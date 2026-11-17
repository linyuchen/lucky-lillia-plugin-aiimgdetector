// Narrow actual-bound append observer. Private sources and payloads never enter snapshot().
import {Session} from 'node:inspector';
import {createHash,randomUUID} from 'node:crypto';
import {parse} from 'acorn';
const OUTER_HASH='c02c0d087d77cc55dd39fa613907a4e0093cd4893c8a01937c63fb35b1877375';
const EMBEDDED_HASH='9e2970d22eac508e349e61b6da4bec25b46cbb5f8cc3c8ca927d36d6587768c2';
const LEGACY_ROLES={methods:{KX:'KX',J:'J',FF:'FF'},appendBindings:{Nv:'Nv',Rk:'Rk'},producerBindings:{O:'O',tI:'tI',y:'y'},serializer:'Iq',tableProperty:'A',destinations:[229,239,333,364,468,498],numericDestination:229,appendParameters:{Nv:{input:1,destination:3,tag:4},Rk:{input:1,destination:2,tag:3}},writerParameters:{O:{vm:0,selector:1},tI:{vm:1,selector:0},y:{vm:1,selector:0}},serializerParameters:{vm:1,selector:3},vmBinding:'a'};
const NEXT_ROLES={methods:{KX:'NR',J:'i',FF:'BQ'},appendBindings:{Nv:'Ok',Rk:'Ek'},producerBindings:{O:'uC',tI:'U',y:'Y'},serializer:'n5',tableProperty:'C',destinations:[23,121,143,261,417,447],numericDestination:143,appendParameters:{Nv:{input:2,destination:0,tag:3},Rk:{input:2,destination:1,tag:3}},writerParameters:{O:{vm:0,selector:1},tI:{vm:1,selector:0},y:{vm:1,selector:0}},serializerParameters:{vm:1,selector:2},vmBinding:'R'};
const REVIEWED_REFERENCES=[
 {version:'reviewed-c02c0d08',outerLength:66835,outerHash:OUTER_HASH,embeddedLength:62188,embeddedHash:EMBEDDED_HASH,maxPrefix:7823,roles:LEGACY_ROLES,starts:{wrapper:23309,KX:57587,J:57979,FF:61775,Nv:27493,Rk:29521,O:28041,tI:21960,y:21582,Iq:41298}},
 {version:'reviewed-000c4d17',outerLength:66645,outerHash:'000c4d17cba5e9ae982e545746ca1a43cebae5d9353043a6d3f2aa259c3f6cd9',embeddedLength:62054,embeddedHash:'45242a678180fc46d7bbbc5486f2a78ff9fb8b4e7adbf077e35586a92b9c4273',maxPrefix:7823,roles:NEXT_ROLES,starts:{wrapper:38780,KX:57420,J:57774,FF:61727,Nv:21813,Rk:19322,O:41442,tI:23550,y:26957,Iq:21419,LookupInput:36072,AdditionInput:30980,Bootstrap:28489,Handoff:36504,FxSource:37785}}
];
const PHASES=['init','events','snapshot'],METHODS=['KX','J','FF'],APPEND_BINDINGS=['Nv','Rk'],MEASURED_SITES=['wrapper','FF',...APPEND_BINDINGS];
const CLASSES=['same-copy','other-public-copy','other-public-site','generated-descendant','unattributed','location-unavailable','binding-unavailable','accessor','missing','non-function','proxy','prototype-limit','protocol-failure'];
const MAX_SCRIPTS=4096,MAX_CANDIDATES=32,MAX_COPIES=8,MAX_CONTEXTS=32,MAX_WRAPPER_INSPECTIONS=32,MAX_PROTOTYPES=4;
const MAX_RECORDS=256,MAX_BYTES=65536,MAX_PRIVATE_SOURCES=2,MAX_SOURCE_UNITS=262144,MAX_SOURCE_BYTES=524288,MAX_PARSE_NODES=50000;
const MAX_ORIGIN_CALLER_SOURCES=4,MAX_ORIGIN_SOURCE_BYTES=1048576,MAX_ORIGIN_RECORDS=256;
const PRODUCER_BINDINGS=['O','tI','y'],MAX_PRODUCER_SOURCES=32,MAX_PRODUCER_SOURCE_BYTES=1048576,MAX_PRODUCER_ARRAYS=128;
const TAGS=[10,12,15,27,104,126,127,153,250];
const PROPERTY_INPUT_KEYS=['length','width','height','availWidth','availHeight','availLeft','availTop','colorDepth','pixelDepth','devicePixelRatio','innerWidth','innerHeight','outerWidth','outerHeight','screenX','screenY','screenLeft','screenTop','scrollX','scrollY','pageXOffset','pageYOffset','clientWidth','clientHeight','offsetWidth','offsetHeight','scrollWidth','scrollHeight','clientLeft','clientTop','offsetLeft','offsetTop','scrollLeft','scrollTop','x','y','left','top','right','bottom','scale','pageLeft','pageTop','hardwareConcurrency','maxTouchPoints','deviceMemory','rtt','downlink','downlinkMax','timeOrigin','startTime','duration','renderTime','loadTime','activationStart','fetchStart','workerStart','redirectStart','redirectEnd','domainLookupStart','domainLookupEnd','connectStart','connectEnd','secureConnectionStart','requestStart','responseStart','responseEnd','domInteractive','domContentLoadedEventStart','domContentLoadedEventEnd','domComplete','loadEventStart','loadEventEnd','navigationStart','unloadEventStart','unloadEventEnd','transferSize','encodedBodySize','decodedBodySize','redirectCount','entryType','now'];
const RECEIVER_TYPES=['object','function','undefined','string','number','boolean','symbol','bigint'];
const RECEIVER_SUBTYPES=['array','null','node','regexp','date','map','set','weakmap','weakset','iterator','generator','error','proxy','promise','typedarray','arraybuffer','dataview','webassemblymemory','wasmvalue'];
const RECEIVER_CLASS_NAMES=['Object','Array','Function','Window','Navigator','Screen','Performance','PerformanceTiming','PerformanceNavigation','PerformanceEntry','PerformanceNavigationTiming','PerformanceResourceTiming','PerformancePaintTiming','DOMRect','DOMRectReadOnly','VisualViewport','Document','HTMLDocument','HTMLElement','HTMLHtmlElement','HTMLBodyElement','HTMLCanvasElement','HTMLImageElement','HTMLVideoElement','HTMLDivElement','HTMLIFrameElement','SVGElement','SVGSVGElement','CSSStyleDeclaration','CSSComputedStyleDeclaration','Date','RegExp','Map','Set','WeakMap','WeakSet','Promise','ArrayBuffer','SharedArrayBuffer','DataView','Uint8Array','Uint8ClampedArray','Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array','Float32Array','Float64Array','BigInt64Array','BigUint64Array','NetworkInformation','TouchList','DOMTokenList','NodeList','HTMLCollection'];
const TYPES=['undefined','null','boolean','integer','number','bigint','string','symbol','object','function'];
const REASONS=['nonArray','arrayCheckFailure','lengthAccessor','invalidLength','sparse','accessor','nonByte','descriptorFailure','numberEncodingFailure','recordLimit','byteLimit','proxy'];
const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
const phaseCounts=()=>Object.fromEntries(PHASES.map(phase=>[phase,0]));
const MAX_PRODUCER_TARGETS=9,MAX_PRODUCER_EPOCHS=128;
const activeCDP=new WeakSet();let activeNode=false;
export class CurrentBoundPayloadInspectorError extends Error{constructor(code){super('Current bound payload inspector: '+code);this.name='CurrentBoundPayloadInspectorError';this.code=code;}}
function visit(node,fn,parent){if(!node||typeof node!=='object')return;if(node.type)fn(node,parent);for(const [key,value]of Object.entries(node)){if(key==='start'||key==='end')continue;if(Array.isArray(value))for(const item of value)visit(item,fn,node);else if(value&&typeof value==='object')visit(value,fn,node);}}
function referenceFor(originalInterpreter){
 if(typeof originalInterpreter!=='string')throw new CurrentBoundPayloadInspectorError('UNREVIEWED_SOURCE');const outerHash=sha(originalInterpreter),version=REVIEWED_REFERENCES.find(item=>item.outerLength===originalInterpreter.length&&item.outerHash===outerHash);if(!version)throw new CurrentBoundPayloadInspectorError('UNREVIEWED_SOURCE');
 const arrays=[];visit(parse(originalInterpreter,{ecmaVersion:'latest'}),node=>{if(node.type==='ArrayExpression'&&node.elements.every(v=>v?.type==='Literal'&&typeof v.value==='string')&&node.elements.some(v=>v.value.length>50000))arrays.push(node);});
 if(arrays.length!==1)throw new CurrentBoundPayloadInspectorError('SOURCE_SHAPE');const source=arrays[0].elements.map(v=>v.value).join(String.fromCharCode(10));
 if(source.length!==version.embeddedLength||sha(source)!==version.embeddedHash)throw new CurrentBoundPayloadInspectorError('SOURCE_SHAPE');
 return makeReference(source,{...version,fixture:false,vmBinding:version.roles.vmBinding});
}
function makeReference(source,options){
 const functions=[];visit(parse(source,{ecmaVersion:'latest'}),(node,parent)=>{if(node.type==='FunctionExpression')functions.push({node,parent});});
 const sites={};for(const kind of ['wrapper',...METHODS,...APPEND_BINDINGS]){const entry=functions.find(v=>v.node.start===options.starts[kind]);if(!entry||entry.node.id||!entry.node.body.body.length)throw new CurrentBoundPayloadInspectorError('SOURCE_SHAPE');const node=entry.node;sites[kind]={start:node.start,end:node.end,bodyStart:node.body.start,bodyEnd:node.body.end,functionLocation:node.start+8,firstStart:node.body.body[0].start,firstEnd:node.body.body[0].end,params:node.params.every(p=>p.type==='Identifier')?node.params.map(p=>p.name):null};}
 const producerSites={};for(const kind of [...PRODUCER_BINDINGS,'Iq']){const node=functions.find(v=>v.node.start===options.starts[kind])?.node;if(!node)continue;if(node.async||node.generator||node.params.some(p=>p.type!=='Identifier'))throw new CurrentBoundPayloadInspectorError('SOURCE_SHAPE');const calls=[];visit(node.body,part=>{const callee=part.callee?.type==='SequenceExpression'?part.callee.expressions.at(-1):part.callee;if(part.type==='CallExpression'&&callee?.type==='Identifier'&&callee.name===options.roles.appendBindings.Nv)calls.push(part.start);});producerSites[kind]={start:node.start,end:node.end,bodyStart:node.body.start,bodyEnd:node.body.end,params:node.params.map(p=>p.name),iqCall:kind==='Iq'&&calls.length===1?calls[0]:null};}
 let inputSite=null;if(options.starts.LookupInput!==undefined){const node=functions.find(v=>v.node.start===options.starts.LookupInput)?.node,expected=['I','G','Q','A','r','e'];if(!node||node.async||node.generator||node.params.length!==expected.length||node.params.some((p,i)=>p.type!=='Identifier'||p.name!==expected[i]))throw new CurrentBoundPayloadInspectorError('SOURCE_SHAPE');const calls=[];visit(node.body,part=>{const callee=part.callee?.type==='SequenceExpression'?part.callee.expressions.at(-1):part.callee,operand=part.arguments?.[2];if(part.type==='CallExpression'&&callee?.type==='Identifier'&&callee.name===options.roles.producerBindings.tI&&operand?.type==='MemberExpression'&&operand.computed&&operand.object?.name==='Q'&&operand.property?.name==='e')calls.push(part);});if(calls.length!==1||!options.fixture&&calls[0].start!==36148)throw new CurrentBoundPayloadInspectorError('SOURCE_SHAPE');inputSite={start:node.start,end:node.end,callStart:calls[0].start,callEnd:calls[0].end,receiver:'Q',key:'e'};}
 let additionSite=null;if(options.starts.AdditionInput!==undefined){const node=functions.find(v=>v.node.start===options.starts.AdditionInput)?.node,expected=['I','G','Q','A','r'];if(!node||node.async||node.generator||node.params.length!==expected.length||node.params.some((p,i)=>p.type!=='Identifier'||p.name!==expected[i]))throw new CurrentBoundPayloadInspectorError('SOURCE_SHAPE');const calls=[];visit(node.body,part=>{const callee=part.callee?.type==='SequenceExpression'?part.callee.expressions.at(-1):part.callee,operand=part.arguments?.[2];if(part.type==='CallExpression'&&callee?.type==='Identifier'&&callee.name===options.roles.producerBindings.tI&&operand?.type==='BinaryExpression'&&operand.operator==='+'&&operand.left?.name==='A'&&operand.right?.name==='G')calls.push(part);});if(calls.length!==1||!options.fixture&&calls[0].start!==31000)throw new CurrentBoundPayloadInspectorError('SOURCE_SHAPE');additionSite={start:node.start,end:node.end,callStart:calls[0].start,callEnd:calls[0].end,left:{vm:'I',selector:'Q'},right:{vm:'k',selector:'r'}};}
 let bootstrapSite=null;if(options.starts.Bootstrap!==undefined){const node=functions.find(v=>v.node.start===options.starts.Bootstrap)?.node,expected=['R','m','c','a','E','h','t','W','n','d','w','O','V','l','z','F','L','v','k','g','dw','Wz','cz','X9','Hz','Ll','Mq','S','bY','E6','Bz','IG','O6','t4'];if(!node||node.async||node.generator||!node.body.body.length||node.params.some(p=>p.type!=='Identifier')||!node.params.some(p=>p.name==='t')||!options.fixture&&(node.params.length!==expected.length||node.params.some((p,i)=>p.name!==expected[i])))throw new CurrentBoundPayloadInspectorError('SOURCE_SHAPE');const initializers=[];visit(node.body,part=>{const rhs=part.right?.type==='SequenceExpression'?part.right.expressions.at(-1):part.right;if(part.type==='AssignmentExpression'&&part.left?.type==='MemberExpression'&&!part.left.computed&&part.left.object?.name==='t'&&part.left.property?.name===options.roles.tableProperty&&rhs?.type==='ArrayExpression'&&rhs.elements.length===0)initializers.push(part);});const first=node.body.body[0];if(initializers.length!==1||initializers[0].start<first.end||!options.fixture&&(first.start!==28580||first.end!==28918||initializers[0].start!==29303))throw new CurrentBoundPayloadInspectorError('SOURCE_SHAPE');bootstrapSite={start:node.start,end:node.end,bodyStart:node.body.start,bodyEnd:node.body.end,functionLocation:node.start+8,params:node.params.map(p=>p.name),firstStart:first.start,firstEnd:first.end,tableInitStart:initializers[0].start};}
 let handoffSite=null;if(options.starts.Handoff!==undefined){const node=functions.find(v=>v.node.start===options.starts.Handoff)?.node,expected=['I','G','Q','A','r'];if(!node||node.async||node.generator||node.params.length!==expected.length||node.params.some((p,i)=>p.type!=='Identifier'||p.name!==expected[i]))throw new CurrentBoundPayloadInspectorError('SOURCE_SHAPE');const calls=[];visit(node.body,part=>{if(part.type==='CallExpression'&&part.callee?.type==='Identifier'&&part.callee.name===options.roles.producerBindings.y)calls.push(part);});const call=calls[0],operand=call?.arguments?.[2],evals=[];if(operand?.type==='CallExpression'&&operand.callee?.type==='FunctionExpression')visit(operand.callee.body,part=>{if(part.type==='CallExpression'&&part.callee?.type==='Identifier'&&part.callee.name==='eval')evals.push(part);});if(calls.length!==1||evals.length!==1||!options.fixture&&(call.start!==36569||call.end!==36617||evals[0].start!==36594||evals[0].end!==36601))throw new CurrentBoundPayloadInspectorError('SOURCE_SHAPE');handoffSite={start:node.start,end:node.end,callStart:call.start,callEnd:call.end};}
 let fxSite=null;if(options.starts.FxSource!==undefined){const node=functions.find(v=>v.node.start===options.starts.FxSource)?.node,expected=['R','m','c','a','E','h','t'];if(!node||node.id||node.async||node.generator||node.params.length!==expected.length||node.params.some((p,i)=>p.type!=='Identifier'||p.name!==expected[i]))throw new CurrentBoundPayloadInspectorError('SOURCE_SHAPE');const calls=[],reads=[];visit(node.body,part=>{const callee=part.callee?.type==='SequenceExpression'?part.callee.expressions.at(-1):part.callee;if(part.type==='CallExpression'&&callee?.type==='Identifier'&&callee.name===options.roles.appendBindings.Rk&&part.arguments.length===3&&part.arguments.every((arg,i)=>arg.type==='Identifier'&&arg.name===['m','t','E'][i]))calls.push(part);if(part.type==='CallExpression'&&callee?.type==='Identifier'&&callee.name==='y'&&part.arguments.length===2&&part.arguments[0]?.name==='h'&&part.arguments[1]?.name==='m')reads.push(part);});const call=calls[0];if(calls.length!==1||reads.length!==1||call.arguments.length!==3||call.arguments.some((part,i)=>part.type!=='Identifier'||part.name!==['m','t','E'][i])||reads[0].end>=call.start||!options.fixture&&(node.end!==37946||call.start!==37936||call.end!==37945||reads[0].start!==37812||reads[0].end!==37857))throw new CurrentBoundPayloadInspectorError('SOURCE_SHAPE');fxSite={start:node.start,end:node.end,bodyStart:node.body.start,bodyEnd:node.body.end,functionLocation:node.start+8,callStart:call.start,callEnd:call.end};}
 return {...options,source,length:source.length,hash:sha(source),sites,producerSites,inputSite,additionSite,bootstrapSite,handoffSite,fxSite};
}
function fixtureReference(source,fixtureVersion='legacy'){
 if(typeof source!=='string'||!source.length||source.length>65536)throw new CurrentBoundPayloadInspectorError('INVALID_FIXTURE');
 if(!['legacy','next'].includes(fixtureVersion))throw new CurrentBoundPayloadInspectorError('INVALID_FIXTURE');const roles=fixtureVersion==='next'?NEXT_ROLES:LEGACY_ROLES,bindings={wrapper:'wrapper',...roles.methods,...roles.appendBindings,...roles.producerBindings,Iq:roles.serializer,...(fixtureVersion==='next'?{LookupInput:'lookupInput',AdditionInput:'additionInput',Bootstrap:'earlyBootstrap',Handoff:'producerHandoff',FxSource:'fxSource'}:{})},roleByName=new Map(Object.entries(bindings).map(([role,name])=>[name,role]));
 const starts={};try{visit(parse(source,{ecmaVersion:'latest'}),(node,parent)=>{if(node.type==='FunctionExpression'&&parent?.type==='AssignmentExpression'&&parent.left?.type==='MemberExpression'&&parent.left.object?.name==='globalThis'&&roleByName.has(parent.left.property?.name)){const kind=roleByName.get(parent.left.property.name);if(starts[kind]!==undefined)throw 0;starts[kind]=node.start;}});return makeReference(source,{fixture:true,version:'authored-'+fixtureVersion,roles,maxPrefix:32,starts,vmBinding:roles.vmBinding});}catch{throw new CurrentBoundPayloadInspectorError('INVALID_FIXTURE');}
}
function limits(options,reference){const maxHits=options.maxHits??2000,maxDurationMs=options.maxDurationMs??60000,observeOrigins=options.observeOrigins??false,observeProducers=options.observeProducers??false,observeEarlyProducers=options.observeEarlyProducers??false,maxProducerKeys=options.maxProducerKeys??1024,maxProducerAttempts=options.maxProducerAttempts??4096,sortIdentityRegistryKey=options.sortIdentityRegistryKey;if(typeof observeOrigins!=='boolean'||typeof observeProducers!=='boolean'||typeof observeEarlyProducers!=='boolean'||observeEarlyProducers&&(!observeProducers||!reference.bootstrapSite)||observeProducers&&!observeOrigins||!Number.isInteger(maxHits)||maxHits<1||maxHits>(observeProducers?20000:10000)||!Number.isInteger(maxDurationMs)||maxDurationMs<100||maxDurationMs>(observeEarlyProducers?420000:observeProducers?240000:120000)||!Number.isInteger(maxProducerKeys)||maxProducerKeys<1||maxProducerKeys>4096||!Number.isInteger(maxProducerAttempts)||maxProducerAttempts<1||maxProducerAttempts>(observeEarlyProducers?16000:10000))throw new CurrentBoundPayloadInspectorError('INVALID_OPTIONS');if(sortIdentityRegistryKey!==undefined&&(typeof sortIdentityRegistryKey!=='string'||!/^__synthid_sort_identity_[a-f0-9]{32}$/.test(sortIdentityRegistryKey)||!observeProducers||observeEarlyProducers||reference.roles!==NEXT_ROLES))throw new CurrentBoundPayloadInspectorError('INVALID_OPTIONS');return{maxHits,maxDurationMs,observeOrigins,observeProducers,observeEarlyProducers,maxProducerKeys,maxProducerAttempts,sortIdentityRegistryKey};}
function positions(source){const starts=[0];for(let i=0;i<source.length;i++)if(source.charCodeAt(i)===10)starts.push(i+1);return{location(offset,scriptId){let lo=0,hi=starts.length;while(lo+1<hi){const mid=(lo+hi)>>1;if(starts[mid]<=offset)lo=mid;else hi=mid;}return{scriptId,lineNumber:lo,columnNumber:offset-starts[lo]};},offset(loc){return loc&&Number.isInteger(loc.lineNumber)&&Number.isInteger(loc.columnNumber)&&loc.lineNumber>=0&&loc.lineNumber<starts.length?starts[loc.lineNumber]+loc.columnNumber:undefined;}};}
function makeHelper(settings){function makePayloadHelper(){
 'use strict';
 const own=Object.getOwnPropertyDescriptor,hasOwn=Object.hasOwn,isArray=Array.isArray,integer=Number.isSafeInteger,define=Object.defineProperty,ByteArray=Uint8Array,RawBuffer=ArrayBuffer,View=DataView,setFloat64=DataView.prototype.setFloat64,apply=Reflect.apply;
 const destinations=settings.destinations,tags=[10,12,15,27,104,126,127,153,250];
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
const own=Object.getOwnPropertyDescriptor,hasOwn=Object.hasOwn,proto=Object.getPrototypeOf,isArray=Array.isArray,integer=Number.isSafeInteger,apply=Reflect.apply,define=Object.defineProperty,Weak=WeakMap,Strong=Map,weakGet=WeakMap.prototype.get,weakSet=WeakMap.prototype.set,mapGet=Map.prototype.get,mapSet=Map.prototype.set,mapClear=Map.prototype.clear,charCode=String.prototype.charCodeAt;
let producerKeys=0,producerVMCount=0,producerTableCount=0,producerArrayKeys=0;const producerMaps=[],producerEpochs=[];
const epochStores=epoch=>{if(!integer(epoch)||epoch<0||epoch>=settings.maxProducerEpochs)throw 0;let stores=producerEpochs[epoch];if(!stores){stores={vms:new Weak(),arrays:new Weak()};producerEpochs[epoch]=stores;}return stores;};
const data=(object,key)=>{const d=own(object,key);if(!d||!hasOwn(d,'value'))throw 0;return d.value;};
const terminal=evidence=>{if(!evidence)return{classification:'unknown-no-observed-writer'};const result={classification:evidence.classification,writer:evidence.writer,writerRole:evidence.writerRole,caller:{...evidence.caller}};if(evidence.phase)result.phase=evidence.phase;if(integer(evidence.writerGeneration))result.writerGeneration=evidence.writerGeneration;if(integer(evidence.observationEpoch))result.observationEpoch=evidence.observationEpoch;if(evidence.input)result.input={...evidence.input};if(evidence.sortIdentity)result.sortIdentity={...evidence.sortIdentity};return result;};
return{payload:makePayloadHelper(),lookup(object,key){const d=own(object,key);if(!d)return{kind:'missing',value:null};if(!hasOwn(d,'value'))return{kind:'accessor',value:null};return{kind:typeof d.value==='function'?'function':'non-function',value:typeof d.value==='function'?d.value:null};},parent(object){return proto(object);},
 sortIdentityReceiverKind(receiver){try{return isArray(receiver)?'array':'non-array';}catch{return'unavailable';}},
 sortIdentityRegistry(){if(!settings.sortIdentityRegistryKey)return undefined;const d=own(globalThis,settings.sortIdentityRegistryKey);return d&&hasOwn(d,'value')?d.value:undefined;},
 sortIdentityQueryFunction(registry){const d=own(registry,'query');return d&&hasOwn(d,'value')&&typeof d.value==='function'?d.value:undefined;},
 sortIdentityQuery(registry,query,receiver){
  try{const publication=own(globalThis,settings.sortIdentityRegistryKey),method=own(registry,'query');if(!publication||!hasOwn(publication,'value')||publication.value!==registry||!method||!hasOwn(method,'value')||method.value!==query)return{classification:'sort-identity-registry-unavailable'};}catch{return{classification:'sort-identity-registry-unavailable'};}
  let reply;try{reply=apply(query,registry,[receiver]);}catch{return{classification:'sort-identity-query-failed'};}
  try{const classification=data(reply,'classification');if(classification==='observed-completed-sort-identity'){const realmKind=data(reply,'realmKind'),realmIndex=data(reply,'realmIndex'),callIndex=data(reply,'callIndex'),completedOrdinal=data(reply,'completedOrdinal'),numericOnly=data(reply,'numericOnly');if((realmKind!=='top'&&realmKind!=='sourced'&&realmKind!=='sourceless')||!integer(realmIndex)||realmIndex<0||realmIndex>31||!integer(callIndex)||callIndex<0||callIndex>31||!integer(completedOrdinal)||completedOrdinal<0||completedOrdinal>31||typeof numericOnly!=='boolean')throw 0;return{classification,realmKind,realmIndex,callIndex,completedOrdinal,numericOnly};}if((classification==='unknown-sort-identity'||classification==='sort-identity-disposed'||classification==='invalid-sort-identity-receiver'||classification==='sort-identity-incomplete'))return{classification};}catch{}
  return{classification:'invalid-sort-identity-response'};
 },
 producerTable(vm){const d=own(vm,settings.tableProperty);return d&&hasOwn(d,'value')?d.value:undefined;},
 producerArray(operation,object,evidence,remaining,epoch=0){
  if(!settings.observeDependencies)throw 0;
  const producerArrays=epochStores(epoch).arrays;
  if(operation==='read'){const prior=apply(weakGet,producerArrays,[object]);return prior?{classification:'observed-array-input-identity',producer:terminal(prior)}:{classification:'unknown-no-observed-array-input'};}
  if(operation!=='write')throw 0;const value=data(object,'arrayInput'),prior=apply(weakGet,producerArrays,[value]);if(!prior&&(remaining<=0||producerArrayKeys>=settings.maxProducerArrays))return{classification:'unknown-array-limit'};
  apply(weakSet,producerArrays,[value,terminal(evidence)]);if(!prior)producerArrayKeys++;return{classification:'array-input-recorded',newKey:!prior};
 },
 propertyInputKey(wrapper,arrayReceiver){
  const key=data(wrapper,'key');
  if(typeof key==='string'){
   if(key.length<=64){for(let i=0;i<settings.propertyKeys.length;i++)if(settings.propertyKeys[i]===key)return{classification:'standard-property',name:settings.propertyKeys[i]};
    if(arrayReceiver&&key.length>0&&key.length<=4&&(key.length===1||apply(charCode,key,[0])!==48)){let index=0;for(let i=0;i<key.length;i++){const digit=apply(charCode,key,[i])-48;if(digit<0||digit>9)return{classification:'unknown-key'};index=index*10+digit;}if(index<=1023)return{classification:'array-index',index};}
   }
   return{classification:'unknown-key'};
  }
  if(arrayReceiver&&typeof key==='number'&&integer(key)&&key>=0&&key<=1023)return{classification:'array-index',index:key===0?0:key};
  return{classification:key!==null&&(typeof key==='object'||typeof key==='function')?'unknown-object-key':'unknown-key'};
 },
 producer(operation,wrapper,table,evidence,remaining,epoch=0){
  if(operation==='clear'){const result={keysCleared:producerKeys,vmsCleared:producerVMCount,tablesCleared:producerTableCount};if(settings.observeDependencies)result.arrayKeysCleared=producerArrayKeys;for(let i=0;i<producerMaps.length;i++){apply(mapClear,producerMaps[i],[]);producerMaps[i]=null;}producerMaps.length=0;for(let i=0;i<producerEpochs.length;i++)producerEpochs[i]=null;producerEpochs.length=0;producerKeys=producerVMCount=producerTableCount=producerArrayKeys=0;return result;}
  const stores=epochStores(epoch),producerVMs=stores.vms,producerArrays=stores.arrays;
  const vm=data(wrapper,'vm'),selector=data(wrapper,'selector');if(typeof selector!=='number'||!integer(selector))return{classification:'unknown-selector'};
  let tables=apply(weakGet,producerVMs,[vm]),entries=tables&&apply(weakGet,tables,[table]),prior=entries&&apply(mapGet,entries,[selector]);
  if(operation==='read')return prior||{classification:'unknown-no-observed-writer'};
  if(operation==='read-terminal')return terminal(prior);
  if(operation!=='write')throw 0;if(!prior&&remaining<=0)return{classification:'unknown-key-limit'};
  if(!tables){tables=new Weak();apply(weakSet,producerVMs,[vm,tables]);producerVMCount++;}if(!entries){entries=new Strong();apply(weakSet,tables,[table,entries]);define(producerMaps,producerMaps.length,{value:entries,writable:true,configurable:true});producerTableCount++;}
  apply(mapSet,entries,[selector,evidence]);if(!prior)producerKeys++;const result={classification:'attempt-recorded',newKey:!prior};if(settings.observeDependencies){try{const value=data(wrapper,'arrayInput');if(!isArray(value))result.arrayInputKind='not-array';else if(apply(weakGet,producerArrays,[value])){apply(weakSet,producerArrays,[value,terminal(evidence)]);result.arrayInputKind='known-array';}else result.arrayInputKind='array-candidate';}catch{result.arrayInputKind='unavailable';}}return result;
 }
};}
function nodeTransport(){if(activeNode)throw new CurrentBoundPayloadInspectorError('ALREADY_ACTIVE');activeNode=true;const session=new Session();try{session.connect();}catch{activeNode=false;throw new CurrentBoundPayloadInspectorError('CONNECT_FAILED');}const listeners=[];return{kind:'node',sync:true,on(name,fn){const wrapped=({params})=>fn(params);session.on(name,wrapped);listeners.push([name,wrapped]);},send(method,params){let done=false,error,result;session.post(method,params,(e,r)=>{done=true;error=e;result=r;});if(!done||error)throw new CurrentBoundPayloadInspectorError('PROTOCOL_FAILED');return result;},close(){for(const[name,fn]of listeners)session.off(name,fn);session.disconnect();activeNode=false;}};}
function cdpTransport(cdp){if(!cdp||typeof cdp.send!=='function'||typeof cdp.on!=='function'||typeof cdp.off!=='function')throw new CurrentBoundPayloadInspectorError('INVALID_CDP');if(activeCDP.has(cdp))throw new CurrentBoundPayloadInspectorError('ALREADY_ACTIVE');activeCDP.add(cdp);const listeners=[];return{kind:'cdp',sync:false,on(name,fn){cdp.on(name,fn);listeners.push([name,fn]);},async send(method,params){let timer;try{return await Promise.race([Promise.resolve().then(()=>cdp.send(method,params)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new CurrentBoundPayloadInspectorError('PROTOCOL_TIMEOUT')),1500);})]);}catch{throw new CurrentBoundPayloadInspectorError('PROTOCOL_FAILED');}finally{clearTimeout(timer);}},close(){for(const[name,fn]of listeners)cdp.off(name,fn);activeCDP.delete(cdp);}};}
function runSync(iterator,transport){let op='next',value;while(true){const step=iterator[op](value);if(step.done)return step.value;try{value=transport.send(step.value.method,step.value.params);op='next';}catch(error){value=error;op='throw';}}}
async function runAsync(iterator,transport){let op='next',value;while(true){const step=iterator[op](value);if(step.done)return step.value;try{value=await transport.send(step.value.method,step.value.params);op='next';}catch(error){value=error;op='throw';}}}
async function createProbe(reference,options,transport){const {sortIdentityRegistryKey,...publicOptions}=options;
 const scriptLimit=options.observeEarlyProducers?65536:options.observeProducers?32768:MAX_SCRIPTS,originCallerSourceLimit=options.observeProducers?16:MAX_ORIGIN_CALLER_SOURCES;
 const state={diagnosticOnly:true,coverageOnly:true,fixture:reference.fixture,transport:transport.kind,sourceModified:false,prototypesModified:false,officialFunctionsInvoked:0,propertyGettersInvoked:0,unknownSourceBodiesRequested:false,candidateSourceRequests:0,payloadValuesRecorded:false,sourceRecorded:false,privateLocationsRecorded:false,protocolDescriptionsIgnored:true,phase:'init',scriptsObserved:0,scriptLimitReached:false,candidateScripts:0,candidateLimitReached:false,knownOuterCopies:0,knownEmbeddedCopies:0,knownCopiesByPhase:phaseCounts(),unmatchedCandidates:0,missingProtocolHashes:0,copyLimitReached:false,copies:[],pauses:0,instrumentationPauses:0,unexpectedPauses:0,wrapperHits:phaseCounts(),ffHits:phaseCounts(),wrapperInspections:0,inspectionLimitReached:false,methodIdentities:Object.fromEntries(METHODS.map(k=>[k,Object.fromEntries(CLASSES.map(v=>[v,0]))])),installedBreakpoints:0,removedBreakpoints:0,installedSetupBreakpoints:0,removedSetupBreakpoints:0,setupBreakpointHits:0,entryUnavailable:0,helperContexts:0,helperFailures:0,helperLimitReached:false,inspectionFailures:0,protocolErrors:0,limitReached:false,durationReached:false,disposed:false,...publicOptions};
 state.wrapperInspectionsByPhase=phaseCounts();state.methodIdentitiesByPhase=Object.fromEntries(PHASES.map(phase=>[phase,Object.fromEntries(METHODS.map(k=>[k,Object.fromEntries(CLASSES.map(v=>[v,0]))]))]));
 state.appendHits=Object.fromEntries(APPEND_BINDINGS.map(kind=>[kind,phaseCounts()]));state.appendBindingInspections=0;state.appendBindingInspectionsByPhase=phaseCounts();state.appendBindingIdentities=Object.fromEntries(APPEND_BINDINGS.map(kind=>[kind,Object.fromEntries(CLASSES.map(value=>[value,0]))]));state.appendBindingIdentitiesByPhase=Object.fromEntries(PHASES.map(phase=>[phase,Object.fromEntries(APPEND_BINDINGS.map(kind=>[kind,Object.fromEntries(CLASSES.map(value=>[value,0]))]))]));
 Object.assign(state,{coverageOnly:false,payloadValuesRecorded:true,publicBytesRecorded:false,captureEntries:0,entryInputsOnly:true,outputCommitmentObserved:false,privateParameterSourceAccess:true,privateSourcesRequested:0,privateSourcesParsed:0,parameterSourceLimitReached:false,parameterShapeFailures:0,targetLimitReached:false,targetChanges:0,boundTargets:0,boundTargetProvenance:{Nv:'unselected',Rk:'unselected'},boundParameterShapes:{Nv:'unselected',Rk:'unselected'},installedBoundBreakpoints:0,removedBoundBreakpoints:0,boundHits:{Nv:phaseCounts(),Rk:phaseCounts()},entryHits:0,siteHits:{Nv:0,Rk:0},capturedRecords:0,capturedBytes:0,capturedNumberInputs:0,privateScalarEncoding:'IEEE754-binary64-big-endian',groups:[],summaryLimitReached:false,recordLimitReached:false,byteLimitReached:false,skippedInputs:0,skips:Object.fromEntries(REASONS.map(reason=>[reason,0])),payloadsTaken:false,collectionClosed:false,contextsLost:0,clearCalls:0,clearedRecords:0,clearedBytes:0,clearFailures:0,inputProxyRefusals:0});
  Object.assign(state,{boundTargetSiteAliases:0,boundTargetRecheckFailures:0,captureEntriesByPhase:phaseCounts(),capturedRecordsByPhase:phaseCounts(),siblingClosureCallsPossible:true,exactCalleeIdentityVerified:false,comparisonScope:'selected-function-source-sites-after-wrapper-arming',instrumentationRemovedForDrain:false});
  Object.assign(state,{scriptLimit,originCallerSourceLimit,nv229Origins:[],boundPublicBodyMatches:{Nv:false,Rk:false},boundPublicHeaderMatches:{Nv:false,Rk:false},uniqueBoundSourceCount:0,originTupleCaptures:0,originCallerSourceRequests:0,originParseFailures:0,originProtocolErrors:0,originMetadataFailures:0,originCallsiteUnavailable:0,originCallerSourceLimitReached:false,originRecordLimitReached:false,originFrameLimit:4,originSourceRequestFrameLimit:2});
 Object.assign(state,{sourceVersion:reference.version,sourceMetadata:{outerLength:reference.outerLength??null,outerHash:reference.outerHash??null,embeddedLength:reference.length,embeddedHash:reference.hash},numericTuple:reference.roles.numericDestination===143?'Ok143Untagged':'Nv229Untagged',publicBindingNames:{...reference.roles.methods,...reference.roles.appendBindings,...reference.roles.producerBindings,Iq:reference.roles.serializer},publicMethods:{...reference.roles.methods},publicAppendBindings:{...reference.roles.appendBindings},publicProducerBindings:{...reference.roles.producerBindings},publicSerializer:reference.roles.serializer,storageProperty:reference.roles.tableProperty,numericAppendTuple:{site:'Nv',publicBinding:reference.roles.appendBindings.Nv,destination:reference.roles.numericDestination,tagPresent:false,inputKind:'array'}});
 const inputState=state.producerInputDiagnostics={enabled:options.observeProducers&&!!reference.inputSite,scope:'next-generic-property-caller',receiverEvidence:'protocol-metadata-only',propertyResultRead:false,propertyResultReadScope:'selected-key-and-receiver-observation',privateKeyValuesRetained:false,candidates:0,captures:0,standardKeys:0,arrayIndices:0,unknownKeys:0,proxyReceivers:0,headerMismatches:0,callsiteMismatches:0,protocolErrors:0,captureFailures:0};
 const sortIdentityState=state.producerSortIdentityDiagnostics={enabled:typeof sortIdentityRegistryKey==='string',scope:'verified-Array[0]-receiver-to-completed-sort',identityOnly:true,arrayElementsRead:false,arraysMayMutate:true,originEstablished:false,causalRelevanceEstablished:false,protocolArrayCandidates:0,nonArrayReceivers:0,receiverClassificationFailures:0,candidates:0,queries:0,matches:0,unknowns:0,registryLookups:0,registryUnavailable:0,registryDisposed:0,registryIncomplete:0,invalidResponses:0,queryFailures:0,protocolErrors:0};const sortIdentityRegistries=new Map();
 const fxState=state.producerFxDiagnostics={enabled:options.observeProducers&&!!reference.fxSite,scope:'snapshot-Rk-Fx-source',sourcePolicy:'verified-public-or-indexed-including-bounded-Rk-caller',sourceReadStorageIdentityVerified:false,outputCommitmentObserved:false,sourceSiteSiblingClosuresPossible:true,additionalSourceRequests:0,maximumRows:MAX_RECORDS,arrayCaptures:0,rows:0,fxBodyMatches:0,verifiedFxCallers:0,nonFxRows:0,uncachedCallerRows:0,unmatchedCallerRows:0,metadataFailures:0,headerMismatches:0,callsiteMismatches:0,coverageRefusals:0,queries:0,matches:0,unknowns:0,vmProxyRefusals:0,tableProxyRefusals:0,storageRefusals:0,selectorRefusals:0,queryFailures:0,invalidReplies:0,protocolErrors:0,contextsLost:0,orderFailures:0,phaseChanges:0,cleanupFailures:0,recordLimitReached:false,privateOrderReferencesCleared:false};
 const fxOrder=state.snapshotRkArrayOrder={scope:'all-snapshot-Rk-array-inputs',ordering:'single-bound-Rk-helper-capture-order',zeroBased:true,count:0,rowCount:0,boundDefinitionStable:true,contextStable:true,helperStable:true,contextVerified:false,phaseStable:true,contiguousOrdinals:true,drainObserved:false,drainedCount:0,drainComplete:false};state.snapshotRkArrayOrigins=[];let fxDefinition=null,fxContextId=null,fxHelperId=null,phaseGeneration=0;
 const rkCallerState=state.rkCallerDiagnostics={enabled:fxState.enabled,scope:'snapshot-Rk-immediate-caller',sourcePolicy:'verified-public-or-already-indexed-plus-ordinal-0',targetOrdinal:0,maximumAdditionalSourceRequests:1,maximumSourceUnits:MAX_SOURCE_UNITS,maximumSourceBytes:MAX_ORIGIN_SOURCE_BYTES,maximumRows:MAX_RECORDS,sourceSiteSiblingClosuresPossible:true,fieldMeaningEstablished:false,rows:0,targetRows:0,matches:0,unknowns:0,publicMatches:0,recompiledMatches:0,publicIndexBuilds:0,cacheHits:0,localCacheHits:0,additionalSourceRequests:0,sourceResponses:0,sourceIndexes:0,policyRefusals:0,cachedUnknowns:0,bodyMismatches:0,headerMismatches:0,callsiteMismatches:0,metadataFailures:0,sourceLimitRefusals:0,parseFailures:0,protocolErrors:0,unexpectedFailures:0,localEntriesHeld:0,localEntriesCleared:0,privateCacheCleared:false,sourceLimitReached:false};const rkCallerSources=new Map();
 const dependencyState=state.producerDependencyDiagnostics={enabled:options.observeProducers&&!!reference.inputSite&&!!reference.additionSite,scope:'next-array-input-identity-and-addition',completedInputObservation:'nonproxy-array-identity-only',numericMeasurementRead:false,arrayElementsRead:false,primitiveInputValuesExported:false,dependenciesCopied:'terminal-only',sourceReadStorageIdentityVerified:false,maxArrays:MAX_PRODUCER_ARRAYS,arrayInputClassifications:0,arrayCandidates:0,arrayCaptures:0,arrayProxyRefusals:0,arrayKeysHeld:0,arrayDistinctInputs:0,arrayKeysCleared:0,arrayClearCalls:0,arrayQueries:0,arrayMatches:0,arrayUnknowns:0,arrayClassificationFailures:0,arrayCaptureFailures:0,arrayQueryFailures:0,arrayKeyLimitReached:false,additionCandidates:0,additionCaptures:0,additionMatchedEdges:0,additionUnknownEdges:0,additionHeaderMismatches:0,additionCallsiteMismatches:0,additionCaptureFailures:0,additionSelectorRefusals:0,vmProxyRefusals:0,tableProxyRefusals:0,storageRefusals:0,protocolErrors:0,clearFailures:0,contextsLost:0};
 const producerState=state.producerDiagnostics={enabled:options.observeProducers,scope:'snapshot-after-wrapper-arming',initialProvenance:'unknown-before-arming',entryInputsOnly:true,outputCommitmentObserved:false,storageIdentity:'vm-and-current-own-data-'+reference.roles.tableProperty,sourceReadStorageIdentityVerified:false,sourceSiteSiblingClosuresPossible:true,selectorValuesExported:false,slotValuesRead:false,targets:0,bindingInspections:0,bindingFailures:0,bodyMismatches:0,headerMismatches:0,targetChanges:0,targetSiteAliases:0,installedBreakpoints:0,removedBreakpoints:0,hits:Object.fromEntries(PRODUCER_BINDINGS.map(kind=>[kind,phaseCounts()])),attempts:0,recordedAttempts:0,keysHeld:0,joins:0,matchedJoins:0,unknownJoins:0,vmProxyRefusals:0,tableProxyRefusals:0,storageRefusals:0,selectorRefusals:0,keyLimitReached:false,attemptLimitReached:false,sourceLimitReached:false,sourceRequests:0,callerSourceRequests:0,parseFailures:0,protocolErrors:0,captureFailures:0,joinFailures:0,clearCalls:0,keysCleared:0,clearedVMs:0,clearedTables:0,clearFailures:0,contextsLost:0,collectionClosed:false};
 const earlyState=state.producerEarlyDiagnostics={enabled:options.observeEarlyProducers,scope:'reviewed-G2-first-statement-before-table-initialization',initialHistoryRecovered:false,tableValuesRead:false,tableHistoryTransferred:false,candidates:0,installedBreakpoints:0,removedBreakpoints:0,hits:0,attempts:0,successes:0,preWrapperSuccesses:0,unrequestedEarlyCallers:0,failures:0,phases:phaseCounts(),unavailableLocations:0,frameMismatches:0,locationMismatches:0,bodyMismatches:0,headerMismatches:0,bindingFailures:0,targetChanges:0,targetSiteAliases:0,helperFailures:0,protocolErrors:0,removeFailures:0,wrapperRechecks:0,wrapperRecheckSuccesses:0,wrapperRecheckFailures:0};
 const relationCounts=()=>Object.fromEntries(['same','different','unavailable'].map(name=>[name,0]));
 const recheckState=state.producerRecheckDiagnostics={enabled:options.observeProducers,checks:0,identityEqual:0,identityUnequal:0,identityExceptions:0,identityUnavailable:0,protocolErrors:0,metadataFailures:0,bodyMismatches:0,headerMismatches:0,byRole:Object.fromEntries(PRODUCER_BINDINGS.map(kind=>[kind,{checks:0,identity:{equal:0,unequal:0,exception:0,unavailable:0},context:relationCounts(),script:relationCounts(),body:relationCounts(),header:relationCounts()}]))};
 const handoffState=state.producerHandoffDiagnostics={enabled:options.observeEarlyProducers&&!!reference.handoffSite,scope:'verified-post-eval-old-Y-entry',evalInteriorWritesObserved:false,unobservedGeneratedHandlersPossible:true,historyScope:'current-observation-epoch-only',maxTargets:MAX_PRODUCER_TARGETS,maxEpochs:MAX_PRODUCER_EPOCHS,attempts:0,successes:0,failures:0,replacements:0,unchanged:0,epochsStarted:0,selectedGeneration:0,currentEpoch:0,retainedTargets:0,retainedReuses:0,retainedIdentityExceptions:0,retainedIdentityUnavailable:0,targetLimitReached:false,epochLimitReached:false,bindingFailures:0,bodyMismatches:0,headerMismatches:0,targetChanges:0,targetSiteAliases:0,protocolErrors:0,phases:phaseCounts()};
 Object.assign(producerState,{attemptsByPhase:phaseCounts(),recordedAttemptsByPhase:phaseCounts(),bindingInspectionsByPhase:phaseCounts()});if(options.observeEarlyProducers)producerState.scope='after-observed-bootstrap-or-snapshot-fallback';
  const group='current-source-coverage-'+randomUUID(),helperGroup=group+'-helpers';
 const targetGroup=group+'-bound-targets',boundTargets=new Map(),boundBreakpoints=new Map(),privateSources=new Set(),capturedContexts=new Set(),clearedHelpers=new Set();let privateSourceBytes=0;
 const originSources=new Map(),originCallerSources=new Set(),originBoundSources=new Set(),originOrdinals=new Map(),originOccurrenceCounts=Object.fromEntries(PHASES.map(phase=>[phase,{array:0}]));let originSourceBytes=0,publicOriginFunctions=[],publicOriginCalls=[],publicBodyIndex=new Map();
 const producerTargets=new Map(),producerAllTargets=new Set(),producerBreakpoints=new Map(),bootstrapBreakpoints=new Map(),producerSources=new Map(),producerSourceRequests=new Set(),producerContexts=new Set(),producerClearedHelpers=new Set();let producerSourceBytes=0;
 if(options.observeOrigins){try{let nodes=0;visit(parse(reference.source,{ecmaVersion:'latest'}),node=>{if(++nodes>MAX_PARSE_NODES)throw 0;if(node.type==='CallExpression')publicOriginCalls.push({start:node.start,end:node.end});if(!['FunctionExpression','FunctionDeclaration','ArrowFunctionExpression'].includes(node.type))return;const item={start:node.start,end:node.end,bodyStart:node.body.start,bodyEnd:node.body.end,params:node.params.every(p=>p.type==='Identifier')?node.params.map(p=>p.name):null,async:node.async,generator:node.generator,arrow:node.type==='ArrowFunctionExpression'};publicOriginFunctions.push(item);const body=reference.source.slice(item.bodyStart,item.bodyEnd),key=sha(body);if(!publicBodyIndex.has(key))publicBodyIndex.set(key,[]);publicBodyIndex.get(key).push(item);});}catch{state.originParseFailures++;publicOriginFunctions=[];publicOriginCalls=[];publicBodyIndex.clear();}}
 const metadata=new Map(),copies=new Map(),checked=new Set(),helpers=new Map(),breakpoints=new Map(),setupBreakpoints=new Map(),hashes=new Map();
 let accepting=true,armed=false,runtimeEnabled=false,debuggerEnabled=false,instrumentationId=null,queue=Promise.resolve(),timer,cleanupStarted=false;
 const command=(method,params={})=>({method,params});
 const dispatch=iterator=>{if(transport.sync){try{return runSync(iterator,transport);}catch{state.protocolErrors++;return undefined;}}queue=queue.then(()=>runAsync(iterator,transport)).catch(()=>{state.protocolErrors++;});return queue;};
 function* helper(contextId){if(!accepting||helpers.has(contextId))return;if(helpers.size>=MAX_CONTEXTS){state.helperLimitReached=true;return;}try{const r=yield command('Runtime.evaluate',{contextId,expression:'('+makeHelper.toString()+')('+JSON.stringify({destinations:reference.roles.destinations,tableProperty:reference.roles.tableProperty,propertyKeys:reference.inputSite?PROPERTY_INPUT_KEYS:[],observeDependencies:dependencyState.enabled,maxProducerArrays:MAX_PRODUCER_ARRAYS,maxProducerEpochs:MAX_PRODUCER_EPOCHS,sortIdentityRegistryKey})+')',objectGroup:helperGroup,returnByValue:false,generatePreview:false,silent:true,disableBreaks:true,userGesture:false});if(r.exceptionDetails||!r.result?.objectId)throw 0;helpers.set(contextId,r.result.objectId);state.helperContexts++;}catch{state.helperFailures++;}}
 function* inspectScript(params){
  if(!accepting||checked.has(params.scriptId))return;
  const prefix=params.length-reference.length,possibleEmbedded=Number.isInteger(prefix)&&prefix>=0&&prefix<=reference.maxPrefix,possibleOuter=reference.outerHash&&params.length===reference.outerLength;
  if(!possibleEmbedded&&!possibleOuter)return;checked.add(params.scriptId);
  if(state.candidateScripts>=MAX_CANDIDATES){state.candidateLimitReached=true;return;}state.candidateScripts++;
  if(typeof params.hash!=='string'||params.hash.length!==64){state.missingProtocolHashes++;return;}
  if(possibleOuter&&params.hash===reference.outerHash){state.knownOuterCopies++;const meta=metadata.get(params.scriptId);if(meta)meta.known=true;if(!transport.sync&&!armed)yield*helper(params.executionContextId);return;}
  if(!possibleEmbedded){state.unmatchedCandidates++;return;}
  let expected=hashes.get(prefix);if(!expected){expected=sha(String.fromCharCode(10).repeat(prefix)+reference.source);hashes.set(prefix,expected);}
  if(params.hash!==expected){state.unmatchedCandidates++;return;}
  if(copies.size>=MAX_COPIES){state.copyLimitReached=true;return;}
  const mapped=positions(String.fromCharCode(10).repeat(prefix)+reference.source),publicCopy={copyIndex:copies.size,discoveredPhase:state.phase,wrapperHits:phaseCounts(),ffHits:phaseCounts(),appendHits:Object.fromEntries(APPEND_BINDINGS.map(kind=>[kind,phaseCounts()])),wrapperInspections:0};
  const copy={scriptId:params.scriptId,contextId:params.executionContextId,prefix,mapped,summary:publicCopy};copies.set(params.scriptId,copy);state.copies.push(publicCopy);state.knownEmbeddedCopies++;state.knownCopiesByPhase[state.phase]++;const meta=metadata.get(params.scriptId);if(meta)meta.known=true;
  if(!transport.sync&&!armed)yield*helper(params.executionContextId);
  let installed=0;
  for(const kind of MEASURED_SITES){const site=reference.sites[kind];try{const choices=(yield command('Debugger.getPossibleBreakpoints',{start:mapped.location(prefix+site.firstStart,params.scriptId),end:mapped.location(prefix+site.firstEnd,params.scriptId),restrictToFunction:true})).locations||[];const location=choices.filter(l=>l.scriptId===params.scriptId&&mapped.offset(l)>=prefix+site.firstStart&&mapped.offset(l)<prefix+site.firstEnd).sort((a,b)=>mapped.offset(a)-mapped.offset(b))[0];if(!location){state.entryUnavailable++;continue;}const result=yield command('Debugger.setBreakpoint',{location});if(!result.breakpointId)throw 0;breakpoints.set(result.breakpointId,{kind,copy});state.installedBreakpoints++;if(result.actualLocation?.scriptId!==params.scriptId||mapped.offset(result.actualLocation)!==mapped.offset(location)){try{yield command('Debugger.removeBreakpoint',{breakpointId:result.breakpointId});breakpoints.delete(result.breakpointId);state.removedBreakpoints++;}catch{state.protocolErrors++;}throw 0;}installed++;}catch{state.entryUnavailable++;}}
  if(!transport.sync&&!helpers.has(params.executionContextId)&&installed===MEASURED_SITES.length){try{const choices=(yield command('Debugger.getPossibleBreakpoints',{start:mapped.location(prefix,params.scriptId),end:mapped.location(prefix+reference.sites.wrapper.firstStart,params.scriptId),restrictToFunction:false})).locations||[];const location=choices.filter(l=>l.scriptId===params.scriptId&&mapped.offset(l)>=prefix&&mapped.offset(l)<prefix+reference.sites.wrapper.firstStart).sort((a,b)=>mapped.offset(a)-mapped.offset(b))[0];if(!location)throw 0;const result=yield command('Debugger.setBreakpoint',{location});if(!result.breakpointId)throw 0;setupBreakpoints.set(result.breakpointId,params.executionContextId);state.installedSetupBreakpoints++;if(result.actualLocation?.scriptId!==params.scriptId||mapped.offset(result.actualLocation)!==mapped.offset(location)){try{yield command('Debugger.removeBreakpoint',{breakpointId:result.breakpointId});setupBreakpoints.delete(result.breakpointId);state.removedSetupBreakpoints++;}catch{state.protocolErrors++;}throw 0;}}catch{state.helperFailures++;}}
  yield*installBootstrap(copy);
 }
 function* installBootstrap(copy){
  if(!earlyState.enabled||state.collectionClosed||producerState.collectionClosed)return;earlyState.candidates++;const site=reference.bootstrapSite,{mapped,prefix,scriptId}=copy;
  try{const choices=(yield command('Debugger.getPossibleBreakpoints',{start:mapped.location(prefix+site.firstStart,scriptId),end:mapped.location(prefix+site.firstEnd,scriptId),restrictToFunction:true})).locations||[],location=choices.filter(item=>item.scriptId===scriptId&&mapped.offset(item)>=prefix+site.firstStart&&mapped.offset(item)<prefix+site.firstEnd&&mapped.offset(item)<prefix+site.tableInitStart).sort((a,b)=>mapped.offset(a)-mapped.offset(b))[0];
   if(!location){earlyState.unavailableLocations++;return;}const reply=yield command('Debugger.setBreakpoint',{location});if(typeof reply.breakpointId!=='string')throw 0;bootstrapBreakpoints.set(reply.breakpointId,{copy,offset:mapped.offset(location)});earlyState.installedBreakpoints++;
   if(reply.actualLocation?.scriptId!==scriptId||mapped.offset(reply.actualLocation)!==mapped.offset(location)){earlyState.locationMismatches++;yield*removeBootstrap(reply.breakpointId);}
  }catch{earlyState.protocolErrors++;state.protocolErrors++;}
 }
 function* removeBootstrap(id){if(!bootstrapBreakpoints.has(id))return;try{yield command('Debugger.removeBreakpoint',{breakpointId:id});bootstrapBreakpoints.delete(id);earlyState.removedBreakpoints++;}catch{earlyState.removeFailures++;earlyState.protocolErrors++;state.protocolErrors++;}}
 function* closeBootstrapCollection(){for(const id of [...bootstrapBreakpoints.keys()])yield*removeBootstrap(id);}
 function* observeBootstrap(frame,definition,id){
  earlyState.hits++;earlyState.attempts++;earlyState.phases[state.phase]++;const {copy,offset}=definition,site=reference.bootstrapSite;let success=false;
  try{yield*removeBootstrap(id);if(bootstrapBreakpoints.has(id))return;
   if(frame?.functionLocation?.scriptId!==copy.scriptId||frame?.location?.scriptId!==copy.scriptId||copy.mapped.offset(frame.functionLocation)!==copy.prefix+site.functionLocation){earlyState.frameMismatches++;return;}
   const current=copy.mapped.offset(frame.location);if(current!==offset||current<copy.prefix+site.firstStart||current>=copy.prefix+site.firstEnd||current>=copy.prefix+site.tableInitStart){earlyState.locationMismatches++;return;}
   const match=yield*producerMatch(frame);if(!match||match.publicStart!==site.start){earlyState.bodyMismatches++;return;}if(!match.headerMatch){earlyState.headerMismatches++;return;}
   yield*helper(copy.contextId);if(!helpers.has(copy.contextId)){earlyState.helperFailures++;return;}
   success=yield*inspectProducerBindings(frame,copy,true);if(success){earlyState.successes++;if(state.wrapperHits.snapshot===0&&[...producerTargets.values()].every(target=>target.armedBy==='bootstrap'))earlyState.preWrapperSuccesses++;}
  }catch{earlyState.protocolErrors++;state.protocolErrors++;}finally{if(!success)earlyState.failures++;}
 }
 function descendant(scriptId){const seen=new Set(),todo=[[scriptId,0]];while(todo.length){const[id,depth]=todo.pop();if(seen.has(id)||depth>8)continue;seen.add(id);const item=metadata.get(id);if(item?.known)return true;for(const parent of item?.parents||[])todo.push([parent,depth+1]);}return false;}
 function classify(location,kind,copy){if(!location||typeof location.scriptId!=='string'||!Number.isInteger(location.lineNumber)||!Number.isInteger(location.columnNumber))return'location-unavailable';const other=copies.get(location.scriptId);if(other){if(other.mapped.offset(location)!==other.prefix+reference.sites[kind].functionLocation)return'other-public-site';return other===copy?'same-copy':'other-public-copy';}return descendant(location.scriptId)?'generated-descendant':'unattributed';}
 function* functionMetadata(value,kind,copy){
  if(value?.subtype==='proxy')return{identity:'proxy'};if(value?.type!=='function')return{identity:'non-function'};if(!value.objectId)return{identity:'location-unavailable'};
  // Consume only the internal location; ignore ordinary descriptors and descriptions.
  const properties=yield command('Runtime.getProperties',{objectId:value.objectId,ownProperties:true,generatePreview:false});if(properties.exceptionDetails)throw 0;const location=properties.internalProperties?.find(v=>v.name==='[[FunctionLocation]]')?.value?.value;return{identity:classify(location,kind,copy),location};
 }
 function* functionIdentity(value,kind,copy){return(yield*functionMetadata(value,kind,copy)).identity;}
 function* inspectAppendBindings(frame,copy){
  state.appendBindingInspections++;state.appendBindingInspectionsByPhase[state.phase]++;
  for(const kind of APPEND_BINDINGS){let identity;try{const result=yield command('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:reference.roles.appendBindings[kind],objectGroup:targetGroup,returnByValue:false,generatePreview:false,silent:true,throwOnSideEffect:true});if(result.exceptionDetails){identity='binding-unavailable';if(!state.collectionClosed&&boundTargets.has(kind))state.boundTargetRecheckFailures++;}else{const info=yield*functionMetadata(result.result,kind,copy);identity=info.identity;yield*selectBoundTarget(result.result,info,kind,copy);}}catch{identity='protocol-failure';state.inspectionFailures++;}state.appendBindingIdentities[kind][identity]++;state.appendBindingIdentitiesByPhase[state.phase][kind][identity]++;}
 }
 function parseParameterShape(source,location,kind){
  let ast,tokens=[];const mapped=positions(source),offset=mapped.offset(location),matches=[];let nodes=0;
  try{
   ast=parse(source,{ecmaVersion:'latest',onToken(token){if(tokens.length>=MAX_PARSE_NODES)throw 0;tokens.push(token);}});
   visit(ast,(node,parent)=>{
    if(++nodes>MAX_PARSE_NODES)throw 0;
    if(!['FunctionExpression','FunctionDeclaration','ArrowFunctionExpression'].includes(node.type))return;
    const arrow=node.type==='ArrowFunctionExpression';let start;
    if(arrow)start=node.start;
    else{const head=tokens.find(token=>token.start===node.start);if(head?.type.label!=='function')return;start=tokens.find(token=>token.start>=node.start&&token.start<node.body.start&&token.type.label==='(')?.start;}
    if(start!==offset)return;
    const roles=reference.roles.appendParameters[kind],required=Math.max(roles.input,roles.destination,roles.tag)+1;
    if(node.async||node.generator||parent?.method||parent?.type==='MethodDefinition'||parent?.type==='Property'&&parent.kind!=='init'||node.params.length<required||node.params.some(param=>param.type!=='Identifier')||new Set(node.params.map(param=>param.name)).size!==node.params.length){matches.push(null);return;}
    const selected=new Set([node.params[roles.input].name,node.params[roles.destination].name,node.params[roles.tag].name]);let shadowed=false;
    const bindsSelected=pattern=>{if(!pattern||typeof pattern!=='object')return false;if(pattern.type==='Identifier')return selected.has(pattern.name);return Object.entries(pattern).some(([key,value])=>key!=='key'&&(Array.isArray(value)?value.some(bindsSelected):bindsSelected(value)));};
    const pending=[node.body];while(pending.length){const part=pending.pop();if(!part||typeof part!=='object')continue;if(part.type==='FunctionDeclaration'){if(selected.has(part.id?.name))shadowed=true;continue;}if(part.type==='FunctionExpression'||part.type==='ArrowFunctionExpression')continue;if(part.type==='VariableDeclaration'&&part.kind!=='var'&&part.declarations.some(item=>bindsSelected(item.id))||part.type==='CatchClause'&&bindsSelected(part.param)||part.type==='ClassDeclaration'&&selected.has(part.id?.name))shadowed=true;for(const value of Object.values(part))if(Array.isArray(value))pending.push(...value);else if(value&&typeof value==='object')pending.push(value);}
    if(shadowed){matches.push(null);return;}
    const expectedParams=reference.sites[kind].params,headerMatch=!arrow&&Array.isArray(expectedParams)&&node.params.length===expectedParams.length&&node.params.every((param,index)=>param.name===expectedParams[index]);
    matches.push({input:node.params[roles.input].name,destination:node.params[roles.destination].name,tag:node.params[roles.tag].name,shape:arrow?'arrow-identifiers':'function-identifiers',start:node.start,end:node.end,bodyStart:node.body.start,bodyEnd:node.body.end,headerMatch,mapped});
   });
   if(matches.length!==1||!matches[0])return null;return matches[0];
  }finally{ast=null;tokens.length=0;tokens=null;}
 }
 function* selectBoundTarget(value,info,kind,copy){
  if(state.collectionClosed)return;
  let retain=false,source='',shape;
  try{
   if(!value?.objectId||value.subtype==='proxy'||value.type!=='function'||!info.location){if(boundTargets.has(kind))state.boundTargetRecheckFailures++;return;}
   const prior=boundTargets.get(kind);
   if(prior){const same=yield command('Runtime.callFunctionOn',{objectId:prior.objectId,functionDeclaration:'function(other){return this===other}',arguments:[{objectId:value.objectId}],returnByValue:true,generatePreview:false,silent:true});if(same.exceptionDetails)throw 0;if(same.result?.value!==true)state.targetChanges++;return;}
   if([...boundTargets.values()].some(target=>target.scriptId===info.location.scriptId&&target.shape.functionOffset===target.shape.mapped.offset(info.location))){state.boundTargetSiteAliases++;return;}
   if(boundTargets.size>=2){state.targetLimitReached=true;return;}
   const original=copies.get(info.location.scriptId);
   if(original&&(info.identity==='same-copy'||info.identity==='other-public-copy'))source=String.fromCharCode(10).repeat(original.prefix)+reference.source;
   else if(info.identity==='generated-descendant'||reference.fixture&&info.identity==='unattributed'){
    const meta=metadata.get(info.location.scriptId);
    if(state.privateSourcesRequested>=MAX_PRIVATE_SOURCES||!Number.isInteger(meta?.length)||meta.length<1||meta.length>MAX_SOURCE_UNITS){state.parameterSourceLimitReached=true;return;}
    state.privateSourcesRequested++;state.unknownSourceBodiesRequested=true;privateSources.add(info.location.scriptId);
    source=(yield command('Debugger.getScriptSource',{scriptId:info.location.scriptId})).scriptSource;
    if(typeof source!=='string'||source.length!==meta.length||source.length>MAX_SOURCE_UNITS||Buffer.byteLength(source,'utf8')>MAX_SOURCE_BYTES-privateSourceBytes){state.parameterSourceLimitReached=true;return;}
    privateSourceBytes+=Buffer.byteLength(source,'utf8');
   }else return;
   shape=parseParameterShape(source,info.location,kind);if(!shape){state.parameterShapeFailures++;return;}shape.functionOffset=shape.mapped.offset(info.location);if(!original)state.privateSourcesParsed++;
   if(options.observeOrigins){try{const publicSite=reference.sites[kind];state.boundPublicBodyMatches[kind]=source.slice(shape.bodyStart,shape.bodyEnd)===reference.source.slice(publicSite.bodyStart,publicSite.bodyEnd);state.boundPublicHeaderMatches[kind]=shape.headerMatch;originBoundSources.add(info.location.scriptId);state.uniqueBoundSourceCount=originBoundSources.size;if(!original&&!originSources.has(info.location.scriptId))indexOriginSource(info.location.scriptId,source);}catch{state.originParseFailures++;}}
   if(options.observeProducers&&(!shape.headerMatch||!state.boundPublicBodyMatches[kind])){state.parameterShapeFailures++;return;}
   const installed=yield command('Debugger.setBreakpointOnFunctionCall',{objectId:value.objectId});if(typeof installed.breakpointId!=='string')throw 0;
   const definition={kind,objectId:value.objectId,scriptId:info.location.scriptId,contextId:metadata.get(info.location.scriptId)?.executionContextId??copy.contextId,shape};
   boundBreakpoints.set(installed.breakpointId,definition);state.installedBoundBreakpoints++;boundTargets.set(kind,definition);state.boundTargets++;state.boundTargetProvenance[kind]=info.identity;state.boundParameterShapes[kind]=shape.shape;retain=true;
  }catch{state.parameterShapeFailures++;}
  finally{source='';if(!retain&&value?.objectId)try{yield command('Runtime.releaseObject',{objectId:value.objectId});}catch{state.protocolErrors++;}}
 }
 function retainSummary(summary,site,phase){
  const record={site,phase,inputType:TYPES.includes(summary.inputType)?summary.inputType:'unknown',destinationType:TYPES.includes(summary.destinationType)?summary.destinationType:'unknown',destination:summary.destinationKnown&&reference.roles.destinations.includes(summary.destination)?summary.destination:'unknown',tagPresent:summary.tagPresent===true,tagType:TYPES.includes(summary.tagType)?summary.tagType:'unknown',tag:summary.tagKnown&&TAGS.includes(summary.tag)?summary.tag:'unknown'};
  const key=JSON.stringify(record);let summaryGroup=state.groups.find(item=>JSON.stringify(Object.fromEntries(Object.keys(record).map(name=>[name,item[name]])))===key);
  if(!summaryGroup){if(state.groups.length>=MAX_RECORDS){state.summaryLimitReached=true;return;}summaryGroup={...record,entries:0,captured:0,skipped:0,totalBytes:0,minLength:null,maxLength:null};state.groups.push(summaryGroup);}
  summaryGroup.entries++;if(summary.captured){summaryGroup.captured++;summaryGroup.totalBytes+=summary.length;}else summaryGroup.skipped++;
  if(Number.isSafeInteger(summary.length)&&summary.length>=0){summaryGroup.minLength=summaryGroup.minLength===null?summary.length:Math.min(summaryGroup.minLength,summary.length);summaryGroup.maxLength=summaryGroup.maxLength===null?summary.length:Math.max(summaryGroup.maxLength,summary.length);}
 }
 function indexOriginSource(scriptId,source,cache=originSources){
  // Retain only mappings that exactly match a known public function body.
  // Unknown body strings, tokens, nodes and unmatched ranges are discarded.
  let ast,tokens=[];const matches=new Map(),mapped=positions(source);let nodes=0;
  cache.set(scriptId,null);
  try{
   ast=parse(source,{ecmaVersion:'latest',onToken(token){if(tokens.length>=MAX_PARSE_NODES)throw 0;tokens.push(token);}});
   visit(ast,node=>{
    if(++nodes>MAX_PARSE_NODES)throw 0;if(!['FunctionExpression','FunctionDeclaration','ArrowFunctionExpression'].includes(node.type))return;
    const body=source.slice(node.body.start,node.body.end),candidates=(publicBodyIndex.get(sha(body))||[]).filter(item=>reference.source.slice(item.bodyStart,item.bodyEnd)===body);
    if(candidates.length!==1)return;
    const functionOffset=node.type==='ArrowFunctionExpression'?node.start:tokens.find(token=>token.start>=node.start&&token.start<node.body.start&&token.type.label==='(')?.start;
    if(!Number.isInteger(functionOffset))return;
    if(matches.has(functionOffset)){matches.set(functionOffset,null);return;}
    const candidate=candidates[0],headerMatch=Array.isArray(candidate.params)&&!node.async&&!node.generator&&!candidate.async&&!candidate.generator&&(node.type==='ArrowFunctionExpression')===candidate.arrow&&node.params.length===candidate.params.length&&node.params.every((p,i)=>p.type==='Identifier'&&p.name===candidate.params[i]);
    matches.set(functionOffset,{bodyStart:node.body.start,bodyEnd:node.body.end,publicStart:candidate.start,publicBodyStart:candidate.bodyStart,headerMatch});
   });
   cache.set(scriptId,{mapped,matches});
  }finally{ast=null;tokens.length=0;tokens=null;}
 }
 function* mapOriginCaller(frame,depth){
  const scriptId=frame?.location?.scriptId;
  if(typeof scriptId!=='string'){state.originMetadataFailures++;return{depth,classification:'unavailable'};}
  if(!originOrdinals.has(scriptId))originOrdinals.set(scriptId,originOrdinals.size);
  const unknown={depth,classification:'unknown',sourceOrdinal:originOrdinals.get(scriptId)},original=copies.get(scriptId);
  if(original){
   const offset=original.mapped.offset(frame.location)-original.prefix;
   if(!Number.isInteger(offset)||offset<0||offset>=reference.length){state.originMetadataFailures++;return unknown;}
   const containing=publicOriginFunctions.filter(item=>offset>=item.start&&offset<item.end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
   const call=publicOriginCalls.filter(item=>offset>=item.start&&offset<item.end&&(!containing||item.start>=containing.start&&item.end<=containing.end)).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];if(!call)state.originCallsiteUnavailable++;
   return containing?{depth,classification:'public',publicFunctionStart:containing.start,publicCallOffset:call?.start??null}:{depth,classification:'public-script',publicCallOffset:call?.start??null};
  }
  if(!originSources.has(scriptId)&&depth<=2){
   if(originCallerSources.size>=originCallerSourceLimit){state.originCallerSourceLimitReached=true;return unknown;}
   const meta=metadata.get(scriptId);
   if(!Number.isInteger(meta?.length)||meta.length<1){state.originMetadataFailures++;originSources.set(scriptId,null);return unknown;}
   if(meta.length>MAX_SOURCE_UNITS){state.originCallerSourceLimitReached=true;originSources.set(scriptId,null);return unknown;}
   originCallerSources.add(scriptId);state.originCallerSourceRequests++;state.unknownSourceBodiesRequested=true;originSources.set(scriptId,null);let source='';
   try{
    let reply;try{reply=yield command('Debugger.getScriptSource',{scriptId});}catch{state.originProtocolErrors++;return unknown;}
    source=reply.scriptSource;reply=null;
    if(typeof source!=='string'||source.length!==meta.length){state.originMetadataFailures++;return unknown;}
    const bytes=Buffer.byteLength(source,'utf8');if(bytes>MAX_ORIGIN_SOURCE_BYTES-originSourceBytes){state.originCallerSourceLimitReached=true;return unknown;}originSourceBytes+=bytes;
    try{indexOriginSource(scriptId,source);}catch{state.originParseFailures++;}
   }finally{source='';}
  }
  const entry=originSources.get(scriptId);
  if(!entry||frame?.functionLocation?.scriptId!==scriptId)return unknown;
  const match=entry.matches.get(entry.mapped.offset(frame.functionLocation)),offset=entry.mapped.offset(frame.location);
  if(!match||!Number.isInteger(offset)||offset<match.bodyStart||offset>=match.bodyEnd)return unknown;
  const publicOffset=match.publicBodyStart+(offset-match.bodyStart),call=publicOriginCalls.filter(item=>publicOffset>=item.start&&publicOffset<item.end&&item.start>=match.publicStart).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];if(!call)state.originCallsiteUnavailable++;
  return{depth,classification:'recompiled-public-body',publicFunctionStart:match.publicStart,publicCallOffset:call?.start??null};
 }
 function* producerIndex(scriptId,caller=false){
  if(producerSources.has(scriptId))return producerSources.get(scriptId);
  if(originSources.has(scriptId)){const index=originSources.get(scriptId);producerSources.set(scriptId,index);return index;}
  const original=copies.get(scriptId);if(original){try{indexOriginSource(scriptId,String.fromCharCode(10).repeat(original.prefix)+reference.source,producerSources);}catch{producerState.parseFailures++;}return producerSources.get(scriptId);}
  producerSources.set(scriptId,null);const meta=metadata.get(scriptId);
  if(producerSourceRequests.size>=MAX_PRODUCER_SOURCES||!Number.isInteger(meta?.length)||meta.length<1||meta.length>MAX_SOURCE_UNITS){producerState.sourceLimitReached=true;return null;}
  producerSourceRequests.add(scriptId);producerState.sourceRequests++;if(caller)producerState.callerSourceRequests++;let source='';
  try{let reply;try{reply=yield command('Debugger.getScriptSource',{scriptId});}catch{producerState.protocolErrors++;state.protocolErrors++;return null;}source=reply.scriptSource;reply=null;if(typeof source!=='string'||source.length!==meta.length){producerState.parseFailures++;return null;}const bytes=Buffer.byteLength(source,'utf8');if(bytes>MAX_PRODUCER_SOURCE_BYTES-producerSourceBytes){producerState.sourceLimitReached=true;return null;}producerSourceBytes+=bytes;try{indexOriginSource(scriptId,source,producerSources);}catch{producerState.parseFailures++;}return producerSources.get(scriptId);}finally{source='';}
 }
 function* producerMatch(frame,expectedKind,caller=false){
  const scriptId=frame?.functionLocation?.scriptId;if(typeof scriptId!=='string'||frame?.location?.scriptId!==scriptId)return null;
  const index=yield*producerIndex(scriptId,caller);if(!index)return null;const match=index.matches.get(index.mapped.offset(frame.functionLocation)),offset=index.mapped.offset(frame.location);
  if(!match||!Number.isInteger(offset)||offset<match.bodyStart||offset>=match.bodyEnd)return null;
  if(expectedKind&&match.publicStart!==reference.producerSites[expectedKind]?.start)return null;
  return{...match,offset,scriptId,index};
 }
 function* producerCaller(frame){
  if(earlyState.enabled&&state.phase!=='snapshot'&&!copies.has(frame?.functionLocation?.scriptId)&&!producerSources.has(frame?.functionLocation?.scriptId)){earlyState.unrequestedEarlyCallers++;return{classification:'unknown'};}
  const match=yield*producerMatch(frame,undefined,true);if(!match)return{classification:'unknown'};
  const offset=match.publicBodyStart+match.offset-match.bodyStart,fn=publicOriginFunctions.find(item=>item.start===match.publicStart),call=publicOriginCalls.filter(item=>item.start<=offset&&offset<item.end&&item.start>=fn.start&&item.end<=fn.end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
  if(!call)return{classification:'unknown'};return{classification:copies.has(match.scriptId)?'public':'recompiled-public-body',publicFunctionStart:match.publicStart,publicCallOffset:call.start};
 }
 function receiverMetadata(remote){
  const type=RECEIVER_TYPES.includes(remote?.type)?remote.type:'unknown',subtype=remote?.subtype===undefined?'none':RECEIVER_SUBTYPES.includes(remote.subtype)?remote.subtype:'unknown',className=subtype!=='proxy'&&RECEIVER_CLASS_NAMES.includes(remote?.className)?remote.className:'unknown';
  return{classification:'protocol-metadata',type,subtype,className};
 }
 function* observeProducerInput(frame,caller,evidence){
  const expected=reference.inputSite;if(!inputState.enabled||!expected||caller?.publicFunctionStart!==expected.start)return undefined;
  inputState.candidates++;
  try{
   const match=yield*producerMatch(frame,undefined,true);if(!match||match.publicStart!==expected.start){inputState.captureFailures++;return{classification:'unknown-caller-body'};}
   if(!match.headerMatch){inputState.headerMismatches++;return{classification:'unknown-caller-header'};}
   const offset=match.publicBodyStart+match.offset-match.bodyStart;if(caller.publicCallOffset!==expected.callStart||offset<expected.callStart||offset>=expected.callEnd){inputState.callsiteMismatches++;return{classification:'unknown-callsite'};}
   const helperId=helpers.get(metadata.get(match.scriptId)?.executionContextId);if(!helperId){inputState.captureFailures++;return{classification:'unknown-input-observation'};}
   const receiverReply=yield command('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:expected.receiver,objectGroup:group,returnByValue:false,generatePreview:false,silent:true,throwOnSideEffect:true});
   if(receiverReply.exceptionDetails||!receiverReply.result){inputState.captureFailures++;return{classification:'unknown-input-observation'};}
   const receiver=receiverMetadata(receiverReply.result);let key;
   if(receiver.subtype==='proxy'){inputState.proxyReceivers++;key={classification:'unknown-proxy-receiver'};}
   else{
    const wrapper=yield command('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:'({key:('+expected.key+')})',objectGroup:group,returnByValue:false,generatePreview:false,silent:true,throwOnSideEffect:true});
    if(wrapper.exceptionDetails||!wrapper.result?.objectId){inputState.captureFailures++;return{classification:'unknown-input-observation'};}
    const arrayReceiver=receiver.type==='object'&&receiver.subtype==='array',reply=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(wrapper,arrayReceiver){return this.propertyInputKey(wrapper,arrayReceiver)}',arguments:[{objectId:wrapper.result.objectId},{value:arrayReceiver}],returnByValue:true,generatePreview:false,silent:true});
    const classified=reply.result?.value;if(reply.exceptionDetails){inputState.captureFailures++;return{classification:'unknown-input-observation'};}
    if(classified?.classification==='standard-property'&&PROPERTY_INPUT_KEYS.includes(classified.name))key={classification:'standard-property',name:classified.name};
    else if(classified?.classification==='array-index'&&arrayReceiver&&Number.isSafeInteger(classified.index)&&classified.index>=0&&classified.index<=1023)key={classification:'array-index',index:classified.index};
    else if(['unknown-key','unknown-object-key'].includes(classified?.classification))key={classification:classified.classification};
    else{inputState.captureFailures++;return{classification:'unknown-input-observation'};}
   }
   inputState.captures++;if(key.classification==='standard-property')inputState.standardKeys++;else if(key.classification==='array-index')inputState.arrayIndices++;else inputState.unknownKeys++;
   if(dependencyState.enabled&&key.classification==='array-index'&&key.index===0&&receiverReply.result.objectId)evidence.dependencies=yield*observeArrayReceiver(receiverReply.result.objectId,helperId);
   if(sortIdentityState.enabled&&key.classification==='array-index'&&key.index===0&&receiverReply.result.objectId)evidence.sortIdentity=yield*observeSortIdentity(receiverReply.result.objectId,helperId);
   return{classification:'property-read',key,receiver};
  }catch{inputState.captureFailures++;inputState.protocolErrors++;state.protocolErrors++;return{classification:'unknown-input-observation'};}
 }
 function* observeSortIdentity(objectId,helperId){
  sortIdentityState.protocolArrayCandidates++;const unknown={classification:'unknown-sort-identity-observation'};
  try{
   const reply=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(receiver){return this.sortIdentityReceiverKind(receiver)}',arguments:[{objectId}],returnByValue:true,generatePreview:false,silent:true});
   if(reply.exceptionDetails){sortIdentityState.receiverClassificationFailures++;return unknown;}
   if(reply.result?.value==='non-array'){sortIdentityState.nonArrayReceivers++;return{classification:'non-array-sort-receiver'};}
   if(reply.result?.value!=='array'){sortIdentityState.receiverClassificationFailures++;return unknown;}
  }catch{sortIdentityState.receiverClassificationFailures++;sortIdentityState.protocolErrors++;return unknown;}
  sortIdentityState.candidates++;
  try{
   if(!sortIdentityRegistries.has(helperId)){
    // The runtime publishes the shared controller in each observed realm. Keep all CDP arguments in the producer helper context.
    let controllerId,queryId,retained=false;try{
     sortIdentityState.registryLookups++;const found=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(){return this.sortIdentityRegistry()}',objectGroup:helperGroup,returnByValue:false,generatePreview:false,silent:true});if(found.exceptionDetails)throw 0;const controller=found.result;
     controllerId=controller?.objectId;if(!controllerId||controller.type!=='object'||controller.subtype==='proxy'){sortIdentityState.registryUnavailable++;return unknown;}
     const method=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(registry){return this.sortIdentityQueryFunction(registry)}',arguments:[{objectId:controller.objectId}],objectGroup:helperGroup,returnByValue:false,generatePreview:false,silent:true});if(method.exceptionDetails)throw 0;
     queryId=method.result?.objectId;if(method.result?.type!=='function'||!queryId||method.result.subtype==='proxy'){sortIdentityState.registryUnavailable++;return unknown;}
     sortIdentityRegistries.set(helperId,{helperId,controllerId,queryId});retained=true;
    }finally{if(!retained)for(const objectId of [queryId,controllerId])if(objectId)try{yield command('Runtime.releaseObject',{objectId});}catch{sortIdentityState.protocolErrors++;}}
   }
   const selected=sortIdentityRegistries.get(helperId);sortIdentityState.queries++;
   const reply=yield command('Runtime.callFunctionOn',{objectId:selected.helperId,functionDeclaration:'function(registry,query,receiver){return this.sortIdentityQuery(registry,query,receiver)}',arguments:[{objectId:selected.controllerId},{objectId:selected.queryId},{objectId}],returnByValue:true,generatePreview:false,silent:true});if(reply.exceptionDetails)throw 0;const result=reply.result?.value;
   if(result?.classification==='observed-completed-sort-identity'&&['top','sourced','sourceless'].includes(result.realmKind)&&['realmIndex','callIndex','completedOrdinal'].every(key=>Number.isSafeInteger(result[key])&&result[key]>=0&&result[key]<=31)&&typeof result.numericOnly==='boolean'){sortIdentityState.matches++;return{classification:result.classification,realmKind:result.realmKind,realmIndex:result.realmIndex,callIndex:result.callIndex,completedOrdinal:result.completedOrdinal,numericOnly:result.numericOnly};}
   if(result?.classification==='unknown-sort-identity'){sortIdentityState.unknowns++;return{classification:result.classification};}
   if(result?.classification==='sort-identity-registry-unavailable')sortIdentityState.registryUnavailable++;
   else if(result?.classification==='sort-identity-disposed')sortIdentityState.registryDisposed++;
   else if(result?.classification==='sort-identity-incomplete')sortIdentityState.registryIncomplete++;
   else if(result?.classification==='sort-identity-query-failed')sortIdentityState.queryFailures++;
   else sortIdentityState.invalidResponses++;return unknown;
  }catch{sortIdentityState.queryFailures++;sortIdentityState.protocolErrors++;return unknown;}
 }
 function* producerBindingCandidate(frame,copy,kind,diagnostics,prior){
  const candidate={kind,value:null,valid:false,identity:prior?'unavailable':'unselected'},relations=prior?{identity:'unavailable',context:'unavailable',script:'unavailable',body:'unavailable',header:'unavailable'}:null;
  try{
   if(!reference.producerSites[kind]){diagnostics.bindingFailures++;return candidate;}
   const evaluated=yield command('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:reference.roles.producerBindings[kind],objectGroup:targetGroup,returnByValue:false,generatePreview:false,silent:true,throwOnSideEffect:true});const value=candidate.value=evaluated.result;
   if(evaluated.exceptionDetails||value?.type!=='function'||!value.objectId||value.subtype==='proxy'){diagnostics.bindingFailures++;return candidate;}
   if(prior){try{const same=yield command('Runtime.callFunctionOn',{objectId:prior.objectId,functionDeclaration:'function(other){return this===other}',arguments:[{objectId:value.objectId}],returnByValue:true,generatePreview:false,silent:true});relations.identity=same.exceptionDetails?'exception':same.result?.type==='boolean'&&typeof same.result.value==='boolean'?(same.result.value?'equal':'unequal'):'unavailable';}catch{diagnostics.protocolErrors++;state.protocolErrors++;recheckState.protocolErrors++;}candidate.identity=relations.identity;}
   const properties=yield command('Runtime.getProperties',{objectId:value.objectId,ownProperties:true,generatePreview:false});const location=properties.internalProperties?.find(item=>item.name==='[[FunctionLocation]]')?.value?.value;
   if(properties.exceptionDetails||!location||typeof location.scriptId!=='string'||!Number.isInteger(location.lineNumber)||!Number.isInteger(location.columnNumber)){diagnostics.bindingFailures++;if(prior)recheckState.metadataFailures++;return candidate;}
   const contextId=metadata.get(location.scriptId)?.executionContextId;
   if(prior){relations.script=prior.scriptId===location.scriptId?'same':'different';const oldContext=metadata.get(prior.scriptId)?.executionContextId;if(Number.isInteger(oldContext)&&Number.isInteger(contextId))relations.context=oldContext===contextId?'same':'different';}
   const index=yield*producerIndex(location.scriptId),offset=index?.mapped.offset(location),match=index?.matches.get(offset),bodyMatch=match?.publicStart===reference.producerSites[kind].start;
   if(prior){relations.body=match?(bodyMatch?'same':'different'):'unavailable';if(bodyMatch)relations.header=match.headerMatch?'same':'different';}
   if(!bodyMatch){diagnostics.bodyMismatches++;if(prior)recheckState.bodyMismatches++;return candidate;}
   if(!match.headerMatch){diagnostics.headerMismatches++;if(prior)recheckState.headerMismatches++;return candidate;}
   Object.assign(candidate,{valid:true,scriptId:location.scriptId,functionOffset:offset,contextId:contextId??copy.contextId});return candidate;
  }catch{diagnostics.protocolErrors++;state.protocolErrors++;if(prior){recheckState.protocolErrors++;recheckState.metadataFailures++;}return candidate;}
  finally{if(prior){recheckState.checks++;recheckState[{equal:'identityEqual',unequal:'identityUnequal',exception:'identityExceptions',unavailable:'identityUnavailable'}[relations.identity]]++;const row=recheckState.byRole[kind];row.checks++;for(const [name,value]of Object.entries(relations))row[name][value]++;}}
 }
 function* releaseProducerCandidate(candidate,diagnostics){const id=candidate?.value?.objectId;if(id&&![...producerAllTargets].some(target=>target.objectId===id))try{yield command('Runtime.releaseObject',{objectId:id});}catch{diagnostics.protocolErrors++;state.protocolErrors++;return false;}return true;}
 function producerSiteAlias(candidate){return [...producerAllTargets].some(target=>target.scriptId===candidate.scriptId&&target.functionOffset===candidate.functionOffset);}
 function* retainedProducerTarget(candidate){
  for(const target of producerAllTargets)if(target.kind===candidate.kind&&target.scriptId===candidate.scriptId&&target.functionOffset===candidate.functionOffset){
   const reply=yield command('Runtime.callFunctionOn',{objectId:target.objectId,functionDeclaration:'function(other){return this===other}',arguments:[{objectId:candidate.value.objectId}],returnByValue:true,generatePreview:false,silent:true});
   if(reply.exceptionDetails){handoffState.retainedIdentityExceptions++;return{complete:false};}if(reply.result?.type!=='boolean'||typeof reply.result.value!=='boolean'){handoffState.retainedIdentityUnavailable++;return{complete:false};}if(reply.result.value)return{complete:true,target};
  }return{complete:true,target:null};
 }
 function* installProducerCandidate(candidate,generation,armedBy){
  const installed=yield command('Debugger.setBreakpointOnFunctionCall',{objectId:candidate.value.objectId});if(typeof installed.breakpointId!=='string'||producerBreakpoints.has(installed.breakpointId))throw 0;
  const target={kind:candidate.kind,objectId:candidate.value.objectId,scriptId:candidate.scriptId,functionOffset:candidate.functionOffset,contextId:candidate.contextId,armedBy,generation};producerAllTargets.add(target);producerBreakpoints.set(installed.breakpointId,target);producerState.installedBreakpoints++;handoffState.retainedTargets=producerAllTargets.size;return target;
 }
 function* inspectProducerBindings(frame,copy,bootstrap=false){
  if(!options.observeProducers||state.phase!=='snapshot'&&!(bootstrap&&earlyState.enabled)||state.collectionClosed||producerState.collectionClosed)return false;
  producerState.bindingInspections++;producerState.bindingInspectionsByPhase[state.phase]++;const diagnostics=bootstrap?earlyState:producerState;let valid=true;
  for(const kind of PRODUCER_BINDINGS){let candidate;try{const prior=producerTargets.get(kind);candidate=yield*producerBindingCandidate(frame,copy,kind,diagnostics,prior);if(!candidate.valid)valid=false;
   if(prior){if(candidate.identity!=='equal'){diagnostics.targetChanges++;valid=false;}continue;}if(!candidate.valid)continue;
   if(producerSiteAlias(candidate)){diagnostics.targetSiteAliases++;valid=false;continue;}
   const target=yield*installProducerCandidate(candidate,0,bootstrap?'bootstrap':'snapshot');producerTargets.set(kind,target);producerState.targets=producerTargets.size;
  }catch{diagnostics.protocolErrors++;state.protocolErrors++;valid=false;}finally{if(!(yield*releaseProducerCandidate(candidate,diagnostics)))valid=false;}}
  return valid&&producerTargets.size===3;
 }
 function* observeProducerHandoff(frame,definition){
  if(!handoffState.enabled||definition.kind!=='y'||state.collectionClosed||producerState.collectionClosed)return;const site=reference.handoffSite,scriptId=frame?.functionLocation?.scriptId;
  // An early unknown caller must not trigger a new source request merely to hunt for this seam.
  if(!copies.has(scriptId)&&!producerSources.has(scriptId))return;const match=yield*producerMatch(frame,undefined,true);if(!match||match.publicStart!==site.start)return;
  const offset=match.publicBodyStart+match.offset-match.bodyStart;if(offset<site.callStart||offset>=site.callEnd)return;
  handoffState.attempts++;handoffState.phases[state.phase]++;const candidates=[],selected=new Map();let success=false;
  try{if(!match.headerMatch){handoffState.headerMismatches++;return;}if(handoffState.currentEpoch+1>=MAX_PRODUCER_EPOCHS){handoffState.epochLimitReached=true;return;}if(producerTargets.size!==3){handoffState.bindingFailures++;return;}
   const copy=copies.get(scriptId)??{contextId:metadata.get(scriptId)?.executionContextId};for(const kind of PRODUCER_BINDINGS)candidates.push(yield*producerBindingCandidate(frame,copy,kind,handoffState,producerTargets.get(kind)));
   if(candidates.some(candidate=>!candidate.valid||!['equal','unequal'].includes(candidate.identity)))return;const changed=candidates.filter(candidate=>candidate.identity==='unequal');
   for(const candidate of changed){const retained=yield*retainedProducerTarget(candidate);if(!retained.complete)return;candidate.retainedTarget=retained.target;}
   const fresh=changed.filter(candidate=>!candidate.retainedTarget);if(producerAllTargets.size+fresh.length>MAX_PRODUCER_TARGETS){handoffState.targetLimitReached=true;return;}
   for(let i=0;i<fresh.length;i++)if(producerSiteAlias(fresh[i])||fresh.slice(0,i).some(other=>other.scriptId===fresh[i].scriptId&&other.functionOffset===fresh[i].functionOffset)){handoffState.targetSiteAliases++;return;}
   const generation=handoffState.selectedGeneration+(changed.length?1:0);for(const candidate of candidates)selected.set(candidate.kind,candidate.identity==='equal'?producerTargets.get(candidate.kind):candidate.retainedTarget??(yield*installProducerCandidate(candidate,generation,'handoff')));
   handoffState.retainedReuses+=changed.length-fresh.length;
   for(const [kind,target]of selected)producerTargets.set(kind,target);handoffState.selectedGeneration=generation;handoffState.currentEpoch++;handoffState.epochsStarted++;handoffState.successes++;if(changed.length)handoffState.replacements++;else handoffState.unchanged++;success=true;
  }catch{handoffState.protocolErrors++;state.protocolErrors++;}finally{for(const candidate of candidates)if(!(yield*releaseProducerCandidate(candidate,handoffState)))success=false;if(!success){handoffState.failures++;handoffState.targetChanges++;producerState.targetChanges++;}}
 }
 function* producerStorage(frame,vmName,selectorName,helperId,inputName=null,diagnostics=producerState){
  const vm=yield command('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:vmName,objectGroup:group,returnByValue:false,generatePreview:false,silent:true,throwOnSideEffect:true});if(vm.exceptionDetails)throw 0;
  if(vm.result?.subtype==='proxy'){diagnostics.vmProxyRefusals++;return{classification:'unknown-vm-proxy'};}
  if(!vm.result?.objectId||!['object','function'].includes(vm.result.type)){diagnostics.storageRefusals++;return{classification:'unknown-storage-descriptor'};}
  const table=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(vm){return this.producerTable(vm)}',arguments:[{objectId:vm.result.objectId}],objectGroup:group,returnByValue:false,generatePreview:false,silent:true});if(table.exceptionDetails)throw 0;
  if(table.result?.subtype==='proxy'){diagnostics.tableProxyRefusals++;return{classification:'unknown-table-proxy'};}
  if(!table.result?.objectId||!['object','function'].includes(table.result.type)){diagnostics.storageRefusals++;return{classification:'unknown-storage-descriptor'};}
  const input=inputName?',arrayInput:(typeof '+inputName+'==="object"&&'+inputName+'!==null?'+inputName+':void 0)':'';
  const wrapper=yield command('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:'({vm:('+vmName+'),selector:('+selectorName+')'+input+'})',objectGroup:group,returnByValue:false,generatePreview:false,silent:true,throwOnSideEffect:true});if(wrapper.exceptionDetails||!wrapper.result?.objectId)throw 0;
  return{table:table.result.objectId,wrapper:wrapper.result.objectId};
 }
 function* observeArrayReceiver(objectId,helperId){
  dependencyState.arrayQueries++;
  try{const reply=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(receiver,epoch){return this.producerArray("read",receiver,undefined,undefined,epoch)}',arguments:[{objectId},{value:handoffState.currentEpoch}],returnByValue:true,generatePreview:false,silent:true});if(reply.exceptionDetails)throw 0;const result=reply.result?.value;
   if(result?.classification==='observed-array-input-identity'&&result.producer?.classification==='attempted-last-writer'){dependencyState.arrayMatches++;return{classification:'array-receiver',receiver:result};}
   if(result?.classification==='unknown-no-observed-array-input'){dependencyState.arrayUnknowns++;return{classification:'array-receiver',receiver:{classification:result.classification}};}
   dependencyState.arrayQueryFailures++;return{classification:'unknown-array-observation'};
  }catch{dependencyState.arrayQueryFailures++;dependencyState.protocolErrors++;state.protocolErrors++;return{classification:'unknown-array-observation'};}
 }
 function* observeArrayInput(storage,helperId,evidence,kind){
  dependencyState.arrayInputClassifications++;
  if(kind==='known-array'){dependencyState.arrayCandidates++;dependencyState.arrayCaptures++;return;}
  if(kind==='not-array')return;if(kind!=='array-candidate'){dependencyState.arrayClassificationFailures++;return;}dependencyState.arrayCandidates++;
  if(dependencyState.arrayKeysHeld>=MAX_PRODUCER_ARRAYS){dependencyState.arrayKeyLimitReached=true;return;}
  try{const value=yield command('Runtime.callFunctionOn',{objectId:storage.wrapper,functionDeclaration:'function(){return this.arrayInput}',objectGroup:group,returnByValue:false,generatePreview:false,silent:true});if(value.exceptionDetails)throw 0;
   if(value.result?.subtype==='proxy'){dependencyState.arrayProxyRefusals++;return;}if(value.result?.type!=='object'||value.result?.subtype!=='array'||!value.result.objectId){dependencyState.arrayCaptureFailures++;return;}
   const reply=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(wrapper,evidence,remaining,epoch){return this.producerArray("write",wrapper,evidence,remaining,epoch)}',arguments:[{objectId:storage.wrapper},{value:evidence},{value:MAX_PRODUCER_ARRAYS-dependencyState.arrayKeysHeld},{value:handoffState.currentEpoch}],returnByValue:true,generatePreview:false,silent:true});if(reply.exceptionDetails)throw 0;
   if(reply.result?.value?.classification==='array-input-recorded'){dependencyState.arrayCaptures++;if(reply.result.value.newKey===true){dependencyState.arrayKeysHeld++;dependencyState.arrayDistinctInputs++;}}
   else if(reply.result?.value?.classification==='unknown-array-limit')dependencyState.arrayKeyLimitReached=true;else dependencyState.arrayCaptureFailures++;
  }catch{dependencyState.arrayCaptureFailures++;dependencyState.protocolErrors++;state.protocolErrors++;}
 }
 function* observeAddition(frame,caller){
  const expected=reference.additionSite;if(!dependencyState.enabled||caller?.publicFunctionStart!==expected.start)return undefined;dependencyState.additionCandidates++;
  try{const match=yield*producerMatch(frame,undefined,true);if(!match||match.publicStart!==expected.start){dependencyState.additionCaptureFailures++;return{classification:'unknown-dependency-body'};}
   if(!match.headerMatch){dependencyState.additionHeaderMismatches++;return{classification:'unknown-dependency-header'};}
   const offset=match.publicBodyStart+match.offset-match.bodyStart;if(caller.publicCallOffset!==expected.callStart||offset<expected.callStart||offset>=expected.callEnd){dependencyState.additionCallsiteMismatches++;return{classification:'unknown-dependency-callsite'};}
   const helperId=helpers.get(metadata.get(match.scriptId)?.executionContextId);if(!helperId){dependencyState.additionCaptureFailures++;return{classification:'unknown-dependency-observation'};}
   const result={classification:'addition-inputs'};
   for(const side of ['left','right']){const role=expected[side],storage=yield*producerStorage(frame,role.vm,role.selector,helperId,null,dependencyState);if(storage.classification){dependencyState.additionCaptureFailures++;return{classification:'unknown-dependency-storage'};}
    const reply=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(wrapper,table,epoch){return this.producer("read-terminal",wrapper,table,undefined,undefined,epoch)}',arguments:[{objectId:storage.wrapper},{objectId:storage.table},{value:handoffState.currentEpoch}],returnByValue:true,generatePreview:false,silent:true});if(reply.exceptionDetails)throw 0;const prior=reply.result?.value;
    if(prior?.classification==='attempted-last-writer')dependencyState.additionMatchedEdges++;else if(prior?.classification==='unknown-no-observed-writer')dependencyState.additionUnknownEdges++;else{if(prior?.classification==='unknown-selector')dependencyState.additionSelectorRefusals++;dependencyState.additionCaptureFailures++;return{classification:'unknown-dependency-observation'};}result[side]=prior;
   }
   dependencyState.additionCaptures++;return result;
  }catch{dependencyState.additionCaptureFailures++;dependencyState.protocolErrors++;state.protocolErrors++;return{classification:'unknown-dependency-observation'};}
 }
 function* observeProducer(frame,definition,callFrames){
  producerState.hits[definition.kind][state.phase]++;
  if(!options.observeEarlyProducers&&state.phase!=='snapshot'||state.collectionClosed||producerState.collectionClosed)return;
  if(producerState.attempts>=options.maxProducerAttempts){producerState.attemptLimitReached=true;yield*closeProducerCollection();return;}
  producerState.attempts++;producerState.attemptsByPhase[state.phase]++;
  try{const match=yield*producerMatch(frame,definition.kind);if(!match||!match.headerMatch||match.scriptId!==definition.scriptId||match.index.mapped.offset(frame.functionLocation)!==definition.functionOffset){producerState.captureFailures++;return;}
   yield*observeProducerHandoff(callFrames?.[1],definition);
   const helperId=helpers.get(definition.contextId);if(!helperId){producerState.captureFailures++;return;}const params=reference.producerSites[definition.kind].params,roles=reference.roles.writerParameters[definition.kind],vmName=params[roles.vm],selectorName=params[roles.selector],storage=yield*producerStorage(frame,vmName,selectorName,helperId,dependencyState.enabled?params[2]:null);if(storage.classification)return;
   const evidence={classification:'attempted-last-writer',writer:reference.roles.producerBindings[definition.kind],writerRole:definition.kind,caller:yield*producerCaller(callFrames?.[1])};if(options.observeEarlyProducers)evidence.phase=state.phase;if(handoffState.enabled){evidence.writerGeneration=definition.generation;evidence.observationEpoch=handoffState.currentEpoch;}
   if(definition.kind==='tI'){const input=yield*observeProducerInput(callFrames?.[1],evidence.caller,evidence);if(input)evidence.input=input;const dependencies=yield*observeAddition(callFrames?.[1],evidence.caller);if(dependencies)evidence.dependencies=dependencies;}
   const reply=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(wrapper,table,evidence,remaining,epoch){return this.producer("write",wrapper,table,evidence,remaining,epoch)}',arguments:[{objectId:storage.wrapper},{objectId:storage.table},{value:evidence},{value:options.maxProducerKeys-producerState.keysHeld},{value:handoffState.currentEpoch}],returnByValue:true,generatePreview:false,silent:true});if(reply.exceptionDetails)throw 0;
   if(reply.result?.value?.classification==='attempt-recorded'){producerState.recordedAttempts++;producerState.recordedAttemptsByPhase[state.phase]++;if(reply.result.value.newKey===true)producerState.keysHeld++;producerContexts.add(definition.contextId);if(dependencyState.enabled)yield*observeArrayInput(storage,helperId,evidence,reply.result.value.arrayInputKind);}else if(reply.result?.value?.classification==='unknown-selector')producerState.selectorRefusals++;else if(reply.result?.value?.classification==='unknown-key-limit'){producerState.keyLimitReached=true;yield*closeProducerCollection();}else throw 0;
  }catch{producerState.captureFailures++;producerState.protocolErrors++;state.protocolErrors++;}
 }
 function* joinProducer(callFrames,origin){
  producerState.joins++;
  let result={classification:'unknown-iq-origin'};
  try{if(state.phase!=='snapshot')result={classification:'unknown-outside-snapshot'};
   else if(producerState.collectionClosed)result={classification:'unknown-observation-limit'};else if(producerState.targets!==3||producerState.bindingFailures||producerState.bodyMismatches||producerState.targetChanges||producerState.targetSiteAliases)result={classification:'unknown-producer-coverage'};
   else{const frame=callFrames?.[1],iq=reference.producerSites.Iq,match=yield*producerMatch(frame,'Iq');
    if(match&&iq){if(!match.headerMatch){producerState.headerMismatches++;result={classification:'unknown-iq-header'};}
     else if(Number.isInteger(iq.iqCall)&&match.publicBodyStart+match.offset-match.bodyStart>=iq.iqCall&&origin.callers[0]?.publicFunctionStart===iq.start&&origin.callers[0]?.publicCallOffset===iq.iqCall){
      const contextId=metadata.get(match.scriptId)?.executionContextId,helperId=helpers.get(contextId);if(!helperId)throw 0;
      const roles=reference.roles.serializerParameters,storage=yield*producerStorage(frame,iq.params[roles.vm],iq.params[roles.selector],helperId);
      if(storage.classification)result=storage;else{const reply=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(wrapper,table,epoch){return this.producer("read",wrapper,table,undefined,undefined,epoch)}',arguments:[{objectId:storage.wrapper},{objectId:storage.table},{value:handoffState.currentEpoch}],returnByValue:true,generatePreview:false,silent:true});if(reply.exceptionDetails)throw 0;result=reply.result?.value;
       if(result?.classification==='unknown-selector')producerState.selectorRefusals++;
       if(!['attempted-last-writer','unknown-no-observed-writer','unknown-selector'].includes(result?.classification))throw 0;
      }
     }
    }
   }
  }catch{producerState.joinFailures++;producerState.protocolErrors++;state.protocolErrors++;result={classification:'unknown-observation-failure'};}
  if(result.classification==='attempted-last-writer')producerState.matchedJoins++;else producerState.unknownJoins++;return result;
 }
 function* closeProducerCollection(){yield*closeBootstrapCollection();producerState.collectionClosed=true;for(const id of [...producerBreakpoints.keys()]){try{yield command('Debugger.removeBreakpoint',{breakpointId:id});producerState.removedBreakpoints++;}catch{producerState.protocolErrors++;state.protocolErrors++;}producerBreakpoints.delete(id);}}
 function* clearProducerHelpers(){
  if(!options.observeProducers)return;
  for(const helperId of helpers.values())if(!producerClearedHelpers.has(helperId))try{const reply=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(){return this.producer("clear")}',returnByValue:true,generatePreview:false,silent:true});const counts=reply.result?.value;if(reply.exceptionDetails||!['keysCleared','vmsCleared','tablesCleared'].every(key=>Number.isInteger(counts?.[key])&&counts[key]>=0&&counts[key]<=options.maxProducerKeys))throw 0;producerState.clearCalls++;producerState.keysCleared+=counts.keysCleared;producerState.keysHeld-=counts.keysCleared;producerState.clearedVMs+=counts.vmsCleared;producerState.clearedTables+=counts.tablesCleared;if(dependencyState.enabled){if(!Number.isInteger(counts.arrayKeysCleared)||counts.arrayKeysCleared<0||counts.arrayKeysCleared>MAX_PRODUCER_ARRAYS)throw 0;dependencyState.arrayClearCalls++;dependencyState.arrayKeysCleared+=counts.arrayKeysCleared;dependencyState.arrayKeysHeld-=counts.arrayKeysCleared;}producerClearedHelpers.add(helperId);}catch{producerState.clearFailures++;state.clearFailures++;if(dependencyState.enabled)dependencyState.clearFailures++;}
 }
 function rkCallerUnknown(reason,counter){if(counter)rkCallerState[counter]++;return{classification:'unknown',reason};}
 function* mapRkCaller(frame,ordinal){
  const scriptId=frame?.functionLocation?.scriptId;
  if(typeof scriptId!=='string'||frame?.location?.scriptId!==scriptId||![frame.functionLocation,frame.location].every(location=>Number.isInteger(location.lineNumber)&&location.lineNumber>=0&&Number.isInteger(location.columnNumber)&&location.columnNumber>=0))return rkCallerUnknown('metadata','metadataFailures');
  const original=copies.get(scriptId);let entry;
  if(original){
   if(!rkCallerSources.has(scriptId)){try{indexOriginSource(scriptId,String.fromCharCode(10).repeat(original.prefix)+reference.source,rkCallerSources);rkCallerState.publicIndexBuilds++;}catch{return rkCallerUnknown('source-parse','parseFailures');}finally{rkCallerState.localEntriesHeld=rkCallerSources.size;}}else rkCallerState.localCacheHits++;
   entry=rkCallerSources.get(scriptId);
  }else if(producerSources.has(scriptId)||originSources.has(scriptId)){rkCallerState.cacheHits++;entry=producerSources.has(scriptId)?producerSources.get(scriptId):originSources.get(scriptId);}
  else if(rkCallerSources.has(scriptId)){rkCallerState.localCacheHits++;entry=rkCallerSources.get(scriptId);}
  else{
   if(ordinal!==rkCallerState.targetOrdinal)return rkCallerUnknown('not-targeted','policyRefusals');
   const meta=metadata.get(scriptId);
   if(!Number.isInteger(meta?.length)||meta.length<1)return rkCallerUnknown('source-metadata','metadataFailures');
   if(rkCallerState.additionalSourceRequests>=rkCallerState.maximumAdditionalSourceRequests||meta.length>MAX_SOURCE_UNITS){rkCallerState.sourceLimitReached=true;return rkCallerUnknown('source-limit','sourceLimitRefusals');}
   rkCallerState.additionalSourceRequests++;rkCallerSources.set(scriptId,null);rkCallerState.localEntriesHeld=rkCallerSources.size;let source='';
   try{
    let reply;try{reply=yield command('Debugger.getScriptSource',{scriptId});}catch{state.protocolErrors++;return rkCallerUnknown('source-request','protocolErrors');}
    source=reply?.scriptSource;reply=null;rkCallerState.sourceResponses++;
    if(typeof source!=='string'||source.length!==meta.length)return rkCallerUnknown('source-metadata','metadataFailures');
    if(source.length>MAX_SOURCE_UNITS||Buffer.byteLength(source,'utf8')>MAX_ORIGIN_SOURCE_BYTES){rkCallerState.sourceLimitReached=true;return rkCallerUnknown('source-limit','sourceLimitRefusals');}
    try{indexOriginSource(scriptId,source,rkCallerSources);rkCallerState.sourceIndexes++;}catch{return rkCallerUnknown('source-parse','parseFailures');}
    entry=rkCallerSources.get(scriptId);
   }finally{source='';}
  }
  if(!entry)return rkCallerUnknown('cached-unavailable','cachedUnknowns');
  const functionOffset=entry.mapped.offset(frame.functionLocation),offset=entry.mapped.offset(frame.location);
  if(!Number.isInteger(functionOffset)||!Number.isInteger(offset))return rkCallerUnknown('metadata','metadataFailures');
  const match=entry.matches.get(functionOffset);if(!match)return rkCallerUnknown('no-reviewed-body','bodyMismatches');
  if(offset<match.bodyStart||offset>=match.bodyEnd)return rkCallerUnknown('metadata','metadataFailures');
  if(!match.headerMatch)return rkCallerUnknown('header','headerMismatches');
  const publicOffset=match.publicBodyStart+offset-match.bodyStart,fn=publicOriginFunctions.find(item=>item.start===match.publicStart),call=fn&&publicOriginCalls.filter(item=>publicOffset>=item.start&&publicOffset<item.end&&item.start>=fn.bodyStart&&item.end<=fn.bodyEnd).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
  if(!call)return rkCallerUnknown('callsite','callsiteMismatches');
  return{classification:original?'public':'recompiled-public-body',publicFunctionStart:match.publicStart,publicCallOffset:call.start};
 }
 function* observeRkCaller(frame,row){
  rkCallerState.rows++;if(row.ordinal===rkCallerState.targetOrdinal)rkCallerState.targetRows++;
  try{row.immediateCaller=yield*mapRkCaller(frame,row.ordinal);}catch{row.immediateCaller=rkCallerUnknown('internal','unexpectedFailures');}
  if(row.immediateCaller.classification==='unknown')rkCallerState.unknowns++;else{rkCallerState.matches++;if(row.immediateCaller.classification==='public')rkCallerState.publicMatches++;else rkCallerState.recompiledMatches++;}
 }
 function fxCallerMatch(frame,immediateCaller){
  const expected=reference.fxSite,scriptId=frame?.functionLocation?.scriptId;
  if(typeof scriptId!=='string'||frame?.location?.scriptId!==scriptId)return{classification:'unknown-caller-metadata'};
  const original=copies.get(scriptId);let match,offset,callerClass,localFallback=false;
  if(original){const functionOffset=original.mapped.offset(frame.functionLocation)-original.prefix;offset=original.mapped.offset(frame.location)-original.prefix;if(!Number.isInteger(functionOffset)||!Number.isInteger(offset)||offset<0||offset>=reference.length)return{classification:'unknown-caller-metadata'};if(functionOffset!==expected.functionLocation)return{classification:'non-fx-caller'};match={publicStart:expected.start,publicBodyStart:expected.bodyStart,bodyStart:expected.bodyStart,bodyEnd:expected.bodyEnd,headerMatch:true};callerClass='public';}
  else{const cached=producerSources.has(scriptId)?producerSources.get(scriptId):originSources.has(scriptId)?originSources.get(scriptId):rkCallerSources.has(scriptId)?(localFallback=true,rkCallerSources.get(scriptId)):undefined;if(cached===undefined)return{classification:'unknown-uncached-caller'};if(!cached)return{classification:'unknown-caller-match'};match=cached.matches.get(cached.mapped.offset(frame.functionLocation));offset=cached.mapped.offset(frame.location);if(!match)return{classification:'unknown-caller-match'};if(match.publicStart!==expected.start)return{classification:'non-fx-caller'};callerClass='recompiled-public-body';}
  if(!Number.isInteger(offset)||offset<match.bodyStart||offset>=match.bodyEnd)return{classification:'unknown-caller-metadata'};
  fxState.fxBodyMatches++;if(!match.headerMatch)return{classification:'unknown-fx-header'};
  const publicOffset=match.publicBodyStart+offset-match.bodyStart;if(publicOffset<expected.callStart||publicOffset>=expected.callEnd)return{classification:'unknown-fx-callsite'};
  if(localFallback&&(immediateCaller?.classification!==callerClass||immediateCaller.publicFunctionStart!==expected.start||immediateCaller.publicCallOffset!==expected.callStart))return{classification:'unknown-caller-match'};
  return{classification:'verified-fx',scriptId,caller:{classification:callerClass,publicFunctionStart:expected.start,publicCallOffset:expected.callStart}};
 }
 function* observeFxSource(frame,definition,helperId,callFrames,capturePhase){
  const ordinal=fxState.arrayCaptures++;fxOrder.count=fxState.arrayCaptures;
  const actualContext=metadata.get(frame?.location?.scriptId)?.executionContextId;
  if(fxDefinition===null){fxDefinition=definition;fxContextId=definition.contextId;fxHelperId=helperId;fxOrder.contextVerified=Number.isInteger(actualContext)&&actualContext===fxContextId;}
  else{if(fxDefinition!==definition)fxOrder.boundDefinitionStable=false;if(fxContextId!==definition.contextId)fxOrder.contextStable=false;if(fxHelperId!==helperId)fxOrder.helperStable=false;if(actualContext!==fxContextId)fxOrder.contextVerified=false;}
  if(capturePhase!=='snapshot'||!fxOrder.contextVerified||!fxOrder.boundDefinitionStable||!fxOrder.contextStable||!fxOrder.helperStable)fxState.orderFailures++;
  if(state.snapshotRkArrayOrigins.length>=MAX_RECORDS){fxState.recordLimitReached=true;return;}
  const row={ordinal,phase:capturePhase,inputKind:'array',classification:'unknown-caller-metadata'};state.snapshotRkArrayOrigins.push(row);fxState.rows++;fxOrder.rowCount=fxState.rows;if(ordinal!==fxState.rows-1)fxOrder.contiguousOrdinals=false;
  // Rk owns the one-source budget; Fx only reads its verified local index.
  yield*observeRkCaller(callFrames?.[1],row);
  try{
   const callerFrame=callFrames?.[1],match=fxCallerMatch(callerFrame,row.immediateCaller);row.classification=match.classification;
   if(match.classification!=='verified-fx'){const counter={'non-fx-caller':'nonFxRows','unknown-uncached-caller':'uncachedCallerRows','unknown-caller-match':'unmatchedCallerRows','unknown-caller-metadata':'metadataFailures','unknown-fx-header':'headerMismatches','unknown-fx-callsite':'callsiteMismatches'}[match.classification];if(counter)fxState[counter]++;else fxState.metadataFailures++;return;}
   fxState.verifiedFxCallers++;
   if(producerState.collectionClosed||producerState.targets!==3||producerState.bindingFailures||producerState.bodyMismatches||producerState.targetChanges||producerState.targetSiteAliases){fxState.coverageRefusals++;row.classification='unknown-producer-coverage';return;}
   const sourceHelperId=helpers.get(metadata.get(match.scriptId)?.executionContextId);if(!sourceHelperId){fxState.metadataFailures++;row.classification='unknown-caller-metadata';return;}
   const storage=yield*producerStorage(callerFrame,'m','h',sourceHelperId,null,fxState);if(storage.classification){row.classification='unknown-fx-storage';return;}
   fxState.queries++;const reply=yield command('Runtime.callFunctionOn',{objectId:sourceHelperId,functionDeclaration:'function(wrapper,table,epoch){return this.producer("read-terminal",wrapper,table,undefined,undefined,epoch)}',arguments:[{objectId:storage.wrapper},{objectId:storage.table},{value:handoffState.currentEpoch}],returnByValue:true,generatePreview:false,silent:true});if(reply.exceptionDetails)throw 0;const prior=reply.result?.value;
   if(prior?.classification==='attempted-last-writer')fxState.matches++;else if(prior?.classification==='unknown-no-observed-writer')fxState.unknowns++;else{if(prior?.classification==='unknown-selector')fxState.selectorRefusals++;else fxState.invalidReplies++;row.classification='unknown-fx-query';return;}
   row.classification='fx-source';row.caller=match.caller;row.producer=prior;
  }catch{fxState.queryFailures++;fxState.protocolErrors++;state.protocolErrors++;row.classification='unknown-fx-query';}
 }
 function* observeNv229Origins(callFrames,inputKind){
  const phase=state.phase,occurrenceIndex=originOccurrenceCounts[phase][inputKind]++;state.originTupleCaptures++;
  if(state.nv229Origins.length>=MAX_ORIGIN_RECORDS){state.originRecordLimitReached=true;return;}
  const record={occurrenceIndex,phase,inputKind,callers:[]};state.nv229Origins.push(record);
  if(!Array.isArray(callFrames)||callFrames.length<2){state.originMetadataFailures++;return;}
  for(let depth=1;depth<Math.min(callFrames.length,5);depth++)try{record.callers.push(yield*mapOriginCaller(callFrames[depth],depth));}catch{state.originParseFailures++;record.callers.push({depth,classification:'unavailable'});}
  if(options.observeProducers)record.producer=yield*joinProducer(callFrames,record);
 }
 function* observeBound(frame,definition,callFrames){
  if(state.collectionClosed)return;const capturePhase=state.phase,capturePhaseGeneration=phaseGeneration;
  state.captureEntries++;state.captureEntriesByPhase[capturePhase]++;
  try{
   const {kind,shape}=definition,helperId=helpers.get(definition.contextId),offset=shape.mapped.offset(frame?.location);
   if(!helperId||frame?.functionLocation?.scriptId!==definition.scriptId||shape.mapped.offset(frame.functionLocation)!==shape.functionOffset||frame?.location?.scriptId!==definition.scriptId||offset<shape.start||offset>=shape.end)throw 0;
   const input=yield command('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:shape.input,objectGroup:group,returnByValue:false,generatePreview:false,silent:true,throwOnSideEffect:true});if(input.exceptionDetails||!input.result)throw 0;
   if(input.result.subtype==='proxy'){state.inputProxyRefusals++;state.skippedInputs++;state.skips.proxy++;return;}
   const wrapper=yield command('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:'({input:('+shape.input+'),destination:('+shape.destination+'),tag:('+shape.tag+')})',objectGroup:group,returnByValue:false,generatePreview:false,silent:true,throwOnSideEffect:true});if(wrapper.exceptionDetails||!wrapper.result?.objectId)throw 0;
   const reply=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(wrapper,site,phase,records,bytes){return this.payload("capture",wrapper,site,phase,records,bytes)}',arguments:[{objectId:wrapper.result.objectId},{value:kind},{value:capturePhase},{value:MAX_RECORDS-state.capturedRecords},{value:MAX_BYTES-state.capturedBytes}],returnByValue:true,generatePreview:false,silent:true});
   const summary=reply.result?.value;if(reply.exceptionDetails||summary?.valid!==true)throw 0;retainSummary(summary,kind,capturePhase);
   if(summary.captured===true){state.capturedRecords++;state.capturedRecordsByPhase[capturePhase]++;state.capturedBytes+=summary.length;if(summary.inputType==='number'||summary.inputType==='integer')state.capturedNumberInputs++;capturedContexts.add(definition.contextId);if(fxState.enabled&&kind==='Rk'&&capturePhase==='snapshot'&&summary.inputType!=='number'&&summary.inputType!=='integer'){yield*observeFxSource(frame,definition,helperId,callFrames,capturePhase);if(capturePhaseGeneration!==phaseGeneration){fxOrder.phaseStable=false;fxState.phaseChanges++;}}if(options.observeOrigins&&kind==='Nv'&&summary.destinationKnown&&summary.destination===reference.roles.numericDestination&&summary.tagPresent===false&&summary.inputType!=='number'&&summary.inputType!=='integer'){yield*observeNv229Origins(callFrames,'array');}}
   else{state.skippedInputs++;if(REASONS.includes(summary.reason))state.skips[summary.reason]++;else throw 0;if(summary.reason==='recordLimit')state.recordLimitReached=true;if(summary.reason==='byteLimit')state.byteLimitReached=true;}
  }catch{state.inspectionFailures++;}
 }
 function wipeRecords(records){if(!Array.isArray(records))return;for(const record of records){if(Array.isArray(record?.bytes))record.bytes.fill(0);if(record&&typeof record==='object'){record.destination=null;if(record.tag&&typeof record.tag==='object')record.tag.integer=null;record.bytes=undefined;}}records.length=0;}
 function countClear(value){if(!value||!Number.isInteger(value.recordsCleared)||value.recordsCleared<0||value.recordsCleared>MAX_RECORDS||!Number.isInteger(value.bytesCleared)||value.bytesCleared<0||value.bytesCleared>MAX_BYTES)throw 0;state.clearCalls++;state.clearedRecords+=value.recordsCleared;state.clearedBytes+=value.bytesCleared;}
 function* clearPayloadHelpers(){
  for(const helperId of helpers.values())if(!clearedHelpers.has(helperId))try{const reply=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(){return this.payload("clear")}',returnByValue:true,generatePreview:false,silent:true,userGesture:false});if(reply.exceptionDetails)throw 0;countClear(reply.result?.value);clearedHelpers.add(helperId);}catch{state.clearFailures++;}
 }
 function* takeBoundPayloads(){
  // Drain uses newly compiled inspector callbacks outside a pause. Keeping the
  // instrumentation breakpoint here would queue its pause behind this drain.
  if(instrumentationId){yield command('Debugger.removeBreakpoint',{breakpointId:instrumentationId});instrumentationId=null;state.instrumentationRemovedForDrain=true;}
  if(options.observeProducers){yield*closeBootstrapCollection();yield*closeProducerCollection();yield*clearProducerHelpers();}
  const output=[];let bytes=0,failed=false,fxDrained=0,fxWrongHelper=false;
  for(const helperId of helpers.values()){
   let value;
   try{
    const reply=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(){return this.payload("take")}',returnByValue:true,generatePreview:false,silent:true,userGesture:false});value=reply.result?.value;if(reply.exceptionDetails||!Array.isArray(value?.records))throw 0;countClear(value);clearedHelpers.add(helperId);
    for(const record of value.records){
     if(!APPEND_BINDINGS.includes(record.site)||!PHASES.includes(record.phase)||!['array','number'].includes(record.inputKind)||!(record.destination===null||Number.isSafeInteger(record.destination))||typeof record.tag?.present!=='boolean'||!TYPES.includes(record.tag.type)||!(record.tag.integer===null||Number.isSafeInteger(record.tag.integer))||!Array.isArray(record.bytes)||record.inputKind==='number'&&record.bytes.length!==8||output.length>=MAX_RECORDS||record.bytes.length>MAX_BYTES-bytes||record.bytes.some(byte=>!Number.isInteger(byte)||byte<0||byte>255))throw 0;
     if(fxState.enabled&&record.site==='Rk'&&record.phase==='snapshot'&&record.inputKind==='array'){fxDrained++;if(helperId!==fxHelperId)fxWrongHelper=true;}
     const copy={site:record.site,phase:record.phase,inputKind:record.inputKind,destination:record.destination,tag:{present:record.tag.present,type:record.tag.type,integer:record.tag.integer},bytes:record.bytes.slice()};output.push(copy);bytes+=copy.bytes.length;
    }
   }catch{state.clearFailures++;failed=true;}finally{wipeRecords(value?.records);}
  }
  if(output.length!==state.capturedRecords||bytes!==state.capturedBytes){state.clearFailures++;failed=true;}
  if(fxState.enabled){fxOrder.drainObserved=true;fxOrder.drainedCount=fxDrained;fxOrder.drainComplete=!failed&&!fxWrongHelper&&fxDrained===fxState.arrayCaptures;if(fxWrongHelper)fxState.orderFailures++;}
  if(failed)wipeRecords(output);return{complete:snapshot().comparisonComplete&&!failed,records:output};
 }
 function* methodIdentity(vm,kind,helperId,copy){
  let object=vm;for(let depth=0;depth<MAX_PROTOTYPES;depth++){
   if(object?.subtype==='proxy')return'proxy';if(!object?.objectId||object.type!=='object')return'missing';
   const reply=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(object,key){return this.lookup(object,key)}',arguments:[{objectId:object.objectId},{value:reference.roles.methods[kind]}],objectGroup:group,returnByValue:false,generatePreview:false,silent:true});if(reply.exceptionDetails||!reply.result?.objectId)throw 0;
   const descriptorId=reply.result.objectId,status=yield command('Runtime.callFunctionOn',{objectId:descriptorId,functionDeclaration:'function(){return this.kind}',objectGroup:group,returnByValue:true,generatePreview:false,silent:true});if(status.exceptionDetails)throw 0;const descriptorKind=status.result?.value;
   if(descriptorKind==='accessor'||descriptorKind==='non-function')return descriptorKind;
   if(descriptorKind==='function'){
    const value=yield command('Runtime.callFunctionOn',{objectId:descriptorId,functionDeclaration:'function(){return this.value}',objectGroup:group,returnByValue:false,generatePreview:false,silent:true});if(value.exceptionDetails||!value.result?.objectId)throw 0;return yield*functionIdentity(value.result,kind,copy);
   }
   if(descriptorKind!=='missing')throw 0;
   const parent=yield command('Runtime.callFunctionOn',{objectId:helperId,functionDeclaration:'function(object){return this.parent(object)}',arguments:[{objectId:object.objectId}],objectGroup:group,returnByValue:false,generatePreview:false,silent:true});if(parent.exceptionDetails)throw 0;object=parent.result;if(object?.subtype==='null')return'missing';
  }return'prototype-limit';
 }
 function* inspectWrapper(frame,copy){
  if(state.wrapperInspections>=MAX_WRAPPER_INSPECTIONS){state.inspectionLimitReached=true;return;}state.wrapperInspections++;state.wrapperInspectionsByPhase[state.phase]++;copy.summary.wrapperInspections++;
  yield*inspectAppendBindings(frame,copy);
  const earlyRecheck=earlyState.enabled&&producerTargets.size===3;if(earlyRecheck)earlyState.wrapperRechecks++;
  const bindingsValid=yield*inspectProducerBindings(frame,copy);if(earlyRecheck){if(bindingsValid)earlyState.wrapperRecheckSuccesses++;else earlyState.wrapperRecheckFailures++;}
  const helperId=helpers.get(copy.contextId);if(!helperId){state.helperFailures++;return;}
  let vm;try{const result=yield command('Debugger.evaluateOnCallFrame',{callFrameId:frame.callFrameId,expression:reference.vmBinding,objectGroup:group,returnByValue:false,generatePreview:false,silent:true,throwOnSideEffect:true});if(result.exceptionDetails||!result.result)throw 0;vm=result.result;}catch{state.inspectionFailures++;return;}
  for(const kind of METHODS){let identity;try{identity=yield*methodIdentity(vm,kind,helperId,copy);}catch{identity='protocol-failure';state.inspectionFailures++;}state.methodIdentities[kind][identity]++;state.methodIdentitiesByPhase[state.phase][kind][identity]++;}
 }
 function* paused(params){
  state.pauses++;if(params.reason==='instrumentation')state.instrumentationPauses++;
  try{
   if(!accepting)return;
   if(params.reason==='instrumentation'){const scriptId=params.data?.scriptId||params.callFrames?.[0]?.location?.scriptId;const meta=metadata.get(scriptId);if(meta)yield*inspectScript(meta);return;}
   let matched=false;
   for(const id of params.hitBreakpoints||[]){
    if(bootstrapBreakpoints.has(id)){matched=true;yield*observeBootstrap(params.callFrames?.[0],bootstrapBreakpoints.get(id),id);continue;}
    if(producerBreakpoints.has(id)){matched=true;yield*observeProducer(params.callFrames?.[0],producerBreakpoints.get(id),params.callFrames);continue;}
    if(boundBreakpoints.has(id)){matched=true;const definition=boundBreakpoints.get(id);state.entryHits++;state.siteHits[definition.kind]++;state.boundHits[definition.kind][state.phase]++;yield*observeBound(params.callFrames?.[0],definition,params.callFrames);continue;}
    if(setupBreakpoints.has(id)){matched=true;state.setupBreakpointHits++;const contextId=setupBreakpoints.get(id);yield*helper(contextId);yield command('Debugger.removeBreakpoint',{breakpointId:id});setupBreakpoints.delete(id);state.removedSetupBreakpoints++;continue;}
    const definition=breakpoints.get(id);if(!definition)continue;matched=true;if(APPEND_BINDINGS.includes(definition.kind)){state.appendHits[definition.kind][state.phase]++;definition.copy.summary.appendHits[definition.kind][state.phase]++;continue;}const counts=definition.kind==='wrapper'?'wrapperHits':'ffHits';state[counts][state.phase]++;definition.copy.summary[counts][state.phase]++;
    if(definition.kind==='wrapper'){const frame=params.callFrames?.find(f=>f.location?.scriptId===definition.copy.scriptId);if(frame)yield*inspectWrapper(frame,definition.copy);else state.inspectionFailures++;}
   }if(!matched)state.unexpectedPauses++;
  }catch{state.protocolErrors++;}
  finally{if(params.reason!=='instrumentation')try{yield command('Runtime.releaseObjectGroup',{objectGroup:group});}catch{state.protocolErrors++;}try{yield command('Debugger.resume');}catch{state.protocolErrors++;}if(state.pauses>=state.maxHits&&!cleanupStarted){state.limitReached=true;yield*shutdown();}}
 }
 function* shutdown(){if(cleanupStarted)return;cleanupStarted=true;accepting=false;state.collectionClosed=true;clearTimeout(timer);const fxCleanupProtocolStart=state.protocolErrors;try{if(instrumentationId){try{yield command('Debugger.removeBreakpoint',{breakpointId:instrumentationId});}catch{state.protocolErrors++;}instrumentationId=null;}for(const id of [...boundBreakpoints.keys()]){try{yield command('Debugger.removeBreakpoint',{breakpointId:id});state.removedBoundBreakpoints++;}catch{state.protocolErrors++;}boundBreakpoints.delete(id);}yield*closeBootstrapCollection();yield*closeProducerCollection();yield*clearProducerHelpers();yield*clearPayloadHelpers();for(const id of [...breakpoints.keys()]){try{yield command('Debugger.removeBreakpoint',{breakpointId:id});state.removedBreakpoints++;}catch{state.protocolErrors++;}breakpoints.delete(id);}for(const id of [...setupBreakpoints.keys()]){try{yield command('Debugger.removeBreakpoint',{breakpointId:id});state.removedSetupBreakpoints++;}catch{state.protocolErrors++;}setupBreakpoints.delete(id);}if(instrumentationId){try{yield command('Debugger.removeBreakpoint',{breakpointId:instrumentationId});}catch{state.protocolErrors++;}instrumentationId=null;}for(const objectGroup of [group,helperGroup,targetGroup])try{yield command('Runtime.releaseObjectGroup',{objectGroup});}catch{state.protocolErrors++;}if(debuggerEnabled){try{yield command('Debugger.disable');}catch{state.protocolErrors++;}debuggerEnabled=false;}if(runtimeEnabled){try{yield command('Runtime.disable');}catch{state.protocolErrors++;}runtimeEnabled=false;}}finally{fxState.cleanupFailures+=Math.max(0,state.protocolErrors-fxCleanupProtocolStart);fxDefinition=null;fxContextId=null;fxHelperId=null;fxState.privateOrderReferencesCleared=true;for(const item of rkCallerSources.values())if(item){item.matches.clear();item.mapped=null;}rkCallerState.localEntriesCleared+=rkCallerSources.size;rkCallerSources.clear();rkCallerState.localEntriesHeld=0;rkCallerState.privateCacheCleared=true;transport.close();for(const target of boundTargets.values()){target.shape.input='';target.shape.destination='';target.shape.tag='';target.shape=null;target.objectId=null;target.scriptId=null;}boundTargets.clear();for(const target of producerAllTargets){target.objectId=null;target.scriptId=null;}producerAllTargets.clear();producerTargets.clear();sortIdentityRegistries.clear();for(const item of producerSources.values())if(item){item.matches.clear();item.mapped=null;}producerSources.clear();producerSourceRequests.clear();producerContexts.clear();producerClearedHelpers.clear();for(const item of originSources.values())if(item){item.matches.clear();item.mapped=null;}originSources.clear();originCallerSources.clear();originBoundSources.clear();originOrdinals.clear();publicOriginFunctions.length=0;publicOriginCalls.length=0;publicBodyIndex.clear();privateSources.clear();capturedContexts.clear();clearedHelpers.clear();metadata.clear();copies.clear();checked.clear();helpers.clear();hashes.clear();state.disposed=true;}}
 function fxSnapshot(result){
  const f=fxState,o=fxOrder,ordered=f.enabled&&result.comparisonComplete&&f.arrayCaptures>0&&f.rows===f.arrayCaptures&&o.count===f.arrayCaptures&&o.rowCount===f.rows&&o.boundDefinitionStable&&o.contextStable&&o.helperStable&&o.contextVerified&&o.phaseStable&&o.contiguousOrdinals&&!f.phaseChanges&&!f.orderFailures&&!f.recordLimitReached&&!f.contextsLost;
  const c=rkCallerState;result.rkCallerObservationComplete=c.enabled&&ordered&&c.rows===f.rows&&c.targetRows===1&&c.matches+c.unknowns===c.rows&&c.publicMatches+c.recompiledMatches===c.matches&&c.additionalSourceRequests<=c.maximumAdditionalSourceRequests&&c.sourceResponses===c.additionalSourceRequests&&c.sourceIndexes===c.sourceResponses&&!c.metadataFailures&&!c.headerMismatches&&!c.callsiteMismatches&&!c.sourceLimitReached&&!c.parseFailures&&!c.protocolErrors&&!c.unexpectedFailures;
  result.rkCallerDisposalComplete=c.enabled&&state.disposed&&c.privateCacheCleared&&c.localEntriesHeld===0;
  result.snapshotRkArrayOrderComplete=ordered&&o.drainObserved&&o.drainComplete&&o.drainedCount===f.arrayCaptures;
  result.producerFxObservationComplete=ordered&&result.producerObservationComplete&&f.verifiedFxCallers>0&&f.verifiedFxCallers===f.queries&&f.queries===f.matches+f.unknowns&&!f.metadataFailures&&!f.headerMismatches&&!f.callsiteMismatches&&!f.coverageRefusals&&!f.vmProxyRefusals&&!f.tableProxyRefusals&&!f.storageRefusals&&!f.selectorRefusals&&!f.queryFailures&&!f.invalidReplies&&!f.protocolErrors;
  result.producerFxDisposalComplete=f.enabled&&state.disposed&&f.privateOrderReferencesCleared&&!f.cleanupFailures&&!state.clearFailures&&!producerState.clearFailures&&state.clearedRecords===state.capturedRecords&&state.clearedBytes===state.capturedBytes&&producerState.keysHeld===0&&producerState.installedBreakpoints===producerState.removedBreakpoints&&state.installedBoundBreakpoints===state.removedBoundBreakpoints&&state.installedSetupBreakpoints===state.removedSetupBreakpoints&&state.installedBreakpoints===state.removedBreakpoints;
  return result;
 }
 function dependencySnapshot(result){
  const d=dependencyState,healthy=d.enabled&&!d.protocolErrors&&!d.clearFailures&&!d.contextsLost;
  result.producerArrayIdentityObservationComplete=healthy&&result.producerInputObservationComplete&&d.arrayQueries>0&&d.arrayInputClassifications===producerState.recordedAttempts&&d.arrayCandidates===d.arrayCaptures+d.arrayProxyRefusals&&d.arrayQueries===d.arrayMatches+d.arrayUnknowns&&!d.arrayClassificationFailures&&!d.arrayCaptureFailures&&!d.arrayQueryFailures&&!d.arrayKeyLimitReached;
  result.producerAdditionDependencyObservationComplete=healthy&&result.producerObservationComplete&&d.additionCandidates>0&&d.additionCaptures===d.additionCandidates&&d.additionMatchedEdges+d.additionUnknownEdges===d.additionCaptures*2&&!d.additionHeaderMismatches&&!d.additionCallsiteMismatches&&!d.additionCaptureFailures&&!d.additionSelectorRefusals&&!d.vmProxyRefusals&&!d.tableProxyRefusals&&!d.storageRefusals;
  result.producerDependencyObservationComplete=result.producerArrayIdentityObservationComplete&&result.producerAdditionDependencyObservationComplete;
  result.producerDependencyDisposalComplete=healthy&&state.disposed&&d.arrayClearCalls>0&&d.arrayKeysHeld===0&&d.arrayKeysCleared===d.arrayDistinctInputs&&producerState.installedBreakpoints===producerState.removedBreakpoints&&!producerState.clearFailures;
  const e=earlyState,bootstrapHealthy=e.enabled&&!e.failures&&!e.unavailableLocations&&!e.frameMismatches&&!e.locationMismatches&&!e.bodyMismatches&&!e.headerMismatches&&!e.bindingFailures&&!e.targetChanges&&!e.targetSiteAliases&&!e.helperFailures&&!e.protocolErrors&&!e.removeFailures;
  result.producerEarlyBootstrapComplete=bootstrapHealthy&&e.attempts>0&&e.successes===e.attempts&&e.preWrapperSuccesses>0;
  result.producerEarlyObservationComplete=result.producerEarlyBootstrapComplete&&result.producerObservationComplete&&e.wrapperRechecks>0&&e.wrapperRecheckSuccesses===e.wrapperRechecks&&!e.wrapperRecheckFailures&&producerState.recordedAttemptsByPhase.init+producerState.recordedAttemptsByPhase.events>0;
  const h=handoffState;result.producerHandoffObservationComplete=h.enabled&&h.attempts>0&&h.successes===h.attempts&&!h.failures&&!h.targetLimitReached&&!h.epochLimitReached&&!h.bindingFailures&&!h.bodyMismatches&&!h.headerMismatches&&!h.targetChanges&&!h.targetSiteAliases&&!h.protocolErrors&&result.producerEarlyObservationComplete;
  result.producerEarlyDisposalComplete=e.enabled&&state.disposed&&e.installedBreakpoints===e.removedBreakpoints&&!e.removeFailures&&!e.protocolErrors&&producerState.keysHeld===0&&!producerState.clearFailures&&producerState.installedBreakpoints===producerState.removedBreakpoints&&!producerState.contextsLost&&!state.clearFailures&&!state.protocolErrors;
  const s=sortIdentityState;result.producerSortIdentityObservationComplete=s.enabled&&result.producerInputObservationComplete&&s.protocolArrayCandidates===s.candidates+s.nonArrayReceivers&&!s.receiverClassificationFailures&&s.candidates>0&&s.queries===s.candidates&&s.matches+s.unknowns===s.queries&&!s.registryUnavailable&&!s.registryDisposed&&!s.registryIncomplete&&!s.invalidResponses&&!s.queryFailures&&!s.protocolErrors;
  return result;
 }
 transport.on('Runtime.executionContextCreated',params=>{if(!accepting||!Number.isInteger(params.context?.id))return;if(transport.sync||!armed)dispatch(helper(params.context.id));});
 transport.on('Runtime.executionContextDestroyed',params=>{if(fxState.enabled&&fxState.arrayCaptures>0&&!fxOrder.drainComplete&&params.executionContextId===fxContextId)fxState.contextsLost++;if(capturedContexts.has(params.executionContextId)&&!state.payloadsTaken)state.contextsLost++;if(producerContexts.has(params.executionContextId)&&!producerState.collectionClosed){producerState.contextsLost++;if(dependencyState.enabled)dependencyState.contextsLost++;}helpers.delete(params.executionContextId);});transport.on('Runtime.executionContextsCleared',()=>{if(fxState.enabled&&fxState.arrayCaptures>0&&!fxOrder.drainComplete)fxState.contextsLost++;if(capturedContexts.size&&!state.payloadsTaken)state.contextsLost++;if(producerContexts.size&&!producerState.collectionClosed){producerState.contextsLost++;if(dependencyState.enabled)dependencyState.contextsLost++;}helpers.clear();});
 transport.on('Debugger.scriptParsed',params=>{if(!accepting)return;state.scriptsObserved++;if(metadata.size>=scriptLimit){state.scriptLimitReached=true;return;}const meta={scriptId:params.scriptId,length:params.length,hash:params.hash,executionContextId:params.executionContextId,parents:(params.stackTrace?.callFrames||[]).slice(0,16).map(f=>f.scriptId),known:false};metadata.set(params.scriptId,meta);if(transport.sync)dispatch(inspectScript(meta));});
 transport.on('Debugger.paused',params=>dispatch(paused(params)));
 const snapshot=()=>{const result=JSON.parse(JSON.stringify(state));result.numericOrigins=result.nv229Origins;result.wrapperUnmatched=state.wrapperHits.snapshot===0;result.snapshotFinalizationObserved=state.ffHits.snapshot>0;result.collectorIntegrityComplete=!state.scriptLimitReached&&!state.candidateLimitReached&&!state.missingProtocolHashes&&!state.copyLimitReached&&!state.inspectionLimitReached&&!state.entryUnavailable&&!state.helperFailures&&!state.helperLimitReached&&!state.inspectionFailures&&!state.protocolErrors&&!state.limitReached&&!state.durationReached;result.observationComplete=result.collectorIntegrityComplete&&state.knownEmbeddedCopies>0&&state.wrapperHits.snapshot>0;result.originalMethodIdentities=METHODS.every(kind=>{const counts=state.methodIdentities[kind];return counts['same-copy']+counts['other-public-copy']===state.wrapperInspections&&state.wrapperInspections>0;});result.originalMethodIdentitiesByPhase=Object.fromEntries(PHASES.map(phase=>[phase,METHODS.every(kind=>{const counts=state.methodIdentitiesByPhase[phase][kind];return counts['same-copy']+counts['other-public-copy']===state.wrapperInspectionsByPhase[phase]&&state.wrapperInspectionsByPhase[phase]>0;})]));result.originalAppendBindingIdentities=APPEND_BINDINGS.every(kind=>{const counts=state.appendBindingIdentities[kind];return counts['same-copy']+counts['other-public-copy']===state.appendBindingInspections&&state.appendBindingInspections>0;});result.originalAppendBindingIdentitiesByPhase=Object.fromEntries(PHASES.map(phase=>[phase,APPEND_BINDINGS.every(kind=>{const counts=state.appendBindingIdentitiesByPhase[phase][kind];return counts['same-copy']+counts['other-public-copy']===state.appendBindingInspectionsByPhase[phase]&&state.appendBindingInspectionsByPhase[phase]>0;})]));result.collectorIntegrityComplete=result.collectorIntegrityComplete&&!state.parameterSourceLimitReached&&!state.parameterShapeFailures&&!state.targetLimitReached&&!state.targetChanges&&!state.boundTargetSiteAliases&&!state.boundTargetRecheckFailures&&!state.contextsLost&&!state.clearFailures&&!state.summaryLimitReached&&!state.recordLimitReached&&!state.byteLimitReached;result.observationComplete=result.observationComplete&&result.collectorIntegrityComplete;result.snapshotCaptureObserved=state.captureEntriesByPhase.snapshot>0&&state.capturedRecordsByPhase.snapshot===state.captureEntriesByPhase.snapshot;result.comparisonComplete=result.observationComplete&&result.snapshotCaptureObserved&&state.boundTargets===2&&state.captureEntries>0&&state.capturedRecords===state.captureEntries&&!state.skippedInputs;result.originCompleteness=options.observeOrigins&&result.comparisonComplete&&state.originTupleCaptures>0&&state.nv229Origins.length===state.originTupleCaptures&&!state.originParseFailures&&!state.originProtocolErrors&&!state.originMetadataFailures&&!state.originCallsiteUnavailable&&!state.originCallerSourceLimitReached&&!state.originRecordLimitReached;result.producerObservationComplete=options.observeProducers&&result.originCompleteness&&producerState.targets===3&&producerState.joins>0&&producerState.joins===state.nv229Origins.length&&!producerState.bindingFailures&&!producerState.bodyMismatches&&!producerState.headerMismatches&&!producerState.targetChanges&&!producerState.targetSiteAliases&&!producerState.vmProxyRefusals&&!producerState.tableProxyRefusals&&!producerState.storageRefusals&&!producerState.selectorRefusals&&!producerState.keyLimitReached&&!producerState.attemptLimitReached&&!producerState.sourceLimitReached&&!producerState.parseFailures&&!producerState.protocolErrors&&!producerState.captureFailures&&!producerState.joinFailures&&!producerState.clearFailures&&!producerState.contextsLost;result.producerInputObservationComplete=inputState.enabled&&result.producerObservationComplete&&inputState.candidates>0&&inputState.captures===inputState.candidates&&!inputState.headerMismatches&&!inputState.callsiteMismatches&&!inputState.captureFailures&&!inputState.protocolErrors;return fxSnapshot(dependencySnapshot(result));};
 const controller={snapshot,setPhase(phase){if(!PHASES.includes(phase))throw new CurrentBoundPayloadInspectorError('INVALID_PHASE');if(state.phase!==phase)phaseGeneration++;state.phase=phase;},async flush(){let previous;do{previous=queue;await previous;}while(queue!==previous);},async takePayloads(){if(state.payloadsTaken)throw new CurrentBoundPayloadInspectorError('PAYLOADS_ALREADY_TAKEN');if(state.disposed||cleanupStarted)throw new CurrentBoundPayloadInspectorError('PAYLOADS_UNAVAILABLE');state.payloadsTaken=true;await controller.flush();state.collectionClosed=true;if(state.disposed||cleanupStarted)throw new CurrentBoundPayloadInspectorError('PAYLOADS_UNAVAILABLE');const result=await dispatch(takeBoundPayloads());if(!result)throw new CurrentBoundPayloadInspectorError('PAYLOAD_DRAIN_FAILED');return result;},async dispose(){accepting=false;await dispatch(shutdown());await controller.flush();}};
 function* setup(){runtimeEnabled=true;yield command('Runtime.enable');debuggerEnabled=true;yield command('Debugger.enable');}
 try{if(transport.sync)runSync(setup(),transport);else{runtimeEnabled=true;await transport.send('Runtime.enable',{});await controller.flush();debuggerEnabled=true;await transport.send('Debugger.enable',{});await controller.flush();for(const meta of metadata.values())await dispatch(inspectScript(meta));const result=await transport.send('Debugger.setInstrumentationBreakpoint',{instrumentation:'beforeScriptExecution'});if(!result.breakpointId)throw 0;instrumentationId=result.breakpointId;armed=true;}timer=setTimeout(()=>{state.durationReached=true;void controller.dispose();},state.maxDurationMs);return controller;}catch{await controller.dispose();throw new CurrentBoundPayloadInspectorError('SETUP_FAILED');}
}
export async function createCurrentBoundPayloadInspector(options={}){const reference=referenceFor(options.originalInterpreter),bounded=limits(options,reference);return createProbe(reference,bounded,nodeTransport());}
export async function createCurrentBoundPayloadCDPInspector(options={}){const reference=referenceFor(options.originalInterpreter),bounded=limits(options,reference);return createProbe(reference,bounded,cdpTransport(options.cdp));}
export async function createCurrentBoundPayloadInspectorFixture(options={}){const reference=fixtureReference(options.source,options.fixtureVersion),bounded=limits(options,reference);return createProbe(reference,bounded,options.cdp?cdpTransport(options.cdp):nodeTransport());}
