import { vi } from 'vitest'
import type { FakeAnswer, FakeCall } from './fakeAi.js'
import { imageResult, jwt, synthIdFixture } from './fakeSynthidManual.js'

/** Fake wire fixtures for the browser-free HTTP chain: page session, challenge,
 * interpreter, frame, upload and detection. Synthetic data only. */
const FRAME_URL = 'https://synthid.com/_/bscframe?fixture=1'
const INTERPRETER_URL = 'https://www.google.com/js/fixture-interpreter.js'

export function pageHtml(): string {
  const data = { eptZe: '/_/WatermarkApp/', FdrFJe: 'fixture-f-sid', cfb2h: 'fixture-bl', SNlM0e: 'fixture-at', hl: 'en-US' }
  return '<!doctype html><script>WIZ_global_data = ' + JSON.stringify(data) + ';</script><body>fixture</body>'
}

/** JSPB-shaped Create response in the documented public representation. */
export function challengeJson(): unknown {
  const program = 'fixture-program//' + Buffer.from(FRAME_URL).toString('base64')
  const resource = [null, null, null, INTERPRETER_URL]
  return [['bfkj', null, resource, 'fixture-hash', program, 'globalFixture', null, '[]']]
}

export function httpSynthIdFixture() {
  const base = synthIdFixture()
  const fixture = {
    ...base,
    page: { body: Buffer.from(pageHtml()), type: 'text/html' } as FakeAnswer,
    frame: { body: Buffer.from('<html><body>frame fixture</body></html>'), type: 'text/html' } as FakeAnswer,
    interpreter: { body: Buffer.from('var fixtureInterpreter = 1;'), type: 'application/javascript' } as FakeAnswer,
    route(call: FakeCall): FakeAnswer | undefined {
      if (call.path.startsWith('/synthid/token?')) return fixture.auth
      if (call.path === '/synthid/page') return fixture.page
      if (call.path === '/synthid/frame') return fixture.frame
      if (call.path === '/synthid/interpreter') return fixture.interpreter
      if (call.path === '/synthid/challenge') return { json: challengeJson() }
      if (call.path === '/synthid/upload/') return fixture.start
      if (call.path.startsWith('/synthid/detect?')) return fixture.detection
      if (call.path.startsWith('/synthid/upload/?')) {
        // The browser-free path generates a fresh UUID path per request.
        return { headers: { 'x-goog-upload-status': 'final' }, body: Buffer.from('/synthid-demo-drop-zone/ttl_1d/' + call.headers['push-filename']), type: 'text/plain' } as FakeAnswer
      }
      return base.route(call)
    },
  }
  return fixture
}

export function redirectSynthIdHttp(url: string | URL, local: string): string | URL {
  const parsed = new URL(url)
  if (parsed.origin === 'https://synthid.com' && parsed.pathname === '/image-detection') return local + '/synthid/page'
  if (parsed.origin === 'https://synthid.com' && (parsed.pathname === '/_/bscframe' || parsed.pathname.startsWith('/_/bscframe/'))) return local + '/synthid/frame'
  if (parsed.origin === 'https://waa-pa.clients6.google.com' && parsed.pathname.endsWith('Waa/Create')) return local + '/synthid/challenge'
  if ((parsed.origin === 'https://www.google.com' || parsed.origin === 'https://www.gstatic.com') && parsed.pathname.startsWith('/js/')) return local + '/synthid/interpreter'
  if (parsed.origin === 'https://securetoken.googleapis.com' && parsed.pathname === '/v1/token') return local + '/synthid/token' + parsed.search
  if (parsed.origin === 'https://content-push.googleapis.com') return local + '/synthid' + parsed.pathname + parsed.search
  if (parsed.origin === 'https://synthid.com' && parsed.pathname === '/_/WatermarkApp/data/batchexecute') return local + '/synthid/detect' + parsed.search
  return url
}

export function fakeLifecycle() {
  const lifecycle = {
    initialize: vi.fn(async () => ({ success: true })),
    dispatchPointerDiagnostics: vi.fn(async () => ({ success: true })),
    snapshot: vi.fn(async (blobref: string) => ({ success: true, bgToken: '!generated-fixture', blobref })),
    dispose: vi.fn(async () => ({ success: true })),
    telemetry: {},
  }
  return lifecycle
}

export function fixtureRuntime(lifecycle: ReturnType<typeof fakeLifecycle>) {
  return async () => ({
    ...(await import('../src/synthid-http-runtime/entry.mjs')),
    createLifecycleClient: () => lifecycle,
  })
}

export { imageResult, jwt }
