// Pinned entry-input diagnostic. Private byte buffers never enter snapshot().
import {Session} from 'node:inspector';
import {createHash,randomUUID} from 'node:crypto';
import {parse} from 'acorn';
const OUTER_HASH='c02c0d087d77cc55dd39fa613907a4e0093cd4893c8a01937c63fb35b1877375';
const EMBEDDED_HASH='9e2970d22eac508e349e61b6da4bec25b46cbb5f8cc3c8ca927d36d6587768c2';
const PHASES=['init','events','snapshot'],SITES=['Nv','Rk'];
const DESTINATIONS=[229,239,333,364,468,498],TAGS=[10,12,15,27,104,126,127,153,250];
const TYPES=['undefined','null','boolean','integer','number','bigint','string','symbol','object','function'];
const REASONS=['nonArray','arrayCheckFailure','lengthAccessor','invalidLength','sparse','accessor','nonByte','descriptorFailure','numberEncodingFailure','recordLimit','byteLimit'];
const MAX_RECORDS=256,MAX_BYTES=65536,MAX_CONTEXTS=32,MAX_SOURCES=16,MAX_SCRIPTS=4096;
const hash=s=>createHash('sha256').update(s).digest('hex');
const activeCDP=new WeakSet();let activeNode=false;
export class CurrentPayloadInspectorError extends Error{constructor(code){super('Current payload inspector: '+code);this.name='CurrentPayloadInspectorError';this.code=code;}}
function referenceFor(source){
 if(typeof source!=='string'||source.length!==66835||hash(source)!==OUTER_HASH)throw new CurrentPayloadInspectorError('UNREVIEWED_SOURCE');
 return {fixture:false,length:62188,hash:EMBEDDED_HASH,outerHash:OUTER_HASH,outerLength:66835,maxPrefix:7823,sites:[
  {site:'Nv',start:27493,end:28038,entry:27528,functionHash:'572e282a5c62364c4161e7b6d25dea6818953bc6dd5610c9608a2389f2006715'},
  {site:'Rk',start:29521,end:30082,entry:29553,functionHash:'57c73f3b70bcc9f26a2b9430694af38c41df287425f1824fb7cd452caf03bc09'}]};
}
function fixtureReference(source){
 if(typeof source!=='string'||!source.length||source.length>1048576)throw new CurrentPayloadInspectorError('INVALID_FIXTURE');
 let ast;try{ast=parse(source,{ecmaVersion:'latest'});}catch{throw new CurrentPayloadInspectorError('INVALID_FIXTURE');}
 const functions=[];
 function walk(node,parent){if(!node||typeof node!=='object')return;
  if(node.type==='FunctionExpression'&&parent?.type==='AssignmentExpression'&&parent.left?.type==='MemberExpression'&&parent.left.object?.name==='globalThis'&&SITES.includes(parent.left.property?.name))functions.push({site:parent.left.property.name,node});
  for(const value of Object.values(node))if(Array.isArray(value)){for(const child of value)walk(child,node);}else if(value&&typeof value==='object')walk(value,node);
 }
 walk(ast);
 if(functions.length!==2||new Set(functions.map(f=>f.site)).size!==2)throw new CurrentPayloadInspectorError('INVALID_FIXTURE');
 const sites=SITES.map(site=>{const node=functions.find(f=>f.site===site).node,expected=site==='Nv'?'L,Q,a,u,w':'L,Q,a,u';
  if(node.params.slice(0,site==='Nv'?5:4).map(p=>p.name).join(',')!==expected||!node.body.body[0])throw new CurrentPayloadInspectorError('INVALID_FIXTURE');
  return {site,start:node.start,end:node.end,entry:node.body.body[0].start,functionHash:hash(source.slice(node.start,node.end))};
 });
 return {fixture:true,length:source.length,hash:hash(source),maxPrefix:32,sites};
}
function limits(options){const maxHits=options.maxHits??2000,maxDurationMs=options.maxDurationMs??60000;
 if(!Number.isInteger(maxHits)||maxHits<1||maxHits>10000||!Number.isInteger(maxDurationMs)||maxDurationMs<100||maxDurationMs>120000)throw new CurrentPayloadInspectorError('INVALID_OPTIONS');return {maxHits,maxDurationMs};}
function positions(source){const starts=[0];for(let i=0;i<source.length;i++)if(source.charCodeAt(i)===10)starts.push(i+1);
 return {location(offset,scriptId){let lo=0,hi=starts.length;while(lo+1<hi){const mid=(lo+hi)>>1;if(starts[mid]<=offset)lo=mid;else hi=mid;}return{scriptId,lineNumber:lo,columnNumber:offset-starts[lo]};},offset(loc){return loc&&Number.isInteger(loc.lineNumber)&&Number.isInteger(loc.columnNumber)&&loc.lineNumber>=0&&loc.lineNumber<starts.length?starts[loc.lineNumber]+loc.columnNumber:undefined;}};}
function makePayloadHelper(){
 'use strict';
 const own=Object.getOwnPropertyDescriptor,hasOwn=Object.hasOwn,isArray=Array.isArray,integer=Number.isSafeInteger,define=Object.defineProperty,ByteArray=Uint8Array,RawBuffer=ArrayBuffer,View=DataView,setFloat64=DataView.prototype.setFloat64,apply=Reflect.apply;
 const destinations=[229,239,333,364,468,498],tags=[10,12,15,27,104,126,127,153,250];
 let records=[],bytesHeld=0,taken=false;
 const append=(array,value)=>{define(array,array.length,{value,writable:true,enumerable:true,configurable:true});};
 const data=(object,key)=>{const d=own(object,key);if(!d||!hasOwn(d,'value'))throw 0;return d.value;};
 const type=value=>value===null?'null':typeof value==='number'&&integer(value)?'integer':typeof value;
 const known=(values,value)=>{for(let i=0;i<values.length;i++)if(values[i]===value)return true;return false;};
 const wipe=()=>{const result={recordsCleared:records.length,bytesCleared:bytesHeld};for(let i=0;i<records.length;i++){const record=records[i];for(let j=0;j<record.bytes.length;j++)record.bytes[j]=0;record.destination=null;record.tag.integer=null;record.bytes=undefined;}records.length=0;bytesHeld=0;return result;};
 return function(operation,wrapper,site,phase,remainingRecords,remainingBytes){
  if(operation==='clear'){taken=true;return wipe();}
  if(operation==='take'){
   if(taken)throw 0;taken=true;const output=[];
   try{for(let i=0;i<records.length;i++){const r=records[i],bytes=[];for(let j=0;j<r.bytes.length;j++)append(bytes,r.bytes[j]);append(output,{site:r.site,phase:r.phase,inputKind:r.inputKind,destination:r.destination,tag:{...r.tag},bytes});}return {records:output,...wipe()};}
   catch(error){wipe();throw error;}
  }
  if(operation!=='capture'||taken)throw 0;
  const input=data(wrapper,'input'),destination=data(wrapper,'destination'),tag=data(wrapper,'tag');
  const destinationType=type(destination),tagType=type(tag),tagPresent=tag!==undefined;
  const summary={valid:true,inputType:type(input),destinationType,destinationKnown:known(destinations,destination),destination:null,
   tagPresent,tagType,tagKnown:known(tags,tag),tag:null,captured:false,length:null};
  if(summary.destinationKnown)summary.destination=destination;if(summary.tagKnown)summary.tag=tag;
  const skipped=reason=>{summary.reason=reason;return summary;};
  const inputKind=typeof input==='number'?'number':'array';let length;
  if(inputKind==='number')length=8;
  else{
   try{if(!isArray(input))return skipped('nonArray');}catch{return skipped('arrayCheckFailure');}
   try{const desc=own(input,'length');if(!desc||!hasOwn(desc,'value'))return skipped('lengthAccessor');length=desc.value;}catch{return skipped('descriptorFailure');}
   if(!integer(length)||length<0)return skipped('invalidLength');
  }
  summary.length=length;
  if(remainingRecords<=0||records.length>=256)return skipped('recordLimit');
  if(length>remainingBytes||length>65536||bytesHeld+length>65536)return skipped('byteLimit');
  const storage=new RawBuffer(length),buffer=new ByteArray(storage);let reason;
  try{if(inputKind==='number')apply(setFloat64,new View(storage),[0,input,false]);else for(let i=0;i<length;i++){
   const desc=own(input,i);if(!desc){reason='sparse';break;}if(!hasOwn(desc,'value')){reason='accessor';break;}
   const value=desc.value;if(!integer(value)||value<0||value>255){reason='nonByte';break;}buffer[i]=value;
  }}catch{reason=inputKind==='number'?'numberEncodingFailure':'descriptorFailure';}
  if(reason){for(let i=0;i<buffer.length;i++)buffer[i]=0;return skipped(reason);}
  append(records,{site,phase,inputKind,destination:integer(destination)?destination:null,tag:{present:tagPresent,type:tagType,integer:integer(tag)?tag:null},bytes:buffer});
  bytesHeld+=length;summary.captured=true;return summary;
 };
}
function nodeTransport() {
  if(activeNode)throw new CurrentPayloadInspectorError('ALREADY_ACTIVE');
  activeNode=true;const session=new Session();try{session.connect();}catch{activeNode=false;throw new CurrentPayloadInspectorError('CONNECT_FAILED');}
  const listeners=[];
  return {kind:'node',sync:true,on(name,fn){const wrapped=({params})=>fn(params);session.on(name,wrapped);listeners.push([name,wrapped]);},
    send(method,params){let done=false,failure,result;session.post(method,params,(e,r)=>{done=true;failure=e;result=r;});if(!done||failure)throw new CurrentPayloadInspectorError('PROTOCOL_FAILED');return result;},
    close(){for(const [name,fn]of listeners)session.off(name,fn);session.disconnect();activeNode=false;}};
}
function cdpTransport(cdp) {
  if(!cdp||typeof cdp.send!=='function'||typeof cdp.on!=='function'||typeof cdp.off!=='function')throw new CurrentPayloadInspectorError('INVALID_CDP');
  if(activeCDP.has(cdp))throw new CurrentPayloadInspectorError('ALREADY_ACTIVE');
  activeCDP.add(cdp);const listeners=[];
  return {kind:'cdp',sync:false,on(name,fn){cdp.on(name,fn);listeners.push([name,fn]);},
    async send(method,params){let timer;try{return await Promise.race([Promise.resolve().then(()=>cdp.send(method,params)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new CurrentPayloadInspectorError('PROTOCOL_TIMEOUT')),1500);})]);}catch{throw new CurrentPayloadInspectorError('PROTOCOL_FAILED');}finally{clearTimeout(timer);}},
    close(){for(const [name,fn]of listeners)cdp.off(name,fn);activeCDP.delete(cdp);}};
}
function runSync(iterator,transport) {
  let op='next',value;while(true){const step=iterator[op](value);if(step.done)return step.value;try{value=transport.send(step.value.method,step.value.params);op='next';}catch(error){value=error;op='throw';}}
}
async function runAsync(iterator,transport) {
  let op='next',value;while(true){const step=iterator[op](value);if(step.done)return step.value;try{value=await transport.send(step.value.method,step.value.params);op='next';}catch(error){value=error;op='throw';}}
}
async function createProbe(reference,options,transport) {
  const state={diagnosticOnly:true,fixture:reference.fixture,transport:transport.kind,entryInputsOnly:true,outputCommitmentObserved:false,sourceModified:false,prototypesModified:false,officialFunctionsInvoked:0,propertyGettersRead:0,arrayProxyDescriptorTrapsPossible:true,publicBytesRecorded:false,sourceRecorded:false,phase:'init',groups:[],summaryLimitReached:false,recordLimitReached:false,byteLimitReached:false,pauses:0,instrumentationPauses:0,unexpectedPauses:0,entryHits:0,siteHits:{Nv:0,Rk:0},capturedRecords:0,capturedBytes:0,skippedInputs:0,skips:Object.fromEntries(REASONS.map(r=>[r,0])),sourceCandidates:0,sourceMatches:0,sourceMismatches:0,sourceLimitReached:false,scriptLimitReached:false,sourceInspectionFailures:0,installedBreakpoints:0,removedBreakpoints:0,entryUnavailable:0,helperContexts:0,helperFailures:0,helperLimitReached:false,inspectionFailures:0,protocolErrors:0,limitReached:false,durationReached:false,disposed:false,payloadsTaken:false,collectionClosed:false,contextsLost:0,clearCalls:0,clearedRecords:0,clearedBytes:0,clearFailures:0,...options};
  const group='current-payload-'+randomUUID(),helperGroup=group+'-helpers';
  Object.assign(state,{outerSourceMatches:0,installedSetupBreakpoints:0,removedSetupBreakpoints:0,setupBreakpointHits:0,lateContextsDeferred:0,privateScalarEncoding:'IEEE754-binary64-big-endian',capturedNumberInputs:0});
  const metadata=new Map(),checked=new Set(),helpers=new Map(),breakpoints=new Map(),setupBreakpoints=new Map(),capturedContexts=new Set(),clearedHelpers=new Set();
  let accepting=true,armed=false,runtimeEnabled=false,debuggerEnabled=false,instrumentationId=null,queue=Promise.resolve(),timer,cleanupStarted=false;
  const command=(method,params={})=>({method,params});
  function dispatch(iterator) {
    if(transport.sync){try{return runSync(iterator,transport);}catch{state.protocolErrors++;return undefined;}}
    queue=queue.then(()=>runAsync(iterator,transport)).catch(()=>{state.protocolErrors++;});return queue;
  }
  function* helper(contextId) {
    if(!accepting||helpers.has(contextId))return;
    if(helpers.size>=MAX_CONTEXTS){state.helperLimitReached=true;return;}
    try {
      const r=yield command('Runtime.evaluate',{contextId,expression:'('+makePayloadHelper.toString()+')()',objectGroup:helperGroup,returnByValue:false,generatePreview:false,silent:true,disableBreaks:true,userGesture:false});
      if(r.exceptionDetails||r.result?.type!=='function'||!r.result.objectId)throw new CurrentPayloadInspectorError('HELPER_UNAVAILABLE');
      helpers.set(contextId,r.result.objectId);state.helperContexts++;
    }catch{state.helperFailures++;}
  }
  function* inspectScript(params) {
    if(!accepting||checked.has(params.scriptId)||state.sourceMatches>=1)return;
    if(!Number.isInteger(params.length)||params.length<reference.length||params.length>reference.length+reference.maxPrefix)return;
    checked.add(params.scriptId);
    if(state.sourceCandidates>=MAX_SOURCES){state.sourceLimitReached=true;return;}
    state.sourceCandidates++;
    try {
      const source=(yield command('Debugger.getScriptSource',{scriptId:params.scriptId})).scriptSource;
      if(reference.outerHash&&typeof source==='string'&&source.length===reference.outerLength&&hash(source)===reference.outerHash){state.outerSourceMatches++;if(!transport.sync&&!armed)yield*helper(params.executionContextId);return;}
      const prefix=typeof source==='string'?source.length-reference.length:-1;
      if(prefix<0||prefix>reference.maxPrefix||!/^\n*$/.test(source.slice(0,prefix))||hash(source.slice(prefix))!==reference.hash){state.sourceMismatches++;return;}
      for(const site of reference.sites)if(hash(source.slice(prefix+site.start,prefix+site.end))!==site.functionHash)throw new CurrentPayloadInspectorError('SITE_MISMATCH');
      // Runtime may already be enabled on the caller's CDP session, in which
      // case enabling it again does not replay executionContextCreated.
      if(!transport.sync&&!armed)yield*helper(params.executionContextId);
      const mapped=positions(source);
      for(const {site,entry:offset}of reference.sites) {
        const location=mapped.location(prefix+offset,params.scriptId);
        const choices=(yield command('Debugger.getPossibleBreakpoints',{start:location,end:mapped.location(prefix+offset+1,params.scriptId),restrictToFunction:true})).locations||[];
        if(!choices.some(l=>mapped.offset(l)===prefix+offset)){state.entryUnavailable++;continue;}
        const result=yield command('Debugger.setBreakpoint',{location});
        if(typeof result.breakpointId!=='string')throw new CurrentPayloadInspectorError('SITE_UNAVAILABLE');
        breakpoints.set(result.breakpointId,{site,scriptId:params.scriptId,contextId:params.executionContextId});state.installedBreakpoints++;
        if(mapped.offset(result.actualLocation)!==prefix+offset){yield command('Debugger.removeBreakpoint',{breakpointId:result.breakpointId});breakpoints.delete(result.breakpointId);state.removedBreakpoints++;state.entryUnavailable++;}
      }
      // Runtime commands cannot execute at a beforeScriptExecution pause in
      // Chrome. A fresh realm gets its helper at the first normal breakpoint
      // in this exact original script, before the original statements run.
      if(!transport.sync&&!helpers.has(params.executionContextId)&&breakpoints.size===2){
        const firstEntry=Math.min(...reference.sites.map(s=>s.entry));
        const locations=(yield command('Debugger.getPossibleBreakpoints',{start:mapped.location(prefix,params.scriptId),end:mapped.location(prefix+firstEntry,params.scriptId),restrictToFunction:false})).locations||[];
        const location=locations.filter(l=>l.scriptId===params.scriptId&&mapped.offset(l)>=prefix&&mapped.offset(l)<prefix+firstEntry&&l.type!=='return').sort((a,b)=>mapped.offset(a)-mapped.offset(b))[0];
        if(!location)throw new CurrentPayloadInspectorError('SETUP_SITE_UNAVAILABLE');
        const result=yield command('Debugger.setBreakpoint',{location});
        if(typeof result.breakpointId!=='string')throw new CurrentPayloadInspectorError('SETUP_SITE_UNAVAILABLE');
        setupBreakpoints.set(result.breakpointId,{contextId:params.executionContextId});state.installedSetupBreakpoints++;
        if(result.actualLocation?.scriptId!==params.scriptId||mapped.offset(result.actualLocation)!==mapped.offset(location))throw new CurrentPayloadInspectorError('SETUP_SITE_UNAVAILABLE');
      }
      state.sourceMatches++;
      if(instrumentationId&&breakpoints.size===2){yield command('Debugger.removeBreakpoint',{breakpointId:instrumentationId});instrumentationId=null;}
    }catch{state.sourceInspectionFailures++;}
  }
  const complete=()=>state.sourceMatches===1&&state.installedBreakpoints===2&&state.entryHits>0&&!state.skippedInputs&&!state.summaryLimitReached&&!state.recordLimitReached&&!state.byteLimitReached&&!state.entryUnavailable&&!state.sourceInspectionFailures&&!state.helperFailures&&!state.inspectionFailures&&!state.protocolErrors&&!state.contextsLost&&!state.clearFailures&&!state.sourceLimitReached&&!state.scriptLimitReached&&!state.helperLimitReached&&!state.limitReached&&!state.durationReached;
  function retain(summary,site,phase){
    const record={site,phase,inputType:TYPES.includes(summary.inputType)?summary.inputType:'unknown',destinationType:TYPES.includes(summary.destinationType)?summary.destinationType:'unknown',destination:summary.destinationKnown&&DESTINATIONS.includes(summary.destination)?summary.destination:'unknown',tagPresent:summary.tagPresent===true,tagType:TYPES.includes(summary.tagType)?summary.tagType:'unknown',tag:summary.tagKnown&&TAGS.includes(summary.tag)?summary.tag:'unknown'};
    const key=JSON.stringify(record);let group=state.groups.find(g=>JSON.stringify(Object.fromEntries(Object.keys(record).map(k=>[k,g[k]])))===key);
    if(!group){if(state.groups.length>=MAX_RECORDS){state.summaryLimitReached=true;return;}group={...record,entries:0,captured:0,skipped:0,totalBytes:0,minLength:null,maxLength:null};state.groups.push(group);}
    group.entries++;if(summary.captured===true){group.captured++;group.totalBytes+=summary.length;}else group.skipped++;
    if(Number.isSafeInteger(summary.length)&&summary.length>=0){group.minLength=group.minLength===null?summary.length:Math.min(group.minLength,summary.length);group.maxLength=group.maxLength===null?summary.length:Math.max(group.maxLength,summary.length);}
  }
  function* observe(frame,definition) {
    if(state.collectionClosed)return;
    state.entryHits++;state.siteHits[definition.site]++;const phase=state.phase;
    try {
      const helperId=helpers.get(definition.contextId);if(!helperId)throw new CurrentPayloadInspectorError('HELPER_UNAVAILABLE');
      const wrapper=yield command('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:definition.site==='Nv'?'({input:Q,destination:u,tag:w})':'({input:Q,destination:a,tag:u})',objectGroup:group,returnByValue:false,generatePreview:false,silent:true,throwOnSideEffect:true});
      if(wrapper.exceptionDetails||!wrapper.result?.objectId)throw new CurrentPayloadInspectorError('PARAMETERS_UNAVAILABLE');
      const result=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(wrapper,site,phase,records,bytes){return this("capture",wrapper,site,phase,records,bytes)}',arguments:[{objectId:wrapper.result.objectId},{value:definition.site},{value:phase},{value:MAX_RECORDS-state.capturedRecords},{value:MAX_BYTES-state.capturedBytes}],objectGroup:group,returnByValue:true,generatePreview:false,silent:true,userGesture:false});
      const summary=result.result?.value;if(result.exceptionDetails||summary?.valid!==true)throw new CurrentPayloadInspectorError('SUMMARY_UNAVAILABLE');
      if(summary.captured===true){if(!Number.isInteger(summary.length)||summary.length<0||summary.length>MAX_BYTES-state.capturedBytes)throw new CurrentPayloadInspectorError('INVALID_SUMMARY');state.capturedRecords++;state.capturedBytes+=summary.length;if(summary.inputType==='integer'||summary.inputType==='number')state.capturedNumberInputs++;capturedContexts.add(definition.contextId);}
      else{state.skippedInputs++;if(REASONS.includes(summary.reason))state.skips[summary.reason]++;else state.inspectionFailures++;if(summary.reason==='recordLimit')state.recordLimitReached=true;if(summary.reason==='byteLimit')state.byteLimitReached=true;}
      retain(summary,definition.site,phase);
    }catch{state.inspectionFailures++;}
  }
  function* paused(params) {
    if(!debuggerEnabled)return;
    state.pauses++;
    try {
      if(params.reason==='instrumentation'){
        state.instrumentationPauses++;
        // data.scriptId is the about-to-run script; frame 0 can be its caller.
        const meta=metadata.get(params.data?.scriptId||params.callFrames?.[0]?.location?.scriptId);
        if(meta)yield*inspectScript(meta);
        for(const pending of metadata.values())yield*inspectScript(pending);
      }else {
        const setupIds=(params.hitBreakpoints||[]).filter(id=>setupBreakpoints.has(id));
        for(const id of setupIds){state.setupBreakpointHits++;yield*helper(setupBreakpoints.get(id).contextId);yield command('Debugger.removeBreakpoint',{breakpointId:id});setupBreakpoints.delete(id);state.removedSetupBreakpoints++;}
        const definitions=(params.hitBreakpoints||[]).map(id=>breakpoints.get(id)).filter(Boolean);
        if(!definitions.length&&!setupIds.length)state.unexpectedPauses++;else if(accepting&&params.callFrames?.[0])for(const definition of definitions)yield*observe(params.callFrames[0],definition);
      }
    }catch{state.inspectionFailures++;}
    finally {
      // No pause-scoped handles are created by instrumentation processing.
      // Waiting for Runtime.releaseObjectGroup here deadlocks until resume.
      if(params.reason!=='instrumentation')try{yield command('Runtime.releaseObjectGroup',{objectGroup:group});}catch{state.protocolErrors++;}
      try{yield command('Debugger.resume');}catch{state.protocolErrors++;}
    }
    if(state.pauses>=state.maxHits&&!cleanupStarted){state.limitReached=true;yield*shutdown();}
  }
  function countClear(value){
    if(!value||!Number.isInteger(value.recordsCleared)||value.recordsCleared<0||value.recordsCleared>MAX_RECORDS||!Number.isInteger(value.bytesCleared)||value.bytesCleared<0||value.bytesCleared>MAX_BYTES)throw new CurrentPayloadInspectorError('INVALID_CLEAR_SUMMARY');
    state.clearCalls++;state.clearedRecords+=value.recordsCleared;state.clearedBytes+=value.bytesCleared;
  }
  function* take(){
    const output=[];let bytes=0,failed=false;
    for(const helperId of helpers.values()){
      let value;
      try{
        const reply=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(){return this("take")}',arguments:[],returnByValue:true,generatePreview:false,silent:true,userGesture:false});
        value=reply.result?.value;if(reply.exceptionDetails||!Array.isArray(value?.records))throw new CurrentPayloadInspectorError('PAYLOAD_DRAIN_FAILED');
        countClear(value);clearedHelpers.add(helperId);
        for(const record of value.records){
          if(!SITES.includes(record.site)||!PHASES.includes(record.phase)||!['array','number'].includes(record.inputKind)||!(record.destination===null||Number.isSafeInteger(record.destination))||typeof record.tag?.present!=='boolean'||!TYPES.includes(record.tag.type)||!(record.tag.integer===null||Number.isSafeInteger(record.tag.integer))||!Array.isArray(record.bytes)||(record.inputKind==='number'&&record.bytes.length!==8)||output.length>=MAX_RECORDS||record.bytes.length>MAX_BYTES-bytes||record.bytes.some(v=>!Number.isInteger(v)||v<0||v>255))throw new CurrentPayloadInspectorError('PAYLOAD_DRAIN_FAILED');
          const copy={site:record.site,phase:record.phase,inputKind:record.inputKind,destination:record.destination,tag:{present:record.tag.present,type:record.tag.type,integer:record.tag.integer},bytes:record.bytes.slice()};
          output.push(copy);bytes+=copy.bytes.length;
        }
      }catch{state.clearFailures++;failed=true;}
      finally{if(Array.isArray(value?.records))for(const record of value.records)if(Array.isArray(record?.bytes))record.bytes.fill(0);}
    }
    if(output.length!==state.capturedRecords||bytes!==state.capturedBytes){state.clearFailures++;failed=true;}
    if(failed){for(const record of output)record.bytes.fill(0);output.length=0;}
    return {complete:complete()&&!failed,records:output};
  }
  function* shutdown() {
    if(cleanupStarted)return;cleanupStarted=true;accepting=false;state.collectionClosed=true;clearTimeout(timer);
    try {
      for(const id of [...breakpoints.keys()]){try{yield command('Debugger.removeBreakpoint',{breakpointId:id});state.removedBreakpoints++;}catch{state.protocolErrors++;}breakpoints.delete(id);}
      for(const id of [...setupBreakpoints.keys()]){try{yield command('Debugger.removeBreakpoint',{breakpointId:id});state.removedSetupBreakpoints++;}catch{state.protocolErrors++;}setupBreakpoints.delete(id);}
      if(instrumentationId){try{yield command('Debugger.removeBreakpoint',{breakpointId:instrumentationId});}catch{state.protocolErrors++;}instrumentationId=null;}
      for(const helperId of helpers.values())if(!clearedHelpers.has(helperId))try{
        const reply=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(){return this("clear")}',arguments:[],returnByValue:true,generatePreview:false,silent:true,userGesture:false});
        if(reply.exceptionDetails)throw new CurrentPayloadInspectorError('PAYLOAD_CLEAR_FAILED');countClear(reply.result?.value);clearedHelpers.add(helperId);
      }catch{state.clearFailures++;}
      for(const objectGroup of [group,helperGroup])try{yield command('Runtime.releaseObjectGroup',{objectGroup});}catch{state.protocolErrors++;}
      if(debuggerEnabled){try{yield command('Debugger.disable');}catch{state.protocolErrors++;}debuggerEnabled=false;}
      if(runtimeEnabled){try{yield command('Runtime.disable');}catch{state.protocolErrors++;}runtimeEnabled=false;}
    }finally{transport.close();helpers.clear();metadata.clear();checked.clear();state.disposed=true;}
  }
  transport.on('Runtime.executionContextCreated',params=>{
    if(!accepting||!Number.isInteger(params.context?.id))return;
    if(transport.sync||!armed)dispatch(helper(params.context.id));else state.lateContextsDeferred++;
  });
  transport.on('Runtime.executionContextDestroyed',params=>{if(capturedContexts.has(params.executionContextId)&&!state.payloadsTaken)state.contextsLost++;});
  transport.on('Runtime.executionContextsCleared',()=>{if(capturedContexts.size&&!state.payloadsTaken)state.contextsLost++;});
  transport.on('Debugger.scriptParsed',params=>{
    if(!accepting)return;if(metadata.size<MAX_SCRIPTS)metadata.set(params.scriptId,{scriptId:params.scriptId,length:params.length,executionContextId:params.executionContextId});else state.scriptLimitReached=true;
    if(transport.sync&&Number.isInteger(params.length)&&params.length>=reference.length&&params.length<=reference.length+reference.maxPrefix)dispatch(inspectScript(params));
  });
  transport.on('Debugger.paused',params=>dispatch(paused(params)));
  const controller={snapshot:()=>JSON.parse(JSON.stringify({...state,comparisonComplete:complete()})),setPhase(phase){if(!PHASES.includes(phase))throw new CurrentPayloadInspectorError('INVALID_PHASE');state.phase=phase;},async flush(){let previous;do{previous=queue;await previous;}while(queue!==previous);},
    async takePayloads(){if(state.payloadsTaken)throw new CurrentPayloadInspectorError('PAYLOADS_ALREADY_TAKEN');if(state.disposed||cleanupStarted)throw new CurrentPayloadInspectorError('PAYLOADS_UNAVAILABLE');state.payloadsTaken=true;await controller.flush();state.collectionClosed=true;if(state.disposed||cleanupStarted)throw new CurrentPayloadInspectorError('PAYLOADS_UNAVAILABLE');const result=await dispatch(take());if(!result)throw new CurrentPayloadInspectorError('PAYLOAD_DRAIN_FAILED');return result;},
    async dispose(){accepting=false;await dispatch(shutdown());await controller.flush();}};
  function* setup(){runtimeEnabled=true;yield command('Runtime.enable');debuggerEnabled=true;yield command('Debugger.enable');}
  try {
    if(transport.sync)runSync(setup(),transport);
    else {
      runtimeEnabled=true;await transport.send('Runtime.enable',{});await controller.flush();
      debuggerEnabled=true;await transport.send('Debugger.enable',{});
      for(const params of metadata.values())await runAsync(inspectScript(params),transport);
      armed=true;
      if(!state.sourceMatches){const result=await transport.send('Debugger.setInstrumentationBreakpoint',{instrumentation:'beforeScriptExecution'});if(typeof result.breakpointId!=='string')throw new CurrentPayloadInspectorError('INSTRUMENTATION_UNAVAILABLE');instrumentationId=result.breakpointId;}
    }
    await controller.flush();
  }
  catch{await controller.dispose();throw new CurrentPayloadInspectorError('SETUP_FAILED');}
  timer=setTimeout(()=>{state.durationReached=true;controller.dispose().catch(()=>{});},state.maxDurationMs);timer.unref?.();
  return controller;
}
export async function createCurrentPayloadInspector({originalInterpreter,...options}={}) {const reference=referenceFor(originalInterpreter),bounded=limits(options);return createProbe(reference,bounded,nodeTransport());}
export async function createCurrentPayloadCDPInspector({cdp,originalInterpreter,...options}={}) {const reference=referenceFor(originalInterpreter),bounded=limits(options);return createProbe(reference,bounded,cdpTransport(cdp));}
// Deliberately separate fixture API; cannot relax either production source pin.
export async function createCurrentPayloadInspectorFixture({source,cdp,...options}={}) {const reference=fixtureReference(source),bounded=limits(options);return createProbe(reference,bounded,cdp?cdpTransport(cdp):nodeTransport());}
