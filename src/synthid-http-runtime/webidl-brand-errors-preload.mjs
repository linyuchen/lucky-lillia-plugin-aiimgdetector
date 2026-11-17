// Optional JSDOM 26 binding adaptation. Changes only the literal error message
// in generated receiver-brand guards. Official/page code and error constructors
// are untouched; dependency files are never rewritten.
import {registerHooks,createRequire} from 'node:module';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parse} from 'acorn';
import jsdomPackage from 'jsdom/package.json' with {type:'json'};
const brandRequire=createRequire(import.meta.url);
const prefix=pathToFileURL(dirname(brandRequire.resolve('jsdom/package.json'))+'/lib/jsdom/living/generated/').href;
if(jsdomPackage.version!=='26.1.0')throw Error('UNSUPPORTED_JSDOM_BRAND_ERRORS');
const stats={diagnosticOnly:true,jsdomBindingMessagesAdapted:true,officialCodeModified:false,errorConstructorsModified:false,dependencyFilesWritten:false,inspectedModules:0,changedModules:0,changedMessages:0,parseFailures:0,unsupportedSources:0};
const member=(node,object,property)=>node?.type==='MemberExpression'&&!node.computed&&node.object?.type==='Identifier'&&node.object.name===object&&node.property?.type==='Identifier'&&node.property.name===property;
export function adaptJsdomBrandErrors(source){
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'script'}),changes=[];
  const stack=[[ast,null,null]];let visited=0;
  while(stack.length){
    if(++visited>250000)throw Error('BRAND_AST_LIMIT');
    const [node,parent,grand]=stack.pop();
    if(node.type==='ThrowStatement'&&parent?.type==='BlockStatement'&&grand?.type==='IfStatement'&&grand.consequent===parent){
      const guard=grand.test,call=guard?.argument,err=node.argument,literal=err?.arguments?.[0];
      if(guard?.type==='UnaryExpression'&&guard.operator==='!'&&call?.type==='CallExpression'&&member(call.callee,'exports','is')&&call.arguments.length===1&&call.arguments[0]?.type==='Identifier'&&call.arguments[0].name==='esValue'&&err?.type==='NewExpression'&&member(err.callee,'globalObject','TypeError')&&err.arguments.length===1&&literal?.type==='Literal'&&typeof literal.value==='string'&&/^'(?:(?:get|set) )?[^']+' called on an object that is not a valid instance of [A-Z][A-Za-z0-9]*.$/.test(literal.value))changes.push([literal.start,literal.end,literal.value]);
    }
    for(const [key,value]of Object.entries(node)){
      if(key==='start'||key==='end')continue;
      if(Array.isArray(value)){for(const child of value)if(child&&typeof child==='object'&&typeof child.type==='string')stack.push([child,node,parent]);}
      else if(value&&typeof value==='object'&&typeof value.type==='string')stack.push([value,node,parent]);
    }
  }
  let output=source;for(const[start,end,literal]of changes.sort((a,b)=>b[0]-a[0])){

    const asynchronous={"'play' called on an object that is not a valid instance of HTMLMediaElement.":"Failed to execute 'play' on 'HTMLMediaElement': Illegal invocation","'whenDefined' called on an object that is not a valid instance of CustomElementRegistry.":"Failed to execute 'whenDefined' on 'CustomElementRegistry': Illegal invocation"};
    output=output.slice(0,start)+JSON.stringify(asynchronous[literal]||'Illegal invocation')+output.slice(end);
  }
  return {source:output,changedMessages:changes.length};
}
registerHooks({load(url,context,nextLoad){
  const result=nextLoad(url,context);
  if(!url.startsWith(prefix)||!/^[-A-Za-z0-9]+.js$/.test(url.slice(prefix.length)))return result;
  if(++stats.inspectedModules>600)throw Error('BRAND_MODULE_LIMIT');
  if(!['commonjs','commonjs-typescript'].includes(result.format)||result.source===undefined||result.source===null){stats.unsupportedSources++;throw Error('BRAND_SOURCE_UNAVAILABLE');}
  const source=typeof result.source==='string'?result.source:Buffer.from(result.source).toString('utf8');
  if(source.length>1048576)throw Error('BRAND_SOURCE_LIMIT');
  let adapted;try{adapted=adaptJsdomBrandErrors(source);}catch{stats.parseFailures++;throw Error('BRAND_SOURCE_PARSE_FAILED');}
  if(!adapted.changedMessages)return result;
  stats.changedModules++;stats.changedMessages+=adapted.changedMessages;
  return {...result,source:adapted.source};
}});
export const webidlBrandErrorSnapshot=()=>({...stats});
