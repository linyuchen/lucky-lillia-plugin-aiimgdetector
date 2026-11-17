// Exact-current-source diagnostics. No interpreter rewrite, byte capture, or
// original function invocation. Transport code is shared by Node and CDP.
import { Session } from 'node:inspector';
import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'acorn';
import { readProbeNames } from './runtime-read-diagnostics.mjs';

const OUTER_HASH='c02c0d087d77cc55dd39fa613907a4e0093cd4893c8a01937c63fb35b1877375';
const EMBEDDED_HASH='9e2970d22eac508e349e61b6da4bec25b46cbb5f8cc3c8ca927d36d6587768c2';
const FUNCTION_HASH='c4cd4a1b3dcb2cc2cad57149ae1742fb75ae64a980b6b45624f23d27d8d11a01';
const CODES=[0,17,21,22,30,31,33,36];
const PHASES=['init','events','snapshot'];
const TYPES=['undefined','object','boolean','number','bigint','string','symbol','function'];
const CLASSES=['other','Array','Error','TypeError','ReferenceError','RangeError','SyntaxError'];
const CATEGORIES=['missingProperty','notCallable','notConstructor','missingReference','illegalInvocation','readonly','nullishConversion','stackOverflow','syntaxFailure','other'];
const PROPERTIES=[...new Set([...readProbeNames,'apply','call','bind','isActive','hasBeenActive'])];
const MAX_RECORDS=256, MAX_CONTEXTS=32, MAX_SOURCES=16, MAX_SCRIPTS=4096;
const hash=s=>createHash('sha256').update(s).digest('hex');
const activeCDP=new WeakSet();
let activeNode=false;
export class CurrentOutputInspectorError extends Error {
  constructor(code) { super('Current output inspector: '+code);this.name='CurrentOutputInspectorError';this.code=code; }
}
function referenceFor(originalInterpreter) {
  if(typeof originalInterpreter!=='string'||originalInterpreter.length!==66835||hash(originalInterpreter)!==OUTER_HASH) throw new CurrentOutputInspectorError('UNREVIEWED_SOURCE');
  return {fixture:false,length:62188,hash:EMBEDDED_HASH,outerHash:OUTER_HASH,outerLength:66835,maxPrefix:7823,start:23780,end:24371,functionHash:FUNCTION_HASH,entry:23820,append:23926};
}
function fixtureReference(source) {
  if(typeof source!=='string'||!source.length||source.length>1048576)throw new CurrentOutputInspectorError('INVALID_FIXTURE');
  let ast;try{ast=parse(source,{ecmaVersion:'latest'});}catch{throw new CurrentOutputInspectorError('INVALID_FIXTURE');}
  const functions=[];
  function walk(node,parent) {
    if(!node||typeof node!=='object')return;
    if(node.type==='FunctionExpression'&&parent?.type==='AssignmentExpression'&&parent.left.property?.name==='KQ')functions.push(node);
    for(const value of Object.values(node))if(Array.isArray(value)){for(const child of value)walk(child,node);}else if(value&&typeof value==='object')walk(value,node);
  }
  walk(ast);
  const fn=functions[0];
  if(functions.length!==1||fn.params.map(p=>p.name).join(',')!=='L,Q,a,u,w,U,d,p,C,A,V,x,T')throw new CurrentOutputInspectorError('INVALID_FIXTURE');
  const calls=[];
  function find(node){if(!node||typeof node!=='object')return;if(node.type==='CallExpression'&&node.callee.type==='MemberExpression'&&node.callee.object.name==='L'&&node.callee.property.name==='push'&&node.arguments[0]?.name==='u')calls.push(node);for(const value of Object.values(node))if(Array.isArray(value)){for(const child of value)find(child);}else if(value&&typeof value==='object')find(value);}
  find(fn.body);
  if(calls.length!==1||!fn.body.body[0])throw new CurrentOutputInspectorError('INVALID_FIXTURE');
  return {fixture:true,length:source.length,hash:hash(source),maxPrefix:32,start:fn.start,end:fn.end,functionHash:hash(source.slice(fn.start,fn.end)),entry:fn.body.body[0].start,append:calls[0].callee.property.start};
}
function limits(options) {
  const maxHits=options.maxHits??2000,maxDurationMs=options.maxDurationMs??60000;
  if(!Number.isInteger(maxHits)||maxHits<1||maxHits>10000||!Number.isInteger(maxDurationMs)||maxDurationMs<100||maxDurationMs>120000)throw new CurrentOutputInspectorError('INVALID_OPTIONS');
  return {maxHits,maxDurationMs};
}
function positions(source) {
  const starts=[0];for(let i=0;i<source.length;i++)if(source.charCodeAt(i)===10)starts.push(i+1);
  return {location(offset,scriptId){let lo=0,hi=starts.length;while(lo+1<hi){const mid=(lo+hi)>>1;if(starts[mid]<=offset)lo=mid;else hi=mid;}return {scriptId,lineNumber:lo,columnNumber:offset-starts[lo]};},offset(loc){return loc&&Number.isInteger(loc.lineNumber)&&Number.isInteger(loc.columnNumber)&&loc.lineNumber>=0&&loc.lineNumber<starts.length?starts[loc.lineNumber]+loc.columnNumber:undefined;}};
}
// Created once per realm, before the measured interpreter. The closure is held
// only by an inspector handle. No raw Error is ever a protocol RemoteObject.
function makeSummaryHelper(names) {
  'use strict';
  const getOwn=Object.getOwnPropertyDescriptor,hasOwn=Object.hasOwn,getPrototype=Object.getPrototypeOf,isArray=Array.isArray,isError=Error.isError,apply=Reflect.apply,test=RegExp.prototype.test;
  const prototypes=[['Error',Error.prototype],['TypeError',TypeError.prototype],['ReferenceError',ReferenceError.prototype],['RangeError',RangeError.prototype],['SyntaxError',SyntaxError.prototype]];
  const codes=[0,17,21,22,30,31,33,36];
  const checks=[[/^Cannot read propert(?:y|ies) of (?:undefined|null)\b/,'missingProperty'],[/\bis not a function$/,'notCallable'],[/\bis not a constructor$/,'notConstructor'],[/\bis not defined$/,'missingReference'],[/Illegal invocation|incompatible receiver|not a valid instance of/i,'illegalInvocation'],[/read only property|readonly property|has only a getter|Cannot assign to read only|Cannot redefine property/i,'readonly'],[/Cannot convert undefined or null to object/,'nullishConversion'],[/Maximum call stack size exceeded/,'stackOverflow']];
  const prefixes=['window','navigator','document','performance','screen','Object','Reflect'];
  return function(wrapper,sample0,sample22) {
    const statusDescriptor=getOwn(wrapper,'status');
    if(!statusDescriptor||!hasOwn(statusDescriptor,'value'))return {valid:false};
    const status=statusDescriptor.value,result={valid:true,statusKnown:false,status:null,statusType:typeof status};
    for(let i=0;i<codes.length;i++)if(status===codes[i]){result.statusKnown=true;result.status=status;break;}
    if(!(status===0&&sample0||status===22&&sample22))return result;
    const desc=getOwn(wrapper,'error');
    if(!desc||!hasOwn(desc,'value'))return result;
    const value=desc.value,type=typeof value;
    const incoming={type,className:'other',classNameSource:'unclassified',messageData:false};result.incoming=incoming;
    if(value===null||type!=='object'&&type!=='function')return result;
    if(typeof isError!=='function'){incoming.unavailable=true;return result;}
    if(!isError(value)){try{if(isArray(value)){incoming.className='Array';incoming.classNameSource='nativeArrayCheck';}}catch{}return result;}
    incoming.className='Error';incoming.classNameSource='nativeErrorCheck';
    const prototype=getPrototype(value);
    for(let i=0;i<prototypes.length;i++)if(prototype===prototypes[i][1]){incoming.className=prototypes[i][0];incoming.classNameSource='realmPrototypeIdentity';break;}
    const message=getOwn(value,'message');
    if(!message||!hasOwn(message,'value')||typeof message.value!=='string')return result;
    if(message.value.length>4096){incoming.oversized=true;return result;}
    incoming.messageData=true;incoming.category=incoming.className==='SyntaxError'?'syntaxFailure':'other';
    for(let i=0;i<checks.length;i++)if(apply(test,checks[i][0],[message.value])){incoming.category=checks[i][1];break;}
    for(let i=0;i<names.length;i++){
      const name=names[i],text=message.value;
      let match=text===name+' is not defined'||text==="Cannot read properties of undefined (reading '"+name+"')"||text==="Cannot read properties of null (reading '"+name+"')"||text===name+' is not a function'||text===name+' is not a constructor';
      for(let j=0;!match&&j<prefixes.length;j++)match=text===prefixes[j]+'.'+name+' is not a function'||text===prefixes[j]+'.'+name+' is not a constructor';
      if(match){incoming.property=name;break;}
    }
    return result;
  };
}
function nodeTransport() {
  if(activeNode)throw new CurrentOutputInspectorError('ALREADY_ACTIVE');
  activeNode=true;const session=new Session();try{session.connect();}catch{activeNode=false;throw new CurrentOutputInspectorError('CONNECT_FAILED');}
  const listeners=[];
  return {kind:'node',sync:true,on(name,fn){const wrapped=({params})=>fn(params);session.on(name,wrapped);listeners.push([name,wrapped]);},
    send(method,params){let done=false,failure,result;session.post(method,params,(e,r)=>{done=true;failure=e;result=r;});if(!done||failure)throw new CurrentOutputInspectorError('PROTOCOL_FAILED');return result;},
    close(){for(const [name,fn]of listeners)session.off(name,fn);session.disconnect();activeNode=false;}};
}
function cdpTransport(cdp) {
  if(!cdp||typeof cdp.send!=='function'||typeof cdp.on!=='function'||typeof cdp.off!=='function')throw new CurrentOutputInspectorError('INVALID_CDP');
  if(activeCDP.has(cdp))throw new CurrentOutputInspectorError('ALREADY_ACTIVE');
  activeCDP.add(cdp);const listeners=[];
  return {kind:'cdp',sync:false,on(name,fn){cdp.on(name,fn);listeners.push([name,fn]);},
    async send(method,params){let timer;try{return await Promise.race([Promise.resolve().then(()=>cdp.send(method,params)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new CurrentOutputInspectorError('PROTOCOL_TIMEOUT')),1500);})]);}catch{throw new CurrentOutputInspectorError('PROTOCOL_FAILED');}finally{clearTimeout(timer);}},
    close(){for(const [name,fn]of listeners)cdp.off(name,fn);activeCDP.delete(cdp);}};
}
function runSync(iterator,transport) {
  let op='next',value;while(true){const step=iterator[op](value);if(step.done)return step.value;try{value=transport.send(step.value.method,step.value.params);op='next';}catch(error){value=error;op='throw';}}
}
async function runAsync(iterator,transport) {
  let op='next',value;while(true){const step=iterator[op](value);if(step.done)return step.value;try{value=await transport.send(step.value.method,step.value.params);op='next';}catch(error){value=error;op='throw';}}
}
async function createProbe(reference,options,transport) {
  const state={diagnosticOnly:true,fixture:reference.fixture,transport:transport.kind,sourceModified:false,prototypesModified:false,officialFunctionsInvoked:0,propertyGettersRead:0,bytesRecorded:false,rawErrorsRecorded:false,sourceRecorded:false,phase:'init',records:[],recordLimitReached:false,pauses:0,instrumentationPauses:0,unexpectedPauses:0,entryHits:0,firstHeaderAppendHits:0,statusesAtFirstHeaderAppend:Object.fromEntries(CODES.map(c=>[c,0])),entryStatuses:Object.fromEntries(CODES.map(c=>[c,0])),unknownStatuses:0,sourceCandidates:0,sourceMatches:0,sourceMismatches:0,sourceLimitReached:false,scriptLimitReached:false,sourceInspectionFailures:0,installedBreakpoints:0,removedBreakpoints:0,entryUnavailable:0,helperContexts:0,helperFailures:0,helperLimitReached:false,inspectionFailures:0,protocolErrors:0,incomingAttempts:{code0:0,code22:0},incomingLimitReached:{code0:false,code22:false},limitReached:false,durationReached:false,disposed:false,...options};
  const group='current-output-'+randomUUID(),helperGroup=group+'-helpers';
  Object.assign(state,{outerSourceMatches:0,installedSetupBreakpoints:0,removedSetupBreakpoints:0,setupBreakpointHits:0,lateContextsDeferred:0});
  const metadata=new Map(),checked=new Set(),helpers=new Map(),breakpoints=new Map(),setupBreakpoints=new Map();
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
      const r=yield command('Runtime.evaluate',{contextId,expression:'('+makeSummaryHelper.toString()+')('+JSON.stringify(PROPERTIES)+')',objectGroup:helperGroup,returnByValue:false,generatePreview:false,silent:true,disableBreaks:true,userGesture:false});
      if(r.exceptionDetails||r.result?.type!=='function'||!r.result.objectId)throw new CurrentOutputInspectorError('HELPER_UNAVAILABLE');
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
      if(hash(source.slice(prefix+reference.start,prefix+reference.end))!==reference.functionHash)throw new CurrentOutputInspectorError('SITE_MISMATCH');
      // Runtime may already be enabled on the caller's CDP session, in which
      // case enabling it again does not replay executionContextCreated.
      if(!transport.sync&&!armed)yield*helper(params.executionContextId);
      const mapped=positions(source);
      for(const [site,offset]of [['entry',reference.entry],['firstHeaderAppend',reference.append]]) {
        const location=mapped.location(prefix+offset,params.scriptId);
        const choices=(yield command('Debugger.getPossibleBreakpoints',{start:location,end:mapped.location(prefix+offset+1,params.scriptId),restrictToFunction:true})).locations||[];
        if(!choices.some(l=>mapped.offset(l)===prefix+offset)){state.entryUnavailable++;continue;}
        const result=yield command('Debugger.setBreakpoint',{location});
        if(typeof result.breakpointId!=='string')throw new CurrentOutputInspectorError('SITE_UNAVAILABLE');
        breakpoints.set(result.breakpointId,{site,scriptId:params.scriptId,contextId:params.executionContextId});state.installedBreakpoints++;
        if(mapped.offset(result.actualLocation)!==prefix+offset){yield command('Debugger.removeBreakpoint',{breakpointId:result.breakpointId});breakpoints.delete(result.breakpointId);state.removedBreakpoints++;state.entryUnavailable++;}
      }
      // Runtime commands cannot execute at a beforeScriptExecution pause in
      // Chrome. A fresh realm gets its helper at the first normal breakpoint
      // in this exact original script, before the original statements run.
      if(!transport.sync&&!helpers.has(params.executionContextId)&&breakpoints.size===2){
        const locations=(yield command('Debugger.getPossibleBreakpoints',{start:mapped.location(prefix,params.scriptId),end:mapped.location(prefix+reference.entry,params.scriptId),restrictToFunction:false})).locations||[];
        const location=locations.filter(l=>l.scriptId===params.scriptId&&mapped.offset(l)>=prefix&&mapped.offset(l)<prefix+reference.entry&&l.type!=='return').sort((a,b)=>mapped.offset(a)-mapped.offset(b))[0];
        if(!location)throw new CurrentOutputInspectorError('SETUP_SITE_UNAVAILABLE');
        const result=yield command('Debugger.setBreakpoint',{location});
        if(typeof result.breakpointId!=='string')throw new CurrentOutputInspectorError('SETUP_SITE_UNAVAILABLE');
        setupBreakpoints.set(result.breakpointId,{contextId:params.executionContextId});state.installedSetupBreakpoints++;
        if(result.actualLocation?.scriptId!==params.scriptId||mapped.offset(result.actualLocation)!==mapped.offset(location))throw new CurrentOutputInspectorError('SETUP_SITE_UNAVAILABLE');
      }
      state.sourceMatches++;
      if(instrumentationId&&breakpoints.size===2){yield command('Debugger.removeBreakpoint',{breakpointId:instrumentationId});instrumentationId=null;}
    }catch{state.sourceInspectionFailures++;}
  }
  function retain(record) {if(state.records.length<MAX_RECORDS)state.records.push({phase:state.phase,...record});else state.recordLimitReached=true;}
  function cleanIncoming(raw) {
    if(!raw||typeof raw!=='object')return undefined;
    const result={type:TYPES.includes(raw.type)?raw.type:'unknown',className:CLASSES.includes(raw.className)?raw.className:'other',classNameSource:['unclassified','nativeArrayCheck','nativeErrorCheck','realmPrototypeIdentity'].includes(raw.classNameSource)?raw.classNameSource:'unclassified',messageData:raw.messageData===true};
    if(raw.unavailable===true)result.unavailable=true;if(raw.oversized===true)result.oversized=true;
    if(CATEGORIES.includes(raw.category))result.category=raw.category;
    if(PROPERTIES.includes(raw.property))result.property=raw.property;
    return result;
  }
  function* observe(frame,definition) {
    const entry=definition.site==='entry';state[entry?'entryHits':'firstHeaderAppendHits']++;
    const record={site:definition.site};
    try {
      const helperId=helpers.get(definition.contextId);if(!helperId)throw new CurrentOutputInspectorError('HELPER_UNAVAILABLE');
      const wrapper=yield command('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:entry?'({status:u,error:a})':'({status:u})',objectGroup:group,returnByValue:false,generatePreview:false,silent:true,throwOnSideEffect:true});
      if(wrapper.exceptionDetails||!wrapper.result?.objectId)throw new CurrentOutputInspectorError('PARAMETERS_UNAVAILABLE');
      const result=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(wrapper,sample0,sample22){return this(wrapper,sample0,sample22)}',arguments:[{objectId:wrapper.result.objectId},{value:entry&&state.incomingAttempts.code0<8},{value:entry&&state.incomingAttempts.code22<8}],objectGroup:group,returnByValue:true,generatePreview:false,silent:true,userGesture:false});
      const summary=result.result?.value;if(result.exceptionDetails||summary?.valid!==true)throw new CurrentOutputInspectorError('SUMMARY_UNAVAILABLE');
      if(summary.statusKnown===true&&CODES.includes(summary.status)) {
        record.status=summary.status;state[entry?'entryStatuses':'statusesAtFirstHeaderAppend'][summary.status]++;
        if(entry&&(summary.status===0||summary.status===22)){
          const key='code'+summary.status;
          if(state.incomingAttempts[key]>=8)state.incomingLimitReached[key]=true;
          else {state.incomingAttempts[key]++;const incoming=cleanIncoming(summary.incoming);if(incoming)record.incoming=incoming;}
        }
      }else state.unknownStatuses++;
    }catch{state.inspectionFailures++;record.unavailable=true;}
    retain(record);
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
  function* shutdown() {
    if(cleanupStarted)return;cleanupStarted=true;accepting=false;clearTimeout(timer);
    try {
      for(const id of [...breakpoints.keys()]){try{yield command('Debugger.removeBreakpoint',{breakpointId:id});state.removedBreakpoints++;}catch{state.protocolErrors++;}breakpoints.delete(id);}
      for(const id of [...setupBreakpoints.keys()]){try{yield command('Debugger.removeBreakpoint',{breakpointId:id});state.removedSetupBreakpoints++;}catch{state.protocolErrors++;}setupBreakpoints.delete(id);}
      if(instrumentationId){try{yield command('Debugger.removeBreakpoint',{breakpointId:instrumentationId});}catch{state.protocolErrors++;}instrumentationId=null;}
      for(const objectGroup of [group,helperGroup])try{yield command('Runtime.releaseObjectGroup',{objectGroup});}catch{state.protocolErrors++;}
      if(debuggerEnabled){try{yield command('Debugger.disable');}catch{state.protocolErrors++;}debuggerEnabled=false;}
      if(runtimeEnabled){try{yield command('Runtime.disable');}catch{state.protocolErrors++;}runtimeEnabled=false;}
    }finally{transport.close();helpers.clear();metadata.clear();checked.clear();state.disposed=true;}
  }
  transport.on('Runtime.executionContextCreated',params=>{
    if(!accepting||!Number.isInteger(params.context?.id))return;
    if(transport.sync||!armed)dispatch(helper(params.context.id));else state.lateContextsDeferred++;
  });
  transport.on('Runtime.executionContextDestroyed',params=>helpers.delete(params.executionContextId));
  transport.on('Runtime.executionContextsCleared',()=>helpers.clear());
  transport.on('Debugger.scriptParsed',params=>{
    if(!accepting)return;if(metadata.size<MAX_SCRIPTS)metadata.set(params.scriptId,{scriptId:params.scriptId,length:params.length,executionContextId:params.executionContextId});else state.scriptLimitReached=true;
    if(transport.sync&&Number.isInteger(params.length)&&params.length>=reference.length&&params.length<=reference.length+reference.maxPrefix)dispatch(inspectScript(params));
  });
  transport.on('Debugger.paused',params=>dispatch(paused(params)));
  const controller={snapshot:()=>JSON.parse(JSON.stringify(state)),setPhase(phase){if(!PHASES.includes(phase))throw new CurrentOutputInspectorError('INVALID_PHASE');state.phase=phase;},async flush(){let previous;do{previous=queue;await previous;}while(queue!==previous);},async dispose(){accepting=false;await dispatch(shutdown());await controller.flush();}};
  function* setup(){runtimeEnabled=true;yield command('Runtime.enable');debuggerEnabled=true;yield command('Debugger.enable');}
  try {
    if(transport.sync)runSync(setup(),transport);
    else {
      runtimeEnabled=true;await transport.send('Runtime.enable',{});await controller.flush();
      debuggerEnabled=true;await transport.send('Debugger.enable',{});
      for(const params of metadata.values())await runAsync(inspectScript(params),transport);
      armed=true;
      if(!state.sourceMatches){const result=await transport.send('Debugger.setInstrumentationBreakpoint',{instrumentation:'beforeScriptExecution'});if(typeof result.breakpointId!=='string')throw new CurrentOutputInspectorError('INSTRUMENTATION_UNAVAILABLE');instrumentationId=result.breakpointId;}
    }
    await controller.flush();
  }
  catch{await controller.dispose();throw new CurrentOutputInspectorError('SETUP_FAILED');}
  timer=setTimeout(()=>{state.durationReached=true;controller.dispose().catch(()=>{});},state.maxDurationMs);timer.unref?.();
  return controller;
}
export async function createCurrentOutputInspector({originalInterpreter,...options}={}) {const reference=referenceFor(originalInterpreter),bounded=limits(options);return createProbe(reference,bounded,nodeTransport());}
export async function createCurrentOutputCDPInspector({cdp,originalInterpreter,...options}={}) {const reference=referenceFor(originalInterpreter),bounded=limits(options);return createProbe(reference,bounded,cdpTransport(cdp));}
// Deliberately separate fixture API; cannot relax either production source pin.
export async function createCurrentOutputInspectorFixture({source,cdp,...options}={}) {const reference=fixtureReference(source),bounded=limits(options);return createProbe(reference,bounded,cdp?cdpTransport(cdp):nodeTransport());}
