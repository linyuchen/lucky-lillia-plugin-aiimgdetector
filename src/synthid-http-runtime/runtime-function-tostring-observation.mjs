import WindowModule from 'jsdom/lib/jsdom/browser/Window.js';
import jsdomPackage from 'jsdom/package.json' with {type:'json'};
import {installFunctionToStringObservation,functionToStringIntrinsicNames,functionToStringNativeNameSupplement} from './function-tostring-observation.mjs';
import {webIdlConstructorNames} from './webidl-realm-catalog.mjs';
import {staticStandardPropertyNames} from './static-standard-property-catalog.mjs';
import {createCompletedToStringComparison} from './completed-tostring-comparison.mjs';
const nativeNames=new Set([...webIdlConstructorNames,...staticStandardPropertyNames,...functionToStringIntrinsicNames,...functionToStringNativeNameSupplement]);
const nativePrefixes=new Set(['plain','get','set','bound']);
const nativeSyntaxes=new Set(['identifier','dotted','symbol','space-separated','other']);
const nativeLengthBuckets=new Set(['1-8','9-16','17-32','33plus']);
const sanitizeNativeNames=report=>{
 const source=report.nativeNameRecords;
 if(!Array.isArray(source)||source.length>128||!Array.isArray(report.records)||report.records.length>128||!Number.isInteger(report.unknownNativeNames)||report.unknownNativeNames<0||report.unknownNativeNames>1000000)throw Error('INVALID_TOSTRING_NATIVE_NAMES');
 const nativeNameRecords=[],knownIndices=new Set();let previousIndex=-1;
 for(const row of source){
  if(!row||!Number.isInteger(row.callIndex)||row.callIndex<=previousIndex||row.callIndex>=report.records.length
   ||report.records[row.callIndex].resultCategory!=='native-named'||!nativeNames.has(row.member)||!nativePrefixes.has(row.prefix))throw Error('INVALID_TOSTRING_NATIVE_NAMES');
  nativeNameRecords.push({callIndex:row.callIndex,member:row.member,prefix:row.prefix});knownIndices.add(row.callIndex);previousIndex=row.callIndex;
 }
 const shapes=report.unknownNativeNameShapes,unknownNativeNameShapes=[];previousIndex=-1;
 if(!Array.isArray(shapes)||shapes.length>128)throw Error('INVALID_TOSTRING_NATIVE_NAMES');
 for(const row of shapes){
  if(!row||!Number.isInteger(row.callIndex)||row.callIndex<=previousIndex||row.callIndex>=report.records.length
   ||knownIndices.has(row.callIndex)||report.records[row.callIndex].resultCategory!=='native-named'
   ||!nativeSyntaxes.has(row.syntax)||!nativeLengthBuckets.has(row.lengthBucket))throw Error('INVALID_TOSTRING_NATIVE_NAMES');
  unknownNativeNameShapes.push({callIndex:row.callIndex,syntax:row.syntax,lengthBucket:row.lengthBucket});previousIndex=row.callIndex;
 }
 return{...report,nativeNamesAreParsedPublicNames:report.nativeNamesAreParsedPublicNames===true,unknownNativeNames:report.unknownNativeNames,nativeNameRecords,unknownNativeNameShapes};
};
let active=false;
export function installRuntimeFunctionToStringObservation(window,{children=false,maximumRealms=32,comparison=undefined}={}){
 if(jsdomPackage.version!=='26.1.0'||active||typeof children!=='boolean'||!Number.isInteger(maximumRealms)||maximumRealms<1||maximumRealms>32)throw Error('INVALID_TOSTRING_RUNTIME');
 const original=Object.getOwnPropertyDescriptor(WindowModule,'createWindow');
 if(children&&(!original?.writable||typeof original.value!=='function'))throw Error('UNSUPPORTED_CHILD_FACTORY');
 const comparisonEnabled=comparison!==undefined;
 let pendingKey;
 if(comparisonEnabled){
  const keyDescriptor=comparison&&(typeof comparison==='object'||typeof comparison==='function')?Object.getOwnPropertyDescriptor(comparison,'keyBytes'):undefined;
  const supplied=keyDescriptor&&Object.hasOwn(keyDescriptor,'value')?keyDescriptor.value:undefined;
  if(!Array.isArray(supplied)||Object.getOwnPropertyDescriptor(supplied,'length')?.value!==32)throw Error('INVALID_COMPARISON_KEY');
  pendingKey=[];
  try{for(let index=0;index<32;index++){
   const descriptor=Object.getOwnPropertyDescriptor(supplied,index),value=descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
   if(!Number.isInteger(value)||value<0||value>255)throw Error('INVALID_COMPARISON_KEY');
   pendingKey[index]=value;
  }}catch(error){for(let index=0;index<pendingKey.length;index++)pendingKey[index]=0;throw error;}
 }
 const clearPendingKey=()=>{if(pendingKey){for(let index=0;index<pendingKey.length;index++)pendingKey[index]=0;pendingKey=undefined;}};
 const records=[];let disposed=false,wrapper,selectionSeen=false,targetRecord,comparisonDrained=false;
 const stats={diagnosticOnly:true,children,maximumRealms,installedRealms:0,skippedRealms:0,installationFailures:0,foreignRegistrationFailures:0,limitReached:false,restoreConflict:false,disposalFailures:0,disposed:false};
 const source='('+installFunctionToStringObservation.toString()+')(window)';
 const comparisonSource='(function(keyBytes){const collector=('+createCompletedToStringComparison.toString()+')({keyBytes});let control;try{control=('
  +installFunctionToStringObservation.toString()+')(window,undefined,undefined,128,collector.observe);if(!control.snapshot().success)throw Error("TOSTRING_INSTALL_FAILED");return {control,collector};}'
  +'catch(error){try{control?.dispose();}finally{collector.dispose();}throw error;}})';
 const install=(realm,kind)=>{
  const selected=comparisonEnabled&&!comparisonDrained&&kind==='sourceless'&&!selectionSeen;
  if(selected)selectionSeen=true;
  if(records.length>=maximumRealms){stats.limitReached=true;if(selected)clearPendingKey();return;}
  let control,collector;
  try{
   if(!realm||realm.Function===Function||typeof realm.eval!=='function')throw Error('UNSUPPORTED_REALM');
   if(selected)({control,collector}=realm.eval(comparisonSource)(pendingKey));
   else {control=realm.eval(source);if(!control.snapshot().success){control.dispose();throw Error('TOSTRING_INSTALL_FAILED');}}
  }finally{if(selected)clearPendingKey();}
  for(const previous of records){
   try{if(!control.registerForeignWindow(previous.realm))stats.foreignRegistrationFailures++;}catch{stats.foreignRegistrationFailures++;}
   try{if(!previous.control.registerForeignWindow(realm))stats.foreignRegistrationFailures++;}catch{stats.foreignRegistrationFailures++;}
  }
  const record={kind,realm,control,collector};records.push(record);stats.installedRealms++;
  if(selected)targetRecord=record;
 };
 const dispose=()=>{
  if(disposed)return;disposed=true;stats.disposed=true;
  try{if(wrapper){if(Object.getOwnPropertyDescriptor(WindowModule,'createWindow')?.value===wrapper)Object.defineProperty(WindowModule,'createWindow',original);else stats.restoreConflict=true;}}
  catch{stats.disposalFailures++;}
  for(const {control,collector}of records.slice().reverse()){
   try{control.dispose();}catch{stats.disposalFailures++;}
   try{collector?.dispose();}catch{stats.disposalFailures++;}
  }
  clearPendingKey();
  for(const record of records)record.realm=undefined;
  active=false;
 };
 try{
  install(window,'top');
  if(children){
   wrapper=function createWindowWithToStringObservation(options){
    const result=Reflect.apply(original.value,this,arguments);if(disposed)return result;
    if(!options||!Object.hasOwn(options,'parentOrigin')||options.runScripts!=='outside-only'){stats.skippedRealms++;return result;}
    try{install(Object.getOwnPropertyDescriptor(result,'_globalProxy')?.value,options.url&&String(options.url)!=='about:blank'?'sourced':'sourceless');}catch{stats.installationFailures++;}
    return result;
   };
   Object.defineProperty(WindowModule,'createWindow',{...original,value:wrapper});
  }
  active=true;
 }catch(error){dispose();throw error;}
 const takeComparison=()=>{
  const target={targetKind:'sourceless',targetIndex:0,targetObserved:!!targetRecord};
  if(comparisonDrained)return{records:[],counts:targetRecord?.collector.snapshotCounts()??null,complete:false,alreadyDrained:true,...target};
  comparisonDrained=true;clearPendingKey();
  if(!targetRecord)return{records:[],counts:null,complete:false,alreadyDrained:false,...target};
  const packet=targetRecord.collector.takeComparison(),observed=targetRecord.control.snapshot();
  const observerComplete=observed.success&&!observed.skipped&&!observed.disposed&&observed.completedObserverEnabled
   &&observed.completedObserverCalls===packet.counts.observedCalls&&!observed.droppedCalls&&!observed.observationFailures
   &&!observed.completedObserverFailures&&!observed.setupFailures&&!observed.scanFailures&&!observed.foreignRegistrationFailures
   &&!observed.identityLimitReached&&!observed.foreignWindowLimitReached&&!observed.restoreConflict&&!observed.restoreFailures;
  const adapterComplete=!disposed&&!stats.installationFailures&&!stats.foreignRegistrationFailures&&!stats.disposalFailures&&!stats.limitReached&&!stats.restoreConflict;
  return{...packet,complete:packet.complete&&!!observerComplete&&adapterComplete,...target};
 };
 return{snapshot:()=>({...stats,realms:records.map(({kind,control})=>({kind,...sanitizeNativeNames(control.snapshot())})),
  comparison:{enabled:comparisonEnabled,targetKind:'sourceless',targetIndex:0,targetObserved:!!targetRecord,counts:targetRecord?.collector.snapshotCounts()??null}}),takeComparison,dispose};
}
