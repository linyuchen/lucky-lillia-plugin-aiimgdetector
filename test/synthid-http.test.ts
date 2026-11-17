import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, type TestApp } from '@luckylillia/plugin-sdk/testing'
import { HttpSynthIdClient } from '../src/synthid-http.js'
import { SynthIdClient } from '../src/synthid.js'
import { startFakeAi, PNG } from './fakeAi.js'
import { fakeLifecycle, fixtureRuntime, httpSynthIdFixture, redirectSynthIdHttp, jwt } from './fakeSynthidHttp.js'
import { rpc } from './fakeSynthidManual.js'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

let app: TestApp, fake: Awaited<ReturnType<typeof startFakeAi>>, fixture: ReturnType<typeof httpSynthIdFixture>
let lifecycle: ReturnType<typeof fakeLifecycle>, client: HttpSynthIdClient
const image = () => ({ data: Uint8Array.from(PNG).buffer, type: 'image/png' })
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
beforeEach(async () => {
  app = await createTestApp()
  fixture = httpSynthIdFixture()
  fake = await startFakeAi(call => fixture.route(call))
  const fetch = app.ctx.http.fetch.bind(app.ctx.http)
  vi.spyOn(app.ctx.http, 'fetch').mockImplementation((url, init) => {
    const local = redirectSynthIdHttp(url, fake.url)
    if (!String(local).startsWith(fake.url + '/')) throw Error('External request is forbidden in tests')
    return fetch(local, init)
  })
  lifecycle = fakeLifecycle()
  lifecycle.snapshot.mockImplementation(async blobref => ({ success: true, bgToken: '!fresh-' + blobref.split('/').at(-1), blobref }))
  client = new HttpSynthIdClient(app.ctx, { refreshToken: fixture.config.refreshToken, timeout: 3000, loadRuntime: fixtureRuntime(lifecycle) })
})
afterEach(async () => { await app.dispose(); await fake.close(); vi.restoreAllMocks() })

describe('browser-free SynthID HTTP client', () => {
  it('executes the complete HTTP chain through the plugin credential scope', async () => {
    const plugin = new SynthIdClient(app.ctx, { timeout: 3000, credentials: { refreshToken: fixture.config.refreshToken } }, { loadRuntime: fixtureRuntime(lifecycle) })
    expect(await plugin.detect(image())).toMatchObject({ status: 'detected' })
    expect(lifecycle.snapshot).toHaveBeenCalledOnce()
    await plugin.dispose()
  })
  it('keeps page cookies on SynthID requests without leaking them to challenge or upload hosts', async () => {
    fixture.page.headers = { 'set-cookie': 'sid=fixture-cookie; Path=/; Secure' }
    await client.detect(image())
    expect(fake.calls.find(c => c.path.startsWith('/synthid/detect?'))!.headers.cookie).toContain('sid=fixture-cookie')
    for (const call of fake.calls.filter(c => c.path === '/synthid/challenge' || c.path.startsWith('/synthid/upload') || c.path === '/synthid/interpreter')) {
      expect(call.headers.cookie).toBeUndefined()
    }
  })
  it('fetches the challenge resources, binds fresh tokens and uploads exact bytes for each image', async () => {
    expect(await client.detect(image())).toMatchObject({ status: 'detected', source: 'google' })
    expect(await client.detect(image())).toMatchObject({ status: 'detected' })
    const starts = fake.calls.filter(c => c.headers['x-goog-upload-command'] === 'start')
    const finals = fake.calls.filter(c => c.headers['x-goog-upload-command'] === 'upload, finalize')
    const detections = fake.calls.filter(c => c.path.startsWith('/synthid/detect?'))
    expect(starts).toHaveLength(2)
    expect(starts[0].headers['push-filename']).not.toBe(starts[1].headers['push-filename'])
    for (let i = 0; i < 2; i++) {
      const path = String(starts[i].headers['push-filename'])
      expect(path).toMatch(new RegExp('^users/' + fixture.userId + '/files/[a-f0-9-]{36}$'))
      expect(finals[i].raw).toEqual(PNG)
      const header = JSON.parse(String(detections[i].headers['x-goog-ext-525006476-jspb']))
      expect(header[0]).toBe(jwt(fixture.userId, JSON.parse(Buffer.from(header[0].split('.')[1], 'base64url').toString()).exp))
      expect(header[5]).toBe('!fresh-' + path.split('/').at(-1))
      expect(lifecycle.snapshot.mock.calls[i][0]).toBe('/synthid-demo-drop-zone/ttl_1d/' + path)
      const form = new URLSearchParams(detections[i].raw.toString())
      expect(form.get('at')).toBe('fixture-at')
      expect(JSON.stringify(JSON.parse(form.get('f.req')!))).toContain(path)
      expect(detections[i].headers['x-same-domain']).toBe('1')
    }
    expect(fake.calls.some(c => c.path === '/synthid/interpreter')).toBe(true)
    expect(fake.calls.some(c => c.path === '/synthid/frame')).toBe(true)
    expect(lifecycle.dispose).toHaveBeenCalledTimes(2)
  })

  it('persists rotated secrets and revalidates authentication after a restart', async () => {
    await client.detect(image())
    const files = await readdir(join(await app.ctx.storage.dir(), 'synthid-http'))
    expect(files).toHaveLength(1)
    const saved = await readFile(join(await app.ctx.storage.dir(), 'synthid-http', files[0]), 'utf8')
    expect(JSON.parse(saved)).toEqual({ refreshToken: 'rotated-' + fixture.userId, updatedAt: expect.any(Number) })
    expect(saved).not.toContain('idToken')
    const next = new HttpSynthIdClient(app.ctx, { refreshToken: fixture.config.refreshToken, timeout: 3000, loadRuntime: fixtureRuntime(lifecycle) })
    await next.detect(image())
    const auth = fake.calls.filter(c => c.path.startsWith('/synthid/token?'))
    expect(auth).toHaveLength(2)
    expect(new URLSearchParams(auth[1].raw.toString()).get('refresh_token')).toBe('rotated-' + fixture.userId)
  })

  it('serializes different refresh tokens belonging to the same verified account', async () => {
    const held = deferred<{ success: boolean; bgToken: string; blobref: string }>()
    lifecycle.snapshot.mockReturnValueOnce(held.promise)
    const other = new HttpSynthIdClient(app.ctx, { refreshToken: 'another-refresh', timeout: 3000, loadRuntime: fixtureRuntime(lifecycle) })
    const first = client.detect(image())
    await vi.waitFor(() => expect(lifecycle.snapshot).toHaveBeenCalledTimes(1))
    const second = other.detect(image())
    await vi.waitFor(() => expect(fake.calls.filter(c => c.path.startsWith('/synthid/token?'))).toHaveLength(2))
    expect(lifecycle.snapshot).toHaveBeenCalledTimes(1)
    held.resolve({ success: true, bgToken: '!held', blobref: lifecycle.snapshot.mock.calls[0][0] })
    await Promise.all([first, second])
    expect(lifecycle.snapshot).toHaveBeenCalledTimes(2)
  })

  it('refreshes authentication once after code 16 and uses a new path and snapshot', async () => {
    const route = fixture.route.bind(fixture)
    let detections = 0
    fixture.route = call => call.path.startsWith('/synthid/detect?') && detections++ === 0 ? rpc(null, 16) : route(call)
    expect(await client.detect(image())).toMatchObject({ status: 'detected' })
    expect(fake.calls.filter(c => c.path.startsWith('/synthid/token?'))).toHaveLength(2)
    expect(lifecycle.snapshot).toHaveBeenCalledTimes(2)
    expect(lifecycle.snapshot.mock.calls[0][0]).not.toBe(lifecycle.snapshot.mock.calls[1][0])
    expect(lifecycle.dispose).toHaveBeenCalledTimes(2)
  })

  it('keeps permission refusal distinct from watermark absence and does not retry it', async () => {
    fixture.detection = rpc(null, 7)
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'permission', code: 7 })
    expect(lifecycle.snapshot).toHaveBeenCalledTimes(1)
    expect(lifecycle.dispose).toHaveBeenCalledOnce()
  })

  it('shares quota backoff across separate credentials for one account', async () => {
    fixture.detection = rpc(null, 8)
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'rate-limit' })
    const other = new HttpSynthIdClient(app.ctx, { refreshToken: 'same-account-other-token', timeout: 3000, loadRuntime: fixtureRuntime(lifecycle) })
    await expect(other.detect(image())).rejects.toMatchObject({ kind: 'rate-limit' })
    expect(lifecycle.snapshot).toHaveBeenCalledOnce()
  })

  it('validates refreshed account claims before uploading', async () => {
    fixture.auth = { json: { id_token: jwt(fixture.userId), user_id: 'different-account' } }
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'auth' })
    expect(lifecycle.initialize).not.toHaveBeenCalled()
    expect(fake.calls).toHaveLength(1)
  })

  it('does not leak upstream bodies or credential values from authentication errors', async () => {
    fixture.auth = { status: 401, body: Buffer.from('PRIVATE-CREDENTIAL-AND-RESPONSE') }
    const error = await client.detect(image()).catch(e => e)
    expect(error).toMatchObject({ kind: 'auth' })
    expect(error.message).not.toContain('PRIVATE')
  })

  it('rejects upload redirects before sending image bytes', async () => {
    fixture.start = { headers: { 'x-goog-upload-url': 'https://attacker.invalid/upload/' } }
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'response' })
    expect(fake.calls.some(c => c.headers['x-goog-upload-command'] === 'upload, finalize')).toBe(false)
    expect(lifecycle.dispose).toHaveBeenCalledOnce()
  })

  it('cancels a queued request immediately without disturbing another client', async () => {
    const held = deferred<{ success: boolean; bgToken: string; blobref: string }>()
    lifecycle.snapshot.mockReturnValueOnce(held.promise)
    const first = client.detect(image())
    await vi.waitFor(() => expect(lifecycle.snapshot).toHaveBeenCalledOnce())
    const other = new HttpSynthIdClient(app.ctx, { refreshToken: 'cancelled-other-token', timeout: 3000, loadRuntime: fixtureRuntime(lifecycle) })
    const signal = new AbortController()
    const second = other.detect(image(), signal.signal)
    const checked = expect(second).rejects.toMatchObject({ kind: 'cancelled' })
    await vi.waitFor(() => expect(fake.calls.filter(c => c.path.startsWith('/synthid/token?'))).toHaveLength(2))
    signal.abort()
    await checked
    held.resolve({ success: true, bgToken: '!held', blobref: lifecycle.snapshot.mock.calls[0][0] })
    await first
    expect(lifecycle.snapshot).toHaveBeenCalledOnce()
  })

  it('enforces the configured deadline while reading an HTTP response body', async () => {
    const quick = new HttpSynthIdClient(app.ctx, { refreshToken: 'quick-timeout', timeout: 35, loadRuntime: fixtureRuntime(lifecycle) })
    fixture.auth = { sse: ['sensitive stalled auth'], hold: true, type: 'text/plain' }
    await expect(quick.detect(image())).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('bounds retained images to four while authentication is pending', async () => {
    fixture.auth.delay = 100
    const tasks = Array.from({ length: 4 }, () => client.detect(image()))
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'busy' })
    await Promise.all(tasks)
    expect(lifecycle.snapshot).toHaveBeenCalledTimes(4)
    expect(fake.calls.filter(c => c.path.startsWith('/synthid/token?'))).toHaveLength(1)
  })

  it('cancels authentication lock waiters without waiting for another client', async () => {
    fixture.auth.delay = 500
    const first = client.detect(image())
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1))
    const other = new HttpSynthIdClient(app.ctx, { refreshToken: fixture.config.refreshToken, timeout: 3000, loadRuntime: fixtureRuntime(lifecycle) })
    const controller = new AbortController()
    const second = other.detect(image(), controller.signal)
    const checked = expect(second).rejects.toMatchObject({ kind: 'cancelled' })
    controller.abort()
    await checked
    expect(lifecycle.snapshot).not.toHaveBeenCalled()
    await first
  })

  it('honors HTTP 429 retry-after without uploading another image', async () => {
    fixture.start = { status: 429, headers: { 'retry-after': '23' } }
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'rate-limit', retryAfterSeconds: 23 })
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'rate-limit' })
    expect(lifecycle.snapshot).toHaveBeenCalledOnce()
  })

  it('rejects oversized streamed resources before interpreter initialization', async () => {
    fixture.interpreter = { body: Buffer.alloc(1024 * 1024 + 1), type: 'application/javascript' }
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'response' })
    expect(lifecycle.initialize).not.toHaveBeenCalled()
  })

  it('aborts active network traffic on unload and cannot be reused afterwards', async () => {
    fixture.auth = { delay: 1000, json: { id_token: jwt(fixture.userId) } }
    const task = client.detect(image())
    const checked = expect(task).rejects.toMatchObject({ kind: 'cancelled' })
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1))
    await client.dispose()
    await checked
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'cancelled' })
  })
})
