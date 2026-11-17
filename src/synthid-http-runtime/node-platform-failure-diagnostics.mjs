import {types} from 'node:util';
import {URL as NativeURL} from 'node:url';
import ElementModule from 'jsdom/lib/jsdom/living/nodes/Element-impl.js';
import utils from 'jsdom/lib/jsdom/living/generated/utils.js';
import jsdomPackage from 'jsdom/package.json' with {type:'json'};

const get=Object.getOwnPropertyDescriptor,prototypeOf=Object.getPrototypeOf,own=Object.hasOwn,isProxy=types.isProxy;
const object=value=>value!==null&&(typeof value==='object'||typeof value==='function');
const data=(value,key)=>{
 if(!object(value)||isProxy(value))return undefined;
 const descriptor=get(value,key);return descriptor&&own(descriptor,'value')?descriptor.value:undefined;
};
const ERROR_CATEGORIES=Object.freeze(['navigation-not-implemented','canvas-not-implemented','other-not-implemented',
 'resource-loading','css-parsing','unhandled-exception','other']);
const SCHEMES=Object.freeze(['http','https','data','about','blob','file','javascript','other','invalid']);
const RELATIONS=Object.freeze(['same-origin','cross-origin','not-http','unknown']);
const ELEMENT_KINDS=Object.freeze(['iframe','frame','link','script','img','audio','video','source','object','embed','other','unknown']);
const ELEMENT_NAMES=new Set(ELEMENT_KINDS.slice(0,-2));
const LIMIT=1000000,MAX_URL_LENGTH=16384,MAX_MESSAGE_LENGTH=65536,MAX_PROTOTYPE_DEPTH=16;
const MAX_BUCKETS=SCHEMES.length*RELATIONS.length*ELEMENT_KINDS.length;
const HTML_NAMESPACE='http://www.w3.org/1999/xhtml';

function classifyElement(options){
 const wrapper=data(options,'element'),impl=data(wrapper,utils.implSymbol);
 if(!object(impl)||isProxy(impl)||data(impl,utils.wrapperSymbol)!==wrapper)return 'unknown';
 let current=impl,matched=false;
 for(let depth=0;object(current)&&depth<MAX_PROTOTYPE_DEPTH;depth++){
  if(isProxy(current))return 'unknown';
  if(current===ElementModule.implementation.prototype){matched=true;break;}
  current=prototypeOf(current);
 }
 if(!matched)return 'unknown';
 const name=data(impl,'_localName'),namespace=data(impl,'_namespaceURI');
 if(typeof name!=='string'||typeof namespace!=='string')return 'unknown';
 return namespace===HTML_NAMESPACE&&ELEMENT_NAMES.has(name)?name:'other';
}

/** Synchronous observations only: no listeners, requests, mutations or clocks.
 * Root calls these inside its existing error handler/refused-resource branch.
 * Aggregate buckets contain only fixed labels; no input object is retained. */
export function createNodePlatformFailureDiagnostics(pageUrl){
 if(jsdomPackage.version!=='26.1.0')throw Error('PLATFORM_FAILURE_UNSUPPORTED_JSDOM');
 let pageOrigin;
 try{
  if(typeof pageUrl!=='string'||pageUrl.length>MAX_URL_LENGTH)throw Error();
  const parsed=new NativeURL(pageUrl);
  if(parsed.protocol!=='http:'&&parsed.protocol!=='https:')throw Error();
  pageOrigin=parsed.origin;
 }catch{throw TypeError('PLATFORM_FAILURE_INVALID_PAGE_URL');}
 const errors={total:0,byCategory:Object.fromEntries(ERROR_CATEGORIES.map(key=>[key,0])),
  proxyInputsIgnored:0,typeUnavailable:0,messageUnavailable:0};
 const resources={total:0,invalidUrlInputs:0,unknownElements:0};
 const buckets=new Map();let limitReached=false;
 const increment=(target,key)=>{if(target[key]<LIMIT)target[key]++;else limitReached=true;};
 function noteJsdomError(error){
  if(errors.total>=LIMIT){limitReached=true;return;}
  increment(errors,'total');let category='other';
  try{
   if(object(error)&&isProxy(error))increment(errors,'proxyInputsIgnored');
   const type=data(error,'type');
   if(typeof type!=='string')increment(errors,'typeUnavailable');
   else if(type==='not implemented'){
    category='other-not-implemented';
    const message=data(error,'message');
    if(typeof message!=='string'||message.length>MAX_MESSAGE_LENGTH)increment(errors,'messageUnavailable');
    else if(message.startsWith('Not implemented: navigation (except hash changes)'))category='navigation-not-implemented';
    else if(message.startsWith('Not implemented: HTMLCanvasElement.prototype.'))category='canvas-not-implemented';
   }else if(type==='resource loading')category='resource-loading';
   else if(type==='css parsing'||type==='css @import URL parsing')category='css-parsing';
   else if(type==='unhandled exception')category='unhandled-exception';
  }catch{category='other';}
  increment(errors.byCategory,category);
 }
 function noteRefusedResource(url,options){
  if(resources.total>=LIMIT){limitReached=true;return;}
  increment(resources,'total');
  let scheme='invalid',httpOriginRelation='unknown',elementKind='unknown';
  try{
   if(typeof url!=='string'||url.length>MAX_URL_LENGTH)throw Error();
   // JSDOM passes absolute resolved resource URLs. Relative or invalid inputs
   // remain unknown; the diagnostic does not reinterpret the loader's target.
   const parsed=new NativeURL(url),protocol=parsed.protocol.slice(0,-1);
   scheme=SCHEMES.includes(protocol)&&protocol!=='invalid'?protocol:'other';
   httpOriginRelation=scheme==='http'||scheme==='https'
    ?(parsed.origin===pageOrigin?'same-origin':'cross-origin'):'not-http';
  }catch{increment(resources,'invalidUrlInputs');}
  try{elementKind=classifyElement(options);}catch{}
  if(elementKind==='unknown')increment(resources,'unknownElements');
  // This key is composed exclusively of three fixed enums, never URL text or
  // an element name supplied by page code. Maximum cardinality is fixed.
  const key=scheme+'|'+httpOriginRelation+'|'+elementKind;
  let bucket=buckets.get(key);
  if(!bucket){
   if(buckets.size>=MAX_BUCKETS){limitReached=true;return;}
   bucket={scheme,httpOriginRelation,elementKind,count:0};buckets.set(key,bucket);
  }
  increment(bucket,'count');
 }
 function snapshot(){
  return{schemaVersion:1,diagnosticOnly:true,pinnedJsdomVersion:'26.1.0',
   counterLimit:LIMIT,maximumResourceBuckets:MAX_BUCKETS,limitReached,
   errorMessagesRecorded:false,errorStacksRecorded:false,urlsRecorded:false,inputObjectsRetained:false,
   listenersInstalled:false,resourceDecisionsModified:false,
   errors:{...errors,byCategory:{...errors.byCategory}},
   refusedResources:{...resources,buckets:[...buckets.values()].map(bucket=>({...bucket}))}};
 }
 return Object.freeze({noteJsdomError,noteRefusedResource,snapshot});
}
