// Fixed100us precision experiment for one dedicated JSDOM26 worker process.
// Never installs on host Date/performance or on a realm's generated wrapper.
import PerformanceModule from 'jsdom/lib/jsdom/living/hr-time/Performance-impl.js';
import jsdomPackage from 'jsdom/package.json' with {type:'json'};
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {performance as hostPerformance} from 'node:perf_hooks';
const require=createRequire(import.meta.url);
const prototype=PerformanceModule.implementation.prototype;
const originalDescriptor=Object.getOwnPropertyDescriptor(prototype,'now');
export const uncoarsenedPerformanceNow=originalDescriptor?.value;
let active=false;
let nativeClamper,nativeToHostOffset;
export const chromiumTimeClamperActive=()=>typeof nativeClamper==='function';
export function coarsenCompletedClockForOrigin(value,originHostMs){
  if(!nativeClamper)return quantizeCompletedClock100us(value);
  if(!Number.isFinite(value)||!Number.isFinite(originHostMs))throw Error('INVALID_CHROMIUM_CLOCK_INPUT');
  const originNative=originHostMs-nativeToHostOffset;
  return nativeClamper((value+originNative)*1000,originNative*1000);
}
export function coarsenNativeFrameForOrigin(nativeMs,originHostMs){
  if(!nativeClamper||!Number.isFinite(nativeMs)||!Number.isFinite(originHostMs))throw Error('CHROMIUM_CLAMPER_UNAVAILABLE');
  return nativeClamper(nativeMs*1000,(originHostMs-nativeToHostOffset)*1000);
}

// Self-contained so web compatibility can create its own realm-local copy.
export function quantizeCompletedClock100us(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER/10)throw Error('CLOCK_PRECISION_INVALID_VALUE');
  return Math.floor(value*10)/10;
}

export function installRuntimeClockPrecisionControl({chromiumClamper=false}={}){
  if(typeof chromiumClamper!=='boolean')throw Error('INVALID_CLOCK_PRECISION_OPTIONS');
  const previous=Object.getOwnPropertyDescriptor(prototype,'now');
  if(active)throw Error('CLOCK_PRECISION_ALREADY_INSTALLED');
  if(jsdomPackage.version!=='26.1.0'||typeof uncoarsenedPerformanceNow!=='function'||previous?.value!==uncoarsenedPerformanceNow
    ||!previous.writable||!previous.configurable)throw Error('CLOCK_PRECISION_UNSUPPORTED_JSDOM');
  const apply=Reflect.apply,get=Object.getOwnPropertyDescriptor,define=Object.defineProperty,own=Object.hasOwn,is=Object.is,min=Math.min;
  const stats={diagnosticOnly:true,fixed100us:true,algorithm:chromiumClamper?'chromium-157-time-clamper':'floor-relative',absoluteMonotonicClamping:chromiumClamper,epochTimeOriginCoarsened:false,quantumMicroseconds:100,hostIntrinsicsModified:false,publicWrapperIdentityChanged:false,
    installed:false,calls:0,quantizedCalls:0,originalThrows:0,invalidResults:0,disposed:false,restored:false,restoreConflict:false,restoreFailures:0};
  const count=key=>{stats[key]=min(1000000,stats[key]+1);};
  const wrapper=function now(){
    if(stats.disposed)return apply(uncoarsenedPerformanceNow,this,arguments);
    count('calls');let value;
    try{value=apply(uncoarsenedPerformanceNow,this,arguments);}catch(error){count('originalThrows');throw error;}
    let rounded;
    try{rounded=nativeClamper?coarsenCompletedClockForOrigin(value,this._nowAtTimeOrigin):quantizeCompletedClock100us(value);}catch(error){count('invalidResults');throw error;}
    count('quantizedCalls');return rounded;
  };
  const installed={...previous,value:wrapper};
  const sameDescriptor=(left,right)=>{
    if(!left||!right)return false;
    for(const key of ['value','get','set','writable','enumerable','configurable'])if(own(left,key)!==own(right,key)||!is(left[key],right[key]))return false;
    return true;
  };
  const snapshot=()=>({...stats});
  const dispose=()=>{
    if(stats.disposed)return snapshot();stats.disposed=true;
    try{if(sameDescriptor(get(prototype,'now'),installed)){define(prototype,'now',previous);stats.restored=true;}else stats.restoreConflict=true;}
    catch{count('restoreFailures');}
    nativeClamper=undefined;nativeToHostOffset=undefined;active=false;return snapshot();
  };
  try{
    if(chromiumClamper){
      const addon=require('./native-display-frames/build/Release/native_display_frames.node');
      const before=hostPerformance.now(),nativeNow=addon.readCounter(),after=hostPerformance.now();nativeToHostOffset=(before+after)/2-nativeNow;
      const bytes=randomBytes(8);try{nativeClamper=addon.createTimeClamper(bytes.readBigUInt64LE());}finally{bytes.fill(0);}
    }
    define(prototype,'now',installed);stats.installed=true;active=true;
  }
  catch(error){dispose();throw error;}
  return{snapshot,dispose};
}
