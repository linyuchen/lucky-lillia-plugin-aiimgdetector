// Abstract Permissions interface only. No Permissions instances are issued.
// Self-contained: root may serialize this installer into another owned realm.
export function installRuntimePermissionsBinding(window) {
  if (window === null || (typeof window !== 'object' && typeof window !== 'function')) {
    throw new TypeError('Invalid Permissions binding realm');
  }
  const own = Object.getOwnPropertyDescriptor;
  const stats = {
    abstractInterface: true, instancesProvisioned: 0, bindingInstalled: false,
    existingBindingPreserved: false, sourceRenderingModified: false,
    disposed: false, bindingRemoved: false, cleanupConflict: false,
  };
  let Constructor;
  const snapshot = () => ({ ...stats });
  const dispose = () => {
    if (stats.disposed) return snapshot();
    stats.disposed = true;
    if (!stats.bindingInstalled) return snapshot();
    const current = own(window, 'Permissions');
    if (!current) return snapshot();
    if (current.value !== Constructor || current.writable !== true || current.configurable !== true || current.enumerable !== false) {
      stats.cleanupConflict = true;
      return snapshot();
    }
    try { stats.bindingRemoved = Reflect.deleteProperty(window, 'Permissions'); }
    catch { stats.bindingRemoved = false; }
    stats.cleanupConflict = !stats.bindingRemoved;
    return snapshot();
  };
  const api = Object.freeze({ snapshot, dispose });
  // Preserve existing own or inherited bindings, including accessors, without
  // invoking them or claiming ownership of them.
  if ('Permissions' in window) { stats.existingBindingPreserved = true; return api; }
  const RealmFunction = own(window, 'Function')?.value;
  if (typeof RealmFunction !== 'function') throw new TypeError('Invalid Permissions binding realm');
  const create = RealmFunction([
    '"use strict";',
    'const RealmTypeError = TypeError;',
    'const RealmPromise = Promise;',
    'function Permissions() {',
    '  throw new RealmTypeError(new.target ? "Failed to construct \'Permissions\': Illegal constructor" : "Illegal constructor");',
    '}',
    // Every receiver is unbranded because this binding provisions no instances.
    // Reject before reading or converting any argument, including missing ones.
    'const prototype = { query(descriptor) {',
    '  return new RealmPromise((resolve, reject) => {',
    '    reject(new RealmTypeError("Failed to execute \'query\' on \'Permissions\': Illegal invocation"));',
    '  });',
    '} };',
    'Object.defineProperty(prototype, "constructor", { value: Permissions, writable: true, enumerable: false, configurable: true });',
    'Object.defineProperty(prototype, Symbol.toStringTag, { value: "Permissions", writable: false, enumerable: false, configurable: true });',
    'Object.defineProperty(Permissions, "prototype", { value: prototype, writable: false, enumerable: false, configurable: false });',
    'return { Constructor: Permissions, realm: globalThis };',
  ].join('\n'));
  const created = create();
  // A JSDOM window without an isolated scripting realm would otherwise create
  // host functions and errors. Do not install that misleading shape.
  if (created.realm !== window || typeof created.Constructor !== 'function') throw new TypeError('Invalid Permissions binding realm');
  if ('Permissions' in window) { stats.existingBindingPreserved = true; return api; }
  Constructor = created.Constructor;
  Object.defineProperty(window, 'Permissions', { value: Constructor, writable: true, enumerable: false, configurable: true });
  stats.bindingInstalled = true;
  return api;
}
