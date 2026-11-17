// Optional abstract WebGL interfaces. No GPU contexts or instances are created.
import { createRequire } from 'node:module';
import WindowModule from 'jsdom/lib/jsdom/browser/Window.js';
import jsdomPackage from 'jsdom/package.json' with { type: 'json' };
import spec from './abstract-webgl-native-spec.json' with { type: 'json' };

const require = createRequire(import.meta.url);
const own = Object.getOwnPropertyDescriptor, define = Object.defineProperty;
const apply = Reflect.apply, names = ['WebGLRenderingContext','WebGL2RenderingContext'];
const active = new WeakSet();
let childHookActive = false;
const same = (a,b) => !!a && !!b && ['value','get','set','writable','enumerable','configurable']
  .every(key => Object.hasOwn(a,key) === Object.hasOwn(b,key) && a[key] === b[key]);
const data = (object,key) => { const d = own(object,key); return d && Object.hasOwn(d,'value') ? d.value : undefined; };
const error = code => Object.assign(new Error(code), { code });

export function installRuntimeAbstractWebGlBindings(window, { children = false } = {}) {
  if (typeof children !== 'boolean' || jsdomPackage.version !== '26.1.0' || !window || active.has(window)) throw error('INVALID_ABSTRACT_WEBGL_OPTIONS');
  if (children && childHookActive) throw error('ABSTRACT_WEBGL_CHILD_HOOK_ACTIVE');
  if (spec.schemaVersion !== 1 || spec.interfaces?.length !== 2 || !spec.interfaces.every((row,index) => row.name === names[index])) throw error('INVALID_ABSTRACT_WEBGL_SPEC');
  const previousFactory = children ? own(WindowModule,'createWindow') : undefined;
  if (children && (!previousFactory?.writable || typeof previousFactory.value !== 'function')) throw error('ABSTRACT_WEBGL_FACTORY_UNAVAILABLE');
  const addon = require('./native-webidl-bridge/build/Release/native_webidl_bridge.node');
  if (typeof addon.createAbstractWebGlCallable !== 'function' || typeof addon.getAbstractWebGlCallStats !== 'function') throw error('ABSTRACT_WEBGL_NATIVE_FACTORY_UNAVAILABLE');
  const records = [], callables = [];
  let disposed = false, installedFactory;
  const stats = { realms:0,childRealms:0,bindingsInstalled:0,bindingsAlreadyPresent:0,bindingsRestored:0,
    restoreConflicts:0,restoreFailures:0,installFailures:0,childFailures:0,counterReadErrors:0,realmLimitReached:false,childFactoryRestored:false };
  function snapshot() {
    const calls = { constructorCalls:0,methodCalls:0,promiseMethodCalls:0,getterCalls:0,setterCalls:0 };
    for (const fn of callables) {
      try {
        const entry = addon.getAbstractWebGlCallStats(fn);
        const key = ['constructorCalls','methodCalls','getterCalls','setterCalls','methodCalls'][entry.kind];
        if (!key || !Number.isSafeInteger(entry.calls) || entry.calls < 0) throw error('ABSTRACT_WEBGL_COUNTER_INVALID');
        calls[key] = Math.min(1000000,calls[key] + entry.calls);
        if (entry.kind === 4) calls.promiseMethodCalls = Math.min(1000000,calls.promiseMethodCalls + entry.calls);
      } catch { stats.counterReadErrors = Math.min(1000000,stats.counterReadErrors + 1); }
    }
    return { diagnosticOnly:true,abstractWebGlOnly:true,functionalGpu:false,instancesProvisioned:0,
      sourceRenderingModified:false,boundConstructor:true,nativeNamedSourceMatched:false,errorMessagesExact:false,
      maximumRealms:32,interfacesRequested:2,childrenEnabled:children,...stats,...calls,
      illegalConstructorThrows:calls.constructorCalls,illegalInvocationThrows:Math.min(1000000,calls.methodCalls-calls.promiseMethodCalls+calls.getterCalls+calls.setterCalls),
      illegalInvocationRejections:calls.promiseMethodCalls,
      apiCalls:Math.min(1000000,calls.constructorCalls+calls.methodCalls+calls.getterCalls+calls.setterCalls),disposed };
  }
  function installRealm(realm) {
    if (active.has(realm)) return;
    if (records.length >= 32) { stats.realmLimitReached = true; return; }
    const RealmFunction = data(realm,'Function'), RealmObject = data(realm,'Object'), RealmSymbol = data(realm,'Symbol');
    if (typeof RealmFunction !== 'function' || RealmFunction === Function || typeof RealmObject !== 'function') throw error('ABSTRACT_WEBGL_REALM_UNAVAILABLE');
    const record = { realm, bindings:[] };
    records.push(record); active.add(realm); stats.realms++; if (realm !== window) stats.childRealms++;
    const references = new Map([['Function.prototype',RealmFunction.prototype],['Object.prototype',RealmObject.prototype],['null',null]]);
    const selected = [];
    for (const entry of spec.interfaces) {
      if (Reflect.has(realm,entry.name)) { stats.bindingsAlreadyPresent++; continue; }
      const ctor = addon.createAbstractWebGlCallable(RealmFunction,0,entry.name,entry.globalBinding.value.length);
      const prototype = own(ctor,'prototype')?.value;
      if (!prototype || Object.getPrototypeOf(ctor) !== RealmFunction.prototype) throw error('ABSTRACT_WEBGL_NATIVE_REALM_MISMATCH');
      references.set(entry.name,ctor); references.set(entry.name+'.prototype',prototype);
      selected.push({entry,ctor,prototype}); callables.push(ctor);
    }
    const keyFor = key => key.startsWith('Symbol.') ? RealmSymbol[key.slice(7)] : key;
    const descriptorFor = (descriptor, role) => {
      const result = { configurable:descriptor.configurable,enumerable:descriptor.enumerable };
      const callable = (metadata,kind) => {
        if (!metadata) return undefined;
        if (metadata.ref) return references.get(metadata.ref);
        const fn = addon.createAbstractWebGlCallable(RealmFunction,
          metadata.invalidReceiver?.delivery === 'reject' ? 4 : kind,metadata.name,metadata.length);
        callables.push(fn); return fn;
      };
      if (descriptor.kind === 'accessor') {
        result.get = callable(descriptor.get,2); result.set = callable(descriptor.set,3);
      } else {
        result.writable = descriptor.writable;
        const value = descriptor.value;
        if (value.type === 'reference') result.value = references.get(value.ref);
        else if (value.type === 'function') result.value = callable(value,role);
        else if (['number','string','boolean','null','undefined'].includes(value.type)) result.value = value.type === 'null' ? null : value.value;
        else throw error('ABSTRACT_WEBGL_SPEC_VALUE_UNSUPPORTED');
      }
      return result;
    };
    for (const {entry,ctor,prototype} of selected) {
      if (!Reflect.deleteProperty(prototype,'constructor')) throw error('ABSTRACT_WEBGL_PROTOTYPE_ORDER_UNAVAILABLE');
      Object.setPrototypeOf(prototype,references.get(entry.prototype.parent));
      for (const member of entry.constructor.members) define(ctor,keyFor(member.key),descriptorFor(member.descriptor,1));
      for (const member of entry.prototype.members) define(prototype,keyFor(member.key),descriptorFor(member.descriptor,1));
      const binding = descriptorFor(entry.globalBinding,0);
      define(realm,entry.name,binding); record.bindings.push({name:entry.name,descriptor:binding}); stats.bindingsInstalled++;
    }
  }
  function dispose() {
    if (disposed) return snapshot(); disposed = true;
    if (installedFactory) {
      try { if (same(own(WindowModule,'createWindow'),installedFactory)) { define(WindowModule,'createWindow',previousFactory); stats.childFactoryRestored = true; }
        else stats.restoreConflicts++; } catch { stats.restoreFailures++; }
      childHookActive = false;
    }
    for (const record of [...records].reverse()) {
      for (const binding of record.bindings) {
        try { if (!same(own(record.realm,binding.name),binding.descriptor)) stats.restoreConflicts++;
          else if (Reflect.deleteProperty(record.realm,binding.name)) stats.bindingsRestored++; else stats.restoreFailures++; }
        catch { stats.restoreFailures++; }
      }
      active.delete(record.realm);
    }
    return snapshot();
  }
  try {
    installRealm(window);
    if (children) {
      const original = previousFactory.value;
      installedFactory = { ...previousFactory,value:function createWindowWithAbstractWebGl(options) {
        const child = apply(original,this,arguments);
        if (disposed || !options || !own(options,'parentOrigin') || data(options,'runScripts') !== 'outside-only') return child;
        try { installRealm(data(child,'_globalProxy')); } catch { stats.childFailures++; }
        return child;
      } };
      define(WindowModule,'createWindow',installedFactory); childHookActive = true;
    }
    return Object.freeze({snapshot,dispose});
  } catch (failure) { stats.installFailures++; dispose(); throw failure; }
}
