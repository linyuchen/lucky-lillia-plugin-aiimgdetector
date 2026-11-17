// Passive source-location breakpoints on two pinned, original VM read opcodes.
// No source/prototype/export changes, property re-read, browser or network port.
import { Session } from 'node:inspector';
import { createHash } from 'node:crypto';
import { readProbeNames as baseReadProbeNames } from './runtime-read-diagnostics.mjs';

// Extend only this unmodified-source probe. The transformer keeps its existing
// vocabulary; all expressions and result names still use this fixed allowlist.
const readProbeNames=Object.freeze([...new Set([...baseReadProbeNames,
  'Object','Reflect','toString','valueOf','getOwnPropertyDescriptor',
  'getOwnPropertyDescriptors','getOwnPropertyNames','getPrototypeOf','ownKeys',
  'defineProperty','hasOwnProperty','vendor','appVersion','product','productSub',
  'userActivation','isActive','hasBeenActive',
])]);

const OUTER_HASH='231468acebdbbfd37651d9060ee7a7420065b3bf0e6fb2be0d8a2b7a5922bad2';
const EMBEDDED_HASH='a9c05edb9f6e3894e0ca8ffc52fee5f6882386813da4195673fb01c145a5c4f1';
const EMBEDDED_LENGTH=61938;
const TYPES=['undefined','object','boolean','number','bigint','string','symbol','function'];
const ERRORS=new Set(['INVALID_OPTIONS','UNREVIEWED_SOURCE','ALREADY_ACTIVE','INSPECTOR_SETUP_FAILED']);
const SITES=[
  {kind:'decoded',needle:'mM(J[R],z,q)',readOffset:0,maximumAdvance:2,key:'R',object:'J'},
  {kind:'computed',needle:'R[p]),z,W)',readOffset:0,maximumAdvance:1,key:'p',object:'R'},
];
const SINK='mM=function(l,C,F){';
let activeOwner;
const hash=source=>createHash('sha256').update(source).digest('hex');
const count=value=>Math.min(1000000,value+1);
export class OriginalOpcodeInspectorError extends Error{
  constructor(code){const safe=ERRORS.has(code)?code:'INSPECTOR_SETUP_FAILED';super('Original opcode diagnostic failed: '+safe);this.name='OriginalOpcodeInspectorError';this.code=safe;}
}
const counters=()=>({reads:0,defined:0,undefined:0,null:0,unresolved:0,throws:null});
function validate({maxHits=1000,maxDurationMs=30000,maxScripts=8,maxPending=16}={}){
  if(!Number.isInteger(maxHits)||maxHits<1||maxHits>10000||!Number.isInteger(maxDurationMs)||maxDurationMs<100||maxDurationMs>120000||
    !Number.isInteger(maxScripts)||maxScripts<1||maxScripts>16||!Number.isInteger(maxPending)||maxPending<1||maxPending>32)throw new OriginalOpcodeInspectorError('INVALID_OPTIONS');
  return{maxHits,maxDurationMs,maxScripts,maxPending};
}
function positions(source){const starts=[0];for(let i=0;i<source.length;i++)if(source.charCodeAt(i)===10)starts.push(i+1);
  return{location(offset,scriptId){let low=0,high=starts.length;while(low+1<high){const mid=(low+high)>>1;if(starts[mid]<=offset)low=mid;else high=mid;}return{scriptId,lineNumber:low,columnNumber:offset-starts[low]};},
    offset(location){if(!location||!Number.isInteger(location.lineNumber)||!Number.isInteger(location.columnNumber)||location.lineNumber<0||location.lineNumber>=starts.length)return undefined;return starts[location.lineNumber]+location.columnNumber;}};
}
function frameIdentity(frame){const location=frame?.functionLocation||frame?.location;return location?[location.scriptId,location.lineNumber,location.columnNumber].join(':'):'?';}
function stackIdentity(frames){return frames.map(frameIdentity);}
function suffixMatches(full,suffix){return full.length>=suffix.length&&suffix.every((entry,index)=>entry===full[full.length-suffix.length+index]);}
function expressionForName(key){return readProbeNames.map(name=>key+'==='+JSON.stringify(name)+'?'+JSON.stringify(name)+':').join('')+'null';}
function conditionForName(key){return readProbeNames.map(name=>key+'==='+JSON.stringify(name)).join('||');}

export async function createOriginalOpcodeInspector(options={}){
  const limits=validate(options);
  if(typeof options.originalInterpreter!=='string'||options.originalInterpreter.length>1048576||hash(options.originalInterpreter)!==OUTER_HASH)throw new OriginalOpcodeInspectorError('UNREVIEWED_SOURCE');
  // Actual public loader: Array(Math.random()*7824|0).join("\n") + payload.
  return createProbe({length:EMBEDDED_LENGTH,hash:EMBEDDED_HASH,maxPrefix:7823,fixture:false},limits);
}
// Explicitly separate fixture entrypoint. It neither relaxes the public-source
// entrypoint nor loads/executes the official interpreter. Used only offline.
export async function createOriginalOpcodeInspectorFixture({source,...options}={}){
  const limits=validate(options);
  if(typeof source!=='string'||source.length<1||source.length>1048576||SITES.some(site=>source.split(site.needle).length!==2)||source.split(SINK).length!==2)throw new OriginalOpcodeInspectorError('INVALID_OPTIONS');
  return createProbe({length:source.length,hash:hash(source),maxPrefix:32,fixture:true},limits);
}

async function createProbe(reference,limits){
  if(activeOwner)throw new OriginalOpcodeInspectorError('ALREADY_ACTIVE');
  const owner={};activeOwner=owner;
  const {maxHits,maxDurationMs,maxScripts,maxPending}=limits;
  const session=new Session(),breakpoints=new Map(),scripts=new Map(),pending=[];
  const state={diagnosticOnly:true,fixture:reference.fixture,sourceModified:false,prototypesModified:false,exportsModified:false,
    propertyReadsIntroduced:0,argumentValuesRecorded:false,sourceTextRecorded:false,exceptionPausingEnabled:false,throwsObserved:false,
    reads:Object.fromEntries(readProbeNames.map(name=>[name,counters()])),resultTypes:Object.fromEntries(TYPES.map(type=>[type,0])),
    sites:{decoded:{installed:0,unavailable:0,reads:0},computed:{installed:0,unavailable:0,reads:0}},
    sourceCandidates:0,sourceMatches:0,sourceMismatches:0,sourceLimitReached:false,sourceInspectionFailures:0,
    resultSiteUnavailable:0,pauses:0,readPauses:0,resultPauses:0,unmatchedResultPauses:0,unexpectedPauses:0,
    inspectionFailures:0,inspectorErrors:0,installedBreakpoints:0,removedBreakpoints:0,pendingReads:0,
    totalReads:0,completedReads:0,unresolvedReads:0,maxHits,maxDurationMs,maxScripts,maxPending,
    pendingLimitReached:false,limitReached:false,durationReached:false,debuggerStoppedAtLimit:false,disposed:false};
  let connected=false,debuggerEnabled=false,active=false,disposed=false,cleanupPromise,timer,checkingSource=false,evaluating=false;
  const started=performance.now();
  function immediate(method,params={}){
    let complete=false,error,result;
    try{session.post(method,params,(err,value)=>{complete=true;error=err;result=value;});}catch{throw new OriginalOpcodeInspectorError('INSPECTOR_SETUP_FAILED');}
    if(!complete||error)throw new OriginalOpcodeInspectorError('INSPECTOR_SETUP_FAILED');
    return result;
  }
  const post=(method,params={})=>new Promise((resolve,reject)=>{
    const deadline=setTimeout(()=>reject(new OriginalOpcodeInspectorError('INSPECTOR_SETUP_FAILED')),1000);
    try{session.post(method,params,(error,result)=>{clearTimeout(deadline);error?reject(new OriginalOpcodeInspectorError('INSPECTOR_SETUP_FAILED')):resolve(result);});}
    catch{clearTimeout(deadline);reject(new OriginalOpcodeInspectorError('INSPECTOR_SETUP_FAILED'));}
  });
  function resume(){if(!connected||!debuggerEnabled)return;try{immediate('Debugger.resume');}catch{if(!disposed)state.inspectorErrors=count(state.inspectorErrors);}}
  function removeBreakpoint(id){if(!id||!breakpoints.has(id))return;
    breakpoints.delete(id);try{immediate('Debugger.removeBreakpoint',{breakpointId:id});state.removedBreakpoints=count(state.removedBreakpoints);}catch{state.inspectorErrors=count(state.inspectorErrors);}
  }
  function removeAll(){for(const id of [...breakpoints.keys()])removeBreakpoint(id);for(const script of scripts.values())script.resultBreakpoint=undefined;}
  function unresolved(item){state.reads[item.name].unresolved=count(state.reads[item.name].unresolved);state.unresolvedReads=count(state.unresolvedReads);}
  function updatePending(){state.pendingReads=pending.length;
    for(const script of scripts.values())if(script.resultBreakpoint&&!pending.some(item=>item.script===script)){removeBreakpoint(script.resultBreakpoint);script.resultBreakpoint=undefined;}
  }
  function expirePending(stack){for(let index=pending.length-1;index>=0;index--)if(!suffixMatches(stack,pending[index].stack)){unresolved(pending[index]);pending.splice(index,1);}updatePending();}
  function stop(reason){active=false;if(reason==='limit')state.limitReached=true;if(reason==='duration')state.durationReached=true;
    removeAll();for(const item of pending)unresolved(item);pending.length=0;updatePending();
    // Disabling this sole debugger also prevents later ordinary debugger
    // statements from causing unlimited pauses after our budget is exhausted.
    if(debuggerEnabled){try{immediate('Debugger.disable');debuggerEnabled=false;state.debuggerStoppedAtLimit=true;}
      catch{state.inspectorErrors=count(state.inspectorErrors);try{session.disconnect();connected=false;debuggerEnabled=false;}catch{}}}
  }
  function evaluation(frame,expression){if(!frame?.callFrameId)throw new OriginalOpcodeInspectorError('INSPECTOR_SETUP_FAILED');
    evaluating=true;try{const response=immediate('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression,returnByValue:true,silent:true});
      if(response.exceptionDetails||response.result?.type!=='object'||!response.result.value)throw new OriginalOpcodeInspectorError('INSPECTOR_SETUP_FAILED');return response.result.value;
    }finally{evaluating=false;}
  }
  function installBreakpoint(location,record,condition){const result=immediate('Debugger.setBreakpoint',{location,...(condition?{condition}:{})});
    if(typeof result.breakpointId!=='string')throw new OriginalOpcodeInspectorError('INSPECTOR_SETUP_FAILED');
    breakpoints.set(result.breakpointId,record);state.installedBreakpoints=count(state.installedBreakpoints);return result;
  }
  function possible(script,offset,maximumAdvance){const start=script.positions.location(offset,script.id),end=script.positions.location(offset+maximumAdvance+1,script.id);
    const result=immediate('Debugger.getPossibleBreakpoints',{start,end,restrictToFunction:true});
    return(result.locations||[]).find(location=>{const actual=script.positions.offset(location);return actual!==undefined&&actual>=offset&&actual<=offset+maximumAdvance;});
  }
  function parsed({params}){
    if(!active||disposed||checkingSource||evaluating)return;
    // Length is metadata supplied by V8, not a source value. Filter before any
    // retrieval. The complete candidate is compared only in memory.
    if(!Number.isInteger(params.length)||params.length<reference.length||params.length>reference.length+reference.maxPrefix)return;
    if(scripts.has(params.scriptId))return;
    if(state.sourceCandidates>=maxScripts*4){state.sourceLimitReached=true;return;}
    state.sourceCandidates=count(state.sourceCandidates);checkingSource=true;
    try{
      const source=immediate('Debugger.getScriptSource',{scriptId:params.scriptId}).scriptSource;
      if(typeof source!=='string'||source.length<reference.length||source.length>reference.length+reference.maxPrefix){state.sourceMismatches=count(state.sourceMismatches);return;}
      const offset=source.length-reference.length;
      if(!/^[\n]*$/.test(source.slice(0,offset))||hash(source.slice(offset))!==reference.hash){state.sourceMismatches=count(state.sourceMismatches);return;}
      if(scripts.size>=maxScripts){state.sourceLimitReached=true;return;}
      if(SITES.some(site=>source.split(site.needle).length!==2)||source.split(SINK).length!==2){state.sourceInspectionFailures=count(state.sourceInspectionFailures);return;}
      const script={id:params.scriptId,positions:positions(source),sites:[],resultLocation:undefined,resultBreakpoint:undefined};
      scripts.set(params.scriptId,script);state.sourceMatches=count(state.sourceMatches);
      const sinkOffset=source.indexOf(SINK)+SINK.length;
      script.resultLocation=possible(script,sinkOffset,3);
      if(!script.resultLocation){state.resultSiteUnavailable=count(state.resultSiteUnavailable);return;}
      for(const definition of SITES){
        const readStart=source.indexOf(definition.needle),requested=readStart+definition.readOffset;
        const location=possible(script,requested,definition.maximumAdvance);
        if(!location){state.sites[definition.kind].unavailable=count(state.sites[definition.kind].unavailable);continue;}
        const callStart=definition.kind==='decoded'?readStart:source.lastIndexOf('mM(',readStart);
        if(callStart<0||readStart-callStart>256){state.sites[definition.kind].unavailable=count(state.sites[definition.kind].unavailable);continue;}
        const site={...definition,callStart,callEnd:readStart+definition.needle.length};
        const result=installBreakpoint(location,{kind:'read',script,site},conditionForName(site.key));
        const actual=script.positions.offset(result.actualLocation);
        if(actual===undefined||actual<requested||actual>requested+definition.maximumAdvance){removeBreakpoint(result.breakpointId);state.sites[definition.kind].unavailable=count(state.sites[definition.kind].unavailable);continue;}
        script.sites.push(site);state.sites[definition.kind].installed=count(state.sites[definition.kind].installed);
      }
    }catch{state.sourceInspectionFailures=count(state.sourceInspectionFailures);}
    finally{checkingSource=false;}
  }
  function paused({params}){
    try{
      if(!active||disposed)return;
      state.pauses=count(state.pauses);
      const owned=(params.hitBreakpoints||[]).map(id=>breakpoints.get(id)).find(Boolean);
      if(!owned){state.unexpectedPauses=count(state.unexpectedPauses);return;}
      if(performance.now()-started>=maxDurationMs){stop('duration');return;}
      const frames=params.callFrames||[];
      if(owned.kind==='read'){
        state.readPauses=count(state.readPauses);
        const stack=stackIdentity(frames);expirePending(stack);
        // The same handler depth can be reused after a throwing property access;
        // retire that missing result as unresolved, never infer an exception.
        for(let index=pending.length-1;index>=0;index--)if(pending[index].stack.length===stack.length&&suffixMatches(stack,pending[index].stack)){unresolved(pending[index]);pending.splice(index,1);}
        const safe=evaluation(frames[0],'({name:'+expressionForName(owned.site.key)+',objectType:typeof '+owned.site.object+',objectNull:'+owned.site.object+'===null})');
        if(!readProbeNames.includes(safe.name)||!TYPES.includes(safe.objectType)||typeof safe.objectNull!=='boolean'){state.inspectionFailures=count(state.inspectionFailures);updatePending();return;}
        state.reads[safe.name].reads=count(state.reads[safe.name].reads);state.totalReads=count(state.totalReads);state.sites[owned.site.kind].reads=count(state.sites[owned.site.kind].reads);
        if(pending.length>=maxPending){state.pendingLimitReached=true;unresolved(pending.shift());}
        const item={name:safe.name,stack,script:owned.script,site:owned.site};pending.push(item);state.pendingReads=pending.length;
        if(!owned.script.resultBreakpoint){const result=installBreakpoint(owned.script.resultLocation,{kind:'result',script:owned.script});
          const expected=owned.script.positions.offset(owned.script.resultLocation),actual=owned.script.positions.offset(result.actualLocation);
          if(actual!==expected){removeBreakpoint(result.breakpointId);throw new OriginalOpcodeInspectorError('INSPECTOR_SETUP_FAILED');}
          owned.script.resultBreakpoint=result.breakpointId;
        }
      }else{
        state.resultPauses=count(state.resultPauses);
        const stack=stackIdentity(frames.slice(1)),caller=frames[1]?.location;
        const callerOffset=owned.script.positions.offset(caller);
        const index=pending.findLastIndex(item=>item.script===owned.script&&caller?.scriptId===owned.script.id&&callerOffset>=item.site.callStart&&callerOffset<=item.site.callEnd&&item.stack.length===stack.length&&suffixMatches(stack,item.stack));
        if(index<0){state.unmatchedResultPauses=count(state.unmatchedResultPauses);expirePending(stack);return;}
        // A thrown access can leave a pending item, then an untracked key can
        // reuse this same handler/stack without triggering its read condition.
        // Confirm the caller's still-local key before attributing the result.
        // This inspects no target property and returns only an allowlisted name.
        const candidate=pending[index],callerKey=evaluation(frames[1],'({name:'+expressionForName(candidate.site.key)+'})');
        if(callerKey.name!==candidate.name){state.unmatchedResultPauses=count(state.unmatchedResultPauses);unresolved(pending.splice(index,1)[0]);updatePending();return;}
        const safe=evaluation(frames[0],'({type:typeof l,isNull:l===null})');
        if(!TYPES.includes(safe.type)||typeof safe.isNull!=='boolean'){state.inspectionFailures=count(state.inspectionFailures);return;}
        const item=pending.splice(index,1)[0],outcome=safe.type==='undefined'?'undefined':safe.isNull?'null':'defined';
        state.reads[item.name][outcome]=count(state.reads[item.name][outcome]);state.completedReads=count(state.completedReads);state.resultTypes[safe.type]=count(state.resultTypes[safe.type]);updatePending();
      }
    }catch{state.inspectionFailures=count(state.inspectionFailures);}
    finally{if(state.pauses>=maxHits&&active)stop('limit');resume();}
  }
  async function dispose(){if(cleanupPromise)return cleanupPromise;active=false;
    cleanupPromise=(async()=>{clearTimeout(timer);removeAll();for(const item of pending)unresolved(item);pending.length=0;state.pendingReads=0;
      if(connected){if(debuggerEnabled)await post('Debugger.disable').catch(()=>{state.inspectorErrors=count(state.inspectorErrors);});debuggerEnabled=false;session.off('Debugger.paused',paused);session.off('Debugger.scriptParsed',parsed);try{session.disconnect();}catch{state.inspectorErrors=count(state.inspectorErrors);}connected=false;}
      scripts.clear();disposed=true;state.disposed=true;if(activeOwner===owner)activeOwner=undefined;
    })();return cleanupPromise;
  }
  try{session.connect();connected=true;session.on('Debugger.paused',paused);session.on('Debugger.scriptParsed',parsed);active=true;debuggerEnabled=true;await post('Debugger.enable');
    timer=setTimeout(()=>{state.durationReached=true;void dispose();},maxDurationMs);timer.unref?.();
  }catch{await dispose();throw new OriginalOpcodeInspectorError('INSPECTOR_SETUP_FAILED');}
  return{snapshot(){return JSON.parse(JSON.stringify(state));},dispose};
}
