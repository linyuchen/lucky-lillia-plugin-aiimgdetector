// Missing CSS named-property reads on unchanged cssstyle declaration backends.
// Parser/serialization/rendering behavior is deliberately not replaced.
import { types as nodeTypes } from 'node:util';
import WindowModule from 'jsdom/lib/jsdom/browser/Window.js';
import cssstyle from 'cssstyle';
import cssstylePackage from 'cssstyle/package.json' with { type: 'json' };
import jsdomPackage from 'jsdom/package.json' with { type: 'json' };
import utils from 'jsdom/lib/jsdom/living/generated/utils.js';
import { chromiumCssPropertyCatalog } from './chromium-css-property-catalog.mjs';

const get = Object.getOwnPropertyDescriptor, define = Object.defineProperty, apply = Reflect.apply, remove = Reflect.deleteProperty;
const own = Object.hasOwn, proxy = nodeTypes.isProxy, object = value => value !== null && (typeof value === 'object' || typeof value === 'function');
const data = (value, key) => { if (!object(value) || proxy(value)) return undefined; const d = get(value, key); return d && own(d, 'value') ? d.value : undefined; };
const same = (left, right) => !!left && !!right && ['value', 'get', 'set', 'writable', 'enumerable', 'configurable'].every(
  key => own(left, key) === own(right, key) && Object.is(left[key], right[key]));
const cssPrototype = cssstyle.CSSStyleDeclaration.prototype;
const originalRead = data(cssPrototype, 'getPropertyValue'), originalWrite = data(cssPrototype, 'setProperty');
const mapHas = Map.prototype.has, isPrototype = Object.prototype.isPrototypeOf;
const MAX_REALMS = 32, MAX_STYLES = 1024, LIMIT = 1000000, activeRealms = new WeakSet(); let activeChildHook = false;
const errors = new Set(['INVALID_OPTIONS', 'UNSUPPORTED_JSDOM', 'UNSUPPORTED_REALM', 'ALREADY_INSTALLED', 'CHILD_HOOK_ALREADY_INSTALLED', 'INSTALL_FAILED']);
export class RuntimeCssPropertiesCompatError extends Error {
  constructor(code) { const safe = errors.has(code) ? code : 'INSTALL_FAILED'; super('Runtime CSS properties failed: ' + safe); this.name = 'RuntimeCssPropertiesCompatError'; this.code = safe; }
}
function hasProperty(value, key) {
  for (let current = value, depth = 0; current && depth < 64; current = Object.getPrototypeOf(current), depth++) {
    if (proxy(current)) return true;
    if (get(current, key)) return true;
  }
  return false;
}
function isStyle(value) {
  if (!object(value) || proxy(value) || !apply(isPrototype, cssPrototype, [value])) return false;
  const values = data(value, '_values');
  if (!object(values) || proxy(values)) return false;
  try { apply(mapHas, values, ['']); return true; } catch { return false; }
}

function createRealmHelpers(read, write, brand, decorateInline, decorateComputed, entries) {
  'use strict';
  const RealmTypeError = TypeError, apply = Reflect.apply, get = Object.getOwnPropertyDescriptor;
  const descriptors = entries.map(([name, cssName]) => {
    const holder = {
      get [name]() { if (!brand(this)) throw new RealmTypeError('Illegal invocation'); return read(this, cssName); },
      set [name](value) { if (!brand(this)) throw new RealmTypeError('Illegal invocation'); write(this, cssName, value); },
    };
    return { name, descriptor: get(holder, name) };
  });
  return {
    realm: globalThis, descriptors,
    styleGetter(original) { return get({ get style() { return decorateInline(apply(original, this, arguments), this); } }, 'style').get; },
    computedStyle(original) { return function getComputedStyle(element) { return decorateComputed(apply(original, this, arguments)); }; },
  };
}

/** Install before page code, after earlier compatibility hooks. Existing styles
 * are decorated lazily on acquisition; dispose before earlier child hooks. */
export function installRuntimeCssPropertiesCompat(window, options = {}) {
  if (!object(window) || proxy(window) || !object(options) || proxy(options) || Array.isArray(options)) throw new RuntimeCssPropertiesCompatError('INVALID_OPTIONS');
  const option = get(options, 'children');
  if (option && !own(option, 'value')) throw new RuntimeCssPropertiesCompatError('INVALID_OPTIONS');
  const children = option?.value === undefined ? false : option.value;
  if (typeof children !== 'boolean') throw new RuntimeCssPropertiesCompatError('INVALID_OPTIONS');
  if (jsdomPackage.version !== '26.1.0' || cssstylePackage.version !== '4.6.0' || typeof originalRead !== 'function' || typeof originalWrite !== 'function') throw new RuntimeCssPropertiesCompatError('UNSUPPORTED_JSDOM');
  if (activeRealms.has(window)) throw new RuntimeCssPropertiesCompatError('ALREADY_INSTALLED');
  if (children && activeChildHook) throw new RuntimeCssPropertiesCompatError('CHILD_HOOK_ALREADY_INSTALLED');
  const previousFactory = children ? get(WindowModule, 'createWindow') : undefined;
  if (children && (!previousFactory?.writable || typeof previousFactory.value !== 'function')) throw new RuntimeCssPropertiesCompatError('UNSUPPORTED_JSDOM');
  const missing = chromiumCssPropertyCatalog.filter(([name]) => !hasProperty(cssPrototype, name));
  const realms = [], saved = []; let stylesSeen = new WeakSet(), realmByBacking = new WeakMap(), disposed = false, installedFactory;
  const stats = { installedRealms: 0, missingCatalogProperties: missing.length, decoratedStyles: 0, addedProperties: 0, preservedProperties: 0,
    inlineGetterWrappers: 0, computedStyleWrappers: 0, unsupportedAcquisitions: 0, unsupportedStyleObjects: 0,
    reads: 0, writes: 0, observedChildren: 0, skippedFactories: 0, unsupportedChildren: 0, childFailures: 0,
    realmLimitReached: false, styleLimitReached: false, mutationFailures: 0, removedProperties: 0, restoredAcquisitionWrappers: 0,
    cleanupConflicts: 0, cleanupFailures: 0, childFactoryRestored: false, childFactoryRestoreConflict: false };
  const increment = key => { stats[key] = Math.min(LIMIT, stats[key] + 1); };
  const snapshot = () => ({ schemaVersion: 1, diagnosticOnly: true, runtimeCssPropertiesCompat: true,
    childrenEnabled: children, maximumRealms: MAX_REALMS, maximumStyles: MAX_STYLES, catalogProperties: chromiumCssPropertyCatalog.length,
    getterSource: 'unchanged-cssstyle-getPropertyValue', setterSource: 'unchanged-cssstyle-setProperty', staticDefaultValues: false,
    fullChromeCssGrammar: false, parserModified: false, renderingModeled: false, sharedCssPrototypeModified: false,
    originalCssMethodsModified: false, styleObjectIdentityChanged: false, sourceRenderingModified: false,
    standaloneConstructorInstancesModeled: false, stylesheetRuleObjectsModeled: false, ...stats, disposed });
  function decorate(style, record) {
    if (disposed || !record) return style;
    if (!isStyle(style)) { increment('unsupportedStyleObjects'); return style; }
    if (stylesSeen.has(style)) return style;
    if (stats.decoratedStyles >= MAX_STYLES) { stats.styleLimitReached = true; return style; }
    stylesSeen.add(style); increment('decoratedStyles');
    for (const { name, descriptor } of record.helpers.descriptors) {
      if (hasProperty(style, name)) { increment('preservedProperties'); continue; }
      const next = { ...descriptor, enumerable: true, configurable: true };
      try { define(style, name, next); saved.push({ target: style, key: name, previous: undefined, next, property: true }); increment('addedProperties'); }
      catch { increment('mutationFailures'); }
    }
    return style;
  }
  function wrap(target, key, previous, next, counter) {
    if (!previous || (!previous.configurable && (!own(previous, 'value') || !previous.writable))) { increment('unsupportedAcquisitions'); return; }
    define(target, key, next); saved.push({ target, key, previous, next, property: false }); increment(counter);
  }
  function installRealm(realm) {
    if (realms.length >= MAX_REALMS) { stats.realmLimitReached = true; return; }
    if (!object(realm) || proxy(realm) || activeRealms.has(realm)) throw new RuntimeCssPropertiesCompatError('UNSUPPORTED_REALM');
    const realmFunction = data(realm, 'Function'), backing = data(realm, '_globalObject'), registry = data(realm, utils.ctorRegistrySymbol);
    if (typeof realmFunction !== 'function' || realmFunction === Function || !backing || data(backing, '_globalProxy') !== realm || !registry) throw new RuntimeCssPropertiesCompatError('UNSUPPORTED_REALM');
    const record = { realm, backing, helpers: undefined }; realms.push(record); realmByBacking.set(backing, record); activeRealms.add(realm); increment('installedRealms');
    const read = (receiver, cssName) => { if (!disposed) increment('reads'); return apply(originalRead, receiver, [cssName]); };
    const write = (receiver, cssName, value) => { if (!disposed) increment('writes'); return apply(originalWrite, receiver, [cssName, value]); };
    const decorateInline = (style, receiver) => {
      const impl = data(receiver, utils.implSymbol), owner = data(impl, '_globalObject');
      return decorate(style, realmByBacking?.get(owner));
    };
    const decorateComputed = style => decorate(style, record);
    const factory = realmFunction('read', 'write', 'brand', 'decorateInline', 'decorateComputed', 'entries',
      'return (' + createRealmHelpers.toString() + ')(read,write,brand,decorateInline,decorateComputed,entries)');
    // Names are fixed public catalog data. They are never derived from a page.
    const entries = apply(realmFunction('return ' + JSON.stringify(missing)), undefined, []);
    const helpers = apply(factory, undefined, [read, write, isStyle, decorateInline, decorateComputed, entries]);
    if (helpers.realm !== realm) throw new RuntimeCssPropertiesCompatError('UNSUPPORTED_REALM'); record.helpers = helpers;
    for (const name of ['HTMLElement', 'SVGElement']) {
      const constructor = data(registry, name), prototype = data(constructor, 'prototype'), previous = prototype && get(prototype, 'style');
      if (!previous || typeof previous.get !== 'function') { increment('unsupportedAcquisitions'); continue; }
      wrap(prototype, 'style', previous, { ...previous, get: helpers.styleGetter(previous.get) }, 'inlineGetterWrappers');
    }
    const computed = get(realm, 'getComputedStyle');
    if (computed && own(computed, 'value') && typeof computed.value === 'function')
      wrap(realm, 'getComputedStyle', computed, { ...computed, value: helpers.computedStyle(computed.value) }, 'computedStyleWrappers');
    else increment('unsupportedAcquisitions');
  }
  function dispose() {
    if (disposed) return snapshot(); disposed = true;
    if (installedFactory) {
      try {
        if (same(get(WindowModule, 'createWindow'), installedFactory)) { define(WindowModule, 'createWindow', previousFactory); stats.childFactoryRestored = true; }
        else stats.childFactoryRestoreConflict = true;
      } catch { stats.childFactoryRestoreConflict = true; }
      activeChildHook = false;
    }
    for (let index = saved.length - 1; index >= 0; index--) {
      const { target, key, previous, next, property } = saved[index];
      try {
        if (!same(get(target, key), next)) { increment('cleanupConflicts'); continue; }
        if (previous) define(target, key, previous); else if (!remove(target, key)) throw Error('RESTORE_FAILED');
        increment(property ? 'removedProperties' : 'restoredAcquisitionWrappers');
      } catch { increment('cleanupFailures'); }
    }
    saved.length = 0; for (const record of realms) activeRealms.delete(record.realm); realms.length = 0;
    stylesSeen = undefined; realmByBacking = undefined; return snapshot();
  }
  try {
    installRealm(window);
    if (children) {
      const original = previousFactory.value;
      const wrapper = function createWindowWithCssProperties(factoryOptions) {
        const child = apply(original, this, arguments); if (disposed) return child;
        if (!object(factoryOptions) || proxy(factoryOptions) || !get(factoryOptions, 'parentOrigin')) { increment('skippedFactories'); return child; }
        increment('observedChildren');
        if (data(factoryOptions, 'runScripts') !== 'outside-only') { increment('unsupportedChildren'); return child; }
        try { const realm = data(child, '_globalProxy'); if (!realm) increment('unsupportedChildren'); else installRealm(realm); } catch { increment('childFailures'); }
        return child;
      };
      installedFactory = { ...previousFactory, value: wrapper }; define(WindowModule, 'createWindow', installedFactory); activeChildHook = true;
    }
    return Object.freeze({ snapshot, dispose });
  } catch (error) { dispose(); throw error instanceof RuntimeCssPropertiesCompatError ? error : new RuntimeCssPropertiesCompatError('INSTALL_FAILED'); }
}
