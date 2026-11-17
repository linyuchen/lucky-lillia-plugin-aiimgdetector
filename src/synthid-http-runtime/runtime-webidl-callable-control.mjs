// Optional diagnostic: empty realm-owned Proxy forwarding of existing APIs.
// Proxy source rendering is NOT proof of a native implementation or browser.
import WindowModule from 'jsdom/lib/jsdom/browser/Window.js';
import webIdlUtils from 'jsdom/lib/jsdom/living/generated/utils.js';
import jsdomPackage from 'jsdom/package.json' with { type: 'json' };
import { createHash } from 'node:crypto';
import { webIdlConstructorNames } from './webidl-realm-catalog.mjs';
import { webIdlCallableSourceHashes } from './webidl-callable-source-catalog.mjs';

const MAX_REALMS=32,MAX_CALLABLES=10000,MAX_OWN_KEYS=4096,MAX_SOURCE_LENGTH=1000000;
const sourceHashes=new Set(webIdlCallableSourceHashes),hostToString=Function.prototype.toString;
const activeWindows=new WeakSet();let activeChildHook=false;
const isObject=value=>value!==null&&(typeof value==='object'||typeof value==='function');
const ownData=(object,key)=>{const d=Object.getOwnPropertyDescriptor(object,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
const sameDescriptor=(a,b)=>!!a&&!!b&&['value','get','set','writable','enumerable','configurable'].every(key=>Object.hasOwn(a,key)===Object.hasOwn(b,key)&&a[key]===b[key]);
const ERROR_CODES=new Set(['INVALID_OPTIONS','UNSUPPORTED_JSDOM','UNSUPPORTED_REALM','REALM_COMPAT_REQUIRED','ALREADY_INSTALLED','CHILD_HOOK_ALREADY_INSTALLED','INSTALL_FAILED']);
export class WebIdlCallableControlError extends Error{constructor(code){const safe=ERROR_CODES.has(code)?code:'INSTALL_FAILED';super('WebIDL callable control failed: '+safe);this.name='WebIdlCallableControlError';this.code=safe;}}

/** Install before official/page code, AFTER WebIDL realm compatibility.
 * Dispose in the reverse order: this controller before realm compatibility.
 * Source hashes only reject overwritten or newly added page callbacks. They
 * are not independent proof of function ownership or internal [[Realm]]. */
export function installWebIdlCallableControl(window,options={}){
  if(!isObject(window)||!options||typeof options!=='object')throw new WebIdlCallableControlError('INVALID_OPTIONS');
  const childrenDescriptor=Object.getOwnPropertyDescriptor(options,'children');
  if(childrenDescriptor&&!Object.hasOwn(childrenDescriptor,'value'))throw new WebIdlCallableControlError('INVALID_OPTIONS');
  const children=childrenDescriptor?.value??false;
  if(typeof children!=='boolean')throw new WebIdlCallableControlError('INVALID_OPTIONS');
  if(jsdomPackage.version!=='26.1.0')throw new WebIdlCallableControlError('UNSUPPORTED_JSDOM');
  if(activeWindows.has(window))throw new WebIdlCallableControlError('ALREADY_INSTALLED');
  if(children&&activeChildHook)throw new WebIdlCallableControlError('CHILD_HOOK_ALREADY_INSTALLED');
  const factoryDescriptor=children?Object.getOwnPropertyDescriptor(WindowModule,'createWindow'):undefined;
  if(children&&(!factoryDescriptor?.writable||typeof factoryDescriptor.value!=='function'))throw new WebIdlCallableControlError('UNSUPPORTED_JSDOM');
  const realms=[],saved=[],callables=new WeakMap();let disposed=false,factoryWrapper;
  const stats={diagnosticOnly:true,proxyCallableSimulation:true,nativeIdentityProven:false,functionInternalRealmChanged:false,
    callableIdentitiesChanged:true,sourceRenderingModified:true,functionToStringOverridden:false,nativeSourceStringsInvented:false,
    officialCodeChanged:false,hostIntrinsicsModified:false,absentApisAdded:0,pageCallbacksWrapped:0,sourceCatalogPinned:true,
    maximumRealms:MAX_REALMS,maximumCallables:MAX_CALLABLES,childrenEnabled:children,installedRealms:0,observedChildren:0,skippedFactories:0,
    unsupportedChildren:0,childFailures:0,realmLimitReached:false,callableLimitReached:false,descriptorLimitReached:false,
    constructorsFound:0,callablesObserved:0,proxiesCreated:0,sourceMismatchesSkipped:0,sourceReadFailures:0,
    sharedCallableConflicts:0,nonRealmFunctionsSkipped:0,descriptorsChanged:0,invariantDescriptorsSkipped:0,
    inheritedConstructorParentsChanged:0,nonExtensibleConstructorsSkipped:0,inspectionFailures:0,mutationFailures:0,
    restoredDescriptors:0,restoredConstructorParents:0,restoreConflicts:0,restoreFailures:0,
    childFactoryRestored:false,childFactoryRestoreConflict:false,disposed:false};
  const increment=key=>{stats[key]=Math.min(1000000,stats[key]+1);};

  function installRealm(realm){
    if(realms.length>=MAX_REALMS){stats.realmLimitReached=true;return;}
    if(activeWindows.has(realm))throw new WebIdlCallableControlError('ALREADY_INSTALLED');
    const realmFunction=ownData(realm,'Function'),realmFunctionPrototype=isObject(realmFunction)?ownData(realmFunction,'prototype'):undefined;
    const realmProxy=ownData(realm,'Proxy'),registry=ownData(realm,webIdlUtils.ctorRegistrySymbol);
    if(typeof realmFunction!=='function'||realmFunction===Function||typeof realmProxy!=='function'||realmProxy===Proxy||!isObject(registry)||Object.getPrototypeOf(registry)!==null)throw new WebIdlCallableControlError('UNSUPPORTED_REALM');
    const eventTarget=ownData(registry,'EventTarget');
    if(typeof eventTarget!=='function'||Object.getPrototypeOf(eventTarget)!==realmFunctionPrototype)throw new WebIdlCallableControlError('REALM_COMPAT_REQUIRED');
    // Compile only this fixed, public helper in the existing isolated realm.
    // Its handler has no traps or inherited trap properties; nothing is added
    // to the page global and no page callable is invoked during installation.
    const makeProxy=Reflect.apply(realmFunction,undefined,['return function(original){ return new Proxy(original, Object.create(null)); };'])();
    const owner={realm,realmFunctionPrototype,makeProxy};realms.push(owner);activeWindows.add(realm);increment('installedRealms');
    const constructors=new Set();
    for(const name of webIdlConstructorNames){const ctor=ownData(registry,name);if(typeof ctor==='function')constructors.add(ctor);}
    const windowPrototype=Object.getPrototypeOf(realm),windowConstructor=isObject(windowPrototype)?ownData(windowPrototype,'constructor'):undefined;
    if(typeof windowConstructor==='function'&&Object.getPrototypeOf(windowConstructor)===eventTarget&&ownData(windowConstructor,'prototype')===windowPrototype)constructors.add(windowConstructor);
    for(const [alias,target] of [['Image','HTMLImageElement'],['Audio','HTMLAudioElement'],['Option','HTMLOptionElement']]){
      const candidate=ownData(realm,alias),registered=ownData(registry,target);
      if(typeof candidate==='function'&&typeof registered==='function'&&ownData(candidate,'name')===alias&&ownData(candidate,'prototype')===ownData(registered,'prototype'))constructors.add(candidate);
    }
    stats.constructorsFound=Math.min(1000000,stats.constructorsFound+constructors.size);
    function proxyFor(fn){
      if(typeof fn!=='function')return fn;
      const seen=callables.get(fn);
      if(seen){if(seen.owner!==owner){increment('sharedCallableConflicts');return fn;}return seen.proxy;}
      if(stats.callablesObserved>=MAX_CALLABLES){stats.callableLimitReached=true;return fn;}
      increment('callablesObserved');const entry={owner,proxy:fn};callables.set(fn,entry);
      const parent=Object.getPrototypeOf(fn);
      if(parent!==realmFunctionPrototype&&!constructors.has(parent)){increment('nonRealmFunctionsSkipped');return fn;}
      // The trust anchor remains the per-window constructor registry. Public
      // pristine-source fingerprints additionally reject replaced callbacks,
      // compat shims and already proxied functions. Never retain candidate text.
      try{const source=Reflect.apply(hostToString,fn,[]);
        if(source.length>MAX_SOURCE_LENGTH||!sourceHashes.has(createHash('sha256').update(source).digest('hex'))){increment('sourceMismatchesSkipped');return fn;}
      }catch{increment('sourceReadFailures');return fn;}
      entry.proxy=Reflect.apply(makeProxy,undefined,[fn]);increment('proxiesCreated');return entry.proxy;
    }
    function replaceDescriptor(object,key,previous,next){
      if(sameDescriptor(previous,next))return;
      if(!previous.configurable&&(!Object.hasOwn(previous,'value')||!previous.writable)){increment('invariantDescriptorsSkipped');return;}
      try{Object.defineProperty(object,key,next);saved.push({kind:'descriptor',object,key,previous,next});increment('descriptorsChanged');}
      catch{increment('mutationFailures');}
    }
    const inspected=new WeakSet();
    function inspectOwn(object){
      if(!isObject(object)||inspected.has(object))return;inspected.add(object);
      try{const keys=Reflect.ownKeys(object);if(keys.length>MAX_OWN_KEYS){stats.descriptorLimitReached=true;return;}
        for(const key of keys){if(stats.callableLimitReached)return;const previous=Object.getOwnPropertyDescriptor(object,key);if(!previous)continue;
          const next={...previous};for(const field of ['value','get','set'])if(typeof previous[field]==='function')next[field]=proxyFor(previous[field]);
          replaceDescriptor(object,key,previous,next);}
      }catch{increment('inspectionFailures');}
    }
    // Make all constructor proxies before altering inheritance, so every
    // derived constructor still passes the original ownership check.
    for(const ctor of constructors)proxyFor(ctor);
    for(const ctor of constructors){inspectOwn(ctor);inspectOwn(ownData(ctor,'prototype'));}
    // Keep internal construction, aliases and visible constructor identities
    // consistent. Only own descriptors for the trusted standard names qualify.
    for(const name of webIdlConstructorNames)for(const object of [registry,realm]){
      const previous=Object.getOwnPropertyDescriptor(object,name);
      if(!previous||!Object.hasOwn(previous,'value')||!constructors.has(previous.value))continue;
      replaceDescriptor(object,name,previous,{...previous,value:proxyFor(previous.value)});
    }
    for(const ctor of constructors){
      const previous=Object.getPrototypeOf(ctor),next=callables.get(previous)?.proxy;
      if(!constructors.has(previous)||!next||previous===next)continue;
      if(!Object.isExtensible(ctor)){increment('nonExtensibleConstructorsSkipped');continue;}
      try{Object.setPrototypeOf(ctor,next);saved.push({kind:'parent',object:ctor,previous,next});increment('inheritedConstructorParentsChanged');}
      catch{increment('mutationFailures');}
    }
  }

  function dispose(){
    if(disposed)return;disposed=true;stats.disposed=true;
    if(factoryWrapper){const current=Object.getOwnPropertyDescriptor(WindowModule,'createWindow');
      if(current?.value===factoryWrapper){try{Object.defineProperty(WindowModule,'createWindow',factoryDescriptor);stats.childFactoryRestored=true;}catch{stats.childFactoryRestoreConflict=true;}}
      else stats.childFactoryRestoreConflict=true;activeChildHook=false;
    }
    for(let i=saved.length-1;i>=0;i--){const change=saved[i];
      try{if(change.kind==='parent'){
        if(Object.getPrototypeOf(change.object)!==change.next){increment('restoreConflicts');continue;}
        Object.setPrototypeOf(change.object,change.previous);increment('restoredConstructorParents');
      }else{
        if(!sameDescriptor(Object.getOwnPropertyDescriptor(change.object,change.key),change.next)){increment('restoreConflicts');continue;}
        Object.defineProperty(change.object,change.key,change.previous);increment('restoredDescriptors');
      }}catch{increment('restoreFailures');}}
    saved.length=0;for(const owner of realms)activeWindows.delete(owner.realm);realms.length=0;
  }
  try{
    installRealm(window);
    if(children){const original=factoryDescriptor.value;
      factoryWrapper=function createWindowWithWebIdlCallableControl(factoryOptions){
        const child=Reflect.apply(original,this,arguments);if(disposed)return child;
        if(!factoryOptions||!Object.hasOwn(factoryOptions,'parentOrigin')){increment('skippedFactories');return child;}
        increment('observedChildren');if(ownData(factoryOptions,'runScripts')!=='outside-only'){increment('unsupportedChildren');return child;}
        if(realms.length>=MAX_REALMS){stats.realmLimitReached=true;return child;}
        try{const proxy=ownData(child,'_globalProxy');if(!proxy){increment('unsupportedChildren');return child;}installRealm(proxy);}catch{increment('childFailures');}
        return child;
      };
      Object.defineProperty(WindowModule,'createWindow',{...factoryDescriptor,value:factoryWrapper});activeChildHook=true;
    }
  }catch(error){dispose();throw error instanceof WebIdlCallableControlError?error:new WebIdlCallableControlError('INSTALL_FAILED');}
  return{snapshot(){return{...stats};},dispose};
}
