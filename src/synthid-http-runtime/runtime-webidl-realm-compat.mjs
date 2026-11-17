// Correct prototype chains of existing per-window JSDOM WebIDL functions.
// No callable replacement, proxy, source rendering change or new API surface.
import WindowModule from 'jsdom/lib/jsdom/browser/Window.js';
import webIdlUtils from 'jsdom/lib/jsdom/living/generated/utils.js';
import jsdomPackage from 'jsdom/package.json' with { type: 'json' };
import { webIdlConstructorNames } from './webidl-realm-catalog.mjs';

const HOST_FUNCTION_PROTOTYPE=Function.prototype;
const MAX_REALMS=32,MAX_CALLABLES=10000,MAX_OWN_KEYS=4096;
const activeWindows=new WeakSet();let activeChildHook=false;
const ERROR_CODES=new Set(['INVALID_OPTIONS','UNSUPPORTED_JSDOM','UNSUPPORTED_REALM','ALREADY_INSTALLED','CHILD_HOOK_ALREADY_INSTALLED','INSTALL_FAILED']);
export class WebIdlRealmCompatError extends Error{constructor(code){const safe=ERROR_CODES.has(code)?code:'INSTALL_FAILED';super('WebIDL realm compatibility failed: '+safe);this.name='WebIdlRealmCompatError';this.code=safe;}}
const ownData=(object,key)=>{const descriptor=Object.getOwnPropertyDescriptor(object,key);return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;};
const isObject=value=>value!==null&&(typeof value==='object'||typeof value==='function');
const JS_INTRINSICS=['Object','Function','Array','Number','String','Boolean','BigInt','Date','RegExp','Promise','Map','Set','WeakMap','WeakSet','Symbol','Reflect','Intl','JSON','Math','Error','TypeError','RangeError','ReferenceError','SyntaxError','EvalError','URIError','AggregateError','ArrayBuffer','SharedArrayBuffer','DataView','Int8Array','Uint8Array','Uint8ClampedArray','Int16Array','Uint16Array','Int32Array','Uint32Array','Float16Array','Float32Array','Float64Array','BigInt64Array','BigUint64Array','Proxy','WeakRef','FinalizationRegistry','Atomics','WebAssembly','eval'];
const EXCLUDED_NAMES=new Set(JS_INTRINSICS);
const protectedHostFunctions=new Set([HOST_FUNCTION_PROTOTYPE]);
for(const name of JS_INTRINSICS){
  const intrinsic=ownData(globalThis,name);if(!isObject(intrinsic))continue;if(typeof intrinsic==='function')protectedHostFunctions.add(intrinsic);
  for(const object of [intrinsic,ownData(intrinsic,'prototype')])if(isObject(object))for(const key of Reflect.ownKeys(object)){
    const descriptor=Object.getOwnPropertyDescriptor(object,key);
    for(const value of [descriptor?.value,descriptor?.get,descriptor?.set])if(typeof value==='function')protectedHostFunctions.add(value);
  }
}

export function installWebIdlRealmCompat(window,options={}){
  if(!isObject(window)||!options||typeof options!=='object')throw new WebIdlRealmCompatError('INVALID_OPTIONS');
  const children=ownData(options,'children')??false;
  if(typeof children!=='boolean'||Object.getOwnPropertyDescriptor(options,'children')&&!Object.hasOwn(Object.getOwnPropertyDescriptor(options,'children'),'value'))throw new WebIdlRealmCompatError('INVALID_OPTIONS');
  if(jsdomPackage.version!=='26.1.0')throw new WebIdlRealmCompatError('UNSUPPORTED_JSDOM');
  if(activeWindows.has(window))throw new WebIdlRealmCompatError('ALREADY_INSTALLED');
  if(children&&activeChildHook)throw new WebIdlRealmCompatError('CHILD_HOOK_ALREADY_INSTALLED');
  const factoryDescriptor=children?Object.getOwnPropertyDescriptor(WindowModule,'createWindow'):undefined;
  if(children&&(!factoryDescriptor?.writable||typeof factoryDescriptor.value!=='function'))throw new WebIdlRealmCompatError('UNSUPPORTED_JSDOM');
  const saved=[],realms=[],seenFunctions=new WeakMap();let disposed=false,factoryWrapper;
  const stats={diagnosticOnly:true,prototypeChainCompatibility:true,functionInternalRealmChanged:false,proxyCallableSimulation:false,nativeIdentityProven:false,
    sourceRenderingModified:false,callableIdentitiesChanged:false,hostIntrinsicsModified:false,absentApisAdded:0,pageCallbacksTraversed:false,
    maximumRealms:MAX_REALMS,maximumCallables:MAX_CALLABLES,childrenEnabled:children,installedRealms:0,observedChildren:0,skippedFactories:0,unsupportedChildren:0,
    childFailures:0,realmLimitReached:false,callableLimitReached:false,descriptorLimitReached:false,constructorsFound:0,unregisteredCatalogFunctions:0,
    callablesObserved:0,functionsCorrected:0,alreadyRealmFunctions:0,inheritedConstructorParentsPreserved:0,protectedIntrinsicsSkipped:0,nonBaselineParentsSkipped:0,
    nonExtensibleFunctions:0,sharedCallableConflicts:0,inspectionFailures:0,mutationFailures:0,restoredFunctions:0,restoreConflicts:0,restoreFailures:0,
    childFactoryRestored:false,childFactoryRestoreConflict:false,disposed:false};
  const increment=key=>{stats[key]=Math.min(1000000,stats[key]+1);};

  function installRealm(realm){
    if(realms.length>=MAX_REALMS){stats.realmLimitReached=true;return;}
    if(activeWindows.has(realm))throw new WebIdlRealmCompatError('ALREADY_INSTALLED');
    const realmFunction=ownData(realm,'Function'),realmFunctionPrototype=isObject(realmFunction)?ownData(realmFunction,'prototype'):undefined;
    const registry=ownData(realm,webIdlUtils.ctorRegistrySymbol);
    if(typeof realmFunction!=='function'||realmFunction===Function||!isObject(realmFunctionPrototype)||!isObject(registry)||Object.getPrototypeOf(registry)!==null)throw new WebIdlRealmCompatError('UNSUPPORTED_REALM');
    const constructors=new Set();
    for(const name of webIdlConstructorNames){
      if(EXCLUDED_NAMES.has(name))continue;
      // The registry refers to generated per-window interfaces, independently
      // of any later reassignment of a public global to a page callback.
      const registered=ownData(registry,name);
      if(typeof registered==='function')constructors.add(registered);
      else if(typeof ownData(realm,name)==='function')increment('unregisteredCatalogFunctions');
    }
    // Window and these legacy factories are created inside createWindow /
    // installOwnProperties in the pinned JSDOM version. Verify their links to
    // that window's registered interface objects; do not touch shared CSSOM.
    const windowPrototype=Object.getPrototypeOf(realm),windowConstructor=isObject(windowPrototype)?ownData(windowPrototype,'constructor'):undefined;
    const eventTarget=ownData(registry,'EventTarget');
    if(typeof windowConstructor==='function'&&Object.getPrototypeOf(windowConstructor)===eventTarget&&ownData(windowConstructor,'prototype')===windowPrototype)constructors.add(windowConstructor);
    for(const [alias,target] of [['Image','HTMLImageElement'],['Audio','HTMLAudioElement'],['Option','HTMLOptionElement']]){
      const candidate=ownData(realm,alias),registered=ownData(registry,target);
      if(typeof candidate==='function'&&typeof registered==='function'&&ownData(candidate,'name')===alias&&ownData(candidate,'prototype')===ownData(registered,'prototype'))constructors.add(candidate);
    }
    const owner={realm,realmFunctionPrototype};realms.push(owner);activeWindows.add(realm);increment('installedRealms');
    stats.constructorsFound=Math.min(1000000,stats.constructorsFound+constructors.size);
    function correct(fn){
      if(typeof fn!=='function')return;
      if(protectedHostFunctions.has(fn)){increment('protectedIntrinsicsSkipped');return;}
      const previousOwner=seenFunctions.get(fn);
      if(previousOwner){if(previousOwner!==owner)increment('sharedCallableConflicts');return;}
      if(stats.callablesObserved>=MAX_CALLABLES){stats.callableLimitReached=true;return;}
      seenFunctions.set(fn,owner);increment('callablesObserved');
      const previous=Object.getPrototypeOf(fn);
      if(previous===realmFunctionPrototype){increment('alreadyRealmFunctions');return;}
      if(constructors.has(previous)){increment('inheritedConstructorParentsPreserved');return;}
      if(previous!==HOST_FUNCTION_PROTOTYPE){increment('nonBaselineParentsSkipped');return;}
      if(!Object.isExtensible(fn)){increment('nonExtensibleFunctions');return;}
      try{Object.setPrototypeOf(fn,realmFunctionPrototype);saved.push({fn,previous,next:realmFunctionPrototype});increment('functionsCorrected');}
      catch{increment('mutationFailures');}
    }
    const inspected=new WeakSet();
    function inspectOwn(object){
      if(!isObject(object)||inspected.has(object))return;inspected.add(object);
      try{const keys=Reflect.ownKeys(object);if(keys.length>MAX_OWN_KEYS){stats.descriptorLimitReached=true;return;}
        for(const key of keys){if(stats.callableLimitReached)return;const descriptor=Object.getOwnPropertyDescriptor(object,key);
          if(!descriptor)continue;correct(descriptor.value);correct(descriptor.get);correct(descriptor.set);}
      }catch{increment('inspectionFailures');}
    }
    for(const constructor of constructors){
      if(stats.callableLimitReached)break;
      correct(constructor);inspectOwn(constructor);inspectOwn(ownData(constructor,'prototype'));
    }
  }

  function dispose(){
    if(disposed)return;disposed=true;stats.disposed=true;
    if(factoryWrapper){
      const current=Object.getOwnPropertyDescriptor(WindowModule,'createWindow');
      if(current?.value===factoryWrapper){try{Object.defineProperty(WindowModule,'createWindow',factoryDescriptor);stats.childFactoryRestored=true;}catch{stats.childFactoryRestoreConflict=true;}}
      else stats.childFactoryRestoreConflict=true;
      activeChildHook=false;
    }
    for(let index=saved.length-1;index>=0;index--){const {fn,previous,next}=saved[index];
      try{if(Object.getPrototypeOf(fn)!==next){increment('restoreConflicts');continue;}Object.setPrototypeOf(fn,previous);increment('restoredFunctions');}
      catch{increment('restoreFailures');}}
    saved.length=0;for(const owner of realms)activeWindows.delete(owner.realm);realms.length=0;
  }
  try{
    installRealm(window);
    if(children){
      const original=factoryDescriptor.value;
      factoryWrapper=function createWindowWithWebIdlRealmCompatibility(factoryOptions){
        const child=Reflect.apply(original,this,arguments);if(disposed)return child;
        if(!factoryOptions||!Object.hasOwn(factoryOptions,'parentOrigin')){increment('skippedFactories');return child;}
        increment('observedChildren');
        if(ownData(factoryOptions,'runScripts')!=='outside-only'){increment('unsupportedChildren');return child;}
        if(realms.length>=MAX_REALMS){stats.realmLimitReached=true;return child;}
        try{const proxy=ownData(child,'_globalProxy');if(!proxy){increment('unsupportedChildren');return child;}installRealm(proxy);}
        catch{increment('childFailures');}
        return child;
      };
      Object.defineProperty(WindowModule,'createWindow',{...factoryDescriptor,value:factoryWrapper});activeChildHook=true;
    }
  }catch(error){dispose();throw error instanceof WebIdlRealmCompatError?error:new WebIdlRealmCompatError('INSTALL_FAILED');}
  return{snapshot(){return{...stats};},dispose};
}
