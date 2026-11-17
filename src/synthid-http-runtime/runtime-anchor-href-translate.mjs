// Optional Chrome hrefTranslate DOMString reflection for isolated JSDOM 26.1.0 realms.
import { types as nodeTypes } from 'node:util';
import WindowModule from 'jsdom/lib/jsdom/browser/Window.js';
import anchorGenerated from 'jsdom/lib/jsdom/living/generated/HTMLAnchorElement.js';
import webIdlUtils from 'jsdom/lib/jsdom/living/generated/utils.js';
import elementImplementation from 'jsdom/lib/jsdom/living/nodes/Element-impl.js';
import customElements from 'jsdom/lib/jsdom/living/helpers/custom-elements.js';
import jsdomPackage from 'jsdom/package.json' with { type: 'json' };

const own = Object.getOwnPropertyDescriptor, define = Object.defineProperty;
const getPrototype = Object.getPrototypeOf, apply = Reflect.apply;
const createObject = Object.create;
const hasOwn = Object.prototype.hasOwnProperty, freeze = Object.freeze;
const remove = Reflect.deleteProperty, isProxy = nodeTypes.isProxy;
const anchorIs = anchorGenerated.is, implForWrapper = webIdlUtils.implForWrapper;
const implSymbol = webIdlUtils.implSymbol, wrapperSymbol = webIdlUtils.wrapperSymbol;
const getAttribute = own(elementImplementation.implementation.prototype, 'getAttributeNS').value;
const setAttribute = own(elementImplementation.implementation.prototype, 'setAttributeNS').value;
const preReactions = customElements.ceReactionsPreSteps, postReactions = customElements.ceReactionsPostSteps;
const MAX_REALMS = 32, LIMIT = 1000000;
const activeRealms = new WeakSet();
let activeChildHook = false;
const isObject = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const data = (object, key) => {
  const descriptor = own(object, key);
  return descriptor && apply(hasOwn, descriptor, ['value']) ? descriptor.value : undefined;
};
const sameAccessor = (a, b) => !!a && !!b && a.get === b.get && a.set === b.set &&
  a.enumerable === b.enumerable && a.configurable === b.configurable && !apply(hasOwn, a, ['value']);
const sameFactory = (a, b) => !!a && !!b && a.value === b.value &&
  a.writable === b.writable && a.enumerable === b.enumerable && a.configurable === b.configurable;
const errorCodes = new Set(['INVALID_OPTIONS', 'UNSUPPORTED_JSDOM', 'UNSUPPORTED_REALM',
  'ALREADY_INSTALLED', 'CHILD_HOOK_ALREADY_INSTALLED', 'INSTALL_FAILED']);
export class RuntimeAnchorHrefTranslateError extends Error {
  constructor(code) {
    const safe = errorCodes.has(code) ? code : 'INSTALL_FAILED';
    super('Runtime anchor hrefTranslate failed: ' + safe);
    this.name = 'RuntimeAnchorHrefTranslateError'; this.code = safe;
  }
}

// Reject proxies and accessor-backed/borrowed impl symbols before generated.is
// or implForWrapper can read a page-controlled property. Cross-realm genuine
// wrappers keep the same implementation brand and reverse-wrapper identity.
function brandedImplementation(receiver) {
  if (!isObject(receiver) || isProxy(receiver)) return undefined;
  const impl = data(receiver, implSymbol);
  if (!isObject(impl) || isProxy(impl) || data(impl, wrapperSymbol) !== receiver) return undefined;
  let depth = 0;
  for (let cursor = impl; cursor !== null; cursor = getPrototype(cursor)) {
    if (isProxy(cursor) || depth++ >= 64) return undefined;
  }
  const carrier = createObject(null);
  define(carrier, implSymbol, { value: impl });
  if (!anchorIs(carrier)) return undefined;
  return implForWrapper(carrier) === impl ? impl : undefined;
}

const realmSource = [
  '"use strict";',
  'const prefix = "Failed to set the \'hrefTranslate\' property on \'HTMLAnchorElement\': ";',
  'const objectLike = value => value !== null && (typeof value === "object" || typeof value === "function");',
  // ToPrimitive uses the specified string hint and original receiver. Only
  // conversion-defined property reads/calls occur; user exceptions are kept.
  'function domString(value) {',
  '  let primitive = value;',
  '  if (objectLike(value)) {',
  '    const exotic = value[toPrimitive];',
  '    if (exotic !== undefined && exotic !== null) {',
  '      if (typeof exotic !== "function") {',
  '        try { RealmString({ [toPrimitive]: exotic }); }',
  '        catch (error) { throw new RealmTypeError(prefix + error.message); }',
  '      }',
  '      primitive = apply(exotic, value, ["string"]);',
  '      if (objectLike(primitive)) throw new RealmTypeError(prefix + "Cannot convert object to primitive value");',
  '    } else {',
  '      let method = value.toString;',
  '      if (typeof method === "function") primitive = apply(method, value, []);',
  '      if (objectLike(primitive)) {',
  '        method = value.valueOf;',
  '        if (typeof method === "function") primitive = apply(method, value, []);',
  '      }',
  '      if (objectLike(primitive)) throw new RealmTypeError(prefix + "Cannot convert object to primitive value");',
  '    }',
  '  }',
  '  if (typeof primitive === "symbol") throw new RealmTypeError(prefix + "Cannot convert a Symbol value to a string");',
  '  return RealmString(primitive);',
  '}',
  'const holder = {',
  '  get hrefTranslate() {',
  '    bridge.call(false);',
  '    try {',
  '      const impl = bridge.brand(this);',
  '      if (!impl) { bridge.illegal(); throw new RealmTypeError("Illegal invocation"); }',
  '      const result = bridge.read(impl); bridge.returned(); return result;',
  '    } catch (error) { bridge.threw(); throw error; }',
  '  },',
  '  set hrefTranslate(value) {',
  '    bridge.call(true);',
  '    try {',
  '      const impl = bridge.brand(this);',
  '      if (!impl) { bridge.illegal(); throw new RealmTypeError("Illegal invocation"); }',
  '      bridge.write(impl, domString(value)); bridge.returned();',
  '    } catch (error) { bridge.threw(); throw error; }',
  '  }',
  '};',
  'return { realm: globalThis, holder, wrap: target => new RealmProxy(target, { __proto__: null }) };',
].join('\n');

/** Install before page code/observers; dispose before earlier child factory hooks. */
export function installRuntimeAnchorHrefTranslate(window, options = {}) {
  if (!isObject(window) || isProxy(window) || !options || typeof options !== 'object' || isProxy(options))
    throw new RuntimeAnchorHrefTranslateError('INVALID_OPTIONS');
  const option = own(options, 'children');
  if (option && !apply(hasOwn, option, ['value'])) throw new RuntimeAnchorHrefTranslateError('INVALID_OPTIONS');
  const children = option?.value === undefined ? false : option.value;
  if (typeof children !== 'boolean') throw new RuntimeAnchorHrefTranslateError('INVALID_OPTIONS');
  if (jsdomPackage.version !== '26.1.0') throw new RuntimeAnchorHrefTranslateError('UNSUPPORTED_JSDOM');
  if (activeRealms.has(window)) throw new RuntimeAnchorHrefTranslateError('ALREADY_INSTALLED');
  if (children && activeChildHook) throw new RuntimeAnchorHrefTranslateError('CHILD_HOOK_ALREADY_INSTALLED');
  const previousFactory = children ? own(WindowModule, 'createWindow') : undefined;
  if (children && (!previousFactory?.writable || typeof previousFactory.value !== 'function'))
    throw new RuntimeAnchorHrefTranslateError('UNSUPPORTED_JSDOM');
  const records = [];
  let disposed = false, installedFactory;
  const stats = { __proto__: null,
    installedRealms: 0, installedBindings: 0, existingBindingsPreserved: 0,
    observedChildren: 0, skippedFactories: 0, unsupportedChildren: 0, childFailures: 0,
    realmLimitReached: false, calls: 0, getterCalls: 0, setterCalls: 0,
    returned: 0, threw: 0, illegalReceivers: 0,
    removedBindings: 0, cleanupConflicts: 0, cleanupFailures: 0,
    childFactoryRestored: false, childFactoryRestoreConflict: false,
  };
  const increment = key => { if (stats[key] < LIMIT) stats[key]++; };
  const counted = key => { if (!disposed) increment(key); };
  const snapshot = () => ({ schemaVersion: 1, diagnosticOnly: true,
    attribute: 'hreftranslate', conversion: 'DOMString', sourceRenderingModified: false,
    callableRepresentation: 'empty-handler-realm-proxy', childrenEnabled: children,
    maximumRealms: MAX_REALMS, counterLimit: LIMIT, ...stats, disposed });
  function installRealm(realm) {
    if (records.length >= MAX_REALMS) { stats.realmLimitReached = true; return; }
    if (!isObject(realm) || isProxy(realm)) throw new RuntimeAnchorHrefTranslateError('UNSUPPORTED_REALM');
    if (activeRealms.has(realm)) throw new RuntimeAnchorHrefTranslateError('ALREADY_INSTALLED');
    const RealmFunction = data(realm, 'Function'), registry = data(realm, webIdlUtils.ctorRegistrySymbol);
    if (typeof RealmFunction !== 'function' || RealmFunction === Function || !isObject(registry) ||
        isProxy(registry) || getPrototype(registry) !== null) throw new RuntimeAnchorHrefTranslateError('UNSUPPORTED_REALM');
    const Anchor = data(registry, 'HTMLAnchorElement');
    const prototype = typeof Anchor === 'function' ? data(Anchor, 'prototype') : undefined;
    if (!isObject(prototype) || isProxy(prototype)) throw new RuntimeAnchorHrefTranslateError('UNSUPPORTED_REALM');
    let existing = false;
    for (let cursor = prototype; cursor !== null; cursor = getPrototype(cursor)) {
      if (isProxy(cursor)) throw new RuntimeAnchorHrefTranslateError('UNSUPPORTED_REALM');
      if (own(cursor, 'hrefTranslate')) { existing = true; break; }
    }
    const record = { realm, prototype, installed: undefined };
    if (!existing) {
      const RealmTypeError = data(realm, 'TypeError'), RealmString = data(realm, 'String');
      const RealmProxy = data(realm, 'Proxy'), RealmSymbol = data(realm, 'Symbol');
      const RealmReflect = data(realm, 'Reflect');
      const realmApply = isObject(RealmReflect) && !isProxy(RealmReflect) ? data(RealmReflect, 'apply') : undefined;
      if (![RealmTypeError, RealmString, RealmProxy, RealmSymbol].every(value => typeof value === 'function'))
        throw new RuntimeAnchorHrefTranslateError('UNSUPPORTED_REALM');
      const toPrimitive = data(RealmSymbol, 'toPrimitive');
      if (typeof toPrimitive !== 'symbol' || typeof realmApply !== 'function') throw new RuntimeAnchorHrefTranslateError('UNSUPPORTED_REALM');
      const bridge = freeze({
        brand: brandedImplementation,
        call(setter) { counted('calls'); counted(setter ? 'setterCalls' : 'getterCalls'); },
        returned() { counted('returned'); }, threw() { counted('threw'); }, illegal() { counted('illegalReceivers'); },
        read(impl) {
          preReactions(realm);
          try { const value = apply(getAttribute, impl, [null, 'hreftranslate']); return value === null ? '' : value; }
          finally { postReactions(realm); }
        },
        write(impl, value) {
          preReactions(realm);
          try { apply(setAttribute, impl, [null, 'hreftranslate', value]); }
          finally { postReactions(realm); }
        },
      });
      const create = RealmFunction('bridge', 'RealmTypeError', 'RealmString', 'RealmProxy', 'toPrimitive', 'apply', realmSource);
      const created = create(bridge, RealmTypeError, RealmString, RealmProxy, toPrimitive, realmApply);
      if (created.realm !== realm) throw new RuntimeAnchorHrefTranslateError('UNSUPPORTED_REALM');
      const authored = own(created.holder, 'hrefTranslate');
      record.installed = { get: created.wrap(authored.get), set: created.wrap(authored.set), enumerable: true, configurable: true };
      define(prototype, 'hrefTranslate', record.installed);
    }
    records[records.length] = record; activeRealms.add(realm); increment('installedRealms');
    increment(existing ? 'existingBindingsPreserved' : 'installedBindings');
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
      try {
        if (record.installed) {
          const current = own(record.prototype, 'hrefTranslate');
          if (current && !sameAccessor(current, record.installed)) increment('cleanupConflicts');
          else if (current && remove(record.prototype, 'hrefTranslate')) increment('removedBindings');
          else if (current) increment('cleanupFailures');
        }
      } catch { increment('cleanupFailures'); }
      activeRealms.delete(record.realm);
    }
    records.length = 0;
    return snapshot();
  }
  try {
    installRealm(window);
    if (children) {
      const original = previousFactory.value;
      const wrapper = function createWindowWithAnchorHrefTranslate(factoryOptions) {
        const child = apply(original, this, arguments);
        if (disposed) return child;
        if (!isObject(factoryOptions) || isProxy(factoryOptions) || !own(factoryOptions, 'parentOrigin')) {
          increment('skippedFactories'); return child;
        }
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
    throw error instanceof RuntimeAnchorHrefTranslateError ? error : new RuntimeAnchorHrefTranslateError('INSTALL_FAILED');
  }
}
