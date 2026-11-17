// Narrow diagnostic counterpart of the existing callable compatibility layer.
// Empty Proxy delegates the real API unchanged; it is not a native scheduler.
export function installRuntimeRafCallableControl(window){
 const get=Object.getOwnPropertyDescriptor,define=Object.defineProperty,own=Object.hasOwn,is=Object.is;
 const original=get(window,'requestAnimationFrame');
 if(!window||window.Function===Function||typeof window.eval!=='function'||typeof original?.value!=='function'||(!original.configurable&&!original.writable))throw Error('RAF_CALLABLE_UNSUPPORTED');
 const make=window.eval('(function(original){return new Proxy(original,Object.create(null));})');
 const proxy=Reflect.apply(make,undefined,[original.value]);
 const installed={...original,value:proxy};
 const stats={diagnosticOnly:true,scope:'top-requestAnimationFrame',emptyProxy:true,originalDelegationsRepeated:false,callbackIdentityChanged:false,timestampsModified:false,schedulingModified:false,functionToStringOverridden:false,sourceRenderingChanged:true,nativeImplementationProven:false,installed:false,disposed:false,restored:false,restoreConflict:false,restoreFailures:0};
 const same=(a,b)=>!!a&&!!b&&['value','get','set','writable','enumerable','configurable'].every(k=>own(a,k)===own(b,k)&&is(a[k],b[k]));
 const snapshot=()=>({...stats});
 const dispose=()=>{if(!stats.disposed){stats.disposed=true;try{if(same(get(window,'requestAnimationFrame'),installed)){define(window,'requestAnimationFrame',original);stats.restored=true;}else stats.restoreConflict=true;}catch{stats.restoreFailures++;}}return snapshot();};
 try{define(window,'requestAnimationFrame',installed);stats.installed=true;}catch(error){dispose();throw error;}
 return{snapshot,dispose};
}
