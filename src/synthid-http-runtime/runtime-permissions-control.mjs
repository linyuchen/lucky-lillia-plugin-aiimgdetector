// Optional abstract Permissions bindings for owned isolated JSDOM realms.
import WindowModule from 'jsdom/lib/jsdom/browser/Window.js';
import webIdlUtils from 'jsdom/lib/jsdom/living/generated/utils.js';
import jsdomPackage from 'jsdom/package.json' with { type: 'json' };
import { installRuntimePermissionsBinding } from './runtime-permissions-binding.mjs';

const own = Object.getOwnPropertyDescriptor, define = Object.defineProperty;
const apply = Reflect.apply, hasOwn = Object.prototype.hasOwnProperty;
const getPrototype = Object.getPrototypeOf, freeze = Object.freeze;
const MAX_REALMS = 32, LIMIT = 1000000;
const activeRealms = new WeakSet();
let activeChildHook = false;
const data = (object, key) => {
  const descriptor = own(object, key);
  return descriptor && apply(hasOwn, descriptor, ['value']) ? descriptor.value : undefined;
};
const isObject = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const sameFactory = (left, right) => !!left && !!right && left.value === right.value &&
  left.writable === right.writable && left.enumerable === right.enumerable && left.configurable === right.configurable;
const errorCodes = new Set(['INVALID_OPTIONS', 'UNSUPPORTED_JSDOM', 'UNSUPPORTED_REALM',
  'ALREADY_INSTALLED', 'CHILD_HOOK_ALREADY_INSTALLED', 'INSTALL_FAILED']);
export class RuntimePermissionsControlError extends Error {
  constructor(code) {
    const safe = errorCodes.has(code) ? code : 'INSTALL_FAILED';
    super('Runtime Permissions control failed: ' + safe);
    this.name = 'RuntimePermissionsControlError'; this.code = safe;
  }
}

/** Install before observers; dispose before earlier createWindow hooks.
 * Adds no Permissions instance, navigator.permissions object, or grant. */
export function installRuntimePermissionsControl(window, options = {}) {
  if (!isObject(window) || !options || typeof options !== 'object') throw new RuntimePermissionsControlError('INVALID_OPTIONS');
  const descriptor = own(options, 'children');
  if (descriptor && !apply(hasOwn, descriptor, ['value'])) throw new RuntimePermissionsControlError('INVALID_OPTIONS');
  const children = descriptor?.value === undefined ? false : descriptor.value;
  if (typeof children !== 'boolean') throw new RuntimePermissionsControlError('INVALID_OPTIONS');
  if (jsdomPackage.version !== '26.1.0') throw new RuntimePermissionsControlError('UNSUPPORTED_JSDOM');
  if (activeRealms.has(window)) throw new RuntimePermissionsControlError('ALREADY_INSTALLED');
  if (children && activeChildHook) throw new RuntimePermissionsControlError('CHILD_HOOK_ALREADY_INSTALLED');
  const previousFactory = children ? own(WindowModule, 'createWindow') : undefined;
  if (children && (!previousFactory?.writable || typeof previousFactory.value !== 'function')) throw new RuntimePermissionsControlError('UNSUPPORTED_JSDOM');
  const records = [];
  let disposed = false, installedFactory;
  const stats = {
    installedRealms: 0, installedBindings: 0, existingBindingsPreserved: 0,
    observedChildren: 0, skippedFactories: 0, unsupportedChildren: 0,
    childFailures: 0, realmLimitReached: false, snapshotFailures: 0,
    removedBindings: 0, cleanupConflicts: 0, cleanupFailures: 0,
    childFactoryRestored: false, childFactoryRestoreConflict: false,
  };
  const increment = key => { if (stats[key] < LIMIT) stats[key]++; };
  const snapshot = () => ({
    schemaVersion: 1, diagnosticOnly: true, abstractInterface: true,
    instancesProvisioned: 0, sourceRenderingModified: false, queryCallsAvailable: false,
    childrenEnabled: children, maximumRealms: MAX_REALMS, counterLimit: LIMIT,
    installedRealms: stats.installedRealms, installedBindings: stats.installedBindings,
    existingBindingsPreserved: stats.existingBindingsPreserved,
    observedChildren: stats.observedChildren, skippedFactories: stats.skippedFactories,
    unsupportedChildren: stats.unsupportedChildren, childFailures: stats.childFailures,
    realmLimitReached: stats.realmLimitReached, snapshotFailures: stats.snapshotFailures,
    removedBindings: stats.removedBindings, cleanupConflicts: stats.cleanupConflicts,
    cleanupFailures: stats.cleanupFailures, childFactoryRestored: stats.childFactoryRestored,
    childFactoryRestoreConflict: stats.childFactoryRestoreConflict, disposed,
  });
  function readBinding(record) {
    const report = apply(record.snapshot, record.control, []);
    if (!report || report.abstractInterface !== true || report.instancesProvisioned !== 0 || report.sourceRenderingModified !== false) throw new Error('INVALID_BINDING_REPORT');
    for (const key of ['bindingInstalled', 'existingBindingPreserved', 'disposed', 'bindingRemoved', 'cleanupConflict']) {
      if (typeof report[key] !== 'boolean') throw new Error('INVALID_BINDING_REPORT');
    }
    return report;
  }
  function installRealm(realm) {
    if (records.length >= MAX_REALMS) { stats.realmLimitReached = true; return; }
    if (!isObject(realm)) throw new RuntimePermissionsControlError('UNSUPPORTED_REALM');
    if (activeRealms.has(realm)) throw new RuntimePermissionsControlError('ALREADY_INSTALLED');
    const RealmFunction = data(realm, 'Function'), registry = data(realm, webIdlUtils.ctorRegistrySymbol);
    if (typeof RealmFunction !== 'function' || RealmFunction === Function || !isObject(registry) || getPrototype(registry) !== null)
      throw new RuntimePermissionsControlError('UNSUPPORTED_REALM');
    const control = installRuntimePermissionsBinding(realm);
    const record = { realm, control, snapshot: data(control, 'snapshot'), dispose: data(control, 'dispose') };
    let report;
    try {
      if (typeof record.snapshot !== 'function' || typeof record.dispose !== 'function') throw new Error('INVALID_BINDING_REPORT');
      report = readBinding(record);
    } catch {
      try { if (typeof record.dispose === 'function') apply(record.dispose, control, []); } catch {}
      throw new RuntimePermissionsControlError('INSTALL_FAILED');
    }
    records[records.length] = record; activeRealms.add(realm); increment('installedRealms');
    if (report.bindingInstalled) increment('installedBindings');
    if (report.existingBindingPreserved) increment('existingBindingsPreserved');
  }
  function dispose() {
    if (disposed) return snapshot();
    disposed = true;
    if (installedFactory) {
      try {
        if (!sameFactory(own(WindowModule, 'createWindow'), installedFactory)) stats.childFactoryRestoreConflict = true;
        else { define(WindowModule, 'createWindow', previousFactory); stats.childFactoryRestored = true; }
      } catch { stats.childFactoryRestoreConflict = true; }
      activeChildHook = false;
    }
    for (let index = records.length - 1; index >= 0; index--) {
      const record = records[index];
      try { apply(record.dispose, record.control, []); } catch { increment('cleanupFailures'); }
      try {
        const report = readBinding(record);
        if (report.bindingRemoved) increment('removedBindings');
        if (report.cleanupConflict) increment('cleanupConflicts');
      } catch { increment('snapshotFailures'); }
      activeRealms.delete(record.realm);
    }
    records.length = 0;
    return snapshot();
  }
  try {
    installRealm(window);
    if (children) {
      const original = previousFactory.value;
      const wrapper = function createWindowWithPermissionsBinding(factoryOptions) {
        const child = apply(original, this, arguments);
        if (disposed) return child;
        if (!isObject(factoryOptions) || !own(factoryOptions, 'parentOrigin')) { increment('skippedFactories'); return child; }
        increment('observedChildren');
        if (data(factoryOptions, 'runScripts') !== 'outside-only') { increment('unsupportedChildren'); return child; }
        if (records.length >= MAX_REALMS) { stats.realmLimitReached = true; return child; }
        try {
          const realm = data(child, '_globalProxy');
          if (!realm) increment('unsupportedChildren'); else installRealm(realm);
        } catch { increment('childFailures'); }
        return child;
      };
      installedFactory = { ...previousFactory, value: wrapper };
      define(WindowModule, 'createWindow', installedFactory); activeChildHook = true;
    }
    return freeze({ snapshot, dispose });
  } catch (error) {
    dispose();
    throw error instanceof RuntimePermissionsControlError ? error : new RuntimePermissionsControlError('INSTALL_FAILED');
  }
}
