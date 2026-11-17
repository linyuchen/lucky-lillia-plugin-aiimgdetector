// Public abstract WebIDL bindings for the experimental Node runtime. No valid
// platform instances are provisioned. Existing JSDOM implementations win.
import { createRequire } from 'node:module';
import WindowModule from 'jsdom/lib/jsdom/browser/Window.js';
import spec from './abstract-interface-native-spec.json' with { type: 'json' };
const require=createRequire(import.meta.url);
const own=Object.getOwnPropertyDescriptor,define=Object.defineProperty;
const active=new WeakSet();let childHookActive=false;
const same=(a,b)=>!!a&&!!b&&['value','get','set','writable','enumerable','configurable'].every(k=>Object.hasOwn(a,k)===Object.hasOwn(b,k)&&a[k]===b[k]);
const data=(o,k)=>{const d=own(o,k);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
export function installRuntimeAbstractInterfaceBindings(window,{children=false}={}) {
  if(typeof children!=='boolean'||!window||active.has(window)||children&&childHookActive)throw Error('ABSTRACT_INTERFACE_OPTIONS_INVALID');
  if(spec.schemaVersion!==1||spec.validation?.equal!==true||spec.interfaces.length<1||spec.interfaces.length>512)throw Error('ABSTRACT_INTERFACE_SPEC_INVALID');
  const factory=children?own(WindowModule,'createWindow'):undefined;
  if(children&&(!factory?.writable||typeof factory.value!=='function'))throw Error('ABSTRACT_INTERFACE_FACTORY_INVALID');
  const addon=require('./native-webidl-bridge/build/Release/native_webidl_bridge.node');
  const records=[],callables=[];
  const stats={realms:0,childRealms:0,bindingsInstalled:0,bindingsAlreadyPresent:0,dependencyUnavailable:0,bindingsRestored:0,restoreConflicts:0,restoreFailures:0,childFailures:0,realmLimitReached:false,childFactoryRestored:false};
  let disposed=false,installedFactory;
  const summary=()=>{
    const calls={constructorCalls:0,methodCalls:0,getterCalls:0,setterCalls:0,promiseMethodCalls:0};
    for(const fn of callables) {
      const entry=addon.getAbstractWebGlCallStats(fn),key=['constructorCalls','methodCalls','getterCalls','setterCalls','promiseMethodCalls'][entry.kind];
      calls[key]+=entry.calls;
    }
    return {diagnosticOnly:true,abstractInterfacesOnly:true,instancesProvisioned:0,interfacesRequested:spec.interfaces.length,boundConstructor:true,nativeNamedSourceMatched:false,errorMessagesExact:false,sourceRenderingModified:false,...stats,...calls,disposed};
  };
  function installRealm(realm) {
    if(active.has(realm))return;
    if(records.length>=32){stats.realmLimitReached=true;return;}
    const F=data(realm,'Function'),O=data(realm,'Object'),S=data(realm,'Symbol');
    if(typeof F!=='function'||F===Function||typeof O!=='function')throw Error('ABSTRACT_INTERFACE_REALM_INVALID');
    const record={realm,bindings:[]};records.push(record);active.add(realm);stats.realms++;if(realm!==window)stats.childRealms++;
    const refs=new Map([['null',null],['Function.prototype',F.prototype],['Object.prototype',O.prototype]]);
    const reference=name=>{
      if(refs.has(name))return refs.get(name);
      const [global,member,...rest]=name.split('.');if(rest.length)throw Error('ABSTRACT_INTERFACE_REFERENCE_INVALID');
      const ctor=data(realm,global),value=member?ctor&&data(ctor,member):ctor;
      if(value!==undefined)refs.set(name,value);return value;
    };
    let candidates=spec.interfaces.filter(entry=>{if(Reflect.has(realm,entry.name)){stats.bindingsAlreadyPresent++;return false;}return true;});
    // Remove interfaces whose unavailable parent would otherwise be replaced by
    // undefined. Iterate to a fixed point before making any global change.
    for(;;) {
      const names=new Set(candidates.map(e=>e.name));
      const next=candidates.filter(e=>[e.constructor.parent,e.prototype.parent].every(parent=>reference(parent)!==undefined||names.has(parent.split('.')[0])));
      if(next.length===candidates.length)break;
      stats.dependencyUnavailable+=candidates.length-next.length;candidates=next;
    }
    const selected=[];
    for(const entry of candidates) {
      // The native factory supplies a constructible, always-illegal V8 callback.
      // Its temporary factory label is replaced by the collected public name.
      // Bound source names and detailed error text remain explicit limitations.
      const ctor=addon.createAbstractWebGlCallable(F,0,'WebGLRenderingContext',entry.globalBinding.value.length);
      const prototype=own(ctor,'prototype').value;
      refs.set(entry.name,ctor);refs.set(entry.name+'.prototype',prototype);
      selected.push({entry,ctor,prototype});callables.push(ctor);
    }
    const keyFor=key=>key.startsWith('Symbol.')?S[key.slice(7)]:key;
    const descriptorFor=(d,kind)=>{
      const result={configurable:d.configurable,enumerable:d.enumerable};
      const fn=(m,role)=>{
        if(!m)return undefined;
        if(m.ref){const value=reference(m.ref);if(value===undefined)throw Error('ABSTRACT_INTERFACE_REFERENCE_UNAVAILABLE');return value;}
        const value=addon.createAbstractWebGlCallable(F,m.invalidReceiver?.delivery==='reject'?4:role,m.name,m.length);callables.push(value);return value;
      };
      if(d.kind==='accessor'){result.get=fn(d.get,2);result.set=fn(d.set,3);return result;}
      result.writable=d.writable;
      if(d.value.type==='function')result.value=fn(d.value,kind);
      else if(d.value.type==='reference'){result.value=reference(d.value.ref);if(result.value===undefined)throw Error('ABSTRACT_INTERFACE_REFERENCE_UNAVAILABLE');}
      else result.value=d.value.type==='null'?null:d.value.value;
      return result;
    };
    for(const {entry,ctor,prototype} of selected) {
      if(!Reflect.deleteProperty(prototype,'constructor'))throw Error('ABSTRACT_INTERFACE_ORDER_INVALID');
      Object.setPrototypeOf(ctor,reference(entry.constructor.parent));Object.setPrototypeOf(prototype,reference(entry.prototype.parent));
      for(const member of entry.constructor.members)define(ctor,keyFor(member.key),descriptorFor(member.descriptor,1));
      for(const member of entry.prototype.members)define(prototype,keyFor(member.key),descriptorFor(member.descriptor,1));
      const binding=descriptorFor(entry.globalBinding,0);define(realm,entry.name,binding);record.bindings.push({name:entry.name,descriptor:binding});stats.bindingsInstalled++;
    }
  }
  const dispose=()=>{
    if(disposed)return summary();disposed=true;
    if(installedFactory){try{if(same(own(WindowModule,'createWindow'),installedFactory)){define(WindowModule,'createWindow',factory);stats.childFactoryRestored=true;}else stats.restoreConflicts++;}catch{stats.restoreFailures++;}childHookActive=false;}
    for(const record of [...records].reverse()) {
      for(const binding of record.bindings){try{if(!same(own(record.realm,binding.name),binding.descriptor))stats.restoreConflicts++;else if(Reflect.deleteProperty(record.realm,binding.name))stats.bindingsRestored++;else stats.restoreFailures++;}catch{stats.restoreFailures++;}}
      active.delete(record.realm);
    }
    return summary();
  };
  try {
    installRealm(window);
    if(children) {
      installedFactory={...factory,value:function createWindowWithAbstractInterfaces(options){
        const child=Reflect.apply(factory.value,this,arguments);
        if(!disposed&&options&&own(options,'parentOrigin')&&data(options,'runScripts')==='outside-only')try{installRealm(data(child,'_globalProxy'));}catch{stats.childFailures++;}
        return child;
      }};
      define(WindowModule,'createWindow',installedFactory);childHookActive=true;
    }
    return Object.freeze({snapshot:summary,dispose});
  }catch(error){dispose();throw error;}
}
