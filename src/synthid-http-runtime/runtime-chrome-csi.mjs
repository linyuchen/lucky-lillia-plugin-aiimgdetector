// Narrow diagnostic Chrome CSI capability for pinned isolated JSDOM realms.
// Native CSI source: Chromium 157.0.8103.38 chrome/renderer/loadtimes_bindings.cc.
// These are this Node HTTP/DOM lifecycle's own clocks, not captured browser data.
import { types as nodeTypes } from 'node:util';
import WindowModule from 'jsdom/lib/jsdom/browser/Window.js';
import DocumentModule from 'jsdom/lib/jsdom/living/nodes/Document-impl.js';
import EventModule from 'jsdom/lib/jsdom/living/events/Event-impl.js';
import PerformanceModule from 'jsdom/lib/jsdom/living/hr-time/Performance-impl.js';
import utils from 'jsdom/lib/jsdom/living/generated/utils.js';
import jsdomPackage from 'jsdom/package.json' with { type: 'json' };
import { uncoarsenedPerformanceNow } from './runtime-clock-precision-control.mjs';

const get = Object.getOwnPropertyDescriptor, define = Object.defineProperty, apply = Reflect.apply, remove = Reflect.deleteProperty;
const object = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const proxy = nodeTypes.isProxy, own = Object.hasOwn, prototypeOf = Object.getPrototypeOf;
const data = (value, key) => { if (!object(value) || proxy(value)) return undefined; const d = get(value, key); return d && own(d, 'value') ? d.value : undefined; };
const same = (left, right) => !!left && !!right && ['value', 'get', 'set', 'writable', 'enumerable', 'configurable'].every(
  key => own(left, key) === own(right, key) && Object.is(left[key], right[key]));
const MAX_REALMS = 32, LIMIT = 1000000, activeRealms = new WeakSet(); let activeChildHook = false;
const transitions = new Map([['link', 0], ['form-submission', 0], ['form-resubmission', 0], ['back-forward', 6], ['restore', 6], ['reload', 16], ['other', 15]]);
const errorCodes = new Set(['INVALID_OPTIONS', 'UNSUPPORTED_JSDOM', 'UNSUPPORTED_REALM', 'ALREADY_INSTALLED', 'CHILD_HOOK_ALREADY_INSTALLED', 'INSTALL_FAILED']);
export class RuntimeChromeCsiError extends Error {
  constructor(code) { const safe = errorCodes.has(code) ? code : 'INSTALL_FAILED'; super('Runtime Chrome CSI failed: ' + safe); this.name = 'RuntimeChromeCsiError'; this.code = safe; }
}
function inheritedData(target, key) {
  for (let current = target, depth = 0; current && depth < 64; current = prototypeOf(current), depth++) {
    if (proxy(current)) return undefined;
    const d = get(current, key); if (d) return own(d, 'value') ? d : undefined;
  }
}
function hasBinding(target, key) {
  for (let current = target, depth = 0; current && depth < 64; current = prototypeOf(current), depth++) {
    if (proxy(current)) throw new RuntimeChromeCsiError('UNSUPPORTED_REALM');
    if (get(current, key)) return true;
  }
  return false;
}
function implementation(wrapper, expected) {
  const impl = data(wrapper, utils.implSymbol);
  return object(impl) && !proxy(impl) && Object.prototype.isPrototypeOf.call(expected, impl) ? impl : undefined;
}

// Trusted source creates every public function, prototype and result in the
// owning realm. Its private bridges accept no input and return numbers only.
function createInRealm(readOrigin, readElapsed, transition) {
  'use strict';
  const trunc = Math.trunc, finite = Number.isFinite, RealmTypeError = TypeError;
  const stats = { calls: 0, domContentLoadedCompletions: 0, clockFailures: 0 };
  let disposed = false, domContentLoadedEnd = 0;
  const increment = key => { if (!disposed && stats[key] < 1000000) stats[key]++; };
  const sample = () => {
    const origin = readOrigin(), elapsed = readElapsed();
    if (!finite(origin) || !finite(elapsed) || origin <= 0 || elapsed < 0) {
      increment('clockFailures'); throw new RealmTypeError('CSI_CLOCK_UNAVAILABLE');
    }
    return { origin, elapsed };
  };
  // A comma expression prevents inferred name "csi"; strict ordinary functions
  // match the native constructibility, prototype and own caller/arguments shape.
  const callable = (0, function () {
    increment('calls'); const { origin, elapsed } = sample();
    const startE = trunc(origin);
    // Chromium subtracts the legacy integer navigation origin. The actual
    // JSDOM clock is relative to the full origin, including its fraction.
    const elapsedSinceLegacyStart = elapsed + (origin - startE);
    return { startE, onloadT: domContentLoadedEnd, pageT: trunc(elapsedSinceLegacyStart * 1000) / 1000, tran: transition };
  });
  const chrome = { csi: callable };
  return {
    realm: globalThis, chrome,
    completeDomContentLoaded() {
      if (disposed || domContentLoadedEnd !== 0) return;
      const { origin, elapsed } = sample(); domContentLoadedEnd = trunc(origin + elapsed); increment('domContentLoadedCompletions');
    },
    snapshot() { return { ...stats, domContentLoadedCaptured: domContentLoadedEnd !== 0 }; },
    dispose() { disposed = true; },
  };
}

/** Prefer calling inside JSDOM beforeParse. Later performance clock rebasing is
 * observed dynamically. Dispose in reverse order with later createWindow hooks.
 * onloadT remains zero if a past DOMContentLoaded completion was not observed. */
export function installRuntimeChromeCsi(window, options = {}) {
  if (!object(window) || proxy(window) || !object(options) || proxy(options) || Array.isArray(options)) throw new RuntimeChromeCsiError('INVALID_OPTIONS');
  const option = key => { const d = get(options, key); if (d && !own(d, 'value')) throw new RuntimeChromeCsiError('INVALID_OPTIONS'); return d?.value; };
  const children = option('children') ?? false, transition = option('transition') ?? 'other';
  if (typeof children !== 'boolean' || !transitions.has(transition)) throw new RuntimeChromeCsiError('INVALID_OPTIONS');
  if (jsdomPackage.version !== '26.1.0' || typeof uncoarsenedPerformanceNow !== 'function') throw new RuntimeChromeCsiError('UNSUPPORTED_JSDOM');
  if (activeRealms.has(window)) throw new RuntimeChromeCsiError('ALREADY_INSTALLED');
  if (children && activeChildHook) throw new RuntimeChromeCsiError('CHILD_HOOK_ALREADY_INSTALLED');
  const previousFactory = children ? get(WindowModule, 'createWindow') : undefined;
  if (children && (!previousFactory?.writable || typeof previousFactory.value !== 'function')) throw new RuntimeChromeCsiError('UNSUPPORTED_JSDOM');
  const records = []; let disposed = false, installedFactory;
  const stats = { installedRealms: 0, installedBindings: 0, preservedBindings: 0, observedChildren: 0, skippedFactories: 0,
    unsupportedChildren: 0, childFailures: 0, realmLimitReached: false, dispatchHooksInstalled: 0, completedDispatches: 0,
    lateDocuments: 0, dispatchCaptureFailures: 0, clockBridgeFailures: 0, removedBindings: 0, restoredDispatchHooks: 0,
    cleanupConflicts: 0, cleanupFailures: 0, childFactoryRestored: false, childFactoryRestoreConflict: false };
  const increment = key => { stats[key] = Math.min(LIMIT, stats[key] + 1); };
  const totals = { calls: 0, domContentLoadedCompletions: 0, clockFailures: 0, domContentLoadedCapturedRealms: 0 };
  function addStats(target, value) {
    for (const key of ['calls', 'domContentLoadedCompletions', 'clockFailures']) {
      const number = data(value, key); if (!Number.isInteger(number) || number < 0 || number > LIMIT) throw Error('INVALID_STATS');
      target[key] = Math.min(LIMIT, target[key] + number);
    }
    const captured = data(value, 'domContentLoadedCaptured'); if (typeof captured !== 'boolean') throw Error('INVALID_STATS');
    if (captured) target.domContentLoadedCapturedRealms = Math.min(LIMIT, target.domContentLoadedCapturedRealms + 1);
  }
  function snapshot() {
    const current = { ...totals };
    if (!disposed) for (const record of records) if (record.controller) addStats(current, record.controller.snapshot());
    return { schemaVersion: 1, diagnosticOnly: true, runtimeChromeCsi: true, childrenEnabled: children, maximumRealms: MAX_REALMS,
      timingSource: 'node-http-jsdom-monotonic-projection', nativeWallClockModeled: false, microsecondTruncation: true,
      domContentLoadedEndSource: 'trusted-jsdom-dispatch-return', nativeSourceForged: false, sourceRenderingModified: false,
      callableRepresentation: 'realm-anonymous-strict-function', nativeResultSetterSemanticsModeled: false,
      hostCallbacksExposed: false, unrelatedChromeApisAdded: false, ...stats, ...current, disposed };
  }
  function installRealm(realm, isChild = false) {
    if (records.length >= MAX_REALMS) { stats.realmLimitReached = true; return; }
    if (!object(realm) || proxy(realm)) throw new RuntimeChromeCsiError('UNSUPPORTED_REALM');
    if (activeRealms.has(realm)) throw new RuntimeChromeCsiError('ALREADY_INSTALLED');
    const backing = data(realm, '_globalObject'), realmFunction = data(realm, 'Function');
    const document = implementation(data(backing, '_document'), DocumentModule.implementation.prototype);
    // The performance wrapper is the existing JSDOM builtin, read once at install.
    const performance = realm.performance, perf = implementation(performance, PerformanceModule.implementation.prototype);
    if (!backing || data(backing, '_globalProxy') !== realm || typeof realmFunction !== 'function' || realmFunction === Function
        || !document || !perf || data(perf, '_globalObject') !== backing) throw new RuntimeChromeCsiError('UNSUPPORTED_REALM');
    const record = { realm, document, controller: undefined, installed: undefined, previousDispatch: undefined, installedDispatch: undefined };
    records.push(record); activeRealms.add(realm); increment('installedRealms');
    if (hasBinding(realm, 'chrome')) { increment('preservedBindings'); return; }
    const finiteNonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;
    const readOrigin = () => { const value = data(perf, 'timeOrigin'); if (finiteNonnegative(value) && value > 0) return value; if (!disposed) increment('clockBridgeFailures'); return NaN; };
    const readElapsed = () => {
      try {
        // Refuse accessor-backed timing internals before calling the original
        // JSDOM method, which otherwise reads _nowAtTimeOrigin directly.
        const clockOffset = data(perf, '_nowAtTimeOrigin');
        if (typeof clockOffset !== 'number' || !Number.isFinite(clockOffset) || Math.abs(clockOffset) >= Number.MAX_SAFE_INTEGER) throw Error('INVALID_CLOCK');
        const value = apply(uncoarsenedPerformanceNow, perf, []);
        if (!finiteNonnegative(value)) throw Error('INVALID_CLOCK'); return value;
      } catch { if (!disposed) increment('clockBridgeFailures'); return NaN; }
    };
    const create = realmFunction('readOrigin', 'readElapsed', 'transition', 'return (' + createInRealm.toString() + ')(readOrigin,readElapsed,transition)');
    const controller = apply(create, undefined, [readOrigin, readElapsed, transitions.get(isChild ? 'other' : transition)]);
    if (controller.realm !== realm) throw new RuntimeChromeCsiError('UNSUPPORTED_REALM');
    record.controller = controller;
    record.installed = { value: controller.chrome, writable: true, enumerable: true, configurable: true };
    define(realm, 'chrome', record.installed); increment('installedBindings');
    const dispatch = inheritedData(document, '_dispatch');
    if (!dispatch || typeof dispatch.value !== 'function') throw new RuntimeChromeCsiError('UNSUPPORTED_REALM');
    record.previousDispatch = get(document, '_dispatch');
    if (record.previousDispatch && !record.previousDispatch.configurable && !record.previousDispatch.writable) throw new RuntimeChromeCsiError('UNSUPPORTED_REALM');
    if (data(document, '_currentDocumentReadiness') !== 'loading') increment('lateDocuments');
    const original = dispatch.value;
    const dispatchWrapper = function dispatchWithChromeCsiTiming(eventImpl) {
      const result = apply(original, this, arguments);
      if (!disposed && this === document && object(eventImpl) && !proxy(eventImpl)
          && Object.prototype.isPrototypeOf.call(EventModule.implementation.prototype, eventImpl)
          && data(eventImpl, 'type') === 'DOMContentLoaded' && data(eventImpl, 'isTrusted') === true) {
        increment('completedDispatches');
        try { controller.completeDomContentLoaded(); } catch { increment('dispatchCaptureFailures'); }
      }
      return result;
    };
    record.installedDispatch = record.previousDispatch ? { ...record.previousDispatch, value: dispatchWrapper }
      : { value: dispatchWrapper, writable: true, enumerable: false, configurable: true };
    define(document, '_dispatch', record.installedDispatch); increment('dispatchHooksInstalled');
  }
  function restore(target, key, previous, installed, counter) {
    if (!installed) return;
    try {
      if (!same(get(target, key), installed)) { increment('cleanupConflicts'); return; }
      if (previous) define(target, key, previous); else if (!remove(target, key)) throw Error('RESTORE_FAILED');
      increment(counter);
    } catch { increment('cleanupFailures'); }
  }
  function dispose() {
    if (disposed) return snapshot();
    for (const record of records) if (record.controller) { try { addStats(totals, record.controller.snapshot()); } catch { increment('cleanupFailures'); } }
    disposed = true;
    if (installedFactory) {
      try {
        if (same(get(WindowModule, 'createWindow'), installedFactory)) { define(WindowModule, 'createWindow', previousFactory); stats.childFactoryRestored = true; }
        else stats.childFactoryRestoreConflict = true;
      } catch { stats.childFactoryRestoreConflict = true; }
      activeChildHook = false;
    }
    for (let index = records.length - 1; index >= 0; index--) {
      const record = records[index];
      restore(record.document, '_dispatch', record.previousDispatch, record.installedDispatch, 'restoredDispatchHooks');
      restore(record.realm, 'chrome', undefined, record.installed, 'removedBindings');
      try { record.controller?.dispose(); } catch { increment('cleanupFailures'); }
      activeRealms.delete(record.realm);
    }
    records.length = 0; return snapshot();
  }
  try {
    installRealm(window);
    if (children) {
      const original = previousFactory.value;
      const wrapper = function createWindowWithChromeCsi(factoryOptions) {
        const child = apply(original, this, arguments); if (disposed) return child;
        if (!object(factoryOptions) || proxy(factoryOptions) || !get(factoryOptions, 'parentOrigin')) { increment('skippedFactories'); return child; }
        increment('observedChildren');
        if (data(factoryOptions, 'runScripts') !== 'outside-only') { increment('unsupportedChildren'); return child; }
        if (records.length >= MAX_REALMS) { stats.realmLimitReached = true; return child; }
        try { const realm = data(child, '_globalProxy'); if (!realm) increment('unsupportedChildren'); else installRealm(realm, true); }
        catch { increment('childFailures'); } return child;
      };
      installedFactory = { ...previousFactory, value: wrapper };
      define(WindowModule, 'createWindow', installedFactory); activeChildHook = true;
    }
    return Object.freeze({ snapshot, dispose });
  } catch (error) {
    dispose(); throw error instanceof RuntimeChromeCsiError ? error : new RuntimeChromeCsiError('INSTALL_FAILED');
  }
}
