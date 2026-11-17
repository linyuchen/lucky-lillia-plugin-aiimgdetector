// Self-contained so the caller can serialize this function into a browser.
// Observes existing clicks only; never clicks, cancels or changes page APIs.
export function installAnchorClickObserver(window) {
  const MAX_EVENTS=20;
  const BOOLEAN_FIELDS=['defaultPrevented','bubbles','cancelable','isTrusted','targetA','connected','topFrame','sameOriginHref'];
  const SCHEMES=['http','https','javascript','data','blob','about','file','mailto','tel','other','empty','not_anchor','unavailable'];
  const add=window?.addEventListener,remove=window?.removeEventListener,queue=window?.queueMicrotask;
  const later=window?.setTimeout,cancelLater=window?.clearTimeout,URLConstructor=window?.URL;
  if(typeof add!=='function'||typeof remove!=='function'||typeof queue!=='function'||typeof later!=='function'||typeof cancelLater!=='function'||typeof URLConstructor!=='function')throw new TypeError('ANCHOR_OBSERVER_UNSUPPORTED_WINDOW');
  let disposed=false,listening=false,topFrame=null,origin=null;
  const records=[],pending=new Map(),timers=new Set();
  const stats={maximumEvents:MAX_EVENTS,eventsObserved:0,eventLimitReached:false,eventsCompleted:0,pendingEvents:0,
    microtaskCompletions:0,taskCompletions:0,microtasksDuringDispatch:0,unconfirmedCompletions:0,
    readFailures:0,installationReadsFailed:0,schedulingFailures:0,listenerRemovalFailures:0,
    pendingDisposed:0,listenerInstalled:false,disposed:false,passive:true,observerInitiatesNavigation:false,
    observerCancelsEvents:false,pageApisPatched:false,capturesDetachedTargets:false,capturesOtherWindows:false};
  const increment=key=>{stats[key]=Math.min(1000000,stats[key]+1);};
  try{topFrame=window.top===window;}catch{increment('installationReadsFailed');}
  try{const value=window.location.origin;if(typeof value==='string')origin=value;}catch{increment('installationReadsFailed');}
  function emptyCounts(){const result={};for(const key of BOOLEAN_FIELDS)result[key]={true:0,false:0,unavailable:0};result.scheme={};for(const scheme of SCHEMES)result.scheme[scheme]=0;return result;}
  const immediateCounts=emptyCounts(),afterDispatchCounts=emptyCounts();
  function countSample(counts,sample){for(const key of BOOLEAN_FIELDS)counts[key][sample[key]===true?'true':sample[key]===false?'false':'unavailable']++;counts.scheme[sample.scheme]++;}
  function readBoolean(object,key){try{const value=object[key];return typeof value==='boolean'?value:null;}catch{increment('readFailures');return null;}}
  function sample(event){
    // Every listed Event property is read once per sample. Do not reread any
    // getter for aggregation or snapshot serialization.
    const result={defaultPrevented:readBoolean(event,'defaultPrevented'),bubbles:readBoolean(event,'bubbles'),cancelable:readBoolean(event,'cancelable'),
      isTrusted:readBoolean(event,'isTrusted'),targetA:null,connected:null,topFrame,sameOriginHref:null,scheme:'unavailable'};
    let target;try{target=event.target;}catch{increment('readFailures');return result;}
    if(target===null||target===undefined){result.targetA=false;result.scheme='not_anchor';return result;}
    result.connected=readBoolean(target,'isConnected');
    try{result.targetA=target.localName==='a';}catch{increment('readFailures');}
    if(result.targetA!==true){result.scheme=result.targetA===false?'not_anchor':'unavailable';return result;}
    try{
      // Read only for in-memory classification; no href, origin, text or
      // identifier enters the returned control or any diagnostic record.
      const href=target.href;
      if(typeof href!=='string')return result;
      if(href===''){result.scheme='empty';return result;}
      const parsed=new URLConstructor(href),protocol=parsed.protocol;
      switch(protocol){
        case 'http:':result.scheme='http';break;case 'https:':result.scheme='https';break;
        case 'javascript:':result.scheme='javascript';break;case 'data:':result.scheme='data';break;
        case 'blob:':result.scheme='blob';break;case 'about:':result.scheme='about';break;
        case 'file:':result.scheme='file';break;case 'mailto:':result.scheme='mailto';break;
        case 'tel:':result.scheme='tel';break;default:result.scheme='other';
      }
      if(origin!==null){const targetOrigin=parsed.origin;result.sameOriginHref=origin!=='null'&&targetOrigin!=='null'&&targetOrigin===origin;}
    }catch{increment('readFailures');}
    return result;
  }
  function stopListening(){if(!listening)return;listening=false;stats.listenerInstalled=false;try{Reflect.apply(remove,window,['click',onClick,true]);}catch{increment('listenerRemovalFailures');}}
  function complete(record,event,kind){
    if(disposed||!pending.has(record))return;
    let phase;try{phase=event.eventPhase;}catch{increment('readFailures');}
    if(phase!==0){
      if(kind==='microtask'){
        increment('microtasksDuringDispatch');record.microtaskAfterDispatch=false;
        // Native browser events may checkpoint microtasks between listeners.
        // A single next-task fallback avoids incorrectly calling that sample
        // final, without spinning in the checkpoint or changing dispatch.
        try{let timer;timer=Reflect.apply(later,window,[()=>{timers.delete(timer);complete(record,event,'task');},0]);timers.add(timer);}
        catch{increment('schedulingFailures');finishUnconfirmed(record);}
      }else finishUnconfirmed(record);
      return;
    }
    if(kind==='microtask')record.microtaskAfterDispatch=true;
    record.afterDispatch=sample(event);record.completion=kind;pending.delete(record);stats.pendingEvents=pending.size;
    countSample(afterDispatchCounts,record.afterDispatch);increment('eventsCompleted');increment(kind==='microtask'?'microtaskCompletions':'taskCompletions');
  }
  function finishUnconfirmed(record){record.completion='unconfirmed';pending.delete(record);stats.pendingEvents=pending.size;increment('unconfirmedCompletions');}
  function onClick(event){
    if(disposed||records.length>=MAX_EVENTS)return;
    const record={sequence:records.length+1,immediate:sample(event),afterDispatch:null,microtaskAfterDispatch:null,completion:'pending'};
    records.push(record);pending.set(record,true);stats.eventsObserved=records.length;stats.pendingEvents=pending.size;countSample(immediateCounts,record.immediate);
    if(records.length===MAX_EVENTS){stats.eventLimitReached=true;stopListening();}
    try{Reflect.apply(queue,window,[()=>complete(record,event,'microtask')]);}catch{increment('schedulingFailures');finishUnconfirmed(record);}
  }
  Reflect.apply(add,window,['click',onClick,{capture:true,passive:true}]);listening=true;stats.listenerInstalled=true;
  function copyCounts(counts){const copy={};for(const key of BOOLEAN_FIELDS)copy[key]={...counts[key]};copy.scheme={...counts.scheme};return copy;}
  return{
    snapshot(){return{...stats,immediate:copyCounts(immediateCounts),afterDispatch:copyCounts(afterDispatchCounts),events:records.map(record=>({...record,immediate:{...record.immediate},afterDispatch:record.afterDispatch?{...record.afterDispatch}:null}))};},
    dispose(){
      if(disposed)return;disposed=true;stats.disposed=true;stopListening();
      for(const timer of timers)try{Reflect.apply(cancelLater,window,[timer]);}catch{increment('schedulingFailures');}
      timers.clear();for(const record of pending.keys()){record.completion='disposed';increment('pendingDisposed');}pending.clear();stats.pendingEvents=0;
    }
  };
}
