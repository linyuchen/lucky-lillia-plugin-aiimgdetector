// Serializable private identity registry; never reads an array element or property.
export function createCompletedSortIdentityRegistry() {
 const own=Object.getOwnPropertyDescriptor,hasOwn=Object.hasOwn,isArray=Array.isArray,
  integer=Number.isSafeInteger,freeze=Object.freeze,apply=Reflect.apply,
  Weak=WeakMap,get=WeakMap.prototype.get,set=WeakMap.prototype.set;
 let identities=new Weak();
 const stats={enabled:true,diagnosticOnly:true,sameObjectOnly:true,arrayElementsRead:false,
  originProven:false,elementImmutabilityProven:false,maximumRecords:128,recordCalls:0,
  recorded:0,uniqueArrays:0,overwrites:0,recordsHeld:0,queryCalls:0,matches:0,unknowns:0,
  invalidRecords:0,invalidQueries:0,rejectedAfterDispose:0,limitReached:false,disposed:false,recordsCleared:0};
 const increment=key=>{if(stats[key]<9007199254740991)stats[key]++;};
 const array=receiver=>{try{return receiver!==null&&typeof receiver==='object'&&isArray(receiver);}catch{return false;}};
 const field=(metadata,key)=>{const descriptor=own(metadata,key);if(!descriptor||!hasOwn(descriptor,'value'))throw 0;return descriptor.value;};
 const metadataCopy=metadata=>{
  if(metadata===null||typeof metadata!=='object')throw 0;
  const realmKind=field(metadata,'realmKind'),realmIndex=field(metadata,'realmIndex'),
   callIndex=field(metadata,'callIndex'),completedOrdinal=field(metadata,'completedOrdinal'),numericOnly=field(metadata,'numericOnly');
  if(realmKind!=='top'&&realmKind!=='sourced'&&realmKind!=='sourceless'||
   !integer(realmIndex)||realmIndex<0||realmIndex>31||!integer(callIndex)||callIndex<0||callIndex>31||
   !integer(completedOrdinal)||completedOrdinal<0||completedOrdinal>31||typeof numericOnly!=='boolean')throw 0;
  return freeze({realmKind,realmIndex,callIndex,completedOrdinal,numericOnly});
 };
 const healthy=()=>!stats.invalidRecords&&!stats.invalidQueries&&!stats.limitReached;
 const snapshot=()=>({...stats,complete:!stats.disposed&&healthy(),cleanupComplete:stats.disposed&&stats.recordsHeld===0&&identities===null});
 const record=(receiver,metadata)=>{
  increment('recordCalls');
  if(stats.disposed){increment('rejectedAfterDispose');return{classification:'sort-identity-record-rejected'};}
  if(stats.recorded>=stats.maximumRecords){stats.limitReached=true;return{classification:'sort-identity-record-rejected'};}
  let value;try{if(!array(receiver))throw 0;value=metadataCopy(metadata);}catch{increment('invalidRecords');return{classification:'sort-identity-record-rejected'};}
  const prior=apply(get,identities,[receiver]);
  apply(set,identities,[receiver,value]);increment('recorded');
  if(prior)increment('overwrites');else{increment('uniqueArrays');increment('recordsHeld');}
  return{classification:'sort-identity-recorded'};
 };
 const query=receiver=>{
  increment('queryCalls');
  if(stats.disposed){increment('rejectedAfterDispose');return{classification:'sort-identity-disposed'};}
  if(!array(receiver)){increment('invalidQueries');return{classification:'invalid-sort-identity-receiver'};}
  if(!healthy())return{classification:'sort-identity-incomplete'};
  const metadata=apply(get,identities,[receiver]);
  if(!metadata){increment('unknowns');return{classification:'unknown-sort-identity'};}
  increment('matches');return{classification:'observed-completed-sort-identity',...metadata};
 };
 const dispose=()=>{if(!stats.disposed){stats.disposed=true;stats.recordsCleared=stats.recordsHeld;stats.recordsHeld=0;identities=null;}return snapshot();};
 return freeze({record,query,snapshot,dispose});
}
