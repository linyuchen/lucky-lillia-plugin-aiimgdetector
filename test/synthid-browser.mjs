import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
const sourceRuntime = process.argv.includes('--source')
const moduleDirectory = sourceRuntime ? '../src' : '../lib'
const moduleExtension = sourceRuntime ? 'ts' : 'js'
const [{ launchSynthIdBrowser }, { describeSynthIdFailure }] = await Promise.all([
  import(`${moduleDirectory}/synthid-browser.${moduleExtension}`),
  import(`${moduleDirectory}/synthid-result.${moduleExtension}`),
])
console.log(`Testing SynthID browser driver from ${sourceRuntime ? 'TypeScript source' : 'compiled JavaScript'}`)

const calls = []
let resultStatus = 2
const imageBytes = Uint8Array.from({ length: 512 * 1024 + 17 }, (_, index) => index % 256)
const marker = Buffer.from(imageBytes)
const profileDir = await mkdtemp(join(tmpdir(), 'synthid-driver-test-'))
const controller = new AbortController()
let detectionScenario = 'ok'
let detectionAborted = 0
const imageUploads = []
const imageRequests = []
const otherImageBytes = Uint8Array.from({length:8197},(_,index)=>(index*17+5)%256)
let captureScenario = 'ok'
let captureUploadCount = 0
let captureAborted = 0
let accountScenario = 'shell'
let captureReadyDelay = 0
let reactiveReadyDelay = 0
let captureScenarioReads = 0
let workerFixtureEnabled = true
const workerReports = new Map()
let workerPending = 0
let workerAborted = 0
const capturedCredentials = { refreshToken: 'synthetic-latest-refresh-token', pushFilename: 'users/synthetic-user/files/synthetic-file', bgToken: '!synthetic-bg-token' }
const jwt = uid => 'synthetic.' + Buffer.from(JSON.stringify({sub:uid,user_id:uid})).toString('base64url') + '.synthetic'
function html() {
  return '<sid-account-avatar></sid-account-avatar><input type="file" hidden><button id="select" disabled>Select file</button><a id="back" href="/" hidden>Back</a><section id="result" hidden>Detection result</section><script>'
    + 'window.WIZ_global_data={yeeU8:{isLoggedIn:"false"}};'
    + 'localStorage.setItem("firstTime",JSON.stringify({termsAccepted:true}));'
    + 'window.fixtureAuth={currentUser:null};window.firebase={apps:[{auth:()=>fixtureAuth}]};'
    + 'document.querySelector("button").onclick=()=>{window.buttonActivated=true;document.querySelector("input").click();};'
    + 'document.querySelector("#back").onclick=e=>{e.preventDefault();document.querySelector("input").value="";document.querySelector("button").hidden=false;document.querySelector("#back").hidden=true;document.querySelector("#result").hidden=true;history.pushState({},"","/");};'
    + 'function showResult(){document.querySelector("button").hidden=true;document.querySelector("#back").hidden=false;document.querySelector("#result").hidden=false;history.pushState({},"","/image-detection");}'
    + 'document.querySelector("input").onchange=async e=>{const f=e.target.files[0];if(!f)return;showResult();if(f.name==="synthid-login-check.png")return captureFixture(f);return detectionFixture(f);};'
    + 'if(location.pathname==="/welcome")setTimeout(()=>{fixtureAuth.currentUser={uid:"synthetic-user",email:"synthetic@example.test",isAnonymous:false,refreshToken:' + JSON.stringify(capturedCredentials.refreshToken) + '};document.querySelector("button").disabled=false;},' + captureReadyDelay + ');'
    + 'if(location.pathname==="/welcome")setTimeout(()=>{window.reactiveReady=true;document.querySelector("sid-account-avatar").attachShadow({mode:"open"}).innerHTML="<span class=profile-image>L</span>";},' + (captureReadyDelay+reactiveReadyDelay) + ');'
    + 'fetch("https://unrelated.example.test/check");</script>'
    + '<script>if(location.pathname==="/welcome"){let popup=window.open("https://accounts.example.test/start","signin");fetch("/popup-opened-"+Boolean(popup));}</script>'
    + '<iframe src="https://accounts.example.test/frame"></iframe>'
    + (workerFixtureEnabled ? '<script>if(location.pathname==="/welcome"){const w=new Worker("/dedicated-worker.js");w.onmessage=e=>fetch("/worker-report?kind=dedicated",{method:"POST",body:e.data});const s=new SharedWorker("/shared-worker.js");s.port.onmessage=e=>fetch("/worker-report?kind=shared",{method:"POST",body:e.data});s.port.start();}</script>' : '')
}
function accountFixture() {
  const liveUser = accountScenario === 'live'
    ? { uid: 'live-user', email: 'live@example.test', isAnonymous: false }
    : accountScenario === 'anonymous' ? { uid: 'anonymous-user', isAnonymous: true } : null
  const persistedUser = accountScenario === 'indexeddb'
    ? { uid: 'persisted-user', email: 'persisted@example.test', isAnonymous: false }
    : accountScenario === 'live' ? { uid: 'stale-user', email: 'stale@example.test', isAnonymous: false }
      : { uid: 'anonymous-user', isAnonymous: true }
  return '<script>window.WIZ_global_data={yeeU8:{isLoggedIn:"false"}};'
    + 'localStorage.setItem("firstTime",JSON.stringify({termsAccepted:true}));'
    + 'window.firebase={apps:[{auth:()=>({currentUser:' + JSON.stringify(liveUser) + '})}]};'
    + '(async()=>{await new Promise((resolve,reject)=>{const r=indexedDB.open("firebaseLocalStorageDb",1);'
    + 'r.onupgradeneeded=()=>r.result.createObjectStore("firebaseLocalStorage",{keyPath:"fbase_key"});'
    + 'r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,t=db.transaction("firebaseLocalStorage","readwrite"),s=t.objectStore("firebaseLocalStorage");'
    + 's.clear();s.put({fbase_key:"firebase:authUser:synthetic:default",value:' + JSON.stringify(persistedUser) + '});'
    + 't.oncomplete=()=>{db.close();resolve();};t.onerror=()=>reject(t.error);};});'
    + 'document.body.appendChild(Object.assign(document.createElement("input"),{type:"file"}));})();</script>'
}
function detectionFixture() {
  return '<script>async function detectionFixture(file){'
    + 'const upload=await (await fetch("/image-upload",{method:"POST",headers:{"x-image-name":file.name,"x-image-type":file.type,"x-synthetic-button-clicked":String(window.buttonActivated===true),"x-synthetic-reactive-ready":String(window.reactiveReady===true)},body:await file.arrayBuffer()})).json();window.buttonActivated=false;'
    + 'await fetch("/_/WatermarkApp/data/batchexecute?rpcids=TZRKo",{method:"POST",headers:{"x-synthetic-upload-id":upload.uploadId},body:JSON.stringify({blob:upload.uploadId})});}'
    + '</script>'
}
function captureFixture() {
  return '<script>const credential=' + JSON.stringify(capturedCredentials) + ';'
    + 'async function captureFixture(file){const scenario=await (await fetch("/capture-scenario")).json();'
    + 'await fetch("/credential-probe-upload",{method:"POST",headers:{"x-synthetic-button-clicked":String(window.buttonActivated===true),"x-synthetic-reactive-ready":String(window.reactiveReady===true)},body:await file.arrayBuffer()});window.buttonActivated=false;'
    + 'if(scenario==="no-request")return;'
    + 'if(scenario==="wrong-refresh-account")fixtureAuth.currentUser.uid="different-user";'
    + 'const header=[' + JSON.stringify(jwt('synthetic-user')) + ',null,null,null,null,scenario==="bad-header"?"not-a-bg-token":credential.bgToken];'
    + 'const path=scenario==="wrong-request-account"?"users/different-user/files/synthetic-file":credential.pushFilename;'
    + 'const payload=JSON.stringify([null,[[["image/png",null,null,null,null,null,"/synthid-demo-drop-zone/ttl_1d/"+path]]],0]);'
    + 'await fetch("/_/WatermarkApp/data/batchexecute?rpcids=TZRKo&capture="+scenario,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded","x-goog-ext-525006476-jspb":JSON.stringify(header)},body:new URLSearchParams({"f.req":JSON.stringify([[["TZRKo",payload,null,"generic"]]])})});}'
    + '</script>'
}
const http = { async fetch(url, init) {
  const target = new URL(url)
  calls.push({path:target.pathname,origin:target.origin,cookie:init.headers.cookie,method:init.method,body:init.body})
  if (target.origin === 'https://accounts.example.test') {
    assert.doesNotMatch(init.headers.cookie || '', /first=|second=/)
    if (target.pathname === '/start') return new Response('',{status:302,headers:{location:'/signin','set-cookie':'oauth=synthetic; Secure; HttpOnly; Path=/; SameSite=Lax'}})
    if (target.pathname === '/signin') assert.match(init.headers.cookie || '', /oauth=synthetic/)
    return new Response('<p>Synthetic identity provider</p>',{headers:{'content-type':'text/html'}})
  }
  if (target.origin === 'https://unrelated.example.test') {
    assert.equal(init.headers.cookie, undefined)
    return new Response('', {headers:{'access-control-allow-origin':'*'}})
  }
  if (target.pathname === '/') {
    const headers = new Headers({location:'/welcome'})
    headers.append('set-cookie','first=one; Path=/; Secure; HttpOnly; SameSite=Lax')
    headers.append('set-cookie','second=two; Path=/; Secure; SameSite=Lax')
    return new Response('',{status:302,headers})
  }
  if (target.pathname === '/welcome' || target.pathname === '/image-detection') {
    assert.match(init.headers.cookie || '', /first=one/)
    assert.match(init.headers.cookie || '', /second=two/)
    return new Response(accountScenario === 'shell' ? html()+captureFixture()+detectionFixture() : accountFixture(),{headers:{'content-type':'text/html','content-encoding':'gzip','content-length':'1'}})
  }
  if (target.pathname === '/dedicated-worker.js' || target.pathname === '/shared-worker.js') {
    assert.match(init.headers.cookie || '', /first=one/)
    const script=target.pathname === '/dedicated-worker.js'
      ? 'fetch("/worker-redirect?kind=dedicated").then(r=>r.text()).then(value=>postMessage(value)).catch(()=>postMessage("failed"))'
      : 'onconnect=e=>{const p=e.ports[0];fetch("/worker-redirect?kind=shared").then(r=>r.text()).then(value=>{p.postMessage(value);return fetch("/worker-pending");}).catch(()=>p.postMessage("failed"));}'
    return new Response(script,{headers:{'content-type':'application/javascript'}})
  }
  if (target.pathname === '/worker-redirect') {
    const kind=target.searchParams.get('kind')
    return new Response('',{status:302,headers:{location:'/worker-final?kind='+kind,'set-cookie':'worker-'+kind+'=synthetic; Path=/; Secure; HttpOnly; SameSite=Lax'}})
  }
  if (target.pathname === '/worker-final') {
    const kind=target.searchParams.get('kind')
    assert.ok((init.headers.cookie || '').includes('worker-'+kind+'=synthetic'))
    return new Response('forwarded-'+kind)
  }
  if (target.pathname === '/worker-report') {
    workerReports.set(target.searchParams.get('kind'),Buffer.from(init.body).toString())
    return new Response('')
  }
  if (target.pathname === '/worker-pending') {
    workerPending++
    return new Promise((_,reject)=>{
      init.signal.addEventListener('abort',()=>{workerPending--;workerAborted++;reject(new Error('synthetic worker cancelled'))},{once:true})
    })
  }
  if (target.pathname === '/image-upload') {
    assert.equal(init.headers['x-synthetic-button-clicked'],'true')
    assert.equal(init.headers['x-synthetic-reactive-ready'],'true')
    const uploadId='synthetic-detection-'+(imageUploads.length+1)
    imageUploads.push({uploadId,data:Buffer.from(init.body),name:init.headers['x-image-name'],type:init.headers['x-image-type'],status:resultStatus,scenario:detectionScenario})
    return new Response(JSON.stringify({uploadId}),{headers:{'content-type':'application/json'}})
  }
  if (target.pathname === '/capture-scenario') {
    captureScenarioReads++
    return new Response(JSON.stringify(captureScenario),{headers:{'content-type':'application/json'}})
  }
  if (target.pathname === '/credential-probe-upload') {
    assert.equal(init.headers['x-synthetic-button-clicked'],'true')
    assert.equal(init.headers['x-synthetic-reactive-ready'],'true')
    const png = Buffer.from(init.body)
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
    assert.equal(png.readUInt32BE(16),512)
    assert.equal(png.readUInt32BE(20),512)
    captureUploadCount++
    return new Response('')
  }
  if (target.pathname.endsWith('/batchexecute')) {
    if (target.searchParams.has('capture')) {
      const scenario=target.searchParams.get('capture')
      if (scenario === 'http-rejected') return new Response('sensitive-response-must-not-escape',{status:403})
      if (scenario === 'rpc-rejected') return new Response(JSON.stringify([['wrb.fr','TZRKo',null,null,null,[16]]]))
      if (scenario === 'rpc-permission') return new Response(JSON.stringify([['wrb.fr','TZRKo',null,null,null,[7]]]))
      if (scenario === 'quota') {
        const data=[];data[6]=[[null,null,null,[60]]]
        return new Response(JSON.stringify([['wrb.fr','TZRKo',JSON.stringify(data)]]))
      }
      if (scenario === 'delay') await new Promise((resolve,reject)=>{
        const timer=setTimeout(resolve,5000)
        init.signal.addEventListener('abort',()=>{captureAborted++;clearTimeout(timer);reject(new Error('sensitive-data-must-not-escape'))},{once:true})
      })
      const data=[];data[4]=[[1]]
      return new Response(JSON.stringify([['wrb.fr','TZRKo',JSON.stringify(data)]]))
    }
    const uploadId=init.headers['x-synthetic-upload-id']
    const upload=imageUploads.find(value=>value.uploadId===uploadId)
    assert.ok(upload)
    assert.equal(JSON.parse(Buffer.from(init.body).toString()).blob,uploadId)
    assert.ok(!imageRequests.includes(uploadId))
    imageRequests.push(uploadId)
    if(upload.scenario==='http-rejected')return new Response('sensitive refusal',{status:403})
    if(upload.scenario==='rpc-permission')return new Response(JSON.stringify([['wrb.fr','TZRKo',null,null,null,[7]]]))
    if(upload.scenario==='quota'){
      const data=[];data[6]=[[null,null,null,[60]]]
      return new Response(JSON.stringify([['wrb.fr','TZRKo',JSON.stringify(data)]]))
    }
    if(upload.scenario==='delay')await new Promise((resolve,reject)=>{
      const timer=setTimeout(resolve,5000)
      init.signal.addEventListener('abort',()=>{detectionAborted++;clearTimeout(timer);reject(new Error('cancelled'))},{once:true})
    })
    const data=[];data[4]=[[upload.status]]
    return new Response(JSON.stringify([['wrb.fr','TZRKo',JSON.stringify(data)]]),{headers:{'content-type':'application/json'}})
  }
  return new Response('',{status:404})
} }
const session = await launchSynthIdBrowser({profileDir,headed:false,timeout:10000,http,signal:controller.signal})
try {
  assert.deepEqual(await session.account(),{loggedIn:true,email:'synthetic@example.test',accepted:true})
  await new Promise(resolve=>setTimeout(resolve,500))
  assert.ok(calls.some(x=>x.origin==='https://accounts.example.test' && x.path==='/start'))
  assert.ok(calls.some(x=>x.origin==='https://accounts.example.test' && x.path==='/signin'))
  assert.ok(calls.some(x=>x.origin==='https://accounts.example.test' && x.path==='/frame'))
  console.log('PASS: OAuth popup first request, popup redirect cookies, cross-origin iframe interception')
  for(let attempt=0;attempt<100&&(workerReports.size<2||workerPending<1);attempt++)await new Promise(resolve=>setTimeout(resolve,10))
  assert.equal(workerReports.get('dedicated'),'forwarded-dedicated')
  assert.equal(workerReports.get('shared'),'forwarded-shared')
  assert.equal(workerPending,1)
  for(const path of ['/dedicated-worker.js','/shared-worker.js','/worker-pending'])assert.ok(calls.some(call=>call.path===path))
  assert.equal(calls.filter(call=>call.path==='/worker-redirect').length,2)
  assert.equal(calls.filter(call=>call.path==='/worker-final').length,2)
  console.log('PASS: Dedicated Worker and SharedWorker initial scripts, fetches, redirects, and redirect cookies all use the provided HTTP service')
  const navigationsBeforeDetection=calls.filter(x=>['/','/welcome','/image-detection'].includes(x.path)).length
  assert.deepEqual(await session.detect({data:imageBytes.buffer,type:'image/png'},5000,'synthetic-user'),{status:'not_detected'})
  resultStatus=1
  assert.deepEqual(await session.detect({data:otherImageBytes.buffer,type:'image/webp'},5000),{status:'uncertain',reason:undefined})
  assert.equal(imageUploads.length,2)
  assert.deepEqual(imageUploads[0].data,marker)
  assert.equal(imageUploads[0].name,'image.png')
  assert.equal(imageUploads[0].type,'image/png')
  assert.deepEqual(imageUploads[1].data,Buffer.from(otherImageBytes))
  assert.equal(imageUploads[1].name,'image.webp')
  assert.equal(imageUploads[1].type,'image/webp')
  assert.equal(new Set(imageRequests).size,2)
  assert.equal(calls.filter(x=>['/','/welcome','/image-detection'].includes(x.path)).length,navigationsBeforeDetection)
  assert.equal(calls.some(x=>x.path==='/image-detection'),false)
  detectionScenario='quota'
  assert.deepEqual(await session.detect({data:imageBytes.buffer,type:'image/png'},5000),{status:'quota_exceeded',retryAfterSeconds:60})
  detectionScenario='ok'
  console.log('PASS: normal SPA Back restores selection while keeping session-only auth; distinct original images get distinct upload snapshots/results without direct result-page navigation; quota remains a result')
  const navigationsBeforeCapture=calls.filter(x=>['/','/welcome','/image-detection'].includes(x.path)).length
  assert.deepEqual(await session.captureCredentials(5000),capturedCredentials)
  assert.equal(captureUploadCount,1)
  assert.equal(captureScenarioReads,1)
  assert.equal(calls.filter(x=>['/','/welcome','/image-detection'].includes(x.path)).length,navigationsBeforeCapture)
  assert.equal(session.isClosed(),false)
  assert.deepEqual(await session.account(),{loggedIn:true,email:'synthetic@example.test',accepted:true})
  console.log('PASS: current-tab-only Firebase login with stale shell and empty IndexedDB captures via the normal button/chooser, uploads one generated 512px PNG, and preserves the page')
  const imagesBeforeRetainedDetection=imageUploads.length
  const requestsBeforeRetainedDetection=imageRequests.length
  resultStatus=2
  assert.deepEqual(await session.detect({data:otherImageBytes.buffer,type:'image/webp'},5000,'synthetic-user'),{status:'not_detected'})
  assert.equal(imageUploads.length,imagesBeforeRetainedDetection+1)
  assert.equal(imageRequests.length,requestsBeforeRetainedDetection+1)
  assert.deepEqual(imageUploads.at(-1).data,Buffer.from(otherImageBytes))
  assert.equal(imageUploads.at(-1).name,'image.webp')
  assert.equal(imageUploads.at(-1).type,'image/webp')
  assert.equal(imageRequests.at(-1),imageUploads.at(-1).uploadId)
  assert.equal(new Set(imageRequests).size,imageRequests.length)
  assert.equal(captureUploadCount,1)
  assert.equal(captureScenarioReads,1)
  assert.equal(calls.filter(x=>['/','/welcome','/image-detection'].includes(x.path)).length,navigationsBeforeCapture)
  assert.equal(session.isClosed(),false)
  assert.deepEqual(await session.account(),{loggedIn:true,email:'synthetic@example.test',accepted:true})
  console.log('PASS: a successful login capture returns through SPA Back and detects a different original image in the retained browser, without reloading, recapturing credentials or reusing the capture result')
} finally { controller.abort(); await session.close() }
assert.equal(workerPending,0)
assert.equal(workerAborted,1)
workerFixtureEnabled=false
console.log('PASS: closing the browser aborts in-flight SharedWorker HTTP traffic')
await assert.rejects(session.account(),error=>error.kind==='cancelled')
await assert.rejects(session.captureCredentials(5000),error=>error.kind==='cancelled')
await assert.rejects(session.detect({data:otherImageBytes.buffer,type:'image/webp'},5000),error=>error.kind==='cancelled')
console.log('PASS: cancellation closes browser and prevents reuse')
const mismatchedSession=await launchSynthIdBrowser({profileDir,headed:false,timeout:10000,http,signal:new AbortController().signal})
const mismatchUploadsBefore=imageUploads.length
const mismatchCapturesBefore=captureUploadCount
const mismatchCallsBefore=calls.length
try {
  const accountBefore=await mismatchedSession.account()
  await assert.rejects(mismatchedSession.detect({data:imageBytes.buffer,type:'image/png'},5000,'different-configured-user'),error=>{
    assert.equal(error.kind,'auth')
    assert.doesNotMatch(error.message,/synthetic-user|different-configured-user/)
    return true
  })
  assert.equal(imageUploads.length,mismatchUploadsBefore)
  assert.equal(captureUploadCount,mismatchCapturesBefore)
  assert.deepEqual(await mismatchedSession.account(),accountBefore)
  assert.equal(mismatchedSession.isClosed(),false)
  await assert.rejects(mismatchedSession.captureCredentials(5000),error=>error.kind==='auth')
  await assert.rejects(mismatchedSession.detect({data:otherImageBytes.buffer,type:'image/webp'},5000,'synthetic-user'),error=>error.kind==='auth')
  assert.equal(calls.slice(mismatchCallsBefore).some(call=>call.method==='POST'),false)
} finally { await mismatchedSession.close() }
console.log('PASS: a live account mismatch rejects before any upload and leaves the signed-in account unchanged')
for(const scenario of ['http-rejected','rpc-permission','delay']){
  detectionScenario=scenario
  const rejectingDetection=await launchSynthIdBrowser({profileDir,headed:false,timeout:10000,http,signal:new AbortController().signal})
  const before=imageUploads.length
  try{
    const running=rejectingDetection.detect({data:imageBytes.buffer,type:'image/png'},scenario==='delay'?400:5000)
    if(scenario==='delay'){
      await assert.rejects(rejectingDetection.detect({data:otherImageBytes.buffer,type:'image/webp'},5000),error=>error.kind==='busy')
      await assert.rejects(rejectingDetection.captureCredentials(5000),error=>error.kind==='busy')
    }
    await assert.rejects(running,error=>error.kind===(scenario==='delay'?'timeout':'permission'))
    assert.equal(imageUploads.length,before+1)
    await assert.rejects(rejectingDetection.detect({data:otherImageBytes.buffer,type:'image/webp'},5000),error=>error.kind==='auth')
    await assert.rejects(rejectingDetection.captureCredentials(5000),error=>error.kind==='auth')
    assert.equal(imageUploads.length,before+1)
  }finally{await rejectingDetection.close()}
}
assert.ok(detectionAborted)
detectionScenario='ok'
resultStatus=2
const freshDetection=await launchSynthIdBrowser({profileDir,headed:false,timeout:10000,http,signal:new AbortController().signal})
try{assert.deepEqual(await freshDetection.detect({data:otherImageBytes.buffer,type:'image/webp'},5000),{status:'not_detected'})}
finally{await freshDetection.close()}
console.log('PASS: detection rejection is never retried, failed sessions reject new uploads, active uploads are mutually exclusive, and reopening cannot reuse a timed-out image response')
for (const [scenario,kind] of [
  ['bad-header','response'],['wrong-request-account','response'],['wrong-refresh-account','auth'],
  ['http-rejected','permission'],['rpc-rejected','auth'],['rpc-permission','permission'],
  ['quota','rate-limit'],['no-request','timeout'],['delay','timeout'],
]) {
  captureScenario=scenario
  const rejectedSession=await launchSynthIdBrowser({profileDir,headed:false,timeout:10000,http,signal:new AbortController().signal})
  const uploadsBefore=captureUploadCount
  const detectionsBefore=imageUploads.length
  try {
    await assert.rejects(rejectedSession.captureCredentials(kind==='timeout'?400:5000),error=>{
      assert.equal(error.kind,kind)
      assert.doesNotMatch(error.message,/synthetic|sensitive|do-not-copy/)
      return true
    })
    assert.equal(rejectedSession.isClosed(),false)
    assert.equal(captureUploadCount,uploadsBefore+1)
    await assert.rejects(rejectedSession.captureCredentials(5000),error=>error.kind==='auth')
    await assert.rejects(rejectedSession.detect({data:otherImageBytes.buffer,type:'image/webp'},5000),error=>error.kind==='auth')
    assert.equal(captureUploadCount,uploadsBefore+1)
    assert.equal(imageUploads.length,detectionsBefore)
  } finally { await rejectedSession.close() }
}
assert.ok(captureAborted)
console.log('PASS: rejected/mismatched/quota responses never retry, failed capture keeps the page and cannot accept a late response; closing cancels pending network requests')

captureScenario='ok'
captureReadyDelay=100
reactiveReadyDelay=600
const delayedSession=await launchSynthIdBrowser({profileDir,headed:false,timeout:10000,http,signal:new AbortController().signal})
let uploadsBefore=captureUploadCount
try {
  assert.deepEqual(await delayedSession.captureCredentials(5000),capturedCredentials)
  assert.equal(captureUploadCount,uploadsBefore+1)
} finally { await delayedSession.close() }
captureReadyDelay=0
reactiveReadyDelay=1500
const unreadySession=await launchSynthIdBrowser({profileDir,headed:false,timeout:10000,http,signal:new AbortController().signal})
uploadsBefore=captureUploadCount
try {
  const detectionsBefore=imageUploads.length
  await assert.rejects(unreadySession.captureCredentials(100),error=>error.kind==='timeout')
  await new Promise(resolve=>setTimeout(resolve,1600))
  assert.equal(captureUploadCount,uploadsBefore)
  assert.equal(unreadySession.isClosed(),false)
  await assert.rejects(unreadySession.captureCredentials(5000),error=>error.kind==='auth')
  await assert.rejects(unreadySession.detect({data:otherImageBytes.buffer,type:'image/webp'},5000),error=>error.kind==='auth')
  assert.equal(captureUploadCount,uploadsBefore)
  assert.equal(imageUploads.length,detectionsBefore)
} finally { await unreadySession.close() }
captureReadyDelay=0
reactiveReadyDelay=0
console.log('PASS: delayed Firebase and reactive avatar readiness uploads once; deadline before readiness uploads nothing, including after the page becomes ready')

for (const [capture,cancelWithSignal] of [[true,true],[true,false],[false,true],[false,false]]) {
  captureScenario='delay'
  detectionScenario='delay'
  const cancelController=new AbortController()
  const cancellingSession=await launchSynthIdBrowser({profileDir,headed:false,timeout:10000,http,signal:cancelController.signal})
  const uploads=()=>capture?captureUploadCount:imageUploads.length
  const previousUploads=uploads()
  const pendingCapture=capture?cancellingSession.captureCredentials(5000):cancellingSession.detect({data:imageBytes.buffer,type:'image/png'},5000)
  const cancelled=assert.rejects(pendingCapture,error=>error.kind==='cancelled')
  for(let attempt=0;attempt<100&&uploads()===previousUploads;attempt++)await new Promise(resolve=>setTimeout(resolve,10))
  assert.ok(uploads()>previousUploads)
  const closedAt=Date.now()
  if(cancelWithSignal)cancelController.abort()
  else void cancellingSession.close()
  await cancelled
  assert.ok(Date.now()-closedAt<1000)
  await cancellingSession.close()
  const capturesAfterCancellation=captureUploadCount
  const imagesAfterCancellation=imageUploads.length
  await assert.rejects(cancellingSession.account(),error=>error.kind==='cancelled')
  await assert.rejects(cancellingSession.captureCredentials(5000),error=>error.kind==='cancelled')
  await assert.rejects(cancellingSession.detect({data:otherImageBytes.buffer,type:'image/webp'},5000),error=>error.kind==='cancelled')
  assert.equal(captureUploadCount,capturesAfterCancellation)
  assert.equal(imageUploads.length,imagesAfterCancellation)
}
console.log('PASS: abort and explicit close promptly cancel capture and detection, reject account/capture/detection reuse without uploads; ordinary Chrome reopens the same isolated profile')
for (const [scenario,expected] of [
  ['live',{loggedIn:true,email:'live@example.test',accepted:true}],
  ['indexeddb',{loggedIn:true,email:'persisted@example.test',accepted:true}],
  ['anonymous',{loggedIn:false,email:undefined,accepted:true}],
]) {
  accountScenario=scenario
  const accountSession=await launchSynthIdBrowser({profileDir,headed:false,timeout:10000,http,signal:new AbortController().signal})
  try { assert.deepEqual(await accountSession.account(),expected) }
  finally { await accountSession.close() }
}
accountScenario='shell'
console.log('PASS: live Firebase account overrides the stale shell and persisted account; IndexedDB fallback works; anonymous users are not signed in')
await assert.rejects(launchSynthIdBrowser({
  profileDir, headed: false, timeout: 10000, signal: new AbortController().signal,
  http: { async fetch() {
    const cause = Object.assign(new Error('sensitive proxy response'), { code: 'ECONNRESET' })
    throw new Error('sensitive proxy URL', { cause })
  } },
}), error => {
  assert.equal(error.kind, 'network')
  assert.equal(error.networkCode, 'ECONNRESET')
  assert.match(describeSynthIdFailure(error), /ECONNRESET/)
  assert.ok(describeSynthIdFailure(error).includes('https://synthid.com/'))
  assert.ok(!JSON.stringify(error).includes('sensitive'))
  return true
})
console.log('PASS: login startup preserves the transport error code without exposing proxy details')
const resolvedProfile = await realpath(profileDir)
assert.equal(dirname(resolvedProfile), await realpath(tmpdir()))
assert.ok(basename(resolvedProfile).startsWith('synthid-driver-test-'))
await rm(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
