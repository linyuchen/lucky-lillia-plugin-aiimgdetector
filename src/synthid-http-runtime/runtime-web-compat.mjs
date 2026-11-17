// Narrow, functional missing-Web-API compatibility for an isolated JSDOM realm.
// This is not a browser sandbox and does not forge native function source.
import generatedUtils from 'jsdom/lib/jsdom/living/generated/utils.js';
import PerformanceModule from 'jsdom/lib/jsdom/living/hr-time/Performance-impl.js';
import jsdomPackage from 'jsdom/package.json' with { type: 'json' };
import {quantizeCompletedClock100us} from './runtime-clock-precision-control.mjs';
const MAX_ENTRIES = 512;
const TIMING_FIELDS = ['workerStart', 'redirectStart', 'redirectEnd', 'fetchStart',
  'domainLookupStart', 'domainLookupEnd', 'connectStart', 'secureConnectionStart',
  'connectEnd', 'requestStart', 'responseStart', 'responseEnd', 'transferSize',
  'encodedBodySize', 'decodedBodySize'];
const STRING_FIELDS = ['initiatorType', 'nextHopProtocol', 'deliveryType'];
const dataValue = (object, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor && !Object.hasOwn(descriptor, 'value')) throw TypeError('WEB_COMPAT_DATA_OPTIONS_REQUIRED');
  return descriptor?.value;
};
const finiteNonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
// Authored-interface brands are shared across isolated realms. These weak
// registries and their bridges are never installed on a Window or navigator.
const activationByWindow = new WeakMap(), activationByNavigator = new WeakMap(), activationByInstance = new WeakMap();
const activationReadFields = ['navigator', 'hasBeenActive', 'isActive', 'invalidReceiver', 'foreignGetter',
  'stickyTrue', 'stickyFalse', 'activeTrue', 'activeFalse'];
const activationReadKinds = ['top', 'connectedChild', 'detachedChild'];
const emptyActivationReads = () => Object.fromEntries(activationReadKinds.map(kind => [kind, Object.fromEntries(activationReadFields.map(field => [field, 0]))]));
const copyActivationReads = record => Object.fromEntries(activationReadKinds.map(kind => [kind, { ...record.reads[kind] }]));
function activationRealmKind(record) {
  // Use JSDOM implementation nodes, never a page getter, to classify the
  // receiver's frame at the time of the actual API read (including detach).
  record.frame ??= Object.getOwnPropertyDescriptor(record.window, '_frameElement')?.value;
  if (!record.frame) return 'top';
  let frame = record.frame;
  const visited = new Set();
  while (frame) {
    if (visited.has(frame) || visited.size >= 256 || !frame.isConnected) return 'detachedChild';
    visited.add(frame);
    frame = Object.getOwnPropertyDescriptor(frame._ownerDocument?._defaultView ?? {}, '_frameElement')?.value;
  }
  return 'connectedChild';
}
function countActivationRead(record, field) {
  const row = record.reads[activationRealmKind(record)];
  row[field] = Math.min(1000000, row[field] + 1);
}
function makeActivationBridge(window) {
  let ownRecord;
  return Object.freeze({
    register(navigator, instance, clock) {
      if (ownRecord || activationByWindow.has(window) || typeof clock !== 'function') throw Error('ACTIVATION_REGISTRATION_FAILED');
      ownRecord = { window, navigator, instance, clock, sticky: false, startedAt: 0, transientMs: 0,
        reads: emptyActivationReads(), controller: undefined, frame: undefined };
      activationByWindow.set(window, ownRecord); activationByNavigator.set(navigator, ownRecord); activationByInstance.set(instance, ownRecord);
    },
    read(kind, receiver) {
      const record = kind === 'navigator' ? activationByNavigator.get(receiver) : activationByInstance.get(receiver);
      if (!record) { if (ownRecord) countActivationRead(ownRecord, 'invalidReceiver'); return undefined; }
      countActivationRead(record, kind);
      if (record !== ownRecord) countActivationRead(record, 'foreignGetter');
      if (kind === 'navigator') return record.instance;
      const value = kind === 'hasBeenActive' ? record.sticky
        : record.sticky && record.transientMs > 0 && record.clock() - record.startedAt < record.transientMs;
      countActivationRead(record, kind === 'hasBeenActive' ? value ? 'stickyTrue' : 'stickyFalse' : value ? 'activeTrue' : 'activeFalse');
      return value;
    },
    snapshot() { return ownRecord ? copyActivationReads(ownRecord) : undefined; },
    dispose() {
      if (!ownRecord) return;
      activationByWindow.delete(window); activationByNavigator.delete(ownRecord.navigator); activationByInstance.delete(ownRecord.instance);
      // Keep the counter record for the trusted controller's final snapshot.
    },
  });
}

/** Explicit diagnostic state, not a trusted user event. It changes the receiver
 * instance's private state without replacing getters or altering their brands. */
export function createRuntimeUserActivationDiagnostic(window, transientMs = 0) {
  if (![0, 5000].includes(transientMs)) throw TypeError('INVALID_ACTIVATION_CONTROL');
  const record = activationByWindow.get(window);
  if (!record) throw TypeError('ACTIVATION_STATE_UNAVAILABLE');
  const previous = { sticky: record.sticky, startedAt: record.startedAt, transientMs: record.transientMs, controller: record.controller };
  const identity = {}; let disposed = false;
  const snapshot = () => ({ diagnosticOnly: true, sticky: record.sticky,
    transient: record.sticky && record.transientMs > 0 && record.clock() - record.startedAt < record.transientMs,
    transientMs: record.transientMs, disposed });
  const activate = () => {
    if (disposed) throw Error('ACTIVATION_CONTROL_DISPOSED');
    record.controller = identity; record.startedAt = record.clock(); record.sticky = true; record.transientMs = transientMs;
    return snapshot();
  };
  activate();
  return { activate, snapshot, dispose() {
    if (disposed) return; disposed = true;
    if (record.controller === identity) Object.assign(record, previous);
  } };
}

// Shared by the child hook so only this small, copied numerical sample crosses
// into a child. Incomplete samples do not become invented network information.
export function normalizeRuntimeNetworkSample(input) {
  if (input === undefined || input === null) return undefined;
  if (typeof input !== 'object' || Array.isArray(input)) throw TypeError('WEB_COMPAT_INVALID_NETWORK_SAMPLE');
  const result = {};
  const fields = ['requestStart', 'responseStart', 'responseEnd', 'encodedBodySize'];
  for (const key of fields) {
    const value = dataValue(input, key);
    if (value === undefined) continue;
    if (!finiteNonnegative(value) || value > Number.MAX_SAFE_INTEGER) throw TypeError('WEB_COMPAT_INVALID_NETWORK_SAMPLE');
    result[key] = value;
  }
  if (fields.some(key => !Object.hasOwn(result, key))) return undefined;
  if (!Number.isSafeInteger(result.encodedBodySize) || result.responseStart < result.requestStart
      || result.responseEnd < result.responseStart) throw TypeError('WEB_COMPAT_INVALID_NETWORK_SAMPLE');
  if (result.encodedBodySize === 0 || result.responseEnd === result.requestStart) return undefined;
  return result;
}

/** options.physicalMemoryBytes: actual host RAM, read by the trusted parent.
 * options.performanceEntries: actual completed HTTP timings; startTime and all
 * timing fields must use this window's performance.timeOrigin, in milliseconds.
 * Omit records when that clock correspondence is not known. No entries are
 * invented. Install once, before page code; call dispose before window.close. */
export function installRuntimeWebCompat(window, options = {}) {
  if (!window || window.Function === Function || typeof window.eval !== 'function'
      || !options || typeof options !== 'object') throw TypeError('WEB_COMPAT_ISOLATED_REALM_REQUIRED');
  const physicalMemoryBytes = dataValue(options, 'physicalMemoryBytes');
  if (physicalMemoryBytes !== undefined && (!Number.isSafeInteger(physicalMemoryBytes) || physicalMemoryBytes <= 0)) {
    throw TypeError('WEB_COMPAT_INVALID_MEMORY');
  }
  const deviceMemoryMaxGiB = dataValue(options, 'deviceMemoryMaxGiB') ?? 8;
  if (![8, 32].includes(deviceMemoryMaxGiB)) throw TypeError('WEB_COMPAT_INVALID_MEMORY_CEILING');
  const platform = dataValue(options, 'platform');
  if (platform !== undefined && !['Win32', 'MacIntel', 'Linux x86_64', 'Linux aarch64'].includes(platform)) throw TypeError('WEB_COMPAT_INVALID_PLATFORM');
  const virtualScreen = dataValue(options, 'virtualScreen') ?? false;
  if (typeof virtualScreen !== 'boolean') throw TypeError('WEB_COMPAT_INVALID_SCREEN');
  const suppliedVirtualMouse = dataValue(options, 'virtualMouse');
  const virtualMouse = suppliedVirtualMouse === undefined ? false : suppliedVirtualMouse;
  if (typeof virtualMouse !== 'boolean') throw TypeError('WEB_COMPAT_INVALID_MOUSE');
  const networkSample = normalizeRuntimeNetworkSample(dataValue(options, 'networkSample'));
  const suppliedClockPrecision=dataValue(options,'clockPrecision100us');
  const clockPrecision100us=suppliedClockPrecision===undefined?false:suppliedClockPrecision;
  if(typeof clockPrecision100us!=='boolean')throw TypeError('WEB_COMPAT_INVALID_CLOCK_PRECISION');
  const suppliedUserActivation = dataValue(options, 'userActivationWebIdlCompatibility');
  const userActivationWebIdlCompatibility = suppliedUserActivation === undefined ? false : suppliedUserActivation;
  if (typeof userActivationWebIdlCompatibility !== 'boolean') throw TypeError('WEB_COMPAT_INVALID_USER_ACTIVATION');
  const performanceTimeOriginEpochMs = dataValue(options, 'performanceTimeOriginEpochMs');
  if (performanceTimeOriginEpochMs !== undefined && (!finiteNonnegative(performanceTimeOriginEpochMs)
      || performanceTimeOriginEpochMs === 0 || performanceTimeOriginEpochMs > window.performance.timeOrigin)) throw TypeError('WEB_COMPAT_INVALID_TIME_ORIGIN');
  const supplied = dataValue(options, 'performanceEntries') ?? [];
  if (!Array.isArray(supplied) || supplied.length > MAX_ENTRIES) throw TypeError('WEB_COMPAT_INVALID_ENTRIES');
  const entries = Array.from({ length: supplied.length }, (_, index) => {
    const input = dataValue(supplied, String(index));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw TypeError('WEB_COMPAT_INVALID_ENTRY');
    const entry = {};
    for (const key of ['name', 'entryType', 'startTime', 'duration', ...TIMING_FIELDS, ...STRING_FIELDS]) {
      const value = dataValue(input, key);
      if (value !== undefined) entry[key] = value;
    }
    if (typeof entry.name !== 'string' || entry.name.length > 8192
        || !['resource', 'navigation'].includes(entry.entryType)
        || !finiteNonnegative(entry.startTime) || !finiteNonnegative(entry.duration)) throw TypeError('WEB_COMPAT_INVALID_ENTRY');
    if (TIMING_FIELDS.some(key => key in entry && !finiteNonnegative(entry[key]))
        || STRING_FIELDS.some(key => key in entry && (typeof entry[key] !== 'string' || entry[key].length > 256))) {
      throw TypeError('WEB_COMPAT_INVALID_ENTRY');
    }
    return entry;
  });
  // Keep the ORIGINAL JSDOM monotonic clock and its private event-clock users
  // aligned to the actual HTTP-session origin. No host callable enters the realm.
  let performanceImpl, oldOrigin, oldNowAtOrigin, clockOffsetMs = 0;
  if (performanceTimeOriginEpochMs !== undefined) {
    performanceImpl = generatedUtils.implForWrapper(window.performance);
    if (jsdomPackage.version !== '26.1.0' || !PerformanceModule.implementation.prototype.isPrototypeOf(performanceImpl)
        || !Number.isFinite(performanceImpl._nowAtTimeOrigin) || !Number.isFinite(performanceImpl.timeOrigin)) {
      throw TypeError('WEB_COMPAT_UNSUPPORTED_CLOCK');
    }
    oldOrigin = performanceImpl.timeOrigin;
    oldNowAtOrigin = performanceImpl._nowAtTimeOrigin;
    clockOffsetMs = oldOrigin - performanceTimeOriginEpochMs;
    performanceImpl.timeOrigin = performanceTimeOriginEpochMs;
    performanceImpl._nowAtTimeOrigin = oldNowAtOrigin - clockOffsetMs;
  }
  const restoreClock = () => {
    if (!performanceImpl) return;
    performanceImpl.timeOrigin = oldOrigin;
    performanceImpl._nowAtTimeOrigin = oldNowAtOrigin;
    performanceImpl = undefined;
  };
  // Options and installed methods are realm-owned; Event/DOMException keep the
  // existing JSDOM wrappers.
  const payload = JSON.stringify({ physicalMemoryBytes, deviceMemoryMaxGiB, platform, virtualScreen, virtualMouse,
    entries, clockOffsetMs, networkSample, clockPrecision100us, userActivationWebIdlCompatibility,
    rebaseClock: performanceTimeOriginEpochMs !== undefined });
  const activationBridge = userActivationWebIdlCompatibility ? makeActivationBridge(window) : undefined;
  try {
    let controller;
    if (activationBridge) {
      controller=Reflect.apply(window.eval('('+installInRealm.toString()+')'),undefined,[window.eval('('+payload+')'),
        clockPrecision100us ? window.eval('('+quantizeCompletedClock100us.toString()+')') : undefined,activationBridge]);
    }else controller = window.eval('(' + installInRealm.toString() + ')(' + payload + ',' + (clockPrecision100us?'('+quantizeCompletedClock100us.toString()+')':'undefined') + ')');
    // This controller remains in the trusted parent, never on the window.
    return { installed: controller.installed, snapshot() { return { ...controller.snapshot(),
      ...(activationBridge ? { userActivationReads: activationBridge.snapshot() } : {}) }; },
      dispose() { try { controller.dispose(); } finally { activationBridge?.dispose(); restoreClock(); } } };
  } catch (error) { activationBridge?.dispose(); restoreClock(); throw error; }
}

function installInRealm(options,quantizeClock,activationBridge) {
  'use strict';
  const win = globalThis;
  const saved = [];
  const installed = [];
  const now = win.performance.now.bind(win.performance);
  const schedule = win.setTimeout.bind(win);
  const unschedule = win.clearTimeout.bind(win);
  let disposed = false;
  function install(object, key, descriptor, label = key, replace = false) {
    if (!replace && key in object) return false;
    const previous = Object.getOwnPropertyDescriptor(object, key);
    const next = { configurable: true, enumerable: true, ...descriptor };
    Object.defineProperty(object, key, next);
    saved.push({ object, key, previous, next });
    installed.push(label);
    return true;
  }
  const activeLists = new Set();
  const listState = new WeakMap();
  // Diagnostic-only query labels. Unknown strings stay inside the runtime and
  // are never retained. Reads reuse the already constructed list's state.
  const mediaQueryLabels = new Set(['screen', 'all', 'not all',
    '(pointer: fine)', '(pointer: coarse)', '(pointer: none)',
    '(any-pointer: fine)', '(any-pointer: coarse)', '(any-pointer: none)',
    '(hover: hover)', '(hover: none)', '(any-hover: hover)', '(any-hover: none)',
    '(prefers-color-scheme: light)', '(prefers-color-scheme: dark)', '(prefers-color-scheme: no-preference)',
    '(prefers-reduced-motion: reduce)', '(prefers-reduced-motion: no-preference)',
    '(forced-colors: active)', '(forced-colors: none)',
    '(display-mode: browser)', '(display-mode: fullscreen)', '(display-mode: standalone)', '(display-mode: minimal-ui)',
    '(resolution: 1dppx)', '(resolution: 1.5dppx)', '(resolution: 2dppx)',
  ]);
  const mediaQueries = { diagnosticOnly: true, fixedPublicQueriesOnly: true,
    declaredVirtualMouse: options.virtualMouse,
    targetPropertyReadsIntroduced: 0, extraQueryConversions: 0,
    maximumRecords: 32, calls: 0, unknown: 0, limitReached: false, records: [] };
  function recordMediaQuery(media, matches) {
    mediaQueries.calls = Math.min(1000000, mediaQueries.calls + 1);
    const label = media.trim().toLowerCase().replace(/\s+/g, ' ')
      .replace(/\(\s*/g, '(').replace(/\s*\)/g, ')').replace(/\s*:\s*/g, ': ');
    if (!mediaQueryLabels.has(label)) {
      mediaQueries.unknown = Math.min(1000000, mediaQueries.unknown + 1); return;
    }
    if (mediaQueries.records.length >= mediaQueries.maximumRecords) { mediaQueries.limitReached = true; return; }
    mediaQueries.records.push({ query: label, matches });
  }
  const number = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
  const dimensionPattern = new RegExp('^(' + number + ')(px|em|rem|in|cm|mm|q|pt|pc)?$');
  function dimension(text, resolution = false) {
    if (resolution) {
      const match = new RegExp('^(' + number + ')(dppx|dpi|dpcm|x)$').exec(text);
      if (!match) return undefined;
      return Number(match[1]) * ({ dppx: 1, x: 1, dpi: 1 / 96, dpcm: 2.54 / 96 }[match[2]]);
    }
    const match = dimensionPattern.exec(text);
    if (!match || (!match[2] && Number(match[1]) !== 0)) return undefined;
    // Media-query em/rem refer to the UA initial font size (16 CSS px), not
    // document styles. This grammar implements CSS absolute/initial lengths.
    return Number(match[1]) * ({ px: 1, em: 16, rem: 16, in: 96, cm: 96 / 2.54,
      mm: 96 / 25.4, q: 96 / 101.6, pt: 96 / 72, pc: 16 }[match[2] || 'px']);
  }
  function feature(text) {
    const split = /^([a-z-]+)(?:\s*:\s*(.+))?$/.exec(text.trim());
    if (!split) return false;
    let name = split[1];
    const argument = split[2]?.trim();
    const prefix = /^(min|max)-/.exec(name)?.[1];
    if (prefix) name = name.slice(4);
    // A declared desktop virtual mouse is one fine pointing device that can
    // hover. These are discrete CSS features: min/max forms are unsupported.
    // Without this option the previous unsupported-feature behavior remains.
    if (['pointer', 'any-pointer', 'hover', 'any-hover'].includes(name)) {
      if (!options.virtualMouse || prefix) return false;
      if (argument === undefined) return true;
      return name === 'pointer' || name === 'any-pointer' ? argument === 'fine' : argument === 'hover';
    }
    const width = Number(win.innerWidth), height = Number(win.innerHeight);
    let actual, expected;
    if (name === 'orientation') {
      return !prefix && (argument === 'portrait' ? height >= width : argument === 'landscape' && width > height);
    }
    if (['width', 'height', 'device-width', 'device-height'].includes(name)) {
      actual = name === 'width' ? width : name === 'height' ? height
        : Number(win.screen?.[name === 'device-width' ? 'width' : 'height']);
      if (name.startsWith('device-') && !(actual > 0)) return false;
      expected = argument === undefined ? undefined : dimension(argument);
    } else if (name === 'aspect-ratio') {
      actual = height > 0 ? width / height : undefined;
      const ratio = argument === undefined ? null : /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(argument);
      expected = ratio && Number(ratio[2]) > 0 ? Number(ratio[1]) / Number(ratio[2]) : undefined;
    } else if (name === 'resolution') {
      actual = Number(win.devicePixelRatio);
      expected = argument === undefined ? undefined : dimension(argument, true);
    } else return false;
    if (!Number.isFinite(actual)) return false;
    if (argument === undefined) return !prefix && actual > 0;
    if (!Number.isFinite(expected)) return false;
    return prefix === 'min' ? actual >= expected : prefix === 'max' ? actual <= expected : Math.abs(actual - expected) <= 1e-9;
  }
  function evaluate(query) {
    if (!query.trim()) return true;
    const alternatives = query.toLowerCase().split(',');
    if (alternatives.length > 64) return false;
    return alternatives.some(raw => {
      let text = raw.trim();
      let negate = false;
      const modifier = /^(not|only)\s+/.exec(text);
      if (modifier) { negate = modifier[1] === 'not'; text = text.slice(modifier[0].length); }
      let result = true;
      const media = /^([a-z-]+)(?:\s+|$)/.exec(text);
      if (media) {
        result = media[1] === 'all' || media[1] === 'screen';
        text = text.slice(media[0].length).trim();
        if (text) {
          if (!/^and\s+/.test(text)) return false;
          text = text.replace(/^and\s+/, '');
        }
      } else if (modifier) return false; // MQ3 modifiers require a media type.
      let count = 0;
      while (text) {
        const part = /^\(([^()]*)\)/.exec(text);
        if (!part || ++count > 64) return false;
        result = feature(part[1]) && result;
        text = text.slice(part[0].length).trim();
        if (text) {
          if (!/^and\s+/.test(text)) return false;
          text = text.replace(/^and\s+/, '');
          if (!text) return false;
        }
      }
      if (!media && !count) return false;
      return negate ? !result : result;
    });
  }
  const mqlKey = {};
  class MediaQueryList {
    constructor(key, media) {
      if (key !== mqlKey) throw new TypeError('Illegal constructor');
      const result = Reflect.construct(EventTarget, [], new.target);
      listState.set(result, { media, matches: evaluate(media), onchange: null, handler: null });
      return result;
    }
    get media() { return listState.get(this).media; }
    get matches() { return evaluate(listState.get(this).media); }
    get onchange() { return listState.get(this).onchange; }
    set onchange(value) {
      const state = listState.get(this);
      state.onchange = typeof value === 'function' ? value : null;
      if (!state.handler) {
        state.handler = event => { if (state.onchange) Reflect.apply(state.onchange, this, [event]); };
        this.addEventListener('change', state.handler);
      }
    }
    addListener(listener) { this.addEventListener('change', listener); }
    removeListener(listener) { this.removeEventListener('change', listener); }
  }
  Object.setPrototypeOf(MediaQueryList.prototype, EventTarget.prototype);
  function onResize() {
    for (const list of activeLists) {
      const state = listState.get(list);
      const matches = evaluate(state.media);
      if (matches === state.matches) continue;
      state.matches = matches;
      const event = new Event('change');
      Object.defineProperties(event, { matches: { value: matches, enumerable: true }, media: { value: state.media, enumerable: true } });
      list.dispatchEvent(event);
    }
  }
  const mediaInstalled = install(win, 'matchMedia', { writable: true, value: function matchMedia(query) {
    if (arguments.length === 0) throw new TypeError('matchMedia requires one argument');
    if (disposed) throw new DOMException('Runtime disposed', 'InvalidStateError');
    const media = String(query);
    if (media.length > 4096 || activeLists.size >= 1024) throw new DOMException('Media query limit', 'QuotaExceededError');
    const list = new MediaQueryList(mqlKey, media);
    activeLists.add(list);
    recordMediaQuery(media, listState.get(list).matches);
    return list;
  } });
  if (mediaInstalled) {
    install(win, 'MediaQueryList', { writable: true, value: MediaQueryList });
    win.addEventListener('resize', onResize);
  }

  const pending = new Map();
  let nextHandle = 0;
  const deadlineState = new WeakMap();
  const deadlineKey = {};
  class IdleDeadline {
    constructor(key, didTimeout, end) {
      if (key !== deadlineKey) throw new TypeError('Illegal constructor');
      deadlineState.set(this, { didTimeout, end });
    }
    get didTimeout() { return deadlineState.get(this).didTimeout; }
    timeRemaining() {
      const state = deadlineState.get(this);
      return state.didTimeout ? 0 : Math.max(0, Math.min(50, state.end - now()));
    }
  }
  // A Node task boundary approximates an available idle turn; it is not a
  // renderer idle scheduler. Deadlines use the actual monotonic realm clock.
  const idleInstalled = !('requestIdleCallback' in win) && !('cancelIdleCallback' in win);
  if (idleInstalled) {
    install(win, 'requestIdleCallback', { writable: true, value: function requestIdleCallback(callback, idleOptions = {}) {
      if (typeof callback !== 'function') throw new TypeError('Idle callback must be callable');
      if (disposed) throw new DOMException('Runtime disposed', 'InvalidStateError');
      if (pending.size >= 1024) throw new DOMException('Idle callback limit', 'QuotaExceededError');
      const timeoutValue = idleOptions?.timeout;
      let timeout;
      if (timeoutValue !== undefined) {
        timeout = Number(timeoutValue);
        if (!Number.isFinite(timeout) || timeout < 0 || timeout > 4294967295) throw new TypeError('Invalid idle timeout');
        timeout = Math.floor(timeout);
      }
      const requestedAt = now();
      do { nextHandle = nextHandle % 4294967295 + 1; } while (pending.has(nextHandle));
      const handle = nextHandle;
      const timer = schedule(() => {
        if (!pending.delete(handle) || disposed) return;
        const startedAt = now();
        const didTimeout = timeout !== undefined && startedAt - requestedAt >= timeout;
        Reflect.apply(callback, win, [new IdleDeadline(deadlineKey, didTimeout, startedAt + 50)]);
      }, 1);
      pending.set(handle, timer);
      return handle;
    } });
    install(win, 'cancelIdleCallback', { writable: true, value: function cancelIdleCallback(handle) {
      const id = Number(handle) >>> 0;
      if (pending.has(id)) { unschedule(pending.get(id)); pending.delete(id); }
    } });
    install(win, 'IdleDeadline', { writable: true, value: IdleDeadline });
  }

  const animationFrames = new Set();
  let cancelFrame;
  if ((options.rebaseClock || options.clockPrecision100us) && typeof win.requestAnimationFrame === 'function' && typeof win.cancelAnimationFrame === 'function') {
    const requestFrame = win.requestAnimationFrame.bind(win);
    cancelFrame = win.cancelAnimationFrame.bind(win);
    install(win, 'requestAnimationFrame', { writable: true, value: function requestAnimationFrame(callback) {
      if (typeof callback !== 'function') throw new TypeError('Animation callback must be callable');
      if (disposed) throw new DOMException('Runtime disposed', 'InvalidStateError');
      if (animationFrames.size >= 1024) throw new DOMException('Animation callback limit', 'QuotaExceededError');
      const handle = requestFrame(stamp => {
        animationFrames.delete(handle);
        if (!disposed) {
          const completed=stamp+options.clockOffsetMs;
          Reflect.apply(callback, win, [options.clockPrecision100us?quantizeClock(completed):completed]);
        }
      });
      animationFrames.add(handle);
      return handle;
    } }, 'requestAnimationFrame.clock', true);
    install(win, 'cancelAnimationFrame', { writable: true, value: function cancelAnimationFrame(handle) {
      const id = Number(handle) >>> 0;
      animationFrames.delete(id);
      cancelFrame(id);
    } }, 'cancelAnimationFrame.clock', true);
  }

  const entryState = new WeakMap();
  const entryKey = {};
  class PerformanceEntry {
    constructor(key, record) {
      if (key !== entryKey) throw new TypeError('Illegal constructor');
      const data = Object.freeze({ ...record });
      entryState.set(this, data);
      for (const name of Object.keys(data)) if (!['name', 'entryType', 'startTime', 'duration'].includes(name)) {
        Object.defineProperty(this, name, { get: () => data[name], enumerable: true });
      }
    }
    get name() { return entryState.get(this).name; }
    get entryType() { return entryState.get(this).entryType; }
    get startTime() { return entryState.get(this).startTime; }
    get duration() { return entryState.get(this).duration; }
    toJSON() { return { ...entryState.get(this) }; }
  }
  const entries = options.entries.map(entry => new PerformanceEntry(entryKey, entry)).sort((a, b) => a.startTime - b.startTime);
  const performancePrototype = Object.getPrototypeOf(win.performance);
  const checkPerformance = receiver => { if (receiver !== win.performance) throw new TypeError('Illegal invocation'); };
  install(performancePrototype, 'getEntries', { writable: true, value: function getEntries() {
    checkPerformance(this); return entries.slice();
  } }, 'performance.getEntries');
  install(performancePrototype, 'getEntriesByType', { writable: true, value: function getEntriesByType(type) {
    checkPerformance(this);
    if (arguments.length === 0) throw new TypeError('getEntriesByType requires one argument');
    const requested = String(type);
    return entries.filter(entry => entry.entryType === requested);
  } }, 'performance.getEntriesByType');
  install(performancePrototype, 'getEntriesByName', { writable: true, value: function getEntriesByName(name, type) {
    checkPerformance(this);
    if (arguments.length === 0) throw new TypeError('getEntriesByName requires one argument');
    const requested = String(name), requestedType = type === undefined ? undefined : String(type);
    return entries.filter(entry => entry.name === requested && (requestedType === undefined || entry.entryType === requestedType));
  } }, 'performance.getEntriesByName');
  install(win, 'PerformanceEntry', { writable: true, value: PerformanceEntry });
  const navigatorPrototype = Object.getPrototypeOf(win.navigator);
  const checkNavigator = receiver => { if (receiver !== win.navigator) throw new TypeError('Illegal invocation'); };
  // This Node runtime is not controlled by WebDriver. Do not change an existing
  // implementation or hide the ordinary JavaScript getter's source.
  install(navigatorPrototype, 'webdriver', { get: function webdriver() { checkNavigator(this); return false; } }, 'navigator.webdriver');
  install(navigatorPrototype, 'maxTouchPoints', { get: function maxTouchPoints() { checkNavigator(this); return 0; } }, 'navigator.maxTouchPoints');
  const activationKey = {};
  const activations = new WeakSet();
  const LegacyUserActivation = class UserActivation {
    constructor(key) { if (key !== activationKey) throw new TypeError('Illegal constructor'); activations.add(this); }
    get isActive() { if (!activations.has(this)) throw new TypeError('Illegal invocation'); return false; }
    get hasBeenActive() { if (!activations.has(this)) throw new TypeError('Illegal invocation'); return false; }
  };
  let UserActivation = LegacyUserActivation;
  let activation;
  if (options.userActivationWebIdlCompatibility) {
    // Authored implementation with the retained public WebIDL descriptor shape.
    // The class stays outside JSDOM's generated-constructor registry; neither
    // native callable identity nor native function source is asserted here.
    UserActivation = class UserActivation {
      constructor() { throw new TypeError('Illegal constructor'); }
    };
    delete UserActivation.prototype.constructor;
    const readActivation = (kind, receiver) => {
      let value;
      try { value = activationBridge.read(kind, receiver); }
      catch { throw new TypeError('Illegal invocation'); }
      if (typeof value !== 'boolean') throw new TypeError('Illegal invocation');
      return value;
    };
    const getters = {
      get hasBeenActive() { return readActivation('hasBeenActive', this); },
      get isActive() { return readActivation('isActive', this); },
    };
    Object.defineProperties(UserActivation.prototype, {
      hasBeenActive: Object.getOwnPropertyDescriptor(getters, 'hasBeenActive'),
      isActive: Object.getOwnPropertyDescriptor(getters, 'isActive'),
      constructor: { configurable: true, writable: true, value: UserActivation },
      [Symbol.toStringTag]: { configurable: true, value: 'UserActivation' },
    });
    activation = Object.create(UserActivation.prototype);
  } else activation = new UserActivation(activationKey);
  const activationDescriptor = options.userActivationWebIdlCompatibility
    ? Object.getOwnPropertyDescriptor({ get userActivation() {
      let value;
      try { value = activationBridge.read('navigator', this); } catch { throw new TypeError('Illegal invocation'); }
      if (value === undefined) throw new TypeError('Illegal invocation');
      return value;
    } }, 'userActivation')
    : { get: function userActivation() { checkNavigator(this); return activation; } };
  if (install(navigatorPrototype, 'userActivation', activationDescriptor, 'navigator.userActivation')) {
    install(win, 'UserActivation', { writable: true, value: UserActivation,
      ...(options.userActivationWebIdlCompatibility ? { enumerable: false } : {}) });
    if (options.userActivationWebIdlCompatibility) activationBridge.register(win.navigator, activation, now);
  }
  if (options.networkSample) {
    const sample = options.networkSample;
    // App-measured HTTP path estimates: headers include server/proxy delay, and
    // throughput deliberately includes the entire request, including latency.
    // This is NOT Chromium's native network-quality estimator or a replay.
    const rtt = Math.round((sample.responseStart - sample.requestStart) / 25) * 25;
    const downlink = Math.floor(Math.min(10, sample.encodedBodySize * 8
      / (sample.responseEnd - sample.requestStart) / 1000) * 40) / 40;
    const effectiveType = rtt >= 2000 || downlink <= 0.05 ? 'slow-2g'
      : rtt >= 1400 || downlink <= 0.07 ? '2g'
      : rtt >= 270 || downlink <= 0.7 ? '3g' : '4g';
    const infoKey = {};
    const infoState = new WeakMap();
    class NetworkInformation {
      constructor(key) {
        if (key !== infoKey) throw new TypeError('Illegal constructor');
        const result = Reflect.construct(EventTarget, [], new.target);
        infoState.set(result, { onchange: null, handler: null });
        return result;
      }
      get rtt() { if (!infoState.has(this)) throw new TypeError('Illegal invocation'); return rtt; }
      get downlink() { if (!infoState.has(this)) throw new TypeError('Illegal invocation'); return downlink; }
      get effectiveType() { if (!infoState.has(this)) throw new TypeError('Illegal invocation'); return effectiveType; }
      get saveData() { if (!infoState.has(this)) throw new TypeError('Illegal invocation'); return false; }
      get onchange() { return infoState.get(this).onchange; }
      set onchange(value) {
        const state = infoState.get(this);
        state.onchange = typeof value === 'function' ? value : null;
        if (!state.handler) {
          state.handler = event => { if (state.onchange) Reflect.apply(state.onchange, this, [event]); };
          this.addEventListener('change', state.handler);
        }
      }
    }
    Object.setPrototypeOf(NetworkInformation.prototype, EventTarget.prototype);
    const information = new NetworkInformation(infoKey);
    if (install(navigatorPrototype, 'connection', { get: function connection() { checkNavigator(this); return information; } }, 'navigator.connection')) {
      install(win, 'NetworkInformation', { writable: true, value: NetworkInformation });
    }
  }
  if (options.platform !== undefined) {
    install(navigatorPrototype, 'platform', { get: function platform() { checkNavigator(this); return options.platform; } }, 'navigator.platform', true);
  }
  if (options.virtualScreen) {
    const screen = win.screen;
    const screenPrototype = Object.getPrototypeOf(screen);
    for (const key of ['width', 'height', 'availWidth', 'availHeight']) {
      install(screenPrototype, key, { get: function screenDimension() {
        if (this !== screen) throw new TypeError('Illegal invocation');
        return Number(win[key.endsWith('Width') || key === 'width' ? 'innerWidth' : 'innerHeight']);
      } }, 'screen.' + key, true);
    }
  }
  if (options.physicalMemoryBytes !== undefined) {
    // Device Memory approximation: nearest power of two MiB, ties downward;
    // expose GiB clamped to [0.25, 8]. https://www.w3.org/TR/device-memory/
    const physicalMiB = Math.floor(options.physicalMemoryBytes / 1048576);
    const lower = 2 ** Math.floor(Math.log2(Math.max(1, physicalMiB)));
    const upper = lower * 2;
    const nearest = physicalMiB - lower <= upper - physicalMiB ? lower : upper;
    const memory = Math.min(options.deviceMemoryMaxGiB, Math.max(0.25, nearest / 1024));
    install(navigatorPrototype, 'deviceMemory', { get: function deviceMemory() { checkNavigator(this); return memory; } }, 'navigator.deviceMemory');
  }
  return Object.freeze({
    installed: Object.freeze(installed.slice()),
    snapshot() { return { mediaQueries: { ...mediaQueries, records: mediaQueries.records.map(row => ({ ...row })) } }; },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const timer of pending.values()) unschedule(timer);
      pending.clear();
      if (cancelFrame) for (const handle of animationFrames) cancelFrame(handle);
      animationFrames.clear();
      if (mediaInstalled) win.removeEventListener('resize', onResize);
      activeLists.clear();
      for (const { object, key, previous, next } of saved.reverse()) {
        const current = Object.getOwnPropertyDescriptor(object, key);
        if (!current || current.value !== next.value || current.get !== next.get || current.set !== next.set) continue;
        if (previous) Object.defineProperty(object, key, previous);
        else delete object[key];
      }
    },
  });
}
