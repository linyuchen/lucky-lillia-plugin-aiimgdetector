// Optional diagnostic binding. The C++ callback invokes the existing getter;
// it does not supply browser plugins or modify Function.prototype.toString.
import { createRequire } from 'node:module';
import WindowModule from 'jsdom/lib/jsdom/browser/Window.js';
import webIdlUtils from 'jsdom/lib/jsdom/living/generated/utils.js';
import generatedNavigator from 'jsdom/lib/jsdom/living/generated/Navigator.js';
import jsdomPackage from 'jsdom/package.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const own = Object.getOwnPropertyDescriptor, define = Object.defineProperty;
const getPrototype = Object.getPrototypeOf, freeze = Object.freeze, is = Object.is;
const apply = Reflect.apply, hasOwn = Object.prototype.hasOwnProperty;
const toSource = Function.prototype.toString;
const fields = ['plugins', 'mimeTypes'];
const descriptorKeys = ['value', 'get', 'set', 'writable', 'enumerable', 'configurable'];
const MAX_REALMS = 32, COUNTER_LIMIT = 1000000;
const activeWindows = new WeakSet();
let activeChildHook = false;
const data = (object, key) => {
  const descriptor = own(object, key);
  return descriptor && apply(hasOwn, descriptor, ['value']) ? descriptor.value : undefined;
};
// Capture the pinned private generated brand check before page code can run.
const navigatorIs = data(generatedNavigator, 'is');
const outcomeFields = ['calls', 'returned', 'threw', 'rejectedReceiver', 'targetThrew', 'predicateThrew'];
const reportOutcomeFields = ['getterCalls', 'getterReturned', 'getterThrew', 'getterRejectedReceiver', 'getterTargetThrew', 'getterPredicateThrew'];
const isObject = value => value !== null && (typeof value === 'object' || typeof value === 'function');
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
export class NativePluginGettersControlError extends Error {
  constructor(code) {
    const safe = codes.has(code) ? code : 'INSTALL_FAILED';
    super('Native plugin getters control failed: ' + safe);
    this.name = 'NativePluginGettersControlError';
    this.code = safe;
  }
}

/** Install after WebIDL realm compatibility, before page code/observers.
 * When children is enabled, dispose before the earlier realm factory hooks.
 * Importing this module never loads the optional native binary. */
export function installNativePluginGettersControl(window, options = {}) {
  if (!isObject(window) || !options || typeof options !== 'object') throw new NativePluginGettersControlError('INVALID_OPTIONS');
  const childrenDescriptor = own(options, 'children');
  if (childrenDescriptor && !apply(hasOwn, childrenDescriptor, ['value'])) throw new NativePluginGettersControlError('INVALID_OPTIONS');
  const children = childrenDescriptor?.value === undefined ? false : childrenDescriptor.value;
  if (typeof children !== 'boolean') throw new NativePluginGettersControlError('INVALID_OPTIONS');
  const brandDescriptor = own(options, 'nativeBrandValidation');
  if (brandDescriptor && !apply(hasOwn, brandDescriptor, ['value'])) throw new NativePluginGettersControlError('INVALID_OPTIONS');
  const nativeBrandValidation = brandDescriptor?.value === undefined ? false : brandDescriptor.value;
  if (typeof nativeBrandValidation !== 'boolean') throw new NativePluginGettersControlError('INVALID_OPTIONS');
  if (jsdomPackage.version !== '26.1.0') throw new NativePluginGettersControlError('UNSUPPORTED_JSDOM');
  if (nativeBrandValidation && typeof navigatorIs !== 'function') throw new NativePluginGettersControlError('UNSUPPORTED_JSDOM');
  if (activeWindows.has(window)) throw new NativePluginGettersControlError('ALREADY_INSTALLED');
  if (children && activeChildHook) throw new NativePluginGettersControlError('CHILD_HOOK_ALREADY_INSTALLED');
  const factoryDescriptor = children ? own(WindowModule, 'createWindow') : undefined;
  if (children && (!factoryDescriptor?.writable || typeof factoryDescriptor.value !== 'function')) throw new NativePluginGettersControlError('UNSUPPORTED_JSDOM');

  // This is deliberately the only native loading site. Off-path module imports
  // work under Node permissions without --allow-addons or a built binary.
  let addon;
  try { addon = require(process.versions.modules === '153'
    ? './engine-canary/native-webidl-bridge/build/Release/native_webidl_bridge.node'
    : './native-webidl-bridge/build/Release/native_webidl_bridge.node'); }
  catch { throw new NativePluginGettersControlError('NATIVE_ADDON_UNAVAILABLE'); }
  const wrapGetter = data(addon, 'wrapGetter'), getCallStats = data(addon, 'getCallStats');
  if (typeof wrapGetter !== 'function' || typeof getCallStats !== 'function') throw new NativePluginGettersControlError('UNSUPPORTED_NATIVE_BRIDGE');
  const getterCallsAvailable = true;
  const realms = [], saved = [];
  let disposed = false, factoryWrapper;
  const stats = {
    installed: false, installedRealms: 0, installedDescriptors: 0,
    installedFields: { plugins: 0, mimeTypes: 0 },
    nativeNamed: { plugins: true, mimeTypes: true },
    exactBuiltinSource: { plugins: true, mimeTypes: true },
    getterCalls: { plugins: 0, mimeTypes: 0 },
    getterReturned: { plugins: 0, mimeTypes: 0 },
    getterThrew: { plugins: 0, mimeTypes: 0 },
    getterRejectedReceiver: { plugins: 0, mimeTypes: 0 },
    getterTargetThrew: { plugins: 0, mimeTypes: 0 },
    getterPredicateThrew: { plugins: 0, mimeTypes: 0 },
    counterReadFailures: 0, observedChildren: 0, skippedFactories: 0,
    unsupportedChildren: 0, childFailures: 0, realmLimitReached: false,
    rolledBackDescriptors: 0, rollbackConflicts: 0, rollbackFailures: 0,
    restoredDescriptors: 0, restoreConflicts: 0, restoreFailures: 0,
    childFactoryRestored: false, childFactoryRestoreConflict: false,
  };
  const increment = key => { if (stats[key] < COUNTER_LIMIT) stats[key]++; };
  function readCounters() {
    if (disposed) return;
    const totals = { plugins: [0, 0, 0, 0, 0, 0], mimeTypes: [0, 0, 0, 0, 0, 0] };
    for (let index = 0; index < saved.length; index++) {
      const item = saved[index];
      try {
        const result = apply(getCallStats, addon, [item.installed.get]), counts = [];
        if (!isObject(result)) { increment('counterReadFailures'); continue; }
        let valid = true;
        for (let fieldIndex = 0; fieldIndex < outcomeFields.length; fieldIndex++) {
          const count = data(result, outcomeFields[fieldIndex]);
          if (typeof count !== 'number' || count < 0 || count > COUNTER_LIMIT || count % 1 !== 0) { valid = false; break; }
          counts[fieldIndex] = count;
        }
        if (!valid) { increment('counterReadFailures'); continue; }
        for (let fieldIndex = 0; fieldIndex < counts.length; fieldIndex++) totals[item.key][fieldIndex] += counts[fieldIndex];
      } catch { increment('counterReadFailures'); }
    }
    for (let fieldIndex = 0; fieldIndex < reportOutcomeFields.length; fieldIndex++) {
      const row = stats[reportOutcomeFields[fieldIndex]];
      row.plugins = totals.plugins[fieldIndex] > COUNTER_LIMIT ? COUNTER_LIMIT : totals.plugins[fieldIndex];
      row.mimeTypes = totals.mimeTypes[fieldIndex] > COUNTER_LIMIT ? COUNTER_LIMIT : totals.mimeTypes[fieldIndex];
    }
  }
  function snapshot() {
    readCounters();
    return {
      schemaVersion: 1, diagnosticOnly: true, genuineNativeBinding: true,
      nativeBrowserImplementation: false, functionIdentityChanged: true,
      rawPrimitiveReceiverPreserved: false,
      functionToStringOverridden: false, nativeSourceForged: false,
      sourceRenderingModified: false, timingNeutral: false, absentApisAdded: 0,
      maximumRealms: MAX_REALMS, counterLimit: COUNTER_LIMIT, childrenEnabled: children, nativeBrandValidation,
      installed: stats.installed, installedRealms: stats.installedRealms,
      installedDescriptors: stats.installedDescriptors,
      installedFields: { plugins: stats.installedFields.plugins, mimeTypes: stats.installedFields.mimeTypes },
      nativeNamed: { plugins: stats.nativeNamed.plugins, mimeTypes: stats.nativeNamed.mimeTypes },
      exactBuiltinSource: { plugins: stats.exactBuiltinSource.plugins, mimeTypes: stats.exactBuiltinSource.mimeTypes },
      getterCallsAvailable,
      getterCalls: { plugins: stats.getterCalls.plugins, mimeTypes: stats.getterCalls.mimeTypes },
      getterReturned: { plugins: stats.getterReturned.plugins, mimeTypes: stats.getterReturned.mimeTypes },
      getterThrew: { plugins: stats.getterThrew.plugins, mimeTypes: stats.getterThrew.mimeTypes },
      getterRejectedReceiver: { plugins: stats.getterRejectedReceiver.plugins, mimeTypes: stats.getterRejectedReceiver.mimeTypes },
      getterTargetThrew: { plugins: stats.getterTargetThrew.plugins, mimeTypes: stats.getterTargetThrew.mimeTypes },
      getterPredicateThrew: { plugins: stats.getterPredicateThrew.plugins, mimeTypes: stats.getterPredicateThrew.mimeTypes },
      counterReadFailures: stats.counterReadFailures, observedChildren: stats.observedChildren,
      skippedFactories: stats.skippedFactories, unsupportedChildren: stats.unsupportedChildren,
      childFailures: stats.childFailures, realmLimitReached: stats.realmLimitReached,
      rolledBackDescriptors: stats.rolledBackDescriptors, rollbackConflicts: stats.rollbackConflicts,
      rollbackFailures: stats.rollbackFailures, restoredDescriptors: stats.restoredDescriptors,
      restoreConflicts: stats.restoreConflicts, restoreFailures: stats.restoreFailures,
      childFactoryRestored: stats.childFactoryRestored,
      childFactoryRestoreConflict: stats.childFactoryRestoreConflict, disposed,
    };
  }
  function installRealm(realm) {
    if (realms.length >= MAX_REALMS) { stats.realmLimitReached = true; return; }
    if (activeWindows.has(realm)) throw new NativePluginGettersControlError('ALREADY_INSTALLED');
    const RealmFunction = data(realm, 'Function');
    const functionPrototype = typeof RealmFunction === 'function' ? data(RealmFunction, 'prototype') : undefined;
    const registry = data(realm, webIdlUtils.ctorRegistrySymbol);
    const Navigator = data(realm, 'Navigator');
    const owner = typeof Navigator === 'function' ? data(Navigator, 'prototype') : undefined;
    if (typeof RealmFunction !== 'function' || RealmFunction === Function || !isObject(functionPrototype) ||
        !isObject(registry) || getPrototype(registry) !== null || data(registry, 'Navigator') !== Navigator || !isObject(owner)) {
      throw new NativePluginGettersControlError('UNSUPPORTED_REALM');
    }
    const pending = [];
    for (let index = 0; index < fields.length; index++) {
      const key = fields[index], previous = own(owner, key);
      if (!previous?.configurable || typeof previous.get !== 'function' || apply(hasOwn, previous, ['value'])) {
        throw new NativePluginGettersControlError('UNSUPPORTED_REALM');
      }
      if (getPrototype(previous.get) !== functionPrototype) throw new NativePluginGettersControlError('REALM_COMPAT_REQUIRED');
      const name = 'get ' + key, originalName = own(previous.get, 'name'), originalLength = own(previous.get, 'length');
      if (originalName?.value !== name || originalLength?.value !== 0 || own(previous.get, 'prototype')) {
        throw new NativePluginGettersControlError('UNSUPPORTED_REALM');
      }
      const getter = apply(wrapGetter, addon, nativeBrandValidation
        ? [RealmFunction, previous.get, name, navigatorIs] : [RealmFunction, previous.get, name]);
      if (typeof getter !== 'function' || getter === previous.get || getPrototype(getter) !== functionPrototype ||
          !sameDescriptor(own(getter, 'name'), originalName) || !sameDescriptor(own(getter, 'length'), originalLength) || own(getter, 'prototype')) {
        throw new NativePluginGettersControlError('UNSUPPORTED_NATIVE_BRIDGE');
      }
      const source = apply(toSource, getter, []);
      const exact = source === 'function ' + name + '() { [native code] }';
      const nativeNamed = key === 'plugins'
        ? /^function\s+get plugins\s*\(\s*\)\s*\{\s*\[native code\]\s*\}$/.test(source)
        : /^function\s+get mimeTypes\s*\(\s*\)\s*\{\s*\[native code\]\s*\}$/.test(source);
      pending[index] = { owner, key, previous, nativeNamed, exact,
        installed: { get: getter, set: previous.set, enumerable: previous.enumerable, configurable: previous.configurable } };
    }
    let changed = 0;
    try {
      for (; changed < pending.length; changed++) {
        const item = pending[changed];
        define(owner, item.key, item.installed);
      }
    } catch (error) {
      // A Proxy trap may apply the attempted descriptor before throwing.
      for (let index = changed; index >= 0; index--) {
        const item = pending[index];
        try {
          const current = own(owner, item.key);
          if (sameDescriptor(current, item.previous)) continue;
          if (!sameDescriptor(current, item.installed)) { increment('rollbackConflicts'); continue; }
          define(owner, item.key, item.previous); increment('rolledBackDescriptors');
        } catch { increment('rollbackFailures'); }
      }
      throw error;
    }
    for (let index = 0; index < pending.length; index++) {
      const item = pending[index];
      saved[saved.length] = item;
      increment('installedDescriptors');
      stats.installedFields[item.key]++;
      stats.nativeNamed[item.key] = stats.nativeNamed[item.key] && item.nativeNamed;
      stats.exactBuiltinSource[item.key] = stats.exactBuiltinSource[item.key] && item.exact;
    }
    realms[realms.length] = realm;
    activeWindows.add(realm); increment('installedRealms');
  }
  function dispose() {
    if (disposed) return snapshot();
    readCounters();
    disposed = true;
    if (factoryWrapper) {
      try {
        const installed = { ...factoryDescriptor, value: factoryWrapper };
        if (!sameDescriptor(own(WindowModule, 'createWindow'), installed)) stats.childFactoryRestoreConflict = true;
        else { define(WindowModule, 'createWindow', factoryDescriptor); stats.childFactoryRestored = true; }
      } catch { stats.childFactoryRestoreConflict = true; }
      activeChildHook = false;
    }
    for (let index = saved.length - 1; index >= 0; index--) {
      const item = saved[index];
      try {
        if (!sameDescriptor(own(item.owner, item.key), item.installed)) { increment('restoreConflicts'); continue; }
        define(item.owner, item.key, item.previous); increment('restoredDescriptors');
      } catch { increment('restoreFailures'); }
    }
    saved.length = 0;
    for (let index = realms.length - 1; index >= 0; index--) activeWindows.delete(realms[index]);
    realms.length = 0;
    return snapshot();
  }
  try {
    installRealm(window);
    if (children) {
      const original = factoryDescriptor.value;
      factoryWrapper = function createWindowWithNativePluginGetters(factoryOptions) {
        const child = apply(original, this, arguments);
        if (disposed) return child;
        if (!isObject(factoryOptions) || !own(factoryOptions, 'parentOrigin')) { increment('skippedFactories'); return child; }
        increment('observedChildren');
        if (data(factoryOptions, 'runScripts') !== 'outside-only') { increment('unsupportedChildren'); return child; }
        if (realms.length >= MAX_REALMS) { stats.realmLimitReached = true; return child; }
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
    throw error instanceof NativePluginGettersControlError ? error : new NativePluginGettersControlError('INSTALL_FAILED');
  }
}
