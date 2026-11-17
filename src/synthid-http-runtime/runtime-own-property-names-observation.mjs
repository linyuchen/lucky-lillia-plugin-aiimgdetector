import WindowModule from 'jsdom/lib/jsdom/browser/Window.js';
import {installOwnPropertyNamesObservation} from './own-property-names-observation.mjs';
import {installOwnPropertyNamesObservation as installCrossRealmObservation,createOwnPropertyNamesCrossRealmRegistry} from './own-property-names-cross-realm.mjs';
import {installOwnPropertyNamesObservation as installSortResultObservation} from './own-property-names-sort-results.mjs';
import {createCompletedToStringComparison} from './completed-tostring-comparison.mjs';
import {installRafSortIntervalAttribution} from './raf-sort-interval-attribution.mjs';
import {createCompletedSortNumberProfile} from './completed-sort-number-profile.mjs';
import {createCompletedSortIdentityRegistry} from './completed-sort-identity-registry.mjs';
import {staticStandardPropertyNames} from './static-standard-property-catalog.mjs';
let active=false;
export function installRuntimeOwnPropertyNamesObservation(window,{children=false,identifyInterfacePrototypes=false,observeArrayConsumers=false,crossRealmConsumers=false,observeUntrackedSortResults=false,sortComparison=undefined,observeNumberProfiles=false,observeRafIntervals=false,rafScope='sourced',sortIdentityRegistryKey=undefined}={}){
 const comparisonEnabled=sortComparison!==undefined;
 const sortIdentityEnabled=sortIdentityRegistryKey!==undefined;
 if(sortIdentityEnabled&&(!observeUntrackedSortResults||typeof sortIdentityRegistryKey!=='string'||!/^__synthid_sort_identity_[a-f0-9]{32}$/.test(sortIdentityRegistryKey)))throw Error('INVALID_SORT_IDENTITY_OPTIONS');
 if(!['sourced','top'].includes(rafScope)||rafScope==='top'&&!observeRafIntervals)throw Error('INVALID_RAF_SCOPE');
 let topRaf;
 if(typeof observeRafIntervals!=="boolean"||observeRafIntervals&&!comparisonEnabled)throw Error("INVALID_RAF_ATTRIBUTION_OPTIONS");
 if(typeof observeNumberProfiles!=='boolean'||observeNumberProfiles&&!comparisonEnabled)throw Error('INVALID_SORT_PROFILE_OPTIONS');
 if(active||typeof children!=='boolean'||typeof identifyInterfacePrototypes!=='boolean'||typeof observeArrayConsumers!=='boolean'||typeof crossRealmConsumers!=='boolean'||crossRealmConsumers&&!observeArrayConsumers||typeof observeUntrackedSortResults!=='boolean'||observeUntrackedSortResults&&!crossRealmConsumers||comparisonEnabled&&!observeUntrackedSortResults)throw Error('INVALID_OWN_NAMES_RUNTIME');
 const original=Object.getOwnPropertyDescriptor(WindowModule,'createWindow');
 if(children&&(!original?.writable||typeof original.value!=='function'))throw Error('UNSUPPORTED_CHILD_FACTORY');
 let pendingKey;
 const clearPendingKey=()=>{if(pendingKey){for(let index=0;index<pendingKey.length;index++)pendingKey[index]=0;pendingKey=undefined;}};
 if(comparisonEnabled){
  try{
   const field=sortComparison&&(typeof sortComparison==='object'||typeof sortComparison==='function')?Object.getOwnPropertyDescriptor(sortComparison,'keyBytes'):undefined;
   const supplied=field&&Object.hasOwn(field,'value')?field.value:undefined;
   if(!Array.isArray(supplied)||Object.getOwnPropertyDescriptor(supplied,'length')?.value!==32)throw Error('INVALID_SORT_COMPARISON_KEY');
   pendingKey=[];
   for(let index=0;index<32;index++){
    const descriptor=Object.getOwnPropertyDescriptor(supplied,index),value=descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
    if(!Number.isInteger(value)||value<0||value>255)throw Error('INVALID_SORT_COMPARISON_KEY');
    pendingKey[index]=value;
   }
  }catch(error){clearPendingKey();throw error;}
 }
 sortComparison=undefined;
 const records=[],stats={diagnosticOnly:true,maximumRealms:32,installationFailures:0,skippedRealms:0,limitReached:false,disposed:false,restoreConflict:false,disposalFailures:0};
 let wrapper,selectionSeen=false,targetRecord,comparisonDrained=false,sourcedRealmsSeen=0;
 let sharedRegistry,sortIdentityRegistry;
 const identityPublications=[],identityPublication={published:false,publishedRealms:0,clearedPublications:0,publicationConflict:false,publicationCleanupComplete:false};
 const publishIdentity=realm=>{
  if(identityPublications.some(item=>item===realm))return;
  if(identityPublications.length>=32)throw Error('SORT_IDENTITY_PUBLICATION_LIMIT');
  if(Object.getOwnPropertyDescriptor(realm,sortIdentityRegistryKey))throw Error('SORT_IDENTITY_REGISTRY_COLLISION');
  Object.defineProperty(realm,sortIdentityRegistryKey,{value:sortIdentityRegistry,enumerable:false,configurable:true,writable:false});
  identityPublications.push(realm);identityPublication.published=true;identityPublication.publishedRealms++;
 };
 try{sharedRegistry=crossRealmConsumers?createOwnPropertyNamesCrossRealmRegistry():undefined;}catch(error){clearPendingKey();throw error;}
 const source='('+installOwnPropertyNamesObservation.toString()+')(window,'+JSON.stringify(staticStandardPropertyNames)+','+identifyInterfacePrototypes+','+observeArrayConsumers+')';
 const install=(realm,kind)=>{
  if(comparisonEnabled&&kind==='sourced')sourcedRealmsSeen=Math.min(1000000,sourcedRealmsSeen+1);
  const selected=comparisonEnabled&&!comparisonDrained&&kind==='sourced'&&!selectionSeen;
  if(selected)selectionSeen=true;
  if(records.length>=32){stats.limitReached=true;if(selected)clearPendingKey();return;}
  let control,collector,profile,raf;
  try{
   if(!realm||realm.Function===Function||typeof realm.eval!=='function')throw Error('UNSUPPORTED_REALM');
   if(sortIdentityEnabled)publishIdentity(realm);
   if(selected)collector=Reflect.apply(realm.eval('('+createCompletedToStringComparison.toString()+')'),undefined,[{keyBytes:pendingKey}]);
   if(selected&&observeNumberProfiles)profile=Reflect.apply(realm.eval('('+createCompletedSortNumberProfile.toString()+')'),undefined,[]);
   if(observeRafIntervals&&rafScope==='top'&&kind==='top')topRaf=Reflect.apply(realm.eval('('+installRafSortIntervalAttribution.toString()+')'),undefined,[realm]);
   if(selected&&observeRafIntervals)raf=rafScope==='top'?topRaf:Reflect.apply(realm.eval('('+installRafSortIntervalAttribution.toString()+')'),undefined,[realm]);
   if(kind==='top'&&topRaf)raf=topRaf;
   const observe=collector&&(profile||raf)?(value,index)=>{profile?.observe(value,index);raf?.observe(value,index);collector.observe(value,index);}:collector?.observe;
   const realmIndex=records.length,observeIdentity=sortIdentityEnabled?(receiver,metadata)=>{
    const result=sortIdentityRegistry.record(receiver,{realmKind:kind,realmIndex,callIndex:metadata.callIndex,completedOrdinal:metadata.completedOrdinal,numericOnly:metadata.numericOnly});
    if(result.classification!=='sort-identity-recorded')throw Error('SORT_IDENTITY_RECORD_FAILED');
   }:undefined;
   control=crossRealmConsumers?Reflect.apply(realm.eval('('+(observeUntrackedSortResults?installSortResultObservation:installCrossRealmObservation).toString()+')'),undefined,[realm,staticStandardPropertyNames,identifyInterfacePrototypes,observeArrayConsumers,sharedRegistry,observeUntrackedSortResults,...(sortIdentityEnabled?[observe,observeIdentity]:collector?[observe]:[])]):realm.eval(source);
   if(selected&&!control.snapshot().success)throw Error('SORT_COMPARISON_INSTALL_FAILED');
   const record={kind,control,collector,profile,raf};records.push(record);if(selected)targetRecord=record;
  }catch(error){try{control?.dispose();}catch{stats.disposalFailures++;}try{collector?.dispose();}catch{stats.disposalFailures++;}try{profile?.dispose();}catch{stats.disposalFailures++;}try{raf?.dispose();}catch{stats.disposalFailures++;}throw error;}
  finally{if(selected)clearPendingKey();}
 };
 const comparisonSnapshot=()=>({enabled:true,targetKind:'sourced-sort-results',targetIndex:0,targetRealmKind:'sourced',targetObserved:!!targetRecord,sourcedRealmsSeen,sourcedRealmsOutsideScope:Math.max(0,sourcedRealmsSeen-1),collectorRealm:'selected-sourced',counts:targetRecord?.collector.snapshotCounts()??null,...(observeNumberProfiles?{numberProfiles:targetRecord?.profile.snapshot()??null}:{}),...(observeRafIntervals?{rafObservedRealmKind:rafScope,rafIntervalAttribution:targetRecord?.raf.snapshot()??null}:{})});
 const identitySnapshot=()=>{
  const result=sortIdentityRegistry?.snapshot(),observerComplete=records.length>0&&records.every(({control})=>{const o=control.snapshot(),s=o.arrayConsumers?.untrackedSortResults;return o.success===true&&s?.enabled===true&&!s.disposed&&s.completedIdentityObserverEnabled===true&&!s.completedIdentityIncomplete&&!s.completedIdentityObserverFailures&&!s.completedIdentityObserverOmissions&&s.completedIdentityObserverCalls===s.returnedArrays;});
  const published=identityPublication.published&&identityPublications.every(realm=>Object.getOwnPropertyDescriptor(realm,sortIdentityRegistryKey)?.value===sortIdentityRegistry);
  return{...result,...identityPublication,published,observerComplete,complete:result?.complete===true&&published&&!identityPublication.publicationConflict&&observerComplete&&!stats.installationFailures&&!stats.disposalFailures&&!stats.limitReached&&!stats.restoreConflict};
 };
 const snapshot=()=>({...stats,...(sharedRegistry?{sharedArrayRegistry:sharedRegistry.snapshot()}:{}),...(sortIdentityEnabled?{sortIdentityRegistry:identitySnapshot()}:{}),realms:records.map(({kind,control},realmIndex)=>({realmIndex,kind,...control.snapshot()})),...(comparisonEnabled?{sortComparison:comparisonSnapshot()}:{})});
 const observerComplete=o=>{
  const c=o.arrayConsumers,s=c?.untrackedSortResults;
  return o.success===true&&!o.skipped&&!o.disposed&&!o.setupFailures&&!o.callLimitReached&&!o.elementLimitReached&&!o.countLimitReached&&!o.observationsIncomplete&&!o.observationFailures&&!o.droppedCalls&&!o.descriptorFailures&&!o.reentrantObservationsSkipped&&!o.restoreConflict&&!o.restoreFailures
   &&o.calls===o.returned+o.threw&&o.calls===o.recordedCalls&&o.returned===o.observationsComplete
   &&c?.enabled===true&&!c.disposed&&c.installedMethods===2&&!c.setupFailures&&!c.callLimitReached&&!c.identityLimitReached&&!c.elementLimitReached&&!c.countLimitReached&&!c.observationsIncomplete&&!c.observationFailures&&!c.droppedCalls&&!c.descriptorFailures&&!c.registryFailures&&!c.reentrantObservationsSkipped&&!c.restoreConflict&&!c.restoreFailures
   &&c.calls===c.returned+c.threw&&c.calls===c.recordedCalls&&c.records.length===c.recordedCalls&&c.records.every(row=>row.before?.observation==='complete'&&row.after?.observation==='complete')
   &&s?.enabled===true&&!s.disposed&&!s.callLimitReached&&!s.elementLimitReached&&!s.countLimitReached&&!s.droppedCalls&&!s.descriptorFailures&&!s.observationFailures&&!s.observationsIncomplete&&!s.reentrantObservationsSkipped&&!s.threw&&!s.nonArrayReturns
   &&s.calls===s.returned&&s.returned===s.recordedCalls&&s.records.length===s.recordedCalls&&s.observationsComplete===s.recordedCalls&&s.records.every(row=>row.outcome==='returned'&&row.observation==='complete');
 };
 const takeSortComparison=()=>{
  const target={targetKind:'sourced-sort-results',targetIndex:0,targetObserved:!!targetRecord};
  if(comparisonDrained)return{...target,records:[],counts:targetRecord?.collector.snapshotCounts()??null,complete:false,alreadyDrained:true};
  comparisonDrained=true;clearPendingKey();
  if(!targetRecord)return{...target,records:[],counts:null,complete:false,alreadyDrained:false};
  const packet=targetRecord.collector.takeComparison(),s=targetRecord.control.snapshot().arrayConsumers?.untrackedSortResults,shared=sharedRegistry?.snapshot();
  const complete=packet.complete&&!stats.disposed&&!stats.installationFailures&&!stats.disposalFailures&&!stats.limitReached&&!stats.restoreConflict&&records.every(({control})=>observerComplete(control.snapshot()))
   &&(!shared||!shared.disposed&&!shared.realmLimitReached&&!shared.identityLimitReached)
   &&s?.completedObserverEnabled===true&&!s.completedObserverFailures&&!s.encodingFailures&&!s.encodingLimitReached&&!s.completedComparisonIncomplete&&!s.unsupportedEncodingRecords&&!s.encodingIncompleteRecords&&s.recordedCalls>0&&s.completedObserverCalls===s.recordedCalls&&s.encodedRecords===s.recordedCalls
   &&s.returnedArrays===s.recordedCalls&&s.records.every(row=>row.completedEncoding==='complete')&&s.encodedTotalCodeUnits===packet.counts.totalCodeUnits
   &&(!observeNumberProfiles||targetRecord.profile.snapshot().complete===true&&targetRecord.profile.snapshot().records.length===s.encodedRecords)
   &&(!observeRafIntervals||targetRecord.raf.snapshot().complete===true)
   &&s.completedObserverCalls===packet.counts.observedCalls&&s.encodedRecords===packet.counts.comparedRecords&&packet.records.length===s.encodedRecords;
  return{...packet,...target,complete:!!complete};
 };
 const dispose=()=>{
  if(stats.disposed)return snapshot();stats.disposed=true;
  try{if(wrapper){if(Object.getOwnPropertyDescriptor(WindowModule,'createWindow')?.value===wrapper)Object.defineProperty(WindowModule,'createWindow',original);else stats.restoreConflict=true;}}catch{stats.disposalFailures++;}
  for(const {control}of records.slice().reverse())try{control.dispose();}catch{stats.disposalFailures++;}
  for(const {collector}of records.slice().reverse())try{collector?.dispose();}catch{stats.disposalFailures++;}
  for(const {profile}of records.slice().reverse())try{profile?.dispose();}catch{stats.disposalFailures++;}
  for(const {raf}of records.slice().reverse())try{raf?.dispose();}catch{stats.disposalFailures++;}
  clearPendingKey();
  try{sharedRegistry?.dispose();}catch{stats.disposalFailures++;}
  if(sortIdentityEnabled){
   try{sortIdentityRegistry?.dispose();}catch{stats.disposalFailures++;}
   let clean=true;for(const realm of identityPublications){try{const descriptor=Object.getOwnPropertyDescriptor(realm,sortIdentityRegistryKey);if(descriptor){if(descriptor.value===sortIdentityRegistry){delete realm[sortIdentityRegistryKey];if(Object.getOwnPropertyDescriptor(realm,sortIdentityRegistryKey)){stats.disposalFailures++;clean=false;continue;}}else{identityPublication.publicationConflict=true;clean=false;continue;}}identityPublication.clearedPublications++;}catch{stats.disposalFailures++;clean=false;}}
   identityPublications.length=0;identityPublication.publicationCleanupComplete=clean;identityPublication.published=false;
  }
  active=false;return snapshot();
 };
 try{
  if(sortIdentityEnabled){
   if(Object.getOwnPropertyDescriptor(window,sortIdentityRegistryKey))throw Error('SORT_IDENTITY_REGISTRY_COLLISION');
   if(!window||window.Function===Function||typeof window.eval!=='function')throw Error('UNSUPPORTED_REALM');
   sortIdentityRegistry=Reflect.apply(window.eval('('+createCompletedSortIdentityRegistry.toString()+')'),undefined,[]);
   publishIdentity(window);
  }
  install(window,'top');
  if(children){
   wrapper=function createWindowWithOwnNamesObservation(options){
    const result=Reflect.apply(original.value,this,arguments);if(stats.disposed)return result;
    if(!options||!Object.hasOwn(options,'parentOrigin')||options.runScripts!=='outside-only'){stats.skippedRealms++;return result;}
    try{install(Object.getOwnPropertyDescriptor(result,'_globalProxy')?.value,options.url&&String(options.url)!=='about:blank'?'sourced':'sourceless');}catch{stats.installationFailures++;}
    return result;
   };
   Object.defineProperty(WindowModule,'createWindow',{...original,value:wrapper});
  }
  active=true;
 }catch(error){dispose();throw error;}
 return {snapshot,dispose,...(comparisonEnabled?{takeSortComparison}:{})};
}
