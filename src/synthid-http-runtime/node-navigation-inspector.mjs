import { Session } from 'node:inspector';
import { randomUUID } from 'node:crypto';
import NavigationModule from 'jsdom/lib/jsdom/living/window/navigation.js';
import utils from 'jsdom/lib/jsdom/living/generated/utils.js';
import whatwgURL from 'whatwg-url';

const SCHEMES = new Set(['http', 'https', 'javascript', 'data', 'about', 'blob', 'file']);
const FRAMES = new Set(['top', 'helper', 'transient', 'other-frame']);
const ERROR_CODES = new Set(['INVALID_OPTIONS', 'ALREADY_ACTIVE', 'INSPECTOR_SETUP_FAILED']);
const own = (object, key) => {
  if (!object || (typeof object !== 'object' && typeof object !== 'function')) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
};
const increment = value => Math.min(1000000, value + 1);
let activeInstallation;
export class NodeNavigationInspectorError extends Error {
  constructor(code) {
    const safeCode = ERROR_CODES.has(code) ? code : 'INSPECTOR_SETUP_FAILED';
    super('Node navigation inspector failed: ' + safeCode);
    this.name = 'NodeNavigationInspectorError'; this.code = safeCode;
  }
}

function copyURL(record) {
  if (!record || typeof record !== 'object') return undefined;
  const result = {};
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
        if ((typeof item !== 'string' && typeof item !== 'number') || (typeof item === 'string' && item.length > 1048576)) return undefined;
        items.push(item);
      }
      result[key] = items;
    } else if (value === null || typeof value === 'number' || (typeof value === 'string' && value.length <= 1048576)) result[key] = value;
    else return undefined;
  }
  return result;
}

function callerSourceKind(url) {
  if (typeof url !== 'string') return 'other';
  const normalized = url.replaceAll(String.fromCharCode(92), '/');
  if (normalized.endsWith('/jsdom/lib/jsdom/living/nodes/HTMLHyperlinkElementUtils-impl.js')) return 'hyperlink';
  if (normalized.endsWith('/jsdom/lib/jsdom/living/window/Location-impl.js')) return 'location';
  return 'other';
}

/** Original-function breakpoint only. Install after JSDOM construction, before
 * the interpreter, with no other debugger controller. Argument values and URLs
 * are reduced to fixed names/booleans inside the process and never returned. */
export async function createNodeNavigationInspector(topWindow, { virtualConsole, maximum = 32, maxDurationMs = 30000 } = {}) {
  if (!own(topWindow, utils.implSymbol) || !Number.isInteger(maximum) || maximum < 1 || maximum > 32 ||
      !Number.isInteger(maxDurationMs) || maxDurationMs < 100 || maxDurationMs > 120000 ||
      typeof NavigationModule.navigate !== 'function') throw new NodeNavigationInspectorError('INVALID_OPTIONS');
  if (activeInstallation) throw new NodeNavigationInspectorError('ALREADY_ACTIVE');
  const owner = {}; activeInstallation = owner;
  const navigate = NavigationModule.navigate;
  const session = new Session();
  const expectedTop = own(topWindow, '_globalProxy') || topWindow;
  const helperFrames = new WeakSet();
  const scriptKinds = new Map();
  const records = [];
  const registryKey = '__synthid_navigation_inspector_' + randomUUID().replaceAll('-', '');
  const objectGroup = 'synthid-navigation-inspector-' + randomUUID();
  const state = { diagnosticOnly: true, sourceModified: false, prototypesModified: false,
    exportReplaced: false, argumentValuesRecorded: false, totalAttempts: 0, recorded: 0,
    outsideScope: 0, inspectionFailures: 0, unexpectedPauses: 0, inspectorErrors: 0,
    navigationNotImplemented: 0, navigationErrorsInCapturedTurn: 0, uncapturedNavigationErrors: 0,
    installedBreakpoints: 0, removedBreakpoints: 0, limitReached: false, durationReached: false,
    scriptLimitReached: false, disposed: false };
  let connected = false, active = false, disposed = false, breakpointId, registryPresent = false;
  let timer, cleanupPromise, pendingTurn = false, turnGeneration = 0;
  let removal = Promise.resolve();
  const post = (method, params = {}) => new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new NodeNavigationInspectorError('INSPECTOR_SETUP_FAILED')), 1000);
    try { session.post(method, params, (error, result) => { clearTimeout(deadline); error ? reject(error) : resolve(result); }); }
    catch (error) { clearTimeout(deadline); reject(error); }
  });
  const resume = () => {
    if (!connected) return;
    try { session.post('Debugger.resume', {}, error => { if (error && !disposed) state.inspectorErrors = increment(state.inspectorErrors); }); }
    catch { if (!disposed) state.inspectorErrors = increment(state.inspectorErrors); }
  };
  const belongs = window => Boolean(window && (window === topWindow || window === expectedTop || own(window, '_top') === expectedTop));
  function frameKind(window) {
    const frame = own(window, '_frameElement');
    if (!frame) return 'top';
    if (helperFrames.has(frame)) return 'helper';
    const attributes = own(frame, '_attributeList');
    if (!Array.isArray(attributes)) return 'other-frame';
    let hasSource = false;
    for (let index = 0; index < Math.min(64, own(attributes, 'length') || 0); index++) {
      const name = own(own(attributes, String(index)), '_localName');
      if (name === 'src' || name === 'srcdoc') hasSource = true;
    }
    return hasSource ? 'other-frame' : 'transient';
  }
  function summarize(window, newURL, flags) {
    if (!belongs(window)) return { matched: false };
    const document = own(own(window, '_document'), utils.implSymbol);
    const current = copyURL(own(document, '_URL'));
    const target = copyURL(newURL);
    const summary = { matched: true, scheme: target && SCHEMES.has(target.scheme) ? target.scheme : 'other',
      frame: frameKind(window), comparable: false, sameCurrentURL: false, sameWithoutFragment: false,
      hashOnly: false, reload: own(flags, 'reloadTriggered') === true, replacement: own(flags, 'replacement') === true };
    if (current && target) {
      summary.sameCurrentURL = whatwgURL.serializeURL(current) === whatwgURL.serializeURL(target);
      summary.sameWithoutFragment = whatwgURL.serializeURL(current, true) === whatwgURL.serializeURL(target, true);
      summary.hashOnly = summary.sameWithoutFragment && current.fragment !== target.fragment;
      summary.comparable = true;
    }
    return summary;
  }
  function removeBreakpoint() {
    const owned = breakpointId; breakpointId = undefined;
    if (!owned || !connected) return removal;
    removal = post('Debugger.removeBreakpoint', { breakpointId: owned })
      .then(() => { state.removedBreakpoints = increment(state.removedBreakpoints); }, () => { state.inspectorErrors = increment(state.inspectorErrors); });
    return removal;
  }
  function parsed({ params }) {
    if (scriptKinds.size >= 6000 && !scriptKinds.has(params.scriptId)) { state.scriptLimitReached = true; return; }
    scriptKinds.set(params.scriptId, callerSourceKind(params.url));
  }
  function paused({ params }) {
    try {
      if (!breakpointId || !(params.hitBreakpoints || []).includes(breakpointId)) { state.unexpectedPauses = increment(state.unexpectedPauses); return; }
      if (!active || disposed) return;
      const frame = params.callFrames?.[0];
      if (!frame?.callFrameId) { state.inspectionFailures = increment(state.inspectionFailures); return; }
      let completed = false, evaluationError, result;
      // For the local same-thread Session this command completes synchronously
      // while paused. If that changes, fail closed and resume without waiting or
      // trying to inspect stale frames. Only reduced data uses returnByValue.
      session.post('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId,
        expression: 'globalThis[' + JSON.stringify(registryKey) + '].summarize(window, newURL, flags)',
        returnByValue: true, silent: true }, (error, response) => { completed = true; evaluationError = error; result = response; });
      if (!completed || evaluationError || result?.exceptionDetails) { state.inspectionFailures = increment(state.inspectionFailures); return; }
      const safe = result?.result?.value;
      pendingTurn = false; const generation = ++turnGeneration;
      if (safe?.matched === false) { state.outsideScope = increment(state.outsideScope); return; }
      const booleans = ['comparable', 'sameCurrentURL', 'sameWithoutFragment', 'hashOnly', 'reload', 'replacement'];
      if (safe?.matched !== true || (!SCHEMES.has(safe.scheme) && safe.scheme !== 'other') || !FRAMES.has(safe.frame) ||
          booleans.some(name => typeof safe[name] !== 'boolean')) { state.inspectionFailures = increment(state.inspectionFailures); return; }
      const caller = scriptKinds.get(params.callFrames?.[1]?.location?.scriptId) || 'other';
      records.push({ scheme: safe.scheme, frame: safe.frame, ...Object.fromEntries(booleans.map(name => [name, safe[name]])), caller });
      state.totalAttempts = increment(state.totalAttempts); state.recorded = records.length;
      pendingTurn = true; queueMicrotask(() => { if (generation === turnGeneration) pendingTurn = false; });
      if (records.length >= maximum) { active = false; state.limitReached = true; void removeBreakpoint(); }
    } catch { state.inspectionFailures = increment(state.inspectionFailures); }
    finally { resume(); }
  }
  function onError(error) {
    if (disposed || own(error, 'type') !== 'not implemented') return;
    const message = own(error, 'message');
    if (typeof message !== 'string' || !message.startsWith('Not implemented: navigation (except hash changes)')) return;
    state.navigationNotImplemented = increment(state.navigationNotImplemented);
    if (pendingTurn) state.navigationErrorsInCapturedTurn = increment(state.navigationErrorsInCapturedTurn);
    else state.uncapturedNavigationErrors = increment(state.uncapturedNavigationErrors);
  }
  async function dispose() {
    if (cleanupPromise) return cleanupPromise;
    active = false;
    cleanupPromise = (async () => {
      clearTimeout(timer);
      await removeBreakpoint();
      if (registryPresent) { delete globalThis[registryKey]; registryPresent = false; }
      virtualConsole?.removeListener('jsdomError', onError);
      if (connected) {
        await post('Runtime.releaseObjectGroup', { objectGroup }).catch(() => { state.inspectorErrors = increment(state.inspectorErrors); });
        await post('Debugger.disable').catch(() => { state.inspectorErrors = increment(state.inspectorErrors); });
        session.off('Debugger.paused', paused); session.off('Debugger.scriptParsed', parsed);
        try { session.disconnect(); } catch { state.inspectorErrors = increment(state.inspectorErrors); }
        connected = false;
      }
      scriptKinds.clear(); pendingTurn = false; disposed = true; state.disposed = true;
      if (activeInstallation === owner) activeInstallation = undefined;
    })();
    return cleanupPromise;
  }
  try {
    session.connect(); connected = true;
    session.on('Debugger.paused', paused); session.on('Debugger.scriptParsed', parsed);
    await post('Debugger.enable');
    Object.defineProperty(globalThis, registryKey, { value: { navigate, summarize }, configurable: true }); registryPresent = true;
    const response = await post('Runtime.evaluate', { expression: 'globalThis[' + JSON.stringify(registryKey) + '].navigate',
      returnByValue: false, silent: true, objectGroup });
    if (response.exceptionDetails || !response.result?.objectId) throw new NodeNavigationInspectorError('INSPECTOR_SETUP_FAILED');
    const breakpoint = await post('Debugger.setBreakpointOnFunctionCall', { objectId: response.result.objectId });
    if (typeof breakpoint.breakpointId !== 'string') throw new NodeNavigationInspectorError('INSPECTOR_SETUP_FAILED');
    breakpointId = breakpoint.breakpointId; state.installedBreakpoints++;
    await post('Runtime.releaseObjectGroup', { objectGroup });
    virtualConsole?.on('jsdomError', onError);
    active = true;
    timer = setTimeout(() => { state.durationReached = true; void dispose(); }, maxDurationMs); timer.unref?.();
  } catch { await dispose(); throw new NodeNavigationInspectorError('INSPECTOR_SETUP_FAILED'); }
  return {
    noteHelperFrame(frame) { const implementation = own(frame, utils.implSymbol); if (!disposed && implementation) helperFrames.add(implementation); },
    snapshot() { return { ...state, attempts: records.map(record => ({ ...record })) }; },
    dispose,
  };
}
