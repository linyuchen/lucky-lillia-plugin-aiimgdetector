import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
const source = process.argv.includes('--source')
const { launchSynthIdBrowser } = await import(source ? '../src/synthid-browser.ts' : '../lib/synthid-browser.js')
const root = await mkdtemp(join(tmpdir(), 'synthid-login-test-'))
const calls = []
let scenario = 'live', session
const html = () => {
  const live = scenario === 'anonymous' ? { uid: 'anonymous', isAnonymous: true }
    : scenario === 'indexeddb' ? null : { uid: 'fixture-user', isAnonymous: false, email: 'live@example.test', refreshToken: 'fixture-refresh' }
  const saved = { uid: 'persisted-user', email: 'saved@example.test', isAnonymous: false, stsTokenManager: { refreshToken: 'persisted-refresh' } }
  return '<!doctype html><body><input type="file" hidden>Local login fixture<script>'
    + 'window.WIZ_global_data={yeeU8:{isLoggedIn:"false",userEmail:"stale@example.test"}};'
    + 'localStorage.setItem("firstTime",JSON.stringify({termsAccepted:' + (scenario !== 'terms') + '}));'
    + 'window.firebase={apps:[{auth:()=>({currentUser:' + JSON.stringify(live) + '})}]};'
    + (scenario === 'indexeddb' ? 'const r=indexedDB.open("firebaseLocalStorageDb",1);r.onupgradeneeded=()=>r.result.createObjectStore("firebaseLocalStorage",{keyPath:"fbase_key"});r.onsuccess=()=>{const d=r.result;const t=d.transaction("firebaseLocalStorage","readwrite");t.objectStore("firebaseLocalStorage").put({fbase_key:"firebase:authUser:fixture",value:' + JSON.stringify(saved) + '});t.oncomplete=()=>d.close();};' : '')
    + '</script></body>'
}
const http = { async fetch(url, init = {}) {
  const target = new URL(url)
  calls.push({ method: init.method || 'GET', origin: target.origin, path: target.pathname })
  if (target.origin === 'https://synthid.com') return new Response(html(), { headers: { 'content-type': 'text/html', 'set-cookie': 'fixture=present; Path=/; Secure' } })
  return new Response('', { status: 404 })
} }
async function open() {
  return launchSynthIdBrowser({ profileDir: join(root, scenario), headed: false, timeout: 10000, http, signal: new AbortController().signal })
}
try {
  for (const name of ['live', 'indexeddb', 'anonymous', 'terms']) {
    scenario = name;session = await open()
    if (name === 'indexeddb') {
      for (let i = 0; i < 50 && !(await session.account()).loggedIn; i++) await new Promise(resolve => setTimeout(resolve, 20))
    }
    const status = await session.account()
    if (name === 'anonymous') { assert.equal(status.loggedIn, false);await assert.rejects(session.captureCredentials(5000), e => e.kind === 'auth') }
    else if (name === 'terms') { assert.equal(status.accepted, false);await assert.rejects(session.captureCredentials(5000), e => e.kind === 'auth') }
    else {
      assert.deepEqual(status, { loggedIn: true, email: name === 'live' ? 'live@example.test' : 'saved@example.test', accepted: true })
      const before = calls.length
      assert.deepEqual(await session.captureCredentials(5000), { refreshToken: name === 'live' ? 'fixture-refresh' : 'persisted-refresh', pushFilename: '', bgToken: '' })
      assert.equal(calls.slice(before).some(c => c.method === 'POST'), false)
    }
    await session.close();assert.equal(session.isClosed(), true)
    await assert.rejects(session.captureCredentials(5000), e => e.kind === 'cancelled')
    session = undefined
  }
  assert.equal(calls.some(c => c.origin === 'https://content-push.googleapis.com' || c.path.includes('batchexecute')), false)
  console.log('PASS: ' + (source ? 'TypeScript' : 'compiled') + ' optional login reads current Firebase/IndexedDB credentials, rejects anonymous/unaccepted users, uploads no images, and closes cleanly')
} finally {
  await session?.close()
  const resolved = await realpath(root)
  assert.ok(basename(resolved).startsWith('synthid-login-test-'))
  await rm(resolved, { recursive: true, force: true })
}
