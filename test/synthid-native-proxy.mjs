import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

// Real Chromium transport, synthetic account and loopback-only fixture servers.
// Only the service origin/import locations change; production launch flags stay intact.
const sourceRuntime = process.argv.includes('--source')
const originalUrl = new URL(sourceRuntime ? '../src/synthid-browser.ts' : '../lib/synthid-browser.js', import.meta.url)
const originalSource = await readFile(originalUrl, 'utf8')
assert.match(originalSource, /http\.proxy/, 'Build the native proxy implementation before running this test')
const fixtureOrigin = 'http://synthetic.localhost'
const testRoot = await mkdtemp(join(tmpdir(), 'synthid-native-proxy-test-'))
const imageBytes = Uint8Array.from({ length: 512 * 1024 + 17 }, (_, index) => (index * 29 + 3) % 256)
let moduleCounter = 0

async function fixtureModule(origin) {
  const originDeclaration = "const ORIGIN = 'https://synthid.com'"
  assert.equal(originalSource.split(originDeclaration).length, 2)
  let source = originalSource.replace(originDeclaration, 'const ORIGIN = ' + JSON.stringify(origin))
  source = source.replace(/from (['"])(\.\/[^'"]+\.js)\1/g, (_match, _quote, relative) => {
    const target = sourceRuntime ? relative.replace(/\.js$/, '.ts') : relative
    return 'from ' + JSON.stringify(new URL(target, originalUrl).href)
  }).replaceAll('import.meta.url', JSON.stringify(originalUrl.href))
  const flags = text => text.match(/['"]--[^'"]*['"]/g)
  assert.deepEqual(flags(source), flags(originalSource), 'Fixture must preserve every production browser flag')
  const file = join(testRoot, 'browser-' + (++moduleCounter) + (sourceRuntime ? '.ts' : '.mjs'))
  await writeFile(file, source, 'utf8')
  return import(pathToFileURL(file).href)
}

async function startServer(handler) {
  const sockets = new Set()
  const failures = []
  const server = createServer((request, response) => {
    Promise.resolve().then(() => handler(request, response)).catch(error => {
      failures.push(error)
      response.destroy()
    })
  })
  server.on('connection', socket => {
    sockets.add(socket)
    socket.on('error', () => {}) // Chromium may reset deliberately rejected background requests.
    socket.once('close', () => sockets.delete(socket))
  })
  // This test proxy never opens an upstream connection, including Chromium background requests.
  server.on('connect', (_request, socket) => {
    socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    url: 'http://127.0.0.1:' + server.address().port,
    assertHealthy() { if (failures.length) throw failures[0] },
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise(resolve => server.close(resolve))
    },
  }
}

async function body(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks)
}

async function waitFor(condition, label, server) {
  const deadline = Date.now() + 5000
  while (!condition() && Date.now() < deadline) {
    server.assertHealthy()
    await delay(20)
  }
  server.assertHealthy()
  assert.ok(condition(), label)
}

function fixtureHtml() {
  return '<!doctype html><sid-account-avatar><span class="profile-image">L</span></sid-account-avatar>'
    + '<input type="file" hidden><button>Select file</button><iframe src="/frame"></iframe><script>'
    + 'window.WIZ_global_data={yeeU8:{isLoggedIn:false}};'
    + 'localStorage.setItem("firstTime",JSON.stringify({termsAccepted:true}));'
    + 'window.firebase={apps:[{auth:()=>({currentUser:{uid:"native-synthetic-user",email:"synthetic@example.test",isAnonymous:false,refreshToken:"synthetic-refresh"}})}]};'
    + 'document.querySelector("button").onclick=()=>{window.clicked=true;document.querySelector("input").click();};'
    + 'document.querySelector("input").onchange=async e=>{const file=e.target.files[0];'
    + 'await fetch("/upload",{method:"POST",headers:{"x-normal-button":String(window.clicked===true),"x-file-name":file.name},body:file});'
    + 'await fetch("/_/WatermarkApp/data/batchexecute?rpcids=TZRKo",{method:"POST",body:new URLSearchParams({"f.req":JSON.stringify([[["TZRKo","synthetic-native-upload",null,"generic"]]])})});};'
    + 'const worker=new SharedWorker("/native-shared-worker.js");'
    + 'worker.port.onmessage=e=>fetch("/worker-report",{method:"POST",body:e.data});worker.port.start();'
    + '</script>'
}

async function nativeScenario(authenticated) {
  const observations = { requests: [], uploads: [], workerReports: [], workerPending: 0, workerClosed: 0, authChallenges: 0 }
  const expectedAuthorization = 'Basic ' + Buffer.from('synthetic-user:synthetic-password').toString('base64')
  const proxy = await startServer(async (request, response) => {
    const target = new URL(request.url)
    if (target.origin !== fixtureOrigin) {
      response.writeHead(502).end()
      return
    }
    if (authenticated && request.headers['proxy-authorization'] !== expectedAuthorization) {
      observations.authChallenges++
      response.writeHead(407, { 'proxy-authenticate': 'Basic realm="synthetic-proxy"', 'content-length': '0' }).end()
      return
    }
    const headers = request.headers
    // Retain only fixture request metadata; never print proxy authorization.
    observations.requests.push({ path: target.pathname, mode: headers['sec-fetch-mode'], site: headers['sec-fetch-site'], destination: headers['sec-fetch-dest'], origin: headers.origin })
    if (target.pathname === '/') {
      response.writeHead(302, { location: '/welcome', 'set-cookie': ['first=one; Path=/; HttpOnly; SameSite=Lax', 'second=two; Path=/; SameSite=Lax'] }).end()
      return
    }
    if (target.pathname === '/welcome') {
      assert.match(headers.cookie || '', /first=one/)
      assert.match(headers.cookie || '', /second=two/)
      response.writeHead(200, { 'content-type': 'text/html' }).end(fixtureHtml())
      return
    }
    if (target.pathname === '/frame') {
      response.writeHead(200, { 'content-type': 'text/html' }).end('<p>Synthetic iframe</p>')
      return
    }
    if (target.pathname === '/native-shared-worker.js') {
      assert.match(headers.cookie || '', /first=one/)
      response.writeHead(200, { 'content-type': 'application/javascript' }).end(
        'onconnect=e=>{const p=e.ports[0];fetch("/worker-start").then(r=>r.text()).then(value=>{p.postMessage(value);return fetch("/worker-pending");}).catch(()=>p.postMessage("failed"));}',
      )
      return
    }
    if (target.pathname === '/worker-start') {
      response.writeHead(302, { location: '/worker-final', 'set-cookie': 'worker=synthetic; Path=/; HttpOnly; SameSite=Lax' }).end()
      return
    }
    if (target.pathname === '/worker-final') {
      assert.match(headers.cookie || '', /worker=synthetic/)
      response.writeHead(200, { 'content-type': 'text/plain' }).end('native-shared-worker-ok')
      return
    }
    if (target.pathname === '/worker-report') {
      observations.workerReports.push((await body(request)).toString())
      response.end()
      return
    }
    if (target.pathname === '/worker-pending') {
      observations.workerPending++
      response.once('close', () => { observations.workerPending--; observations.workerClosed++ })
      return
    }
    if (target.pathname === '/upload') {
      assert.equal(headers['x-normal-button'], 'true')
      assert.equal(headers['x-file-name'], 'image.png')
      assert.equal(headers['content-type'], 'image/png')
      observations.uploads.push(await body(request))
      response.end()
      return
    }
    if (target.pathname.endsWith('/batchexecute')) {
      assert.equal(request.method, 'POST')
      const batches = JSON.parse(new URLSearchParams((await body(request)).toString()).get('f.req'))
      assert.equal(batches[0][0][0], 'TZRKo')
      const result = []; result[4] = [[2]]
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify([['wrb.fr', 'TZRKo', JSON.stringify(result)]]))
      return
    }
    response.writeHead(404).end()
  })
  const proxyAddress = new URL(proxy.url)
  if (authenticated) {
    proxyAddress.username = 'synthetic-user'
    proxyAddress.password = 'synthetic-password'
  }
  const resolutionCalls = []
  let bridgedCalls = 0
  let session
  try {
    const { launchSynthIdBrowser } = await fixtureModule(fixtureOrigin)
    session = await launchSynthIdBrowser({
      profileDir: join(testRoot, authenticated ? 'authenticated-profile' : 'native-profile'),
      headed: false, timeout: 10000, signal: new AbortController().signal,
      http: {
        proxy(url) { resolutionCalls.push(String(url)); return proxyAddress.href },
        async fetch() { bridgedCalls++; throw new Error('Native browser traffic must not use the HTTP bridge') },
      },
    })
    assert.deepEqual(await session.account(), { loggedIn: true, email: 'synthetic@example.test', accepted: true })
    assert.deepEqual(await session.detect({ data: imageBytes.buffer, type: 'image/png' }, 5000, 'native-synthetic-user'), { status: 'not_detected' })
    await waitFor(() => observations.workerReports.length > 0 && observations.workerPending > 0, 'SharedWorker must reach the proxy', proxy)
    assert.deepEqual(resolutionCalls, [fixtureOrigin])
    assert.equal(bridgedCalls, 0)
    assert.equal(observations.uploads.length, 1)
    assert.deepEqual(observations.uploads[0], Buffer.from(imageBytes))
    assert.deepEqual(observations.workerReports, ['native-shared-worker-ok'])
    const navigation = observations.requests.find(item => item.path === '/welcome')
    const upload = observations.requests.find(item => item.path === '/upload')
    const iframe = observations.requests.find(item => item.path === '/frame')
    assert.equal(navigation.mode, 'navigate')
    assert.equal(navigation.destination, 'document')
    assert.equal(upload.mode, 'cors')
    assert.equal(upload.destination, 'empty')
    assert.equal(upload.site, 'same-origin')
    assert.equal(upload.origin, fixtureOrigin)
    assert.equal(iframe.mode, 'navigate')
    assert.equal(iframe.destination, 'iframe')
    if (authenticated) assert.ok(observations.authChallenges > 0)
    await session.close()
    await waitFor(() => observations.workerPending === 0, 'Browser closure must end pending SharedWorker traffic', proxy)
    assert.equal(observations.workerClosed, 1)
    proxy.assertHealthy()
    console.log('PASS: ' + (authenticated ? 'authenticated' : 'plain') + ' native proxy preserves Chromium metadata, original File bytes, iframe/SharedWorker traffic, redirect cookies and cancellation; HTTP bridge is unused')
  } finally {
    await session?.close()
    await proxy.close()
  }
}

async function brokenProxyScenario() {
  let directRequests = 0
  let proxyRequests = 0
  let bridgedCalls = 0
  const directTrap = await startServer((_request, response) => {
    directRequests++
    response.writeHead(200, { 'content-type': 'text/html' }).end(fixtureHtml())
  })
  const brokenProxy = await startServer((_request, response) => { proxyRequests++; response.destroy() })
  let session
  try {
    const { launchSynthIdBrowser } = await fixtureModule(directTrap.url)
    await assert.rejects(async () => {
      session = await launchSynthIdBrowser({
        profileDir: join(testRoot, 'broken-proxy-profile'), headed: false, timeout: 3000,
        signal: new AbortController().signal,
        http: {
          proxy(url) { assert.equal(String(url), directTrap.url); return brokenProxy.url },
          async fetch() { bridgedCalls++; throw new Error('Proxy failure must not fall back to HTTP forwarding') },
        },
      })
    }, error => {
      assert.ok(['proxy', 'network', 'timeout'].includes(error.kind))
      assert.doesNotMatch(error.message, /127\.0\.0\.1|synthetic-password/)
      return true
    })
    assert.ok(proxyRequests > 0)
    assert.equal(directRequests, 0, 'Even loopback destinations must not bypass an explicitly configured proxy')
    assert.equal(bridgedCalls, 0)
    directTrap.assertHealthy()
    brokenProxy.assertHealthy()
    console.log('PASS: failed native proxy never falls back to direct traffic or HTTP forwarding')
  } finally {
    await session?.close()
    await brokenProxy.close()
    await directTrap.close()
  }
}

console.log('Testing native SynthID browser proxy from ' + (sourceRuntime ? 'TypeScript source' : 'compiled JavaScript'))
try {
  await nativeScenario(false)
  await nativeScenario(true)
  await brokenProxyScenario()
} finally {
  const resolvedRoot = await realpath(testRoot)
  assert.equal(dirname(resolvedRoot), await realpath(tmpdir()))
  assert.ok(basename(resolvedRoot).startsWith('synthid-native-proxy-test-'))
  await rm(resolvedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
