// JavaScript WebIDL receiver checks for the owned JSDOM runtime. Valid calls
// delegate to JSDOM; invalid calls throw the declaring window's TypeError.
// Function.prototype.toString and host intrinsics are left unchanged.
import WindowModule from 'jsdom/lib/jsdom/browser/Window.js';
import NavigatorModule from 'jsdom/lib/jsdom/living/generated/Navigator.js';
import MediaModule from 'jsdom/lib/jsdom/living/generated/HTMLMediaElement.js';
import jsdomPackage from 'jsdom/package.json' with { type: 'json' };
const own=Object.getOwnPropertyDescriptor,define=Object.defineProperty,apply=Reflect.apply;
const active=new WeakSet();let childHookActive=false;
const same=(a,b)=>!!a&&!!b&&['value','get','set','writable','enumerable','configurable'].every(k=>Object.hasOwn(a,k)===Object.hasOwn(b,k)&&a[k]===b[k]);
export function installJavascriptBindings(window,{children=false}={}) {
  if(jsdomPackage.version!=='26.1.0'||!window||active.has(window)||typeof children!=='boolean'||children&&childHookActive)throw Error('JS_BINDING_OPTIONS_INVALID');
  const previousFactory=children?own(WindowModule,'createWindow'):undefined;
  if(children&&(!previousFactory?.writable||typeof previousFactory.value!=='function'))throw Error('JS_BINDING_FACTORY_UNAVAILABLE');
  const records=[];let disposed=false,installedFactory;
  const stats={realms:0,childRealms:0,installedDescriptors:0,calls:0,rejectedReceivers:0,returned:0,delegatedThrows:0,
    childFailures:0,realmLimitReached:false,restoredDescriptors:0,restoreConflicts:0,restoreFailures:0,childFactoryRestored:false};
  const snapshot=()=>({...stats,javascriptOnly:true,nativeAddonUsed:false,functionToStringOverridden:false,disposed});
  const installRealm=realm=>{
    if(active.has(realm))return;
    if(records.length>=32){stats.realmLimitReached=true;return;}
    if(typeof realm.Function!=='function'||realm.Function===Function)throw Error('JS_BINDING_REALM_INVALID');
    const record={realm,bindings:[]};records.push(record);active.add(realm);stats.realms++;if(realm!==window)stats.childRealms++;
    const RealmError=realm.TypeError,captureStack=realm.Error.captureStackTrace,NavigatorPrototype=realm.Navigator.prototype,MediaPrototype=realm.HTMLMediaElement.prototype;
    const install=(target,key,kind,predicate,fallback)=>{
      const previous=own(target,key),original=fallback??previous?.[kind];
      if(typeof original!=='function'||previous&&!previous.configurable&&!previous.writable)throw Error('JS_BINDING_DESCRIPTOR_INVALID');
      const wrapper=new realm.Proxy(original,{apply:function invokeBinding(fn,receiver,args){
        stats.calls++;
        if(!predicate(receiver)){
          stats.rejectedReceivers++;
          const error=new RealmError('Illegal invocation');
          captureStack(error,invokeBinding);
          throw error;
        }
        try{const result=apply(fn,receiver,args);stats.returned++;return result;}catch(error){stats.delegatedThrows++;throw error;}
      }});
      const installed=previous?{...previous,[kind]:wrapper}:{configurable:true,enumerable:true,get:wrapper,set:undefined};
      define(target,key,installed);record.bindings.push({target,key,previous,installed});stats.installedDescriptors++;
    };
    install(NavigatorPrototype,'plugins','get',NavigatorModule.is);
    install(NavigatorPrototype,'mimeTypes','get',NavigatorModule.is);
    const falseGetter=realm.eval('Object.getOwnPropertyDescriptor({get webdriver(){return false}},"webdriver").get');
    install(NavigatorPrototype,'webdriver','get',NavigatorModule.is,falseGetter);
    install(MediaPrototype,'canPlayType','value',MediaModule.is);
  };
  const dispose=()=>{
    if(disposed)return snapshot();disposed=true;
    if(installedFactory){try{if(same(own(WindowModule,'createWindow'),installedFactory)){define(WindowModule,'createWindow',previousFactory);stats.childFactoryRestored=true;}else stats.restoreConflicts++;}catch{stats.restoreFailures++;}childHookActive=false;}
    for(const record of [...records].reverse()){
      for(const binding of [...record.bindings].reverse())try{
        if(!same(own(binding.target,binding.key),binding.installed)){stats.restoreConflicts++;continue;}
        if(binding.previous)define(binding.target,binding.key,binding.previous);else if(!Reflect.deleteProperty(binding.target,binding.key))throw Error('JS_BINDING_DELETE_FAILED');
        stats.restoredDescriptors++;
      }catch{stats.restoreFailures++;}
      active.delete(record.realm);
    }
    return snapshot();
  };
  try{
    installRealm(window);
    if(children){installedFactory={...previousFactory,value:function createWindowWithJavascriptBindings(options){
      const child=apply(previousFactory.value,this,arguments);
      if(!disposed&&options&&own(options,'parentOrigin')&&options.runScripts==='outside-only')try{installRealm(own(child,'_globalProxy')?.value);}catch{stats.childFailures++;}
      return child;
    }};define(WindowModule,'createWindow',installedFactory);childHookActive=true;}
    return Object.freeze({snapshot,dispose});
  }catch(error){dispose();throw error;}
}
