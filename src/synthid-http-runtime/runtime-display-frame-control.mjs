// Diagnostic Windows rendering-opportunity source. No browser process and no
// fabricated frame times: every timestamp comes from DWM's actual qpcVBlank.
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import reportException from 'jsdom/lib/jsdom/living/helpers/runtime-script-errors.js';
import generatedUtils from 'jsdom/lib/jsdom/living/generated/utils.js';
import {chromiumTimeClamperActive,coarsenNativeFrameForOrigin} from './runtime-clock-precision-control.mjs';
const require=createRequire(import.meta.url),active=new WeakSet();
export function installRuntimeDisplayFrameControl(window,{clockPrecision100us=false}={}){
 if(process.platform!=='win32'||process.arch!=='x64'||!window||window.Function===Function||typeof clockPrecision100us!=='boolean'||active.has(window))throw Error('DISPLAY_FRAME_UNSUPPORTED');
 const own=Object.getOwnPropertyDescriptor,define=Object.defineProperty,apply=Reflect.apply;
 const previousRequest=own(window,'requestAnimationFrame'),previousCancel=own(window,'cancelAnimationFrame');
 if(typeof previousRequest?.value!=='function'||typeof previousCancel?.value!=='function'||!previousRequest.configurable||!previousCancel.configurable)throw Error('DISPLAY_FRAME_API_UNAVAILABLE');
 const addon=require('./native-display-frames/build/Release/native_display_frames.node');
 const clock=addon.readClock();
 const before=performance.now(),nativeNow=addon.readCounter(),after=performance.now();
 const nativeToHostOffset=(before+after)/2-nativeNow;
 const hostToRealmOffset=performance.timeOrigin-window.performance.timeOrigin;
 const realmOriginHostMs=generatedUtils.implForWrapper(window.performance)._nowAtTimeOrigin;
 if(!Number.isFinite(nativeToHostOffset)||!Number.isFinite(hostToRealmOffset)||!(clock.refreshNumerator>0)||!(clock.refreshDenominator>0))throw Error('DISPLAY_FRAME_CLOCK_UNAVAILABLE');
 const pending=new Map();let nextHandle=0,lastFrame=clock.nowMs,job;
 const stats={diagnosticOnly:true,scope:'top-window',source:'Windows-DWM-qpcVBlank',browserProcessUsed:false,frameTimesInvented:false,clockPrecision100us,
  refreshRateHz:clock.refreshNumerator/clock.refreshDenominator,clockCalibrationUncertaintyMs:after-before,
  installed:false,requests:0,cancellations:0,frames:0,callbacks:0,callbackThrows:0,failures:0,lastFailure:'none',
  disposed:false,restoredDescriptors:0,restoreConflicts:0,restoreFailures:0,drained:false};
 const count=k=>{stats[k]=Math.min(1000000,stats[k]+1);};
 const nativeFailure=()=>{count('failures');stats.lastFailure='native-frame-failed';pending.clear();};
 const arm=()=>{
  if(stats.disposed||stats.failures||job||pending.size===0)return;
  let next;try{next=addon.nextFrame(lastFrame);}catch{nativeFailure();return;}
  job=next.then(nativeStamp=>{
   if(stats.disposed)return;
   if(!Number.isFinite(nativeStamp)||nativeStamp<=lastFrame)throw Error('NONADVANCING_FRAME');
   lastFrame=nativeStamp;count('frames');
   const realTime=nativeStamp+nativeToHostOffset+hostToRealmOffset;
   if(!Number.isFinite(realTime)||realTime<0)throw Error('INVALID_FRAME_TIME');
   const stamp=clockPrecision100us?(chromiumTimeClamperActive()?coarsenNativeFrameForOrigin(nativeStamp,realmOriginHostMs):Math.floor(realTime*10)/10):realTime;
   const handles=Array.from(pending.keys());
   for(const id of handles){
    if(stats.disposed)break;
    const callback=pending.get(id);if(!callback)continue;pending.delete(id);count('callbacks');
    try{apply(callback,window,[stamp]);}catch(error){count('callbackThrows');try{reportException(window,error);}catch{count('failures');stats.lastFailure='exception-report-failed';}}
   }
  }).catch(nativeFailure).finally(()=>{job=undefined;arm();});
 };
 const request=new window.Proxy(previousRequest.value,{apply(target,receiver,args){
  if(stats.disposed||typeof args[0]!=='function')return apply(target,receiver,args);
  if(stats.failures)throw new window.DOMException('Display clock unavailable','InvalidStateError');
  if(pending.size>=4096)throw new window.DOMException('Animation callback limit','QuotaExceededError');
  do{nextHandle=(nextHandle+1)>>>0;}while(nextHandle===0||pending.has(nextHandle));
  pending.set(nextHandle,args[0]);count('requests');arm();
  if(stats.failures)throw new window.DOMException('Display clock unavailable','InvalidStateError');
  return nextHandle;
 }});
 const cancel=new window.Proxy(previousCancel.value,{apply(target,receiver,args){
  if(stats.disposed)return apply(target,receiver,args);
  if(typeof args[0]==='bigint'||typeof args[0]==='symbol')throw new window.TypeError('Invalid animation frame handle');
  const handle=Number(args[0])>>>0;if(pending.delete(handle))count('cancellations');return undefined;
 }});
 const installedRequest={...previousRequest,value:request},installedCancel={...previousCancel,value:cancel};
 const same=(a,b)=>!!a&&!!b&&['value','get','set','writable','enumerable','configurable'].every(k=>Object.hasOwn(a,k)===Object.hasOwn(b,k)&&Object.is(a[k],b[k]));
 const snapshot=()=>({...stats,pendingCallbacks:pending.size,pendingNativeFrame:!!job});
 const dispose=()=>{
  if(!stats.disposed){stats.disposed=true;pending.clear();
   for(const [name,installed,previous]of [['requestAnimationFrame',installedRequest,previousRequest],['cancelAnimationFrame',installedCancel,previousCancel]]){
    try{if(same(own(window,name),installed)){define(window,name,previous);count('restoredDescriptors');}else if(!same(own(window,name),previous))count('restoreConflicts');}catch{count('restoreFailures');}
   }
   active.delete(window);
  }
  return snapshot();
 };
 const drain=async()=>{dispose();const pendingJob=job;if(pendingJob)await pendingJob;stats.drained=!job;return snapshot();};
 try{define(window,'requestAnimationFrame',installedRequest);define(window,'cancelAnimationFrame',installedCancel);stats.installed=true;active.add(window);}catch(error){dispose();throw error;}
 return {snapshot,dispose,drain};
}
