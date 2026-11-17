import LocationModule from 'jsdom/lib/jsdom/living/window/Location-impl.js';
import utils from 'jsdom/lib/jsdom/living/generated/utils.js';
import whatwgURL from 'whatwg-url';
import { createRequire } from 'node:module';

// Optional JSDOM26 internal-method diagnostic. No public Location getter/method,
// navigation result, event trust, or official interpreter source is replaced.
// This diagnostic adds observation/timing and is not an acceptance workaround.
const SCHEMES = new Set(['http', 'https', 'javascript', 'data', 'about', 'blob', 'file']);
const MAX_COUNT = 1000000;
const own = (object, key) => {
  if (!object || (typeof object !== 'object' && typeof object !== 'function')) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
};
const count = value => Math.min(MAX_COUNT, value + 1);
const impl = wrapper => own(wrapper, utils.implSymbol);
let activeInstallation;
const installedVersion = createRequire(import.meta.url)('jsdom/package.json').version;

export class NodeNavigationDiagnosticError extends Error {
  constructor(code) { super('Node navigation diagnostic failed: ' + code);this.name = 'LifecycleError';this.code = code; }
}

// URL records supplied by LocationImpl are internal parsed data. Copy only own
// scalar/array data so observations cannot invoke property getters on a fixture.
function urlCopy(record) {
  if (!record || typeof record !== 'object') return undefined;
  const copy = {};
  for (const key of ['scheme', 'username', 'password', 'host', 'port', 'path', 'query', 'fragment']) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return undefined;
    const value = descriptor.value;
    if (Array.isArray(value)) {
      const length = own(value, 'length');
      if (!Number.isInteger(length) || length < 0 || length > 4096) return undefined;
      const items = [];
      for (let index = 0; index < length; index++) {
        const item = own(value, String(index));
        if (typeof item !== 'string' && typeof item !== 'number') return undefined;
        items.push(item);
      }
      copy[key] = items;
    } else if (value === null || typeof value === 'string' || typeof value === 'number') copy[key] = value;
    else return undefined;
  }
  return copy;
}

export function createNodeNavigationDiagnostics(topWindow, { virtualConsole, maximum = 32 } = {}) {
  if (installedVersion !== '26.1.0') throw new NodeNavigationDiagnosticError('UNSUPPORTED_JSDOM_VERSION');
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 128 || !impl(topWindow)) throw new NodeNavigationDiagnosticError('INVALID_OPTIONS');
  if (activeInstallation) throw new NodeNavigationDiagnosticError('ALREADY_ACTIVE');
  const prototype = LocationModule.implementation.prototype;
  const descriptors = Object.fromEntries(['_locationObjectNavigate', 'reload'].map(name => [name, Object.getOwnPropertyDescriptor(prototype, name)]));
  if (Object.values(descriptors).some(descriptor => typeof descriptor?.value !== 'function' || descriptor.writable !== true || descriptor.configurable !== true)) throw new NodeNavigationDiagnosticError('UNSUPPORTED_JSDOM_INTERNALS');
  const expectedTop = own(topWindow, '_globalProxy') || topWindow;
  const helperFrames = new WeakSet();
  const records = [];
  const stack = [];
  const state = { diagnosticOnly: true, attempts: 0, recorded: 0, truncated: false, inspectionFailures: 0,
    navigationNotImplemented: 0, uncapturedNavigationNotImplemented: 0, disposed: false, restored: false };
  const owner = {};
  let disposed = false;
  const belongs = window => Boolean(window && (window === topWindow || window === expectedTop || own(window, '_top') === expectedTop));
  const kind = window => {
    const frame = own(window, '_frameElement');
    if (!frame) return 'top';
    if (helperFrames.has(frame)) return 'helper';
    const attributes = own(frame, '_attributeList');
    if (!Array.isArray(attributes)) return 'other-frame';
    let hasSrc = false, hasSrcdoc = false;
    for (let index = 0; index < Math.min(64, own(attributes, 'length') || 0); index++) {
      const attribute = own(attributes, String(index));
      const name = own(attribute, '_localName');
      if (name === 'src') hasSrc = true;
      if (name === 'srcdoc') hasSrcdoc = true;
    }
    return !hasSrc && !hasSrcdoc ? 'transient' : 'other-frame';
  };
  const capture = (location, targetRecord, method, options) => {
    const document = own(location, '_relevantDocument');
    const window = own(document, '_defaultView');
    if (!belongs(window)) return undefined;
    state.attempts = count(state.attempts);
    const record = { method, frame: kind(window), closed: !own(window, '_document'),
      scheme: 'other', comparable: false, sameCurrentURL: false, sameWithoutFragment: false, hashOnly: false,
      replacement: method !== 'reload' && own(options, 'replacement') === true,
      reload: method === 'reload', predictedBranch: 'unknown', navigationNotImplementedObserved: false, threw: false };
    const current = urlCopy(own(document, '_URL'));
    const target = urlCopy(targetRecord);
    if (target) record.scheme = SCHEMES.has(target.scheme) ? target.scheme : 'other';
    if (current && target) {
      // Serialized private URLs exist only during these comparisons, never in state.
      record.comparable = true;
      record.sameCurrentURL = whatwgURL.serializeURL(current) === whatwgURL.serializeURL(target);
      record.sameWithoutFragment = whatwgURL.serializeURL(current, true) === whatwgURL.serializeURL(target, true);
      record.hashOnly = record.sameWithoutFragment && current.fragment !== target.fragment;
      record.predictedBranch = record.closed ? 'closed-skip'
        : !record.reload && record.sameWithoutFragment ? record.hashOnly ? 'fragment' : 'same-document-noop'
        : target.scheme === 'javascript' ? 'javascript' : 'unsupported-navigation';
    }
    if (records.length < maximum) { records.push(record);state.recorded = records.length; }
    else state.truncated = true;
    return record;
  };
  const wrappers = {};
  for (const name of ['_locationObjectNavigate', 'reload']) {
    const original = descriptors[name].value;
    wrappers[name] = function (...args) {
      let record;
      if (!disposed) {
        try {
          record = capture(this, name === 'reload' ? own(own(this, '_relevantDocument'), '_URL') : args[0], name === 'reload' ? 'reload' : 'navigate', args[1]);
        } catch { state.inspectionFailures = count(state.inspectionFailures); }
      }
      stack.push(record);
      try { return Reflect.apply(original, this, args); }
      catch (error) { if (record) record.threw = true;throw error; }
      finally { stack.pop(); }
    };
  }
  const onError = error => {
    if (disposed || own(error, 'type') !== 'not implemented') return;
    const message = own(error, 'message');
    if (typeof message !== 'string' || !message.startsWith('Not implemented: navigation (except hash changes)')) return;
    state.navigationNotImplemented = count(state.navigationNotImplemented);
    const record = stack.at(-1);
    if (record) record.navigationNotImplementedObserved = true;
    else state.uncapturedNavigationNotImplemented = count(state.uncapturedNavigationNotImplemented);
  };
  try {
    for (const name of Object.keys(wrappers)) Object.defineProperty(prototype, name, { ...descriptors[name], value: wrappers[name] });
    virtualConsole?.on('jsdomError', onError);
    activeInstallation = owner;
  } catch {
    for (const name of Object.keys(wrappers)) if (Object.getOwnPropertyDescriptor(prototype, name)?.value === wrappers[name]) Object.defineProperty(prototype, name, descriptors[name]);
    throw new NodeNavigationDiagnosticError('INSTALL_FAILED');
  }
  return {
    // Root can call this from the existing supplied-resource callback. It stores
    // only the iframe implementation identity, not its URL or attributes.
    noteHelperFrame(frame) { const frameImpl = impl(frame);if (!disposed && frameImpl) helperFrames.add(frameImpl); },
    snapshot() { return { ...state, attempts: records.map(record => ({ ...record })), totalAttempts: state.attempts }; },
    dispose() {
      if (disposed) return;
      disposed = true;state.disposed = true;
      virtualConsole?.removeListener('jsdomError', onError);
      let restored = true;
      for (const name of Object.keys(wrappers)) {
        if (Object.getOwnPropertyDescriptor(prototype, name)?.value === wrappers[name]) Object.defineProperty(prototype, name, descriptors[name]);
        else restored = false;
      }
      state.restored = restored;
      if (activeInstallation === owner) activeInstallation = undefined;
      stack.length = 0;
    },
  };
}
