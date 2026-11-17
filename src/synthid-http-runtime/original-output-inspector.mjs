// Source-pinned original output append/encoding entries. No source/prototype
// replacement, official function invocation, property getter read or byte log.
import { Session } from 'node:inspector';
import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'acorn';
import { readProbeNames } from './runtime-read-diagnostics.mjs';

const OUTER_HASH = '231468acebdbbfd37651d9060ee7a7420065b3bf0e6fb2be0d8a2b7a5922bad2';
const EMBEDDED_HASH = 'a9c05edb9f6e3894e0ca8ffc52fee5f6882386813da4195673fb01c145a5c4f1';
const EMBEDDED_LENGTH = 61938;
const TYPES = ['undefined','object','boolean','number','bigint','string','symbol','function','unknown'];
const PHASES = ['init','events','snapshot'];
const SLOTS = [30,80,126,149,167,205,242,243,423,452];
const TAGS = [10,12,15,27,104,126,127,153,250];
const CODES = [0,17,21,22,30,31,33,36];
const ERROR_CLASSES = ['Error','TypeError','ReferenceError','RangeError','SyntaxError','Array','other'];
const ERROR_CATEGORIES = ['missingProperty','notCallable','notConstructor','missingReference','illegalInvocation','readonly','nullishConversion','stackOverflow','syntaxFailure','other'];
const ERROR_PROPERTIES = [...new Set([...readProbeNames,'apply','call','bind','isActive','hasBeenActive'])];
const INTERNAL_CODES = [21,30,33,36];
const MAX_RECORDS = 256, MAX_SOURCES = 16, MAX_MATCHES = 4, MAX_ARRAY_PROPERTIES = 4096;
const DEFINITIONS = [
  { name:'v2', start:30000, end:30598, hash:'a6b7e5ec9aa1a9400080172dd6b6f2901cbc837e0d7116451ba4d0450015ab31', parameters:['l','C','F','Z','M','A','m','X','O'], destination:'l', array:'F', tag:'Z' },
  { name:'Dn', start:24223, end:24838, hash:'066193a475f29d44195dfccaa3ae6dfd66eee61f4b450f74beba6bcfe1554662', parameters:['l','C','F','Z','M','A','m','X','O','h'], destination:'F', array:'l', tag:'M' },
  { name:'gw', start:24842, end:25411, hash:'dc6459083493d72452244057e8dcf04542afc96990692e5850da7494afa8c157', parameters:['l','C','F','Z','M','A','m','X','O','h','T','f','U'], code:'l', tag:'F' },
  { name:'F1', start:61618, end:61655, hash:'31ff68b55839776e22c9309c551615edfb026bac914144c05165144ac8f220fa', parameters:['l'], array:'l' },
];
const hash = value => createHash('sha256').update(value).digest('hex');
const increase = value => Math.min(1000000, value + 1);
let activeOwner;
export class OriginalOutputInspectorError extends Error {
  constructor(code) { super('Original output inspector: ' + code); this.name = 'OriginalOutputInspectorError'; this.code = code; }
}
function limitsFor(options) {
  const maxHits = options.maxHits ?? 2000, maxDurationMs = options.maxDurationMs ?? 60000;
  if (!Number.isInteger(maxHits) || maxHits < 1 || maxHits > 10000 || !Number.isInteger(maxDurationMs) || maxDurationMs < 100 || maxDurationMs > 120000) throw new OriginalOutputInspectorError('INVALID_OPTIONS');
  return { maxHits, maxDurationMs };
}
function functionsIn(source) {
  const found = [];
  function walk(node, parent) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'FunctionExpression' || node.type === 'FunctionDeclaration') {
      const name = node.id?.name || (parent?.type === 'AssignmentExpression'
        ? parent.left.type === 'Identifier' ? parent.left.name : parent.left.property?.name : undefined);
      found.push({ name, node });
    }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(item => walk(item,node)); else if (value && typeof value === 'object') walk(value,node);
  }
  walk(parse(source, { ecmaVersion:'latest' }));
  return found;
}
function positions(source) {
  const starts = [0];
  for (let index=0; index<source.length; index++) if (source.charCodeAt(index) === 10) starts.push(index+1);
  return {
    location(offset,scriptId) { let low=0,high=starts.length; while(low+1<high) { const middle=(low+high)>>1; if(starts[middle]<=offset) low=middle; else high=middle; } return {scriptId,lineNumber:low,columnNumber:offset-starts[low]}; },
    offset(location) { return location && Number.isInteger(location.lineNumber) && Number.isInteger(location.columnNumber) && location.lineNumber>=0 && location.lineNumber<starts.length ? starts[location.lineNumber]+location.columnNumber : undefined; },
  };
}
function classifyMessage(message,errorClass) {
  let category='other';
  if(/^Cannot read propert(?:y|ies) of (?:undefined|null)\b/.test(message)) category='missingProperty';
  else if(/\bis not a function$/.test(message)) category='notCallable';
  else if(/\bis not a constructor$/.test(message)) category='notConstructor';
  else if(/\bis not defined$/.test(message)) category='missingReference';
  else if(/Illegal invocation|incompatible receiver|not a valid instance of/i.test(message)) category='illegalInvocation';
  else if(/read only property|readonly property|has only a getter|Cannot assign to read only|Cannot redefine property/i.test(message)) category='readonly';
  else if(/Cannot convert undefined or null to object/.test(message)) category='nullishConversion';
  else if(/Maximum call stack size exceeded/.test(message)) category='stackOverflow';
  else if(errorClass==='SyntaxError') category='syntaxFailure';
  let property;
  for(const name of ERROR_PROPERTIES) {
    if(message===name+' is not defined'
      || message==="Cannot read properties of undefined (reading '"+name+"')"
      || message==="Cannot read properties of null (reading '"+name+"')"
      || message===name+' is not a function' || message===name+' is not a constructor'
      || ['window','navigator','document','performance','screen','Object','Reflect'].some(prefix=>message===prefix+'.'+name+' is not a function'||message===prefix+'.'+name+' is not a constructor')) {property=name;break;}
  }
  return {category,...(property?{property}:{})};
}
// Runs in an inspector-private closure in the target realm. Intrinsics and
// known prototypes are captured before the original interpreter is evaluated.
// The error itself is never serialized as a RemoteObject (V8 would format it and
// invoke custom message/stack getters even with previews disabled).
function summarizeIncomingError(wrapper,inspectInternal) {
  'use strict';
  const wrapped=getOwn(wrapper,'value');
  if(!wrapped||!hasOwn(wrapped,'value')) return {valid:false};
  const value=wrapped.value,type=typeof value;
  const result={valid:true,type,className:'other',classNameSource:'unclassified',nativeError:false,messageStatus:'unavailable',message:undefined,internal:null};
  if(value===null||type!=='object'&&type!=='function') return result;
  if(!isNativeError(value)) {
    // Array.isArray is trap-free, but throws for a revoked Proxy. No array or
    // proxy descriptors are inspected by this error classifier.
    try {if(isArray(value)) {
      result.className='Array';result.classNameSource='nativeArrayCheck';
      // The caller must first confirm CDP subtype=array (not proxy). Only these
      // three own descriptors are inspected; element 2 is never materialized.
      if(inspectInternal) {
        const internal={ownDataSchema:false,markerMatches:false,code:null,unknownCode:false};
        result.internal=internal;
        const length=getOwn(value,'length');
        if(length&&hasOwn(length,'value')&&(length.value===2||length.value===3)) {
          const first=getOwn(value,'0'),second=getOwn(value,'1'),marker=getOwn(wrapper,'marker');
          if(first&&hasOwn(first,'value')&&second&&hasOwn(second,'value')) {
            internal.ownDataSchema=true;
            internal.markerMatches=!!marker&&hasOwn(marker,'value')&&marker.value!==null&&typeof marker.value==='object'&&first.value===marker.value;
            if(internal.markerMatches) {
              const code=second.value;
              if(code===21||code===30||code===33||code===36) internal.code=code;
              else internal.unknownCode=true;
            }
          }
        }
      }
    }} catch {}
    return result;
  }
  result.nativeError=true;result.className='Error';result.classNameSource='nativeErrorCheck';
  const prototype=getPrototype(value);
  for(let index=0;index<errorPrototypes.length;index++) {
    if(prototype===errorPrototypes[index][1]) {
      result.className=errorPrototypes[index][0];result.classNameSource='realmPrototypeIdentity';break;
    }
  }
  const message=getOwn(value,'message');
  if(!message||!hasOwn(message,'value')||typeof message.value!=='string') result.messageStatus='unavailable';
  else if(message.value.length>4096) result.messageStatus='oversized';
  else {result.messageStatus='data';result.message=message.value;}
  return result;
}

export async function createOriginalOutputInspector(options={}) {
  const limits=limitsFor(options);
  if(typeof options.originalInterpreter!=='string' || options.originalInterpreter.length>1048576 || hash(options.originalInterpreter)!==OUTER_HASH) throw new OriginalOutputInspectorError('UNREVIEWED_SOURCE');
  return createProbe({length:EMBEDDED_LENGTH,hash:EMBEDDED_HASH,maxPrefix:7823,fixture:false,definitions:DEFINITIONS},limits);
}
// Explicit fixture entrypoint; cannot relax the production hash requirement.
export async function createOriginalOutputInspectorFixture({source,...options}={}) {
  const limits=limitsFor(options);
  if(typeof source!=='string' || source.length<1 || source.length>1048576) throw new OriginalOutputInspectorError('INVALID_OPTIONS');
  const functions=functionsIn(source);
  const definitions=DEFINITIONS.map(definition=>{
    const matching=functions.filter(item=>item.name===definition.name);
    if(matching.length!==1 || matching[0].node.params.map(node=>node.name).join(',')!==definition.parameters.join(',')) throw new OriginalOutputInspectorError('INVALID_OPTIONS');
    const node=matching[0].node;
    return {...definition,start:node.start,end:node.end,hash:hash(source.slice(node.start,node.end))};
  });
  return createProbe({length:source.length,hash:hash(source),maxPrefix:32,fixture:true,definitions},limits);
}

async function createProbe(reference,limits) {
  if(activeOwner) throw new OriginalOutputInspectorError('ALREADY_ACTIVE');
  const owner={};activeOwner=owner;
  const session=new Session(),breakpoints=new Map(),scripts=new Set(),scriptContexts=new Map(),errorHelpers=new Map();
  const group='original-output-'+randomUUID();
  const helperGroup=group+'-helper';
  const state={diagnosticOnly:true,fixture:reference.fixture,sourceModified:false,prototypesModified:false,
    officialFunctionsInvoked:0,propertyGettersRead:0,bytesRecorded:false,sourceRecorded:false,
    records:[],recordLimitReached:false,phase:'init',pauses:0,observedEntries:0,unexpectedPauses:0,
    functionHits:Object.fromEntries(DEFINITIONS.map(item=>[item.name,0])),
    parameterTypes:Object.fromEntries(TYPES.map(type=>[type,0])),
    unknownSlots:0,unknownTags:0,unknownEntryCodes:0,unknownErrorCodes:0,
    incomingErrors:Object.fromEntries(['code0','code22'].map(code=>[code,{attempts:0,limitReached:false,messageData:0,messageUnavailable:0,messageOversized:0,
      internalChecked:0,internalMatched:0,internalUnknownCodes:0,internalCodes:Object.fromEntries(INTERNAL_CODES.map(code=>[code,0])),
      classes:Object.fromEntries(ERROR_CLASSES.map(name=>[name,0])),categories:Object.fromEntries(ERROR_CATEGORIES.map(name=>[name,0]))}])),
    sourceCandidates:0,sourceMatches:0,sourceMismatches:0,sourceLimitReached:false,
    sourceInspectionFailures:0,entryUnavailable:0,installedBreakpoints:0,removedBreakpoints:0,
    inspectionFailures:0,inspectorErrors:0,descriptorLimitReached:false,errorHelperContexts:0,errorHelperFailures:0,errorHelperLimitReached:false,
    limitReached:false,durationReached:false,debuggerStoppedAtLimit:false,disposed:false,...limits};
  let connected=false,enabled=false,runtimeEnabled=false,active=false,disposed=false,checking=false,evaluating=false,timer,cleanupPromise;
  const started=performance.now();
  function immediate(method,params={}) {
    let done=false,error,result;
    session.post(method,params,(failure,value)=>{done=true;error=failure;result=value;});
    if(!done || error) throw new OriginalOutputInspectorError('INSPECTOR_SETUP_FAILED');
    return result;
  }
  const post=(method,params={})=>new Promise((resolve,reject)=>{
    const deadline=setTimeout(()=>reject(new OriginalOutputInspectorError('INSPECTOR_SETUP_FAILED')),1000);
    try {session.post(method,params,(error,result)=>{clearTimeout(deadline);error?reject(new OriginalOutputInspectorError('INSPECTOR_SETUP_FAILED')):resolve(result);});}
    catch {clearTimeout(deadline);reject(new OriginalOutputInspectorError('INSPECTOR_SETUP_FAILED'));}
  });
  function contextCreated({params}) {
    if(disposed||!Number.isInteger(params.context?.id)||errorHelpers.has(params.context.id)) return;
    if(errorHelpers.size>=32) {state.errorHelperLimitReached=true;return;}
    const contextId=params.context.id;
    const previous=evaluating;evaluating=true;
    try {
      const helper=immediate('Runtime.evaluate',{contextId,expression:'(()=>{const isNativeError=Error.isError,getOwn=Object.getOwnPropertyDescriptor,getPrototype=Object.getPrototypeOf,hasOwn=Object.hasOwn,isArray=Array.isArray;const errorPrototypes=[["Error",Error.prototype],["TypeError",TypeError.prototype],["ReferenceError",ReferenceError.prototype],["RangeError",RangeError.prototype],["SyntaxError",SyntaxError.prototype]];if(typeof isNativeError!=="function")return null;return ('+summarizeIncomingError.toString()+');})()',objectGroup:helperGroup,returnByValue:false,generatePreview:false,silent:true});
      if(helper.exceptionDetails||helper.result?.type!=='function'||!helper.result.objectId) throw new OriginalOutputInspectorError('ERROR_HELPER_UNAVAILABLE');
      errorHelpers.set(contextId,helper.result.objectId);state.errorHelperContexts=increase(state.errorHelperContexts);
    } catch {state.errorHelperFailures=increase(state.errorHelperFailures);}
    finally {evaluating=previous;}
  }
  function contextDestroyed({params}) {errorHelpers.delete(params.executionContextId);}
  function resume() { if(connected&&enabled) try { immediate('Debugger.resume'); } catch { if(!disposed) state.inspectorErrors=increase(state.inspectorErrors); } }
  function removeAll() {
    for(const id of [...breakpoints.keys()]) {
      breakpoints.delete(id);
      try { immediate('Debugger.removeBreakpoint',{breakpointId:id});state.removedBreakpoints=increase(state.removedBreakpoints); }
      catch { state.inspectorErrors=increase(state.inspectorErrors); }
    }
  }
  function stop(reason) {
    active=false;state[reason==='duration'?'durationReached':'limitReached']=true;removeAll();
    if(enabled) try { immediate('Debugger.disable');enabled=false;state.debuggerStoppedAtLimit=true; }
    catch { state.inspectorErrors=increase(state.inspectorErrors);try{session.disconnect();connected=false;enabled=false;}catch{} }
  }
  function parsed({params}) {
    if(!active||disposed||checking||evaluating||scripts.has(params.scriptId)) return;
    if(!Number.isInteger(params.length)||params.length<reference.length||params.length>reference.length+reference.maxPrefix) return;
    if(state.sourceCandidates>=MAX_SOURCES) {state.sourceLimitReached=true;return;}
    state.sourceCandidates=increase(state.sourceCandidates);checking=true;
    try {
      const source=immediate('Debugger.getScriptSource',{scriptId:params.scriptId}).scriptSource;
      if(typeof source!=='string'||source.length<reference.length||source.length>reference.length+reference.maxPrefix) {state.sourceMismatches=increase(state.sourceMismatches);return;}
      const prefix=source.length-reference.length;
      if(!/^\n*$/.test(source.slice(0,prefix))||hash(source.slice(prefix))!==reference.hash) {state.sourceMismatches=increase(state.sourceMismatches);return;}
      if(scripts.size>=MAX_MATCHES) {state.sourceLimitReached=true;return;}
      const mapped=positions(source);scripts.add(params.scriptId);scriptContexts.set(params.scriptId,params.executionContextId);state.sourceMatches=increase(state.sourceMatches);
      for(const definition of reference.definitions) {
        const functionSource=source.slice(prefix+definition.start,prefix+definition.end);
        if(hash(functionSource)!==definition.hash) throw new OriginalOutputInspectorError('SOURCE_SITE_MISMATCH');
        const fn=parse('('+functionSource+')',{ecmaVersion:'latest'}).body[0]?.expression;
        if(fn?.type!=='FunctionExpression'||fn.params.map(node=>node.name).join(',')!==definition.parameters.join(',')) throw new OriginalOutputInspectorError('SOURCE_SITE_MISMATCH');
        const bodyStart=prefix+definition.start+fn.body.start; // AST includes one wrapping '('
        const locations=immediate('Debugger.getPossibleBreakpoints',{start:mapped.location(bodyStart,params.scriptId),end:mapped.location(Math.min(bodyStart+64,prefix+definition.end-1),params.scriptId),restrictToFunction:true}).locations||[];
        const location=locations.find(item=>mapped.offset(item)>=bodyStart&&mapped.offset(item)<bodyStart+64);
        if(!location) {state.entryUnavailable=increase(state.entryUnavailable);continue;}
        const result=immediate('Debugger.setBreakpoint',{location});
        if(typeof result.breakpointId!=='string') throw new OriginalOutputInspectorError('INSPECTOR_SETUP_FAILED');
        breakpoints.set(result.breakpointId,definition);state.installedBreakpoints=increase(state.installedBreakpoints);
        if(mapped.offset(result.actualLocation)!==mapped.offset(location)) {
          immediate('Debugger.removeBreakpoint',{breakpointId:result.breakpointId});breakpoints.delete(result.breakpointId);state.removedBreakpoints=increase(state.removedBreakpoints);state.entryUnavailable=increase(state.entryUnavailable);
        }
      }
    } catch {state.sourceInspectionFailures=increase(state.sourceInspectionFailures);}
    finally {checking=false;}
  }
  function parameter(frame,name) {
    if(!/^[a-zA-Z]+$/.test(name)) throw new OriginalOutputInspectorError('INVALID_PARAMETER');
    evaluating=true;
    try {
      const result=immediate('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:name,objectGroup:group,returnByValue:false,generatePreview:false,silent:true,throwOnSideEffect:true});
      if(result.exceptionDetails||!result.result) throw new OriginalOutputInspectorError('PARAMETER_UNAVAILABLE');
      const type=TYPES.includes(result.result.type)?result.result.type:'unknown';state.parameterTypes[type]=increase(state.parameterTypes[type]);
      return result.result;
    } finally {evaluating=false;}
  }
  function descriptors(remote,nonIndexedPropertiesOnly) {
    const response=immediate('Runtime.getProperties',{objectId:remote.objectId,ownProperties:true,generatePreview:false,nonIndexedPropertiesOnly});
    if(response.exceptionDetails||!Array.isArray(response.result)) throw new OriginalOutputInspectorError('DESCRIPTORS_UNAVAILABLE');
    if(response.result.length>MAX_ARRAY_PROPERTIES) {state.descriptorLimitReached=true;return undefined;}
    return response.result;
  }
  function ownValue(list,name) {
    const descriptor=list?.find(item=>item.name===name&&item.isOwn!==false);
    return descriptor&&!descriptor.get&&!descriptor.set&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
  }
  function arrayInfo(remote,needBytes=false) {
    const result={array:remote.type==='object'&&remote.subtype==='array',length:null};
    if(!result.array||!remote.objectId) return result;
    const length=ownValue(descriptors(remote,true),'length');
    if(length?.type!=='number'||!Number.isSafeInteger(length.value)||length.value<0) return result;
    result.length=length.value;
    if(needBytes&&length.value<=MAX_ARRAY_PROPERTIES-32) result.properties=descriptors(remote,false);
    return result;
  }
  function byte(properties,index) {
    const value=ownValue(properties,String(index));
    return value?.type==='number'&&Number.isInteger(value.value)&&value.value>=0&&value.value<=255?value.value:undefined;
  }
  function knownNumber(remote,allowed) {return remote?.type==='number'&&allowed.includes(remote.value)?remote.value:undefined;}
  function incomingError(frame,entryCode) {
    const counts=state.incomingErrors['code'+entryCode];
    if(!counts) return undefined;
    if(counts.attempts>=8) {counts.limitReached=true;return undefined;}
    counts.attempts++;
    let summary;
    evaluating=true;
    try {
      const errorHelper=errorHelpers.get(scriptContexts.get(frame.location?.scriptId));
      if(!errorHelper) throw new OriginalOutputInspectorError('ERROR_HELPER_UNAVAILABLE');
      const wrapper=immediate('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:'({value:C})',objectGroup:group,returnByValue:false,generatePreview:false,silent:true,throwOnSideEffect:true});
      if(wrapper.exceptionDetails||!wrapper.result?.objectId) throw new OriginalOutputInspectorError('PARAMETER_UNAVAILABLE');
      const response=immediate('Runtime.callFunctionOn',{objectId:errorHelper,functionDeclaration:'function(wrapper){return this(wrapper)}',arguments:[{objectId:wrapper.result.objectId}],objectGroup:group,returnByValue:true,generatePreview:false,silent:true});
      if(response.exceptionDetails||!response.result?.value?.valid) throw new OriginalOutputInspectorError('PARAMETER_UNAVAILABLE');
      summary=response.result.value;
      if(summary.className==='Array') {
        const array=parameter(frame,'C');
        if(array.type==='object'&&array.subtype==='array'&&array.objectId) {
          evaluating=true;
          const marked=immediate('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:'({value:C,marker:typeof GP==="object"?GP:null})',objectGroup:group,returnByValue:false,generatePreview:false,silent:true,throwOnSideEffect:true});
          if(marked.exceptionDetails||!marked.result?.objectId) throw new OriginalOutputInspectorError('PARAMETER_UNAVAILABLE');
          const inspected=immediate('Runtime.callFunctionOn',{objectId:errorHelper,functionDeclaration:'function(wrapper){return this(wrapper,true)}',arguments:[{objectId:marked.result.objectId}],objectGroup:group,returnByValue:true,generatePreview:false,silent:true});
          if(inspected.exceptionDetails||!inspected.result?.value?.valid||!inspected.result.value.internal) throw new OriginalOutputInspectorError('PARAMETER_UNAVAILABLE');
          summary.internal=inspected.result.value.internal;
        }
      }
    } finally {evaluating=false;}
    const type=TYPES.includes(summary.type)?summary.type:'unknown';state.parameterTypes[type]=increase(state.parameterTypes[type]);
    const className=ERROR_CLASSES.includes(summary.className)?summary.className:'other';
    counts.classes[className]=increase(counts.classes[className]);
    const classNameSource=['unclassified','nativeArrayCheck','nativeErrorCheck','realmPrototypeIdentity'].includes(summary.classNameSource)?summary.classNameSource:'unclassified';
    const result={type,className,classNameSource};
    if(summary.internal) {
      counts.internalChecked++;
      const internal={ownDataSchema:summary.internal.ownDataSchema===true,markerMatches:summary.internal.markerMatches===true};
      if(internal.markerMatches) counts.internalMatched++;
      if(internal.markerMatches&&INTERNAL_CODES.includes(summary.internal.code)) {internal.code=summary.internal.code;counts.internalCodes[internal.code]++;}
      else if(internal.markerMatches&&summary.internal.unknownCode===true) counts.internalUnknownCodes++;
      result.internalArray=internal;
    }
    if(!summary.nativeError) return result;
    if(summary.messageStatus==='oversized') {result.messageData=false;counts.messageOversized++;return result;}
    if(summary.messageStatus!=='data'||typeof summary.message!=='string'||summary.message.length>4096) {result.messageData=false;counts.messageUnavailable++;return result;}
    result.messageData=true;counts.messageData++;
    const classified=classifyMessage(summary.message,className);
    counts.categories[classified.category]=increase(counts.categories[classified.category]);
    Object.assign(result,classified);
    return result;
  }
  function record(value) {
    if(state.records.length<MAX_RECORDS) state.records.push({phase:state.phase,...value});
    else state.recordLimitReached=true;
  }
  function observe(frame,definition) {
    state.functionHits[definition.name]=increase(state.functionHits[definition.name]);state.observedEntries=increase(state.observedEntries);
    if(definition.name==='gw') {
      const code=parameter(frame,definition.code),tag=parameter(frame,definition.tag);
      const entryCode=knownNumber(code,CODES),knownTag=knownNumber(tag,TAGS);
      if(entryCode===undefined) {state.unknownEntryCodes=increase(state.unknownEntryCodes);return;}
      if(knownTag===undefined) {state.unknownTags=increase(state.unknownTags);return;}
      let incoming;
      try {incoming=incomingError(frame,entryCode);} catch {state.inspectionFailures=increase(state.inspectionFailures);}
      record({function:'gw',entryCode,tag:knownTag,...(incoming?{incoming}:{})});return;
    }
    if(definition.name==='F1') {
      const input=arrayInfo(parameter(frame,definition.array),true);
      const bytes=Array.from({length:5},(_,index)=>byte(input.properties,index));
      const checked=input.array&&input.length>=5&&bytes.every(value=>value!==undefined);
      const header={checked};
      if(checked) {
        header.saltRelationship=bytes[1]===(bytes[0]^3);header.initialMarker=bytes[2]===165;
        const boundary=((bytes[3]^bytes[1])<<8)|(bytes[4]^bytes[1]);header.boundaryWithinArray=boundary>=5&&boundary<=input.length;
      }
      record({function:'F1',array:input.array,length:input.length,header});return;
    }
    const destination=knownNumber(parameter(frame,definition.destination),SLOTS),tagRemote=parameter(frame,definition.tag);
    const tag=tagRemote.type==='undefined'||tagRemote.type==='number'&&tagRemote.value===0?'none':knownNumber(tagRemote,TAGS);
    if(destination===undefined) {state.unknownSlots=increase(state.unknownSlots);return;}
    if(tag===undefined) {state.unknownTags=increase(state.unknownTags);return;}
    const errorHeader=destination===167&&tag===15;
    const input=arrayInfo(parameter(frame,definition.array),errorHeader);
    const output={function:definition.name,destination,tag,array:input.array,length:input.length};
    if(errorHeader) {
      const bytes=Array.from({length:input.length===5||input.length===6?input.length:0},(_,index)=>byte(input.properties,index));
      const schema=bytes.length>0&&bytes.every(value=>value!==undefined)&&((bytes[0]<<8)|bytes[1])===bytes.length-2;
      output.errorHeader={schema};
      if(schema) {if(CODES.includes(bytes[2])) output.errorHeader.statusCode=bytes[2];else state.unknownErrorCodes=increase(state.unknownErrorCodes);}
    }
    record(output);
  }
  function paused({params}) {
    try {
      if(!active||disposed) return;
      state.pauses=increase(state.pauses);
      if(performance.now()-started>=limits.maxDurationMs) {stop('duration');return;}
      const definition=(params.hitBreakpoints||[]).map(id=>breakpoints.get(id)).find(Boolean);
      if(!definition) {state.unexpectedPauses=increase(state.unexpectedPauses);return;}
      if(!params.callFrames?.[0]) throw new OriginalOutputInspectorError('FRAME_UNAVAILABLE');
      observe(params.callFrames[0],definition);
    } catch {state.inspectionFailures=increase(state.inspectionFailures);}
    finally {
      if(connected) try{immediate('Runtime.releaseObjectGroup',{objectGroup:group});}catch{state.inspectorErrors=increase(state.inspectorErrors);}
      if(active&&state.pauses>=limits.maxHits) stop('limit');
      resume();
    }
  }
  async function dispose() {
    if(cleanupPromise) return cleanupPromise;
    active=false;
    cleanupPromise=(async()=>{
      clearTimeout(timer);removeAll();
      if(connected) {
        try{immediate('Runtime.releaseObjectGroup',{objectGroup:helperGroup});}catch{state.inspectorErrors=increase(state.inspectorErrors);}
        if(enabled) await post('Debugger.disable').catch(()=>{state.inspectorErrors=increase(state.inspectorErrors);});
        enabled=false;session.off('Debugger.paused',paused);session.off('Debugger.scriptParsed',parsed);
        if(runtimeEnabled) await post('Runtime.disable').catch(()=>{state.inspectorErrors=increase(state.inspectorErrors);});
        runtimeEnabled=false;session.off('Runtime.executionContextCreated',contextCreated);session.off('Runtime.executionContextDestroyed',contextDestroyed);
        try{session.disconnect();}catch{state.inspectorErrors=increase(state.inspectorErrors);}connected=false;
      }
      scripts.clear();scriptContexts.clear();errorHelpers.clear();disposed=true;state.disposed=true;if(activeOwner===owner) activeOwner=undefined;
    })();return cleanupPromise;
  }
  try {
    session.connect();connected=true;
    session.on('Runtime.executionContextCreated',contextCreated);session.on('Runtime.executionContextDestroyed',contextDestroyed);runtimeEnabled=true;
    await post('Runtime.enable');
    session.on('Debugger.paused',paused);session.on('Debugger.scriptParsed',parsed);active=true;enabled=true;
    await post('Debugger.enable');timer=setTimeout(()=>{state.durationReached=true;void dispose();},limits.maxDurationMs);timer.unref?.();
  } catch {await dispose();throw new OriginalOutputInspectorError('INSPECTOR_SETUP_FAILED');}
  return {snapshot(){return JSON.parse(JSON.stringify(state));},setPhase(phase){if(!PHASES.includes(phase)) throw new OriginalOutputInspectorError('INVALID_PHASE');state.phase=phase;},dispose};
}
