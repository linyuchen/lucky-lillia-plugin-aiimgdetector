import { randomUUID } from 'node:crypto'
import type { ManualSynthIdCredentials } from '../src/synthid-manual.js'
import type { FakeAnswer, FakeCall } from './fakeAi.js'

export function jwt(userId: string, expires = Date.now() / 1000 + 3600): string {
  return 'test.' + Buffer.from(JSON.stringify({ user_id: userId, sub: userId, exp: expires })).toString('base64url') + '.test'
}

export function frame(entries: unknown[]): string {
  const text = JSON.stringify(entries) + '\n'
  return Buffer.byteLength(text) + '\n' + text
}

/** Synthetic wire fixtures following the documented JSPB fields; no real account data. */
export function rpc(payload: unknown, code?: number): FakeAnswer {
  return {
    body: Buffer.from(")]}'\n\n" + frame([['wrb.fr', 'TZRKo', payload === null ? null : JSON.stringify(payload), null, null, code === undefined ? null : [code], 'generic']])),
    type: 'application/json; charset=utf-8',
  }
}

export function imageResult(status = 3, source = 1, partner: string | null = null, reason: number | null = null): FakeAnswer {
  return rpc([null, null, null, null, [[status, null, null, 0.001, null, null, null, null, null, reason, source, partner, 5]]])
}

export function synthIdFixture() {
  const userId = 'test-' + randomUUID()
  const config: ManualSynthIdCredentials & { timeout: number } = {
    refreshToken: 'test-refresh-' + userId,
    pushFilename: `users/${userId}/files/00000000-0000-4000-8000-000000000000`,
    bgToken: '!test-botguard',
    timeout: 1000,
  }
  const fixture = {
    userId,
    config,
    auth: { json: { id_token: jwt(userId), refresh_token: 'rotated-' + userId, user_id: userId } } as FakeAnswer,
    start: {
      headers: { 'x-goog-upload-url': 'https://content-push.googleapis.com/upload/?upload_id=test-session', 'x-goog-upload-status': 'active' },
      body: Buffer.alloc(0), type: 'text/plain',
    } as FakeAnswer,
    uploaded: {
      headers: { 'x-goog-upload-status': 'final' },
      body: Buffer.from('/synthid-demo-drop-zone/ttl_1d/' + config.pushFilename), type: 'text/plain',
    } as FakeAnswer,
    detection: imageResult(),
    route(call: FakeCall): FakeAnswer | undefined {
      if (call.path.startsWith('/synthid/token?')) return fixture.auth
      if (call.path === '/synthid/upload/') return fixture.start
      if (call.path.startsWith('/synthid/upload/?')) return fixture.uploaded
      if (call.path.startsWith('/synthid/detect?')) return fixture.detection
    },
  }
  return fixture
}

export function redirectSynthId(url: string | URL, local: string): string | URL {
  const parsed = new URL(url)
  if (parsed.origin === 'https://securetoken.googleapis.com' && parsed.pathname === '/v1/token') return local + '/synthid/token' + parsed.search
  if (parsed.origin === 'https://content-push.googleapis.com') return local + '/synthid' + parsed.pathname + parsed.search
  if (parsed.origin === 'https://synthid.com' && parsed.pathname === '/_/WatermarkApp/data/batchexecute') return local + '/synthid/detect' + parsed.search
  return url
}
