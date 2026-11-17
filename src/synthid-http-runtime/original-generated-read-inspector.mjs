// Passive original tiny accessor observation. No source/property replacement.
import { Session } from 'node:inspector';
import { createHash } from 'node:crypto';
import { parse } from 'acorn';
import { readProbeNames as baseReadProbeNames } from './runtime-read-diagnostics.mjs';

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
const PROVENANCES=['directOriginal','generatedDescendant'];
const CALLERS=['original','generatedDescendant','outsideOrUnavailable'];
const RESERVED=new Set(('break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with let static yield await implements interface package private protected public').split(' '));
const CODES=new Set(['INVALID_OPTIONS','UNREVIEWED_SOURCE','ALREADY_ACTIVE','INSPECTOR_SETUP_FAILED']);
const hash=source=>createHash('sha256').update(source).digest('hex');
const count=value=>Math.min(1000000,value+1);
let activeOwner;
export class OriginalGeneratedReadInspectorError extends Error{
  constructor(code){const safe=CODES.has(code)?code:'INSPECTOR_SETUP_FAILED';super('Original generated read diagnostic failed: '+safe);this.name='OriginalGeneratedReadInspectorError';this.code=safe;}
}

// Closed grammar, not execution or loose text matching. Comments, strings,
// directives, arrows, async/generators and parameter initializers are rejected.
function accessorShape(source){
  if(typeof source!=='string'||source.length<1||source.length>1024)return;
  const tokens=[];
  for(let offset=0;offset<source.length;){
    if(/\s/.test(source[offset])){offset++;continue;}
    const identifier=/^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(offset));
    if(identifier){tokens.push({value:identifier[0],start:offset,end:offset+identifier[0].length,identifier:true});offset+=identifier[0].length;continue;}
    if(!/[(){}\[\],;]/.test(source[offset]))return;
    tokens.push({value:source[offset],start:offset,end:offset+1,identifier:false});offset++;
  }
  let index=0;const take=value=>tokens[index]?.value===value?(index++,true):false;
  const identifier=()=>{const token=tokens[index];if(!token?.identifier||RESERVED.has(token.value))return;index++;return token;};
  const wrapped=take('(');
  if(!take('function'))return;
  if(tokens[index]?.identifier&&!identifier())return;
  if(!take('('))return;
  const object=identifier();if(!object||!take(','))return;
  const key=identifier();if(!key||object.value===key.value||!take(')')||!take('{'))return;
  const bodyStart=tokens[index-1].end,returnToken=tokens[index];
  if(!take('return'))return;
  const member=tokens[index];
  // A newline after return inserts a semicolon and is NOT this grammar.
  if(!member||member.value!==object.value||/[\r\n\u2028\u2029]/.test(source.slice(returnToken.end,member.start)))return;
  index++;if(!take('[')||!take(key.value)||!take(']'))return;
  const memberEnd=tokens[index-1].end;take(';');
  if(!take('}'))return;
  const bodyEnd=tokens[index-1].end;
  if(wrapped&&!take(')'))return;
  take(';');if(index!==tokens.length)return;
  return{object:object.value,key:key.value,bodyStart,bodyEnd,readStart:member.start,readEnd:memberEnd};
}
export function summarizeOriginalGeneratedReadShape(source){
  const shape=accessorShape(source);return{matched:!!shape,twoPlainParameters:!!shape,soleComputedReadReturn:!!shape};
}

// Structural diagnostics only. This classifier does not admit new breakpoint
// shapes. All outputs are fixed categories, booleans or bounded count buckets;
// parser nodes, source, identifiers, literal values and errors stay in memory.
const countBucket=value=>value<0?'none':value<=4?String(value):'5-or-more';
function unparen(node){for(let depth=0;node?.type==='ParenthesizedExpression'&&depth<16;depth++)node=node.expression;return node;}
const isFunction=node=>['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node?.type);
function topology(node){
  node=unparen(node);if(!node)return'none';
  if(node.type==='MemberExpression')return node.computed?'computed-member':'static-member';
  const names={Identifier:'identifier',Literal:'literal',ThisExpression:'this',CallExpression:'call',NewExpression:'construct',
    ReturnStatement:'return',ExpressionStatement:'expression',VariableDeclaration:'declaration',IfStatement:'if',TryStatement:'try',
    BlockStatement:'block',EmptyStatement:'empty',ThrowStatement:'throw',ForStatement:'loop',ForOfStatement:'loop',ForInStatement:'loop',WhileStatement:'loop',DoWhileStatement:'loop',
    FunctionDeclaration:'function',FunctionExpression:'function',ArrowFunctionExpression:'arrow',ConditionalExpression:'conditional',BinaryExpression:'binary',
    LogicalExpression:'logical',SequenceExpression:'sequence',UnaryExpression:'unary',UpdateExpression:'update',AssignmentExpression:'assignment',
    AwaitExpression:'await',YieldExpression:'yield',ArrayExpression:'array',ObjectExpression:'object',ChainExpression:'optional-chain',TemplateLiteral:'template'};
  return Object.hasOwn(names,node.type)?names[node.type]:'other';
}
function parameterRole(node,params,outerParams){
  node=unparen(node);if(!node)return'none';
  if(node.type==='Identifier'){
    const own=params.findIndex(param=>param.type==='Identifier'&&param.name===node.name);
    if(own>=0)return own===0?'parameter0-name-match':own===1?'parameter1-name-match':'other-parameter-name-match';
    if(outerParams.some(param=>param.type==='Identifier'&&param.name===node.name))return'outer-parameter-name-match';
    return node.name==='arguments'?'arguments-name':'other-identifier';
  }
  return topology(node);
}
const operationStatements=body=>body.filter(statement=>!(statement.type==='ExpressionStatement'&&typeof statement.directive==='string'));
function soleReturnedNode(fn){
  if(!isFunction(fn))return;
  if(fn.body.type!=='BlockStatement')return unparen(fn.body);
  const operations=operationStatements(fn.body.body);
  return operations.length===1&&operations[0].type==='ReturnStatement'?unparen(operations[0].argument):undefined;
}
function functionStructure(fn,outerParams=[]){
  const output={kind:'none',async:false,generator:false,parameters:'none',allPlainParameters:false,distinctPlainParameters:false,
    parameterKinds:{identifier:false,default:false,rest:false,objectPattern:false,arrayPattern:false,other:false},
    statements:'none',directives:'none',bodyTopology:'none',operationStatements:'none',operationTopology:'none',returnTopology:'none',
    memberComputed:false,memberOptional:false,memberObjectRole:'none',memberKeyRole:'none',returnsFunction:false};
  if(!isFunction(fn))return output;
  output.kind=fn.type==='ArrowFunctionExpression'?'arrow':fn.type==='FunctionDeclaration'?'declaration':'expression';
  output.async=!!fn.async;output.generator=!!fn.generator;output.parameters=countBucket(fn.params.length);
  output.allPlainParameters=fn.params.every(param=>param.type==='Identifier');
  output.distinctPlainParameters=output.allPlainParameters&&new Set(fn.params.map(param=>param.name)).size===fn.params.length;
  for(const parameter of fn.params){const key={Identifier:'identifier',AssignmentPattern:'default',RestElement:'rest',ObjectPattern:'objectPattern',ArrayPattern:'arrayPattern'}[parameter.type]||'other';output.parameterKinds[key]=true;}
  const returned=soleReturnedNode(fn);
  if(fn.body.type==='BlockStatement'){
    const statements=fn.body.body;output.statements=countBucket(statements.length);
    output.directives=countBucket(statements.filter(statement=>statement.type==='ExpressionStatement'&&typeof statement.directive==='string').length);
    output.bodyTopology=statements.length===1?topology(statements[0]):statements.length===0?'empty':'multiple';
    const operations=operationStatements(statements);output.operationStatements=countBucket(operations.length);
    output.operationTopology=operations.length===1?topology(operations[0]):operations.length===0?'empty':'multiple';
  }else{output.statements='0';output.directives='0';output.bodyTopology='expression-body';output.operationStatements='0';output.operationTopology='expression-body';}
  output.returnTopology=topology(returned);output.returnsFunction=isFunction(returned);
  if(returned?.type==='MemberExpression'){
    output.memberComputed=!!returned.computed;output.memberOptional=!!returned.optional;
    output.memberObjectRole=parameterRole(returned.object,fn.params,outerParams);
    // A dotted property identifier is syntax, not a parameter reference.
    output.memberKeyRole=returned.computed?parameterRole(returned.property,fn.params,outerParams):'static-property';
  }
  return output;
}
export function summarizeOriginalGeneratedCandidate(source){
  const output={analysis:'acorn-fixed-structure',identifierAnalysis:'lexical-name-matches-only',parsed:false,lengthBucket:'invalid',programStatements:'none',rootTopology:'none',
    parenthesizedRoot:false,iife:false,wrapperArguments:'none',assignmentWrapper:false,variableWrapper:false,
    function:functionStructure(),returnedFunction:functionStructure()};
  if(typeof source!=='string')return output;
  output.lengthBucket=source.length===0?'empty':source.length<=128?'at-most-128':source.length<=256?'at-most-256':source.length<=512?'at-most-512':source.length<=1024?'at-most-1024':'over-limit';
  if(source.length>1024)return output;
  let ast;try{ast=parse(source,{ecmaVersion:'latest',sourceType:'script',preserveParens:true});}catch{output.rootTopology='parse-error';return output;}
  output.parsed=true;output.programStatements=countBucket(ast.body.length);
  if(ast.body.length!==1){output.rootTopology=ast.body.length===0?'empty':'multiple';return output;}
  const statement=ast.body[0];let expression=statement.type==='ExpressionStatement'?statement.expression:statement;
  output.parenthesizedRoot=expression?.type==='ParenthesizedExpression';expression=unparen(expression);output.rootTopology=topology(expression);
  let fn=isFunction(expression)?expression:undefined;
  if(expression?.type==='CallExpression'&&isFunction(unparen(expression.callee))){output.iife=true;output.wrapperArguments=countBucket(expression.arguments.length);fn=unparen(expression.callee);}
  else if(expression?.type==='AssignmentExpression'&&isFunction(unparen(expression.right))){output.assignmentWrapper=true;fn=unparen(expression.right);}
  else if(statement.type==='VariableDeclaration'&&statement.declarations.length===1&&isFunction(unparen(statement.declarations[0].init))){output.variableWrapper=true;fn=unparen(statement.declarations[0].init);}
  output.function=functionStructure(fn);
  const returned=soleReturnedNode(fn);if(isFunction(returned))output.returnedFunction=functionStructure(returned,fn.params);
  return output;
}
function positions(source){const starts=[0];for(let index=0;index<source.length;index++){
    const code=source.charCodeAt(index);if(code===13){if(source.charCodeAt(index+1)===10)index++;starts.push(index+1);}else if(code===10||code===0x2028||code===0x2029)starts.push(index+1);
  }
  return{location(offset,scriptId){let low=0,high=starts.length;while(low+1<high){const mid=(low+high)>>1;if(starts[mid]<=offset)low=mid;else high=mid;}return{scriptId,lineNumber:low,columnNumber:offset-starts[low]};},
    offset(location){if(!location||!Number.isInteger(location.lineNumber)||!Number.isInteger(location.columnNumber)||location.lineNumber<0||location.lineNumber>=starts.length)return;return starts[location.lineNumber]+location.columnNumber;}};
}
function validate({maxHits=4000,maxDurationMs=30000,maxScripts=32,maxCandidates=512,maxPending=16,maxGraphScripts=6000}={}){
  const valid=(value,min,max)=>Number.isInteger(value)&&value>=min&&value<=max;
  if(!valid(maxHits,1,10000)||!valid(maxDurationMs,100,120000)||!valid(maxScripts,1,128)||!valid(maxCandidates,1,512)||!valid(maxPending,1,32)||!valid(maxGraphScripts,16,12000))throw new OriginalGeneratedReadInspectorError('INVALID_OPTIONS');
  return{maxHits,maxDurationMs,maxScripts,maxCandidates,maxPending,maxGraphScripts};
}
function stackIdentity(frames){return frames.map(frame=>{const location=frame.functionLocation||frame.location;return location?[location.scriptId,location.lineNumber,location.columnNumber].join(':'):'?';});}
function suffixMatches(full,suffix){return full.length>=suffix.length&&suffix.every((entry,index)=>entry===full[full.length-suffix.length+index]);}
function nameExpression(key){return readProbeNames.map(name=>key+'==='+JSON.stringify(name)+'?'+JSON.stringify(name)+':').join('')+'null';}
function nameCondition(key){return readProbeNames.map(name=>key+'==='+JSON.stringify(name)).join('||');}
const counters=()=>({reads:0,defined:0,undefined:0,null:0,completed:0,typesUnobserved:0,unresolved:0,throws:null,callers:Object.fromEntries(CALLERS.map(name=>[name,0]))});

export async function createOriginalGeneratedReadInspector(options={}){
  const limits=validate(options);
  if(typeof options.originalInterpreter!=='string'||options.originalInterpreter.length>1048576||hash(options.originalInterpreter)!==OUTER_HASH)throw new OriginalGeneratedReadInspectorError('UNREVIEWED_SOURCE');
  return createProbe({fixture:false,outerLength:options.originalInterpreter.length,outerHash:OUTER_HASH,embedded:true},limits);
}
export async function createOriginalGeneratedReadInspectorFixture({source,...options}={}){
  const limits=validate(options);
  if(typeof source!=='string'||!source.length||source.length>16384)throw new OriginalGeneratedReadInspectorError('INVALID_OPTIONS');
  return createProbe({fixture:true,outerLength:source.length,outerHash:hash(source),embedded:false},limits);
}

async function createProbe(reference,limits){
  if(activeOwner)throw new OriginalGeneratedReadInspectorError('ALREADY_ACTIVE');
  const owner={};activeOwner=owner;
  const {maxHits,maxDurationMs,maxScripts,maxCandidates,maxPending,maxGraphScripts}=limits;
  const session=new Session(),graph=new Map(),scripts=new Map(),breakpoints=new Map(),pending=[],rejectedBins=new Map();
  const state={diagnosticOnly:true,fixture:reference.fixture,sourceModified:false,prototypesModified:false,exportsModified:false,
    propertyReadsIntroduced:0,argumentValuesRecorded:false,sourceTextRecorded:false,returnValuesRecorded:false,
    exceptionPausingEnabled:false,throwsObserved:false,returnObservation:'original-return-breakpoint-metadata',
    provenanceScope:'script-compilation-ancestry',functionInstanceOriginObserved:false,
    reads:Object.fromEntries(readProbeNames.map(name=>[name,counters()])),resultTypes:Object.fromEntries(TYPES.map(type=>[type,0])),
    provenance:Object.fromEntries(PROVENANCES.map(name=>[name,{scripts:0,reads:0}])),
    callers:Object.fromEntries(CALLERS.map(name=>[name,0])),
    originalSourceMatches:0,originalSourceCandidates:0,originalSourceMismatches:0,originalSourceLimitReached:false,
    parseNotifications:0,graphScripts:0,graphLimitReached:false,candidateScripts:0,candidateLimitReached:false,
    matchedScripts:0,scriptLimitReached:false,rejectedShapes:0,sourceInspectionFailures:0,ancestorOnlyRejected:0,
    rejectedStructure:{parser:'acorn',acceptanceUnchanged:true,inspected:0,parsed:0,parseErrors:0,maxBins:32,overflow:0,bins:[]},
    installedReadSites:0,unavailableReadSites:0,installedReturnSites:0,unavailableReturnSites:0,
    pauses:0,readPauses:0,returnPauses:0,unexpectedPauses:0,unmatchedReturnPauses:0,
    totalReads:0,completedReads:0,typesObserved:0,typesUnobserved:0,unresolvedReads:0,
    pendingReads:0,pendingLimitReached:false,inspectionFailures:0,inspectorErrors:0,
    installedBreakpoints:0,removedBreakpoints:0,limitReached:false,durationReached:false,debuggerStoppedAtLimit:false,disposed:false,...limits};
  let active=false,connected=false,debuggerEnabled=false,checkingSource=false,evaluating=false,disposed=false,cleanupPromise,timer,parseStopPending=false;
  const started=performance.now();
  function immediate(method,params={}){let done=false,error,result;
    try{session.post(method,params,(failure,value)=>{done=true;error=failure;result=value;});}catch{throw new OriginalGeneratedReadInspectorError('INSPECTOR_SETUP_FAILED');}
    if(!done||error)throw new OriginalGeneratedReadInspectorError('INSPECTOR_SETUP_FAILED');return result;
  }
  const post=(method,params={})=>new Promise((resolve,reject)=>{const deadline=setTimeout(()=>reject(new OriginalGeneratedReadInspectorError('INSPECTOR_SETUP_FAILED')),1000);
    try{session.post(method,params,(error,value)=>{clearTimeout(deadline);error?reject(new OriginalGeneratedReadInspectorError('INSPECTOR_SETUP_FAILED')):resolve(value);});}
    catch{clearTimeout(deadline);reject(new OriginalGeneratedReadInspectorError('INSPECTOR_SETUP_FAILED'));}
  });
  function resume(){if(!connected||!debuggerEnabled)return;try{immediate('Debugger.resume');}catch{if(!disposed)state.inspectorErrors=count(state.inspectorErrors);}}
  function removeBreakpoint(id){if(!breakpoints.has(id))return;breakpoints.delete(id);try{immediate('Debugger.removeBreakpoint',{breakpointId:id});state.removedBreakpoints=count(state.removedBreakpoints);}catch{state.inspectorErrors=count(state.inspectorErrors);}}
  function unresolved(item){state.reads[item.name].unresolved=count(state.reads[item.name].unresolved);state.unresolvedReads=count(state.unresolvedReads);}
  function expirePending(stack){for(let index=pending.length-1;index>=0;index--)if(!suffixMatches(stack,pending[index].stack)){unresolved(pending[index]);pending.splice(index,1);}state.pendingReads=pending.length;}
  function stop(reason){active=false;if(reason==='limit')state.limitReached=true;if(reason==='duration')state.durationReached=true;
    for(const id of [...breakpoints.keys()])removeBreakpoint(id);for(const item of pending)unresolved(item);pending.length=0;state.pendingReads=0;
    if(debuggerEnabled){try{immediate('Debugger.disable');debuggerEnabled=false;state.debuggerStoppedAtLimit=true;}catch{state.inspectorErrors=count(state.inspectorErrors);try{session.disconnect();connected=false;debuggerEnabled=false;}catch{}}}
  }
  function stopAfterParse(){
    // V8 must finish its scriptParsed notification before Debugger.disable.
    // Disabling inside that notification can terminate Node during compilation.
    active=false;state.durationReached=true;parseStopPending=true;
    queueMicrotask(()=>{if(parseStopPending&&!disposed&&!cleanupPromise){parseStopPending=false;stop('duration');}});
  }
  function localName(frame,key){evaluating=true;try{const result=immediate('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:'({name:'+nameExpression(key)+'})',returnByValue:true,silent:true});
      if(result.exceptionDetails||result.result?.type!=='object'||!readProbeNames.includes(result.result.value?.name))throw new OriginalGeneratedReadInspectorError('INSPECTOR_SETUP_FAILED');return result.result.value.name;
    }finally{evaluating=false;}
  }
  function originalAncestry(id,seen=new Set()){if(!id||seen.has(id)||seen.size>=64)return false;seen.add(id);const entry=graph.get(id);return!!entry&&(entry.original||entry.parents.some(parent=>originalAncestry(parent,seen)));}
  function directChain(id,seen=new Set()){if(!id||seen.has(id)||seen.size>=32)return false;seen.add(id);const entry=graph.get(id);return!!entry&&(entry.original||directChain(entry.parents[0],seen));}
  function provenanceFor(parents){if(graph.get(parents[0])?.original)return'directOriginal';if(directChain(parents[0]))return'generatedDescendant';}
  function addBreakpoint(location,record,condition){const result=immediate('Debugger.setBreakpoint',{location,condition});
    if(typeof result.breakpointId!=='string')throw new OriginalGeneratedReadInspectorError('INSPECTOR_SETUP_FAILED');
    breakpoints.set(result.breakpointId,record);state.installedBreakpoints=count(state.installedBreakpoints);
    if(result.actualLocation?.scriptId!==location.scriptId||result.actualLocation?.lineNumber!==location.lineNumber||result.actualLocation?.columnNumber!==location.columnNumber){removeBreakpoint(result.breakpointId);return false;}return true;
  }
  function parsed({params}){
    if(!active||disposed||checkingSource||evaluating)return;state.parseNotifications=count(state.parseNotifications);
    if(performance.now()-started>=maxDurationMs){stopAfterParse();return;}
    if(graph.has(params.scriptId))return;
    if(graph.size>=maxGraphScripts){state.graphLimitReached=true;return;}
    const parents=(params.stackTrace?.callFrames||[]).slice(0,24).map(frame=>frame.scriptId).filter(Boolean);
    const entry={parents,original:false};graph.set(params.scriptId,entry);state.graphScripts=graph.size;
    const length=params.length;
    const possibleOriginal=Number.isInteger(length)&&(length===reference.outerLength||(reference.embedded&&length>=EMBEDDED_LENGTH&&length<=EMBEDDED_LENGTH+7823));
    const provenance=provenanceFor(parents);
    if(!provenance&&Number.isInteger(length)&&length>=1&&length<=1024&&parents.some(id=>originalAncestry(id)))state.ancestorOnlyRejected=count(state.ancestorOnlyRejected);
    const possibleAccessor=Number.isInteger(length)&&length>=1&&length<=1024&&!!provenance;
    if(!possibleOriginal&&!possibleAccessor)return;
    if(possibleOriginal&&state.originalSourceCandidates>=32){state.originalSourceLimitReached=true;return;}
    if(!possibleOriginal&&state.candidateScripts>=maxCandidates){state.candidateLimitReached=true;return;}
    checkingSource=true;
    try{
      if(possibleOriginal)state.originalSourceCandidates=count(state.originalSourceCandidates);
      const source=immediate('Debugger.getScriptSource',{scriptId:params.scriptId}).scriptSource;
      if(typeof source!=='string'||source.length!==length){state.sourceInspectionFailures=count(state.sourceInspectionFailures);return;}
      if(possibleOriginal){let matches=source.length===reference.outerLength&&hash(source)===reference.outerHash;
        if(!matches&&reference.embedded&&source.length>=EMBEDDED_LENGTH&&source.length<=EMBEDDED_LENGTH+7823){const prefix=source.length-EMBEDDED_LENGTH;matches=/^[\n]*$/.test(source.slice(0,prefix))&&hash(source.slice(prefix))===EMBEDDED_HASH;}
        if(matches){entry.original=true;state.originalSourceMatches=count(state.originalSourceMatches);return;}state.originalSourceMismatches=count(state.originalSourceMismatches);
      }
      if(!possibleAccessor)return;
      if(state.candidateScripts>=maxCandidates){state.candidateLimitReached=true;return;}state.candidateScripts=count(state.candidateScripts);
      const shape=accessorShape(source);if(!shape){
        state.rejectedShapes=count(state.rejectedShapes);
        const summary=summarizeOriginalGeneratedCandidate(source),histogram=state.rejectedStructure;
        histogram.inspected=count(histogram.inspected);if(summary.parsed)histogram.parsed=count(histogram.parsed);else histogram.parseErrors=count(histogram.parseErrors);
        const key=JSON.stringify(summary),existing=rejectedBins.get(key);
        if(existing)existing.count=count(existing.count);
        else if(rejectedBins.size<histogram.maxBins){const bin={count:1,shape:summary};rejectedBins.set(key,bin);histogram.bins.push(bin);}
        else histogram.overflow=count(histogram.overflow);
        return;
      }
      if(scripts.size>=maxScripts){state.scriptLimitReached=true;return;}
      const script={id:params.scriptId,shape,positions:positions(source),provenance};scripts.set(script.id,script);
      state.matchedScripts=count(state.matchedScripts);state.provenance[provenance].scripts=count(state.provenance[provenance].scripts);
      const locations=immediate('Debugger.getPossibleBreakpoints',{start:script.positions.location(shape.bodyStart,script.id),end:script.positions.location(shape.bodyEnd,script.id),restrictToFunction:true}).locations||[];
      // The only statement is this return. V8 may place its pre-read location
      // on the return keyword, before the member-expression token itself.
      const reads=locations.filter(location=>{const offset=script.positions.offset(location);return location.type!=='return'&&offset>=shape.bodyStart&&offset<shape.readEnd;});
      const returns=locations.filter(location=>{const offset=script.positions.offset(location);return location.type==='return'&&offset>=shape.readEnd&&offset<shape.bodyEnd;});
      if(reads.length!==1){state.unavailableReadSites=count(state.unavailableReadSites);return;}
      if(addBreakpoint(reads[0],{kind:'read',script},nameCondition(shape.key)))state.installedReadSites=count(state.installedReadSites);else{state.unavailableReadSites=count(state.unavailableReadSites);return;}
      if(returns.length===1&&addBreakpoint(returns[0],{kind:'return',script},nameCondition(shape.key)))state.installedReturnSites=count(state.installedReturnSites);else state.unavailableReturnSites=count(state.unavailableReturnSites);
    }catch{state.sourceInspectionFailures=count(state.sourceInspectionFailures);}
    finally{checkingSource=false;}
  }
  function paused({params}){
    try{
      if(parseStopPending&&!disposed){state.pauses=count(state.pauses);parseStopPending=false;stop('duration');return;}
      if(!active||disposed)return;state.pauses=count(state.pauses);
      if(performance.now()-started>=maxDurationMs){stop('duration');return;}
      const owned=(params.hitBreakpoints||[]).map(id=>breakpoints.get(id)).find(Boolean);
      if(!owned){state.unexpectedPauses=count(state.unexpectedPauses);return;}
      const frames=params.callFrames||[],stack=stackIdentity(frames);expirePending(stack);
      const name=localName(frames[0],owned.script.shape.key);
      if(owned.kind==='read'){
        state.readPauses=count(state.readPauses);
        for(let index=pending.length-1;index>=0;index--)if(pending[index].stack.length===stack.length&&suffixMatches(stack,pending[index].stack)){unresolved(pending[index]);pending.splice(index,1);}
        state.reads[name].reads=count(state.reads[name].reads);state.totalReads=count(state.totalReads);state.provenance[owned.script.provenance].reads=count(state.provenance[owned.script.provenance].reads);
        // Compilation caching can share a script across function instances.
        // Report the immediate invocation caller independently of source origin.
        const callerId=frames[1]?.location?.scriptId;
        const caller=graph.get(callerId)?.original?'original':directChain(callerId)?'generatedDescendant':'outsideOrUnavailable';
        state.callers[caller]=count(state.callers[caller]);state.reads[name].callers[caller]=count(state.reads[name].callers[caller]);
        if(pending.length>=maxPending){state.pendingLimitReached=true;unresolved(pending.shift());}
        pending.push({name,script:owned.script,stack});state.pendingReads=pending.length;
      }else{
        state.returnPauses=count(state.returnPauses);
        const index=pending.findLastIndex(item=>item.script===owned.script&&item.name===name&&item.stack.length===stack.length&&suffixMatches(stack,item.stack));
        if(index<0){state.unmatchedReturnPauses=count(state.unmatchedReturnPauses);return;}
        const item=pending.splice(index,1)[0];state.pendingReads=pending.length;
        state.reads[item.name].completed=count(state.reads[item.name].completed);state.completedReads=count(state.completedReads);
        // Read only fixed protocol tags from the original, already-evaluated
        // return metadata. Never inspect value, description or objectId.
        const metadata=frames[0]?.returnValue,type=metadata?.type;
        if(!TYPES.includes(type)){state.reads[item.name].typesUnobserved=count(state.reads[item.name].typesUnobserved);state.typesUnobserved=count(state.typesUnobserved);return;}
        const outcome=type==='undefined'?'undefined':type==='object'&&metadata.subtype==='null'?'null':'defined';
        state.reads[item.name][outcome]=count(state.reads[item.name][outcome]);state.resultTypes[type]=count(state.resultTypes[type]);state.typesObserved=count(state.typesObserved);
      }
    }catch{state.inspectionFailures=count(state.inspectionFailures);}
    finally{if(active&&state.pauses>=maxHits)stop('limit');resume();}
  }
  async function dispose(){if(cleanupPromise)return cleanupPromise;active=false;
    cleanupPromise=(async()=>{clearTimeout(timer);for(const id of [...breakpoints.keys()])removeBreakpoint(id);for(const item of pending)unresolved(item);pending.length=0;state.pendingReads=0;
      if(connected){if(debuggerEnabled)await post('Debugger.disable').catch(()=>{state.inspectorErrors=count(state.inspectorErrors);});debuggerEnabled=false;session.off('Debugger.paused',paused);session.off('Debugger.scriptParsed',parsed);try{session.disconnect();}catch{state.inspectorErrors=count(state.inspectorErrors);}connected=false;}
      scripts.clear();graph.clear();rejectedBins.clear();disposed=true;state.disposed=true;if(activeOwner===owner)activeOwner=undefined;
    })();return cleanupPromise;
  }
  try{session.connect();connected=true;session.on('Debugger.scriptParsed',parsed);session.on('Debugger.paused',paused);active=true;debuggerEnabled=true;await post('Debugger.enable');
    timer=setTimeout(()=>{state.durationReached=true;void dispose();},maxDurationMs);timer.unref?.();
  }catch{await dispose();throw new OriginalGeneratedReadInspectorError('INSPECTOR_SETUP_FAILED');}
  return{snapshot(){return JSON.parse(JSON.stringify(state));},dispose};
}
