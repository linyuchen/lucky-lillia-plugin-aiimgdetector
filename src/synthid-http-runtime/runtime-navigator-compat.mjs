// Optional, source-derived consistency for two EXISTING legacy properties.
// Uses the pinned per-navigator implementation; public getters stay original.
import WindowModule from 'jsdom/lib/jsdom/browser/Window.js';
import NavigatorModule from 'jsdom/lib/jsdom/living/navigator/Navigator-impl.js';
import utils from 'jsdom/lib/jsdom/living/generated/utils.js';
import jsdomPackage from 'jsdom/package.json' with { type: 'json' };

const MAX_REALMS=32,MAX_UA_LENGTH=8192;
const activeWindows=new WeakSet();let activeChildHook=false;
const isObject=value=>value!==null&&(typeof value==='object'||typeof value==='function');
const ownData=(object,key)=>{const d=Object.getOwnPropertyDescriptor(object,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
const sameDescriptor=(a,b)=>!!a&&!!b&&['value','get','set','writable','enumerable','configurable'].every(key=>Object.hasOwn(a,key)===Object.hasOwn(b,key)&&a[key]===b[key]);
const ERROR_CODES=new Set(['INVALID_OPTIONS','UNSUPPORTED_JSDOM','UNSUPPORTED_REALM','ALREADY_INSTALLED','CHILD_HOOK_ALREADY_INSTALLED','INSTALL_FAILED']);
export class RuntimeNavigatorCompatError extends Error{constructor(code){const safe=ERROR_CODES.has(code)?code:'INSTALL_FAILED';super('Navigator compatibility failed: '+safe);this.name='RuntimeNavigatorCompatError';this.code=safe;}}

export function installRuntimeNavigatorCompat(window,options={}){
  if(!isObject(window)||!options||typeof options!=='object')throw new RuntimeNavigatorCompatError('INVALID_OPTIONS');
  const option=Object.getOwnPropertyDescriptor(options,'children');
  if(option&&!Object.hasOwn(option,'value'))throw new RuntimeNavigatorCompatError('INVALID_OPTIONS');
  const children=option?.value??false;if(typeof children!=='boolean')throw new RuntimeNavigatorCompatError('INVALID_OPTIONS');
  if(jsdomPackage.version!=='26.1.0')throw new RuntimeNavigatorCompatError('UNSUPPORTED_JSDOM');
  if(activeWindows.has(window))throw new RuntimeNavigatorCompatError('ALREADY_INSTALLED');
  if(children&&activeChildHook)throw new RuntimeNavigatorCompatError('CHILD_HOOK_ALREADY_INSTALLED');
  const factoryDescriptor=children?Object.getOwnPropertyDescriptor(WindowModule,'createWindow'):undefined;
  if(children&&(!factoryDescriptor?.writable||typeof factoryDescriptor.value!=='function'))throw new RuntimeNavigatorCompatError('UNSUPPORTED_JSDOM');
  const saved=[],realms=[];let disposed=false,factoryWrapper;
  const stats={diagnosticOnly:true,legacyNavigatorConsistency:true,sourceDerivedFromSuppliedUserAgent:true,
    publicGetterFunctionsChanged:false,publicDescriptorsChanged:false,nativeSourceForged:false,userAgentModified:false,
    userAgentDataAdded:false,otherNavigatorPropertiesModified:false,maximumRealms:MAX_REALMS,childrenEnabled:children,
    visitedRealms:0,eligibleChromeRealms:0,skippedNonChromeRealms:0,invalidUserAgents:0,wrapperValueConflicts:0,
    correctedRealms:0,appVersionCorrections:0,vendorCorrections:0,alreadyConsistentProperties:0,
    unsupportedProperties:0,mutationFailures:0,observedChildren:0,skippedFactories:0,unsupportedChildren:0,
    childFailures:0,realmLimitReached:false,restoredProperties:0,restoreConflicts:0,restoreFailures:0,
    childFactoryRestored:false,childFactoryRestoreConflict:false,disposed:false};
  const increment=key=>{stats[key]=Math.min(1000000,stats[key]+1);};

  function installRealm(realm){
    if(realms.length>=MAX_REALMS){stats.realmLimitReached=true;return;}
    if(activeWindows.has(realm))throw new RuntimeNavigatorCompatError('ALREADY_INSTALLED');
    const realmFunction=ownData(realm,'Function');
    if(typeof realmFunction!=='function'||realmFunction===Function)throw new RuntimeNavigatorCompatError('UNSUPPORTED_REALM');
    const navigator=realm.navigator,impl=isObject(navigator)?ownData(navigator,utils.implSymbol):undefined;
    const backing=ownData(realm,'_globalObject');
    if(!isObject(impl)||!Object.prototype.isPrototypeOf.call(NavigatorModule.implementation.prototype,impl)
      ||ownData(impl,'_globalObject')!==backing||ownData(backing,'_globalProxy')!==realm)throw new RuntimeNavigatorCompatError('UNSUPPORTED_REALM');
    realms.push(realm);activeWindows.add(realm);increment('visitedRealms');
    // Navigator-impl receives precisely this own data value from the supplied
    // ResourceLoader. Do not manufacture a user agent or read browser storage.
    const ua=ownData(impl,'userAgent');
    if(typeof ua!=='string'||ua.length>MAX_UA_LENGTH){increment('invalidUserAgents');return;}
    if(navigator.userAgent!==ua){increment('wrapperValueConflicts');return;}
    if(!ua.startsWith('Mozilla/')||!/(?:^|\s)Chrome\/\d+(?:\.\d+){1,3}(?:\s|$)/.test(ua)){increment('skippedNonChromeRealms');return;}
    increment('eligibleChromeRealms');let corrected=0;
    for(const [key,value,counter] of [['appVersion',ua.slice(8),'appVersionCorrections'],['vendor','Google Inc.','vendorCorrections']]){
      const previous=Object.getOwnPropertyDescriptor(impl,key);
      const inherited=Object.getOwnPropertyDescriptor(NavigatorModule.implementation.prototype,key);
      if(previous&&!Object.hasOwn(previous,'value')||!previous&&typeof inherited?.get!=='function'){
        increment('unsupportedProperties');continue;
      }
      const current=previous?previous.value:Reflect.apply(inherited.get,impl,[]);
      if(navigator[key]!==current){increment('wrapperValueConflicts');continue;}
      if(current===value){increment('alreadyConsistentProperties');continue;}
      if(previous&&!previous.configurable&&!previous.writable||!previous&&!Object.isExtensible(impl)){
        increment('unsupportedProperties');continue;
      }
      const next=previous?{...previous,value}:{value,writable:true,enumerable:true,configurable:true};
      try{Object.defineProperty(impl,key,next);saved.push({impl,key,previous,next});increment(counter);corrected++;}
      catch{increment('mutationFailures');}
    }
    if(corrected>0)increment('correctedRealms');
  }
  function dispose(){
    if(disposed)return;disposed=true;stats.disposed=true;
    if(factoryWrapper){const current=Object.getOwnPropertyDescriptor(WindowModule,'createWindow');
      if(current?.value===factoryWrapper){try{Object.defineProperty(WindowModule,'createWindow',factoryDescriptor);stats.childFactoryRestored=true;}catch{stats.childFactoryRestoreConflict=true;}}
      else stats.childFactoryRestoreConflict=true;activeChildHook=false;
    }
    for(let i=saved.length-1;i>=0;i--){const {impl,key,previous,next}=saved[i];
      try{if(!sameDescriptor(Object.getOwnPropertyDescriptor(impl,key),next)){increment('restoreConflicts');continue;}
        if(previous)Object.defineProperty(impl,key,previous);else delete impl[key];increment('restoredProperties');
      }catch{increment('restoreFailures');}}
    saved.length=0;for(const realm of realms)activeWindows.delete(realm);realms.length=0;
  }
  try{
    installRealm(window);
    if(children){const original=factoryDescriptor.value;
      factoryWrapper=function createWindowWithNavigatorConsistency(factoryOptions){
        const child=Reflect.apply(original,this,arguments);if(disposed)return child;
        if(!factoryOptions||!Object.hasOwn(factoryOptions,'parentOrigin')){increment('skippedFactories');return child;}
        increment('observedChildren');if(ownData(factoryOptions,'runScripts')!=='outside-only'){increment('unsupportedChildren');return child;}
        if(realms.length>=MAX_REALMS){stats.realmLimitReached=true;return child;}
        try{const proxy=ownData(child,'_globalProxy');if(!proxy){increment('unsupportedChildren');return child;}installRealm(proxy);}catch{increment('childFailures');}
        return child;
      };
      Object.defineProperty(WindowModule,'createWindow',{...factoryDescriptor,value:factoryWrapper});activeChildHook=true;
    }
  }catch(error){dispose();throw error instanceof RuntimeNavigatorCompatError?error:new RuntimeNavigatorCompatError('INSTALL_FAILED');}
  return{snapshot(){return{...stats};},dispose};
}
