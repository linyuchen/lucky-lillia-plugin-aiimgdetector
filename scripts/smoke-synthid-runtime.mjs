import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
// Local authored program only; no Google resources, account or network access.
const entry=process.argv[2]?pathToFileURL(resolve(process.argv[2])):new URL('../lib/synthid-http-runtime/entry.mjs',import.meta.url);
if(process.platform!=='win32'||process.arch!=='x64'||process.versions.modules!=='137')throw Error('This runtime smoke requires Windows x64 and Node.js 24');
const {createLifecycleClient}=await import(entry.href);
const client=createLifecycleClient({webidlBrandErrors:true,nativePluginGetters:true,nativeTimerResolution:true,nativeDisplayFrames:true,maxLifetimeMs:15000});
let disposed;
try {
 const result=await client.initialize({program:'authored-runtime-smoke',globalName:'fixture',experiments:'[]',
  interpreter:`globalThis.fixture={a(program,ready){
   const frame=document.createElement('iframe');document.body.append(frame);
   ready((done,input)=>{if(!input[0].blobref.endsWith('/fixture'))throw Error('BAD_BINDING');done('!authored-runtime-smoke');},()=>{});
  }};`,
  pageUrl:'https://synthid.com/image-detection',pageHTML:'<!doctype html><body></body>',
  pageGlobals:{WIZ_global_data:{cfb2h:'fixture'}},
  frameUrl:'https://synthid.com/_/bscframe',frameHTML:'<!doctype html><body></body>',
  userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  performanceEntries:[{name:'https://synthid.com/image-detection',entryType:'navigation',startTime:0,duration:2,fetchStart:0,requestStart:0,responseStart:1,responseEnd:2,encodedBodySize:64,decodedBodySize:64}],
  eventClockCompatibility:true,enablePointerDiagnostics:true,clockPrecision100us:true,chromiumTimeClamper:true,
  runtimeWebCompatibility:true,runtimeChildWebCompatibility:true,runtimeNavigatorCompatibility:true,runtimeWindowStateCompatibility:true,runtimeNetworkCompatibility:true,
  runtimeDetachedFrameCompatibility:true,runtimeWebIdlRealmCompatibility:true,runtimeWebIdlCallableControl:true,runtimePermissionsBinding:true,runtimeAnchorHrefTranslate:true,
  runtimeMouseMediaCompatibility:true,runtimeChromeCsi:true,runtimeCssProperties:true,nativeWebdriverGetter:true,nativeMediaBinding:true,
  activationStateControl:true,activationTimingControl:true,virtualFocusControl:true,webidlBrandErrors:true,nativePluginGetters:true,nativePluginBrandValidation:true,nativeTimerResolution:true,nativeDisplayFrames:true,
 });
 assert.equal(result.success,true);
 assert.equal((await client.dispatchPointerDiagnostics()).success,true);
 assert.equal((await client.snapshot('/synthid-demo-drop-zone/ttl_1d/users/fixture/files/fixture')).bgToken,'!authored-runtime-smoke');
}finally{disposed=await client.dispose();}
assert.equal(disposed.success,true);assert.equal(disposed.shutdownCompleted,true);
assert.equal(disposed.nativeTimerResolutionControl.restored,true);assert.equal(disposed.displayFrameControl.drained,true);
assert.equal(client.telemetry.exited,true);assert.equal(client.telemetry.exitCode,0);
console.log(JSON.stringify({success:true,initialized:true,snapshot:true,nativeRestored:true,workerExited:true,browserUsed:false,networkRequests:0}));
