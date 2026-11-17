// Narrow missing Window/Navigator state for isolated JSDOM 26 realms.
// Trust derives from the document implementation origin and actual ancestors.
import WindowModule from 'jsdom/lib/jsdom/browser/Window.js';
import DocumentModule from 'jsdom/lib/jsdom/living/nodes/Document-impl.js';
import NavigatorModule from 'jsdom/lib/jsdom/living/navigator/Navigator-impl.js';
import ElementModule from 'jsdom/lib/jsdom/living/nodes/Element-impl.js';
import utils from 'jsdom/lib/jsdom/living/generated/utils.js';
import jsdomPackage from 'jsdom/package.json' with {type:'json'};

const MAX_REALMS=32,activeWindows=new WeakSet();let activeChildHook=false;
const object=value=>value!==null&&(typeof value==='object'||typeof value==='function');
const data=(value,key)=>{if(!object(value))return;const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,'value')?d.value:undefined;};
const sameDescriptor=(a,b)=>!!a&&!!b&&['value','get','set','writable','enumerable','configurable'].every(key=>Object.hasOwn(a,key)===Object.hasOwn(b,key)&&a[key]===b[key]);
const implementation=(wrapper,prototype)=>{const impl=data(wrapper,utils.implSymbol);return object(impl)&&Object.prototype.isPrototypeOf.call(prototype,impl)?impl:undefined;};
function realmState(realm){
  const backing=data(realm,'_globalObject'),proxy=data(backing,'_globalProxy');
  const document=implementation(data(backing,'_document'),DocumentModule.implementation.prototype);
  if(!object(backing)||!object(proxy)||!document||data(document,'_defaultView')!==proxy&&data(document,'_defaultView')!==backing)return;
  return{backing,proxy,document};
}
function trustworthyOrigin(origin){
  if(typeof origin!=='string'||origin==='null')return;
  let parsed;try{parsed=new URL(origin);}catch{return;}
  if(parsed.origin!==origin)return;
  if(parsed.protocol==='https:')return true;
  if(parsed.protocol!=='http:')return;
  const host=parsed.hostname.toLowerCase().replace(/\.$/,'');
  return host==='localhost'||host.endsWith('.localhost')||host==='[::1]'||/^127\.\d+\.\d+\.\d+$/.test(host);
}
function missing(object,key){
  let current=object;
  for(let depth=0;current&&depth<32;current=Object.getPrototypeOf(current),depth++)if(Object.getOwnPropertyDescriptor(current,key))return false;
  return current===null;
}

export function installRuntimeWindowStateCompat(window,options={}){
  if(!object(window)||!object(options))throw Error('WINDOW_STATE_INVALID_OPTIONS');
  const option=Object.getOwnPropertyDescriptor(options,'children'),children=option?.value??false;
  if(option&&!Object.hasOwn(option,'value')||typeof children!=='boolean')throw Error('WINDOW_STATE_INVALID_OPTIONS');
  if(jsdomPackage.version!=='26.1.0')throw Error('WINDOW_STATE_UNSUPPORTED_JSDOM');
  if(activeWindows.has(window)||children&&activeChildHook)throw Error('WINDOW_STATE_ALREADY_INSTALLED');
  const factoryDescriptor=children?Object.getOwnPropertyDescriptor(WindowModule,'createWindow'):undefined;
  if(children&&(!factoryDescriptor?.writable||typeof factoryDescriptor.value!=='function'))throw Error('WINDOW_STATE_UNSUPPORTED_FACTORY');
  const saved=[],realms=[];let disposed=false,factoryWrapper;
  const stats={diagnosticOnly:true,documentOriginDerived:true,ancestorContextsChecked:true,secureCrossOriginContextsModeled:false,
    sandboxContextsModeled:false,responsePoliciesModeled:false,windowDoNotTrackAdded:false,nativeSourceForged:false,sourceRenderingModified:false,
    doNotTrackPreferenceConfigured:false,maximumRealms:MAX_REALMS,childrenEnabled:children,installedRealms:0,
    secureContextGettersAdded:0,openerPropertiesAdded:0,navigatorDoNotTrackGettersAdded:0,preservedProperties:0,
    secureReads:0,insecureReads:0,unsupportedReads:0,unsupportedSandboxReads:0,unsupportedCrossOriginReads:0,
    unsupportedOriginReads:0,unsupportedAncestryReads:0,observedChildren:0,skippedFactories:0,childFailures:0,
    realmLimitReached:false,mutationFailures:0,restoredProperties:0,restoreConflicts:0,restoreFailures:0,
    childFactoryRestored:false,childFactoryRestoreConflict:false,disposed:false};
  const increment=key=>{stats[key]=Math.min(1000000,stats[key]+1);};
  function unsupported(reason){increment('unsupportedReads');increment(reason);return undefined;}
  function secureContext(realm,pendingChild){
    const seen=new Set();let current=realm,firstOrigin,crossOrigin=false,insecure=false;
    for(let depth=0;depth<MAX_REALMS;depth++){
      const state=realmState(current);if(!state||seen.has(state.backing))return unsupported('unsupportedAncestryReads');
      seen.add(state.backing);
      const url=data(state.document,'_URL'),scheme=data(url,'scheme');
      if(scheme!=='https'&&scheme!=='http'&&!(scheme==='about'&&data(url,'path')==='blank'&&data(url,'query')===null&&data(url,'fragment')===null))return unsupported('unsupportedOriginReads');
      const origin=data(state.document,'_origin'),trusted=trustworthyOrigin(origin);
      if(trusted===undefined)return unsupported('unsupportedOriginReads');
      if(firstOrigin===undefined)firstOrigin=origin;else if(firstOrigin!==origin)crossOrigin=true;
      if(!trusted)insecure=true;
      const parent=realmState(data(state.backing,'_parent')),frame=data(state.backing,'_frameElement');
      if(!parent)return unsupported('unsupportedAncestryReads');
      if(parent.backing===state.backing){
        if(frame!==null||depth===0&&pendingChild)return unsupported('unsupportedAncestryReads');
        if(insecure){increment('insecureReads');return false;}
        if(crossOrigin)return unsupported('unsupportedCrossOriginReads');
        increment('secureReads');return true;
      }
      if(!object(frame)||data(frame,'_ownerDocument')!==parent.document||data(frame,'_contentDocument')!==state.document)return unsupported('unsupportedAncestryReads');
      if(Reflect.apply(ElementModule.implementation.prototype.hasAttributeNS,frame,[null,'sandbox']))return unsupported('unsupportedSandboxReads');
      current=parent.proxy;
    }
    return unsupported('unsupportedAncestryReads');
  }
  function installRealm(realm,pendingChild=false){
    if(realms.length>=MAX_REALMS){stats.realmLimitReached=true;return;}
    if(activeWindows.has(realm))throw Error('WINDOW_STATE_ALREADY_INSTALLED');
    const state=realmState(realm),realmFunction=data(realm,'Function'),realmTypeError=data(realm,'TypeError');
    const navigator=realm.navigator,impl=implementation(navigator,NavigatorModule.implementation.prototype);
    if(!state||state.proxy!==realm||typeof realmFunction!=='function'||realmFunction===Function||typeof realmTypeError!=='function'||!impl||data(impl,'_globalObject')!==state.backing)throw Error('WINDOW_STATE_UNSUPPORTED_REALM');
    realms.push(realm);activeWindows.add(realm);increment('installedRealms');
    function add(target,key,descriptor,counter){
      if(!missing(target,key)){increment('preservedProperties');return;}
      const previous=Object.getOwnPropertyDescriptor(target,key);
      try{Object.defineProperty(target,key,descriptor);saved.push({target,key,previous,next:Object.getOwnPropertyDescriptor(target,key)});increment(counter);}catch{increment('mutationFailures');}
    }
    const secureGetter=realmFunction('resolve','return Object.getOwnPropertyDescriptor({get isSecureContext(){return resolve(this)}} ,"isSecureContext").get')(receiver=>{
      if(receiver!==realm&&receiver!==state.backing)throw new realmTypeError('Illegal invocation');
      try{return secureContext(realm,pendingChild);}catch{return unsupported('unsupportedAncestryReads');}
    });
    add(realm,'isSecureContext',{get:secureGetter,enumerable:true,configurable:true},'secureContextGettersAdded');
    const parent=realmState(data(state.backing,'_parent'));
    if(pendingChild||parent?.backing===state.backing&&data(state.backing,'_frameElement')===null||parent&&object(data(state.backing,'_frameElement')))
      add(realm,'opener',{value:null,writable:true,enumerable:true,configurable:true},'openerPropertiesAdded');
    const navigatorGetter=realmFunction('resolve','return Object.getOwnPropertyDescriptor({get doNotTrack(){return resolve(this)}} ,"doNotTrack").get')(receiver=>{
      if(!implementation(receiver,NavigatorModule.implementation.prototype))throw new realmTypeError('Illegal invocation');return null;
    });
    if(!missing(navigator,'doNotTrack'))increment('preservedProperties');
    else add(Object.getPrototypeOf(navigator),'doNotTrack',{get:navigatorGetter,enumerable:true,configurable:true},'navigatorDoNotTrackGettersAdded');
  }
  function dispose(){
    if(disposed)return;disposed=true;stats.disposed=true;
    if(factoryWrapper){
      if(Object.getOwnPropertyDescriptor(WindowModule,'createWindow')?.value===factoryWrapper){try{Object.defineProperty(WindowModule,'createWindow',factoryDescriptor);stats.childFactoryRestored=true;}catch{stats.childFactoryRestoreConflict=true;}}
      else stats.childFactoryRestoreConflict=true;activeChildHook=false;
    }
    for(let i=saved.length-1;i>=0;i--){const {target,key,previous,next}=saved[i];try{
      if(!sameDescriptor(Object.getOwnPropertyDescriptor(target,key),next)){increment('restoreConflicts');continue;}
      if(previous)Object.defineProperty(target,key,previous);else delete target[key];increment('restoredProperties');
    }catch{increment('restoreFailures');}}
    saved.length=0;for(const realm of realms)activeWindows.delete(realm);realms.length=0;
  }
  try{
    installRealm(window);
    if(children){const original=factoryDescriptor.value;factoryWrapper=function createWindowWithState(factoryOptions){
      const child=Reflect.apply(original,this,arguments);if(disposed)return child;
      if(!factoryOptions||!Object.hasOwn(factoryOptions,'parentOrigin')){increment('skippedFactories');return child;}
      increment('observedChildren');if(data(factoryOptions,'runScripts')!=='outside-only'){increment('childFailures');return child;}
      try{installRealm(data(child,'_globalProxy'),true);}catch{increment('childFailures');}return child;
    };Object.defineProperty(WindowModule,'createWindow',{...factoryDescriptor,value:factoryWrapper});activeChildHook=true;}
  }catch{dispose();throw Error('WINDOW_STATE_INSTALL_FAILED');}
  return{snapshot(){return{...stats};},dispose};
}
