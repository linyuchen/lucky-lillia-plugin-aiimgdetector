// Optional genuine native canPlayType binding for this owned Node runtime.
// A pinned media brand predicate precedes the unchanged original JSDOM method.
import { createRequire } from 'node:module';
import WindowModule from 'jsdom/lib/jsdom/browser/Window.js';
import webIdlUtils from 'jsdom/lib/jsdom/living/generated/utils.js';
import generatedHTMLMediaElement from 'jsdom/lib/jsdom/living/generated/HTMLMediaElement.js';
import jsdomPackage from 'jsdom/package.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const own = Object.getOwnPropertyDescriptor, define = Object.defineProperty;
const getPrototype = Object.getPrototypeOf, freeze = Object.freeze, is = Object.is;
const apply = Reflect.apply, hasOwn = Object.prototype.hasOwnProperty;
const toSource = Function.prototype.toString;
const MAX_REALMS = 32, COUNTER_LIMIT = 1000000;
const activeWindows = new WeakSet();
let activeChildHook = false;
const data = (object, key) => {
  const descriptor = own(object, key);
  return descriptor && apply(hasOwn, descriptor, ['value']) ? descriptor.value : undefined;
};
const mediaIs = data(generatedHTMLMediaElement, 'is');
const isObject = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const descriptorKeys = ['value', 'get', 'set', 'writable', 'enumerable', 'configurable'];
const outcomeFields = ['calls', 'returned', 'threw', 'rejectedReceiver', 'targetThrew', 'predicateThrew'];
const reportOutcomeFields = ['methodCalls', 'methodReturned', 'methodThrew', 'methodRejectedReceiver', 'methodTargetThrew', 'methodPredicateThrew'];
const sameDescriptor = (left, right) => {
  if (!left || !right) return false;
  for (let index = 0; index < descriptorKeys.length; index++) {
    const key = descriptorKeys[index];
    if (apply(hasOwn, left, [key]) !== apply(hasOwn, right, [key]) || !is(left[key], right[key])) return false;
  }
  return true;
};
const codes = new Set(['INVALID_OPTIONS', 'UNSUPPORTED_JSDOM', 'UNSUPPORTED_REALM',
  'REALM_COMPAT_REQUIRED', 'ALREADY_INSTALLED', 'CHILD_HOOK_ALREADY_INSTALLED',
  'NATIVE_ADDON_UNAVAILABLE', 'UNSUPPORTED_NATIVE_BRIDGE', 'INSTALL_FAILED']);
export class RuntimeNativeMediaControlError extends Error {
  constructor(code) {
    const safe = codes.has(code) ? code : 'INSTALL_FAILED';
    super('Runtime native canPlayType control failed: ' + safe);
    this.name = 'RuntimeNativeMediaControlError'; this.code = safe;
  }
}

/** Install after realm compatibility, before page code/observers.
 * Dispose before earlier child factory hooks. Branded top/foreign media elements
 * delegate to the original method with the same receiver and all arguments.
 * Merely importing this optional module does not load the native binary. */
export function installRuntimeNativeMediaControl(window, options = {}) {
  if (!isObject(window) || !options || typeof options !== 'object') throw new RuntimeNativeMediaControlError('INVALID_OPTIONS');
  const childrenDescriptor = own(options, 'children');
  if (childrenDescriptor && !apply(hasOwn, childrenDescriptor, ['value'])) throw new RuntimeNativeMediaControlError('INVALID_OPTIONS');
  const children = childrenDescriptor?.value === undefined ? false : childrenDescriptor.value;
  if (typeof children !== 'boolean') throw new RuntimeNativeMediaControlError('INVALID_OPTIONS');
  if (jsdomPackage.version !== '26.1.0' || typeof mediaIs !== 'function') throw new RuntimeNativeMediaControlError('UNSUPPORTED_JSDOM');
  if (activeWindows.has(window)) throw new RuntimeNativeMediaControlError('ALREADY_INSTALLED');
  if (children && activeChildHook) throw new RuntimeNativeMediaControlError('CHILD_HOOK_ALREADY_INSTALLED');
  const factoryDescriptor = children ? own(WindowModule, 'createWindow') : undefined;
  if (children && (!factoryDescriptor?.writable || typeof factoryDescriptor.value !== 'function')) throw new RuntimeNativeMediaControlError('UNSUPPORTED_JSDOM');

  let addon;
  try { addon = require(process.versions.modules === '153'
    ? './engine-canary/native-webidl-bridge/build/Release/native_webidl_bridge.node'
    : './native-webidl-bridge/build/Release/native_webidl_bridge.node'); }
  catch { throw new RuntimeNativeMediaControlError('NATIVE_ADDON_UNAVAILABLE'); }
  const wrapCanPlayType = data(addon, 'wrapCanPlayType'), getCallStats = data(addon, 'getCallStats');
  if (typeof wrapCanPlayType !== 'function' || typeof getCallStats !== 'function') throw new RuntimeNativeMediaControlError('UNSUPPORTED_NATIVE_BRIDGE');
  const saved = [];
  let disposed = false, factoryWrapper;
  const stats = {
    installed: false, installedRealms: 0, installedDescriptors: 0,
    nativeNamed: true, exactBuiltinSource: true,
    methodCalls: 0, methodReturned: 0, methodThrew: 0, methodRejectedReceiver: 0,
    methodTargetThrew: 0, methodPredicateThrew: 0, counterReadFailures: 0,
    observedChildren: 0, skippedFactories: 0, unsupportedChildren: 0,
    childFailures: 0, realmLimitReached: false, rolledBackDescriptors: 0,
    rollbackConflicts: 0, rollbackFailures: 0, restoredDescriptors: 0,
    restoreConflicts: 0, restoreFailures: 0,
    childFactoryRestored: false, childFactoryRestoreConflict: false,
  };
  const increment = key => { if (stats[key] < COUNTER_LIMIT) stats[key]++; };
  function readCounters() {
    if (disposed) return;
    const totals = [0, 0, 0, 0, 0, 0];
    for (let index = 0; index < saved.length; index++) {
      try {
        const result = apply(getCallStats, addon, [saved[index].installed.value]), counts = [];
        if (!isObject(result)) { increment('counterReadFailures'); continue; }
        let valid = true;
        for (let fieldIndex = 0; fieldIndex < outcomeFields.length; fieldIndex++) {
          const count = data(result, outcomeFields[fieldIndex]);
          if (typeof count !== 'number' || count < 0 || count > COUNTER_LIMIT || count % 1 !== 0) { valid = false; break; }
          counts[fieldIndex] = count;
        }
        if (!valid) { increment('counterReadFailures'); continue; }
        for (let fieldIndex = 0; fieldIndex < counts.length; fieldIndex++) totals[fieldIndex] += counts[fieldIndex];
      } catch { increment('counterReadFailures'); }
    }
    for (let index = 0; index < reportOutcomeFields.length; index++)
      stats[reportOutcomeFields[index]] = totals[index] > COUNTER_LIMIT ? COUNTER_LIMIT : totals[index];
  }
  function snapshot() {
    readCounters();
    return {
      schemaVersion: 1, diagnosticOnly: true, genuineNativeBinding: true,
      nativeBrowserImplementation: false, functionIdentityChanged: true,
      nativeBrandValidation: true, originalMethodDelegated: true,
      argumentCoercionDelegated: true, codecSupportFabricated: false,
      rawPrimitiveReceiverPreserved: false, functionToStringOverridden: false,
      nativeSourceForged: false, sourceRenderingModified: false,
      timingNeutral: false, absentApisAdded: 0, methodCallsAvailable: true,
      maximumRealms: MAX_REALMS, counterLimit: COUNTER_LIMIT, childrenEnabled: children,
      ...stats, disposed,
    };
  }
  function installRealm(realm) {
    if (saved.length >= MAX_REALMS) { stats.realmLimitReached = true; return; }
    if (!isObject(realm)) throw new RuntimeNativeMediaControlError('UNSUPPORTED_REALM');
    if (activeWindows.has(realm)) throw new RuntimeNativeMediaControlError('ALREADY_INSTALLED');
    const RealmFunction = data(realm, 'Function');
    const functionPrototype = typeof RealmFunction === 'function' ? data(RealmFunction, 'prototype') : undefined;
    const registry = data(realm, webIdlUtils.ctorRegistrySymbol), HTMLMediaElement = data(realm, 'HTMLMediaElement');
    const owner = typeof HTMLMediaElement === 'function' ? data(HTMLMediaElement, 'prototype') : undefined;
    if (typeof RealmFunction !== 'function' || RealmFunction === Function || !isObject(functionPrototype) ||
        !isObject(registry) || getPrototype(registry) !== null || data(registry, 'HTMLMediaElement') !== HTMLMediaElement || !isObject(owner))
      throw new RuntimeNativeMediaControlError('UNSUPPORTED_REALM');
    const previous = own(owner, 'canPlayType');
    if (!previous?.configurable || typeof previous.value !== 'function' || !apply(hasOwn, previous, ['value']))
      throw new RuntimeNativeMediaControlError('UNSUPPORTED_REALM');
    if (getPrototype(previous.value) !== functionPrototype) throw new RuntimeNativeMediaControlError('REALM_COMPAT_REQUIRED');
    if (data(previous.value, 'name') !== 'canPlayType' || data(previous.value, 'length') !== 1 || own(previous.value, 'prototype'))
      throw new RuntimeNativeMediaControlError('UNSUPPORTED_REALM');
    let method;
    try { method = apply(wrapCanPlayType, addon, [RealmFunction, previous.value, mediaIs]); }
    catch { throw new RuntimeNativeMediaControlError('UNSUPPORTED_NATIVE_BRIDGE'); }
    if (typeof method !== 'function' || method === previous.value || getPrototype(method) !== functionPrototype ||
        !sameDescriptor(own(method, 'name'), { value: 'canPlayType', writable: false, enumerable: false, configurable: true }) ||
        !sameDescriptor(own(method, 'length'), { value: 1, writable: false, enumerable: false, configurable: true }) || own(method, 'prototype') ||
        apply(toSource, method, []) !== 'function canPlayType() { [native code] }')
      throw new RuntimeNativeMediaControlError('UNSUPPORTED_NATIVE_BRIDGE');
    const installed = { value: method, writable: previous.writable, enumerable: previous.enumerable, configurable: previous.configurable };
    try { define(owner, 'canPlayType', installed); }
    catch (error) {
      // Include a Proxy trap that writes the attempted descriptor then throws.
      try {
        const current = own(owner, 'canPlayType');
        if (!sameDescriptor(current, previous)) {
          if (!sameDescriptor(current, installed)) increment('rollbackConflicts');
          else { define(owner, 'canPlayType', previous); increment('rolledBackDescriptors'); }
        }
      } catch { increment('rollbackFailures'); }
      throw error;
    }
    saved[saved.length] = { realm, owner, previous, installed };
    activeWindows.add(realm); increment('installedRealms'); increment('installedDescriptors');
  }
  function dispose() {
    if (disposed) return snapshot();
    readCounters(); disposed = true;
    if (factoryWrapper) {
      try {
        if (!sameDescriptor(own(WindowModule, 'createWindow'), { ...factoryDescriptor, value: factoryWrapper }))
          stats.childFactoryRestoreConflict = true;
        else { define(WindowModule, 'createWindow', factoryDescriptor); stats.childFactoryRestored = true; }
      } catch { stats.childFactoryRestoreConflict = true; }
      activeChildHook = false;
    }
    for (let index = saved.length - 1; index >= 0; index--) {
      const item = saved[index];
      try {
        if (!sameDescriptor(own(item.owner, 'canPlayType'), item.installed)) increment('restoreConflicts');
        else { define(item.owner, 'canPlayType', item.previous); increment('restoredDescriptors'); }
      } catch { increment('restoreFailures'); }
      activeWindows.delete(item.realm);
    }
    saved.length = 0;
    return snapshot();
  }
  try {
    installRealm(window);
    if (children) {
      const original = factoryDescriptor.value;
      factoryWrapper = function createWindowWithNativeMedia(factoryOptions) {
        const child = apply(original, this, arguments);
        if (disposed) return child;
        if (!isObject(factoryOptions) || !own(factoryOptions, 'parentOrigin')) { increment('skippedFactories'); return child; }
        increment('observedChildren');
        if (data(factoryOptions, 'runScripts') !== 'outside-only') { increment('unsupportedChildren'); return child; }
        if (saved.length >= MAX_REALMS) { stats.realmLimitReached = true; return child; }
        try {
          const proxy = data(child, '_globalProxy');
          if (!proxy) increment('unsupportedChildren'); else installRealm(proxy);
        } catch { increment('childFailures'); }
        return child;
      };
      define(WindowModule, 'createWindow', { ...factoryDescriptor, value: factoryWrapper });
      activeChildHook = true;
    }
    stats.installed = true;
    return freeze({ snapshot, dispose });
  } catch (error) {
    dispose();
    throw error instanceof RuntimeNativeMediaControlError ? error : new RuntimeNativeMediaControlError('INSTALL_FAILED');
  }
}
