import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, type TestApp } from '@luckylillia/plugin-sdk/testing'
import { ManualSynthIdClient as SynthIdClient, ManualSynthIdError, describeManualSynthIdFailure, synthIdCredentialIdentity, type ManualSynthIdCredentials } from '../src/synthid-manual.js'
import { PNG, startFakeAi, type FakeAnswer, type FakeCall } from './fakeAi.js'
import { imageResult, jwt, redirectSynthId, rpc, synthIdFixture } from './fakeSynthidManual.js'

let app: TestApp
let fake: Awaited<ReturnType<typeof startFakeAi>>
let fixture: ReturnType<typeof synthIdFixture>
let override: ((call: FakeCall) => FakeAnswer | undefined) | undefined
let client: SynthIdClient
const image = (bytes = PNG) => ({ data: Uint8Array.from(bytes).buffer, type: 'image/png' })
const phase = (call: FakeCall) => call.path.startsWith('/synthid/token?') ? 'auth'
  : call.path.startsWith('/synthid/detect?') ? 'detect' : call.headers['x-goog-upload-command']

beforeEach(async () => {
  fixture = synthIdFixture()
  override = undefined
  fake = await startFakeAi(call => override?.(call) ?? fixture.route(call))
  app = await createTestApp()
  const fetch = app.ctx.http.fetch.bind(app.ctx.http)
  vi.spyOn(app.ctx.http, 'fetch').mockImplementation((url, init, config) => {
    const local = redirectSynthId(url, fake.url)
    if (!String(local).startsWith(fake.url + '/')) throw new Error('unexpected external request in test')
    return fetch(local, init, config)
  })
  client = new SynthIdClient(app.ctx, fixture.config)
})

afterEach(async () => {
  await app.dispose()
  await fake.close()
  vi.restoreAllMocks()
})

describe('SynthID credential source identity', () => {
  it('matches normalized form values without returning credential contents or making requests', () => {
    const original = synthIdCredentialIdentity(fixture.config)
    const formatted = {
      refreshToken: '  ' + fixture.config.refreshToken + '\n',
      pushFilename: ' /synthid-demo-drop-zone/ttl_1d/' + fixture.config.pushFilename + ' ',
      bgToken: '\n' + JSON.stringify([jwt(fixture.userId), null, null, null, null, fixture.config.bgToken]) + ' ',
    }
    expect(original).toEqual({ key: expect.stringMatching(/^[a-f0-9]{64}$/), userId: fixture.userId })
    expect(synthIdCredentialIdentity(formatted)).toEqual(original)
    expect(formatted.bgToken).toContain('[')
    for (const value of [fixture.config.refreshToken, fixture.config.pushFilename, fixture.config.bgToken]) {
      expect(JSON.stringify(original)).not.toContain(value)
    }
    expect(fake.calls).toEqual([])
  })

  it.each(['refreshToken', 'pushFilename', 'bgToken'] as const)('distinguishes a different %s, including changes within the same account', field => {
    const original = synthIdCredentialIdentity(fixture.config)!
    const changed = synthIdCredentialIdentity({ ...fixture.config, [field]: fixture.config[field] + 'other' })!
    expect(changed.userId).toBe(original.userId)
    expect(changed.key).not.toBe(original.key)
  })

  it.each(['refreshToken', 'pushFilename', 'bgToken'] as const)('rejects a missing or invalid %s instead of matching the remaining fields', field => {
    for (const value of ['', '   ', undefined, 123]) {
      expect(synthIdCredentialIdentity({ ...fixture.config, [field]: value } as ManualSynthIdCredentials)).toBeUndefined()
    }
    expect(fake.calls).toEqual([])
  })

  it('validates a complete header account before matching its verification token', () => {
    const mixed = { ...fixture.config, bgToken: JSON.stringify([jwt('other-account'), null, null, null, null, fixture.config.bgToken]) }
    expect(synthIdCredentialIdentity(mixed)).toBeUndefined()
    expect(fake.calls).toEqual([])
  })

  it.each([
    { bgToken: '[broken' }, { bgToken: '[null,null,null,null,null,42]' }, { bgToken: 'not-a-verification-token' },
    { refreshToken: 'a\rb' }, { pushFilename: 'users/a/files/../b' }, { pushFilename: 'https://example.test/users/a/files/b' },
  ])('rejects malformed identity input: %j', change => {
    expect(synthIdCredentialIdentity({ ...fixture.config, ...change })).toBeUndefined()
  })
})

describe('SynthID manual credential HTTP client', () => {
  it('refreshes the login, uploads the original bytes and sends the documented image RPC', async () => {
    const hooks: string[] = []
    app.ctx.on('http/fetch-init', (url, _init, config) => {
      hooks.push(url.pathname)
      expect(config.proxyAgent).not.toBe('')
    })
    expect(await client.detect(image())).toEqual({ status: 'detected', source: 'google', confidence: 'high' })
    expect(fake.calls.map(phase)).toEqual(['auth', 'start', 'upload, finalize', 'detect'])
    expect(hooks).toHaveLength(4)
    const [auth, start, upload, detect] = fake.calls
    expect(Object.fromEntries(new URLSearchParams(auth.raw.toString()))).toEqual({
      grant_type: 'refresh_token', refresh_token: fixture.config.refreshToken,
    })
    expect(start.headers).toMatchObject({
      'x-goog-upload-protocol': 'resumable', 'x-goog-upload-header-content-length': String(PNG.length),
      'push-filename': fixture.config.pushFilename, origin: 'https://synthid.com', referer: 'https://synthid.com/',
    })
    expect(start.raw.toString()).toBe('file_name image.png')
    expect(upload.raw).toEqual(PNG)
    expect(upload.headers['push-filename']).toBe(start.headers['push-filename'])
    expect(upload.headers['x-goog-upload-offset']).toBe('0')
    const query = new URL(detect.path, fake.url).searchParams
    expect(Object.fromEntries(query)).toEqual({ rpcids: 'TZRKo', 'source-path': '/image-detection', hl: 'en-US', rt: 'c' })
    const envelope = JSON.parse(new URLSearchParams(detect.raw.toString()).get('f.req')!)
    expect(envelope[0][0][0]).toBe('TZRKo')
    expect(JSON.parse(envelope[0][0][1])).toEqual([null, [[['image/png', null, null, null, null, null, '/synthid-demo-drop-zone/ttl_1d/' + fixture.config.pushFilename]]], 0])
    expect(JSON.parse(detect.headers['x-goog-ext-525006476-jspb'] as string)).toEqual([
      (fixture.auth.json as any).id_token, null, null, null, null, fixture.config.bgToken,
    ])
    expect(detect.headers.authorization).toBeUndefined()
    const directory = join(await app.ctx.storage.dir(), 'synthid-manual')
    const files = await readdir(directory)
    expect(files).toHaveLength(1)
    expect(files[0]).not.toContain(fixture.config.refreshToken)
    expect(JSON.parse(await readFile(join(directory, files[0]), 'utf8'))).toMatchObject({ refreshToken: 'rotated-' + fixture.userId })
  })

  it('reuses cached tokens across instances, then refreshes with the rotated token after expiry', async () => {
    await client.detect(image())
    const restarted = new SynthIdClient(app.ctx, fixture.config)
    await restarted.detect(image())
    expect(fake.calls.filter(call => phase(call) === 'auth')).toHaveLength(1)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 3600_000)
    fixture.auth = { json: { id_token: jwt(fixture.userId), refresh_token: 'rotated-again', user_id: fixture.userId } }
    await restarted.detect(image())
    const refreshes = fake.calls.filter(call => phase(call) === 'auth')
    expect(refreshes).toHaveLength(2)
    expect(new URLSearchParams(refreshes[1].raw.toString()).get('refresh_token')).toBe('rotated-' + fixture.userId)
    // The original config remains usable through the persisted cache.
    expect(fixture.config.refreshToken).toBe('test-refresh-' + fixture.userId)
  })

  it('accepts the full captured header and full blob path but verifies login with a refresh first', async () => {
    const captured = new SynthIdClient(app.ctx, {
      ...fixture.config, pushFilename: '/synthid-demo-drop-zone/ttl_1d/' + fixture.config.pushFilename,
      bgToken: JSON.stringify([jwt(fixture.userId), null, null, null, null, fixture.config.bgToken]),
    })
    await captured.detect(image())
    expect(fake.calls.map(phase)).toEqual(['auth', 'start', 'upload, finalize', 'detect'])
  })

  it('does not reuse credentials or tokens from the previous unrequested manual configuration cache', async () => {
    const directory = join(await app.ctx.storage.dir(), 'synthid')
    await mkdir(directory, { recursive: true })
    const key = createHash('sha256').update(fixture.userId + '\0' + fixture.config.refreshToken).digest('hex')
    await writeFile(join(directory, key + '.json'), JSON.stringify({ refreshToken: 'old-cache-token', idToken: jwt(fixture.userId), updatedAt: Date.now() }))
    await client.detect(image())
    expect(await readdir(await app.ctx.storage.dir())).toContain('synthid-manual')
    expect(fake.calls.map(phase)).toEqual(['auth', 'start', 'upload, finalize', 'detect'])
    expect(new URLSearchParams(fake.calls[0].raw.toString()).get('refresh_token')).toBe(fixture.config.refreshToken)
    expect(JSON.parse(await readFile(join(directory, key + '.json'), 'utf8')).refreshToken).toBe('old-cache-token')
  })

  it('serializes complete detections across clients sharing one account', async () => {
    fixture.uploaded.delay = 20
    const second = new SynthIdClient(app.ctx, fixture.config)
    await Promise.all([client.detect(image(Buffer.from('first'))), second.detect(image(Buffer.from('second'))), client.detect(image(Buffer.from('third')))])
    expect(fake.calls.map(phase)).toEqual(['auth', 'start', 'upload, finalize', 'detect', 'start', 'upload, finalize', 'detect', 'start', 'upload, finalize', 'detect'])
    expect(fake.calls.filter(call => phase(call) === 'upload, finalize').map(call => call.raw.toString())).toEqual(['first', 'second', 'third'])
  })

  it('releases the queue after a failed detection without replaying a consumed blob', async () => {
    let detections = 0
    override = call => phase(call) === 'detect' && ++detections === 1 ? rpc(null, 13) : undefined
    const results = await Promise.allSettled([client.detect(image()), client.detect(image())])
    expect(results[0]).toMatchObject({ status: 'rejected', reason: { kind: 'server', code: 13 } })
    expect(results[1]).toMatchObject({ status: 'fulfilled', value: { status: 'detected' } })
    expect(fake.calls.filter(call => phase(call) === 'detect')).toHaveLength(2)
  })

  it('bounds the queue rather than retaining unlimited image buffers', async () => {
    fixture.uploaded.delay = 15
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => client.detect(image())))
    expect(results.slice(0, 4).every(result => result.status === 'fulfilled')).toBe(true)
    expect(results[4]).toMatchObject({ status: 'rejected', reason: { kind: 'busy' } })
    expect(fake.calls.filter(call => phase(call) === 'detect')).toHaveLength(4)
  })

  it('cancels queued callers immediately and releases their capacity while a different client is stalled', async () => {
    fixture.uploaded = { sse: ['waiting'], hold: true }
    const first = new SynthIdClient(app.ctx, fixture.config)
    const pending = first.detect(image())
    const failed = expect(pending).rejects.toMatchObject({ kind: 'cancelled' })
    await vi.waitFor(() => expect(fake.calls.some(call => phase(call) === 'upload, finalize')).toBe(true))
    const queued = [client.detect(image(Buffer.from('cancelled-1'))), client.detect(image(Buffer.from('cancelled-2'))), client.detect(image(Buffer.from('cancelled-3')))]
    const cancelled = Promise.all(queued.map(task => expect(task).rejects.toMatchObject({ kind: 'cancelled' })))
    await client.dispose()
    await cancelled
    expect(fake.calls.map(phase)).toEqual(['auth', 'start', 'upload, finalize'])
    const next = new SynthIdClient(app.ctx, fixture.config)
    fixture.uploaded = { headers: { 'x-goog-upload-status': 'final' }, body: Buffer.from('/synthid-demo-drop-zone/ttl_1d/' + fixture.config.pushFilename), type: 'text/plain' }
    const result = next.detect(image(Buffer.from('remaining')))
    await first.dispose()
    await failed
    expect(await result).toMatchObject({ status: 'detected' })
    expect(fake.calls.filter(call => phase(call) === 'upload, finalize').map(call => call.raw.toString())).toEqual([PNG.toString(), 'remaining'])
  })

  it('refreshes once after an RPC login rejection and re-uploads before retrying', async () => {
    let detections = 0
    override = call => phase(call) === 'detect' && ++detections === 1 ? rpc(null, 16) : undefined
    expect(await client.detect(image())).toMatchObject({ status: 'detected' })
    expect(fake.calls.map(phase)).toEqual(['auth', 'start', 'upload, finalize', 'detect', 'auth', 'start', 'upload, finalize', 'detect'])
  })

  it.each([16, 7])('stops retrying rejected credentials (RPC %s)', async code => {
    fixture.detection = rpc(null, code)
    await expect(client.detect(image())).rejects.toMatchObject({ kind: code === 16 ? 'auth' : 'permission', code })
    expect(fake.calls.filter(call => phase(call) === 'detect')).toHaveLength(code === 16 ? 2 : 1)
  })

  it('honors quota backoff across instances and resumes after the cooldown', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now())
    fixture.detection = rpc([null, null, null, null, null, null, [[null, null, 1, [5, 0]]]])
    expect(await client.detect(image())).toEqual({ status: 'quota_exceeded', retryAfterSeconds: 5 })
    const other = new SynthIdClient(app.ctx, fixture.config)
    await expect(other.detect(image())).rejects.toMatchObject({ kind: 'rate-limit', retryAfterSeconds: 5 })
    expect(fake.calls).toHaveLength(4)
    clock.mockReturnValue(Date.now() + 6000)
    fixture.detection = imageResult(2)
    expect(await other.detect(image())).toEqual({ status: 'not_detected' })
    expect(fake.calls).toHaveLength(7)
  })

  it('handles HTTP rate limits without leaking an upstream body that echoes credentials', async () => {
    fixture.start = { status: 429, headers: { 'retry-after': '30' }, json: { error: fixture.config.refreshToken } }
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'rate-limit', retryAfterSeconds: 30, message: 'SynthID upload returned HTTP 429' })
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'rate-limit' })
    expect(fake.calls).toHaveLength(2)
  })

  it('does not retry an upload after a dropped connection', async () => {
    fixture.uploaded = { drop: true }
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'network' })
    expect(fake.calls.map(phase)).toEqual(['auth', 'start', 'upload, finalize'])
  })

  it.each([
    'https://unrelated.invalid/upload/',
    'http://content-push.googleapis.com/upload/',
    'https://content-push.googleapis.com.unrelated.invalid/upload/',
    'https://content-push.googleapis.com/other/',
    'https://content-push.googleapis.com:444/upload/',
    'https://user:password@content-push.googleapis.com/upload/',
    'https://content-push.googleapis.com/upload/../other/',
  ])('rejects an unexpected upload destination: %s', async url => {
    fixture.start.headers!['x-goog-upload-url'] = url
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'response' })
    expect(fake.calls.map(phase)).toEqual(['auth', 'start'])
  })

  it('does not send a mismatched upload path to BotGuard', async () => {
    fixture.uploaded.body = Buffer.from('/synthid-demo-drop-zone/ttl_1d/users/other/files/other')
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'response' })
    expect(fake.calls.filter(call => phase(call) === 'detect')).toHaveLength(0)
  })

  it('reports a mismatched account before uploading an image', async () => {
    fixture.auth = { json: { id_token: jwt('other-account'), user_id: 'other-account' } }
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'config' })
    expect(fake.calls.map(phase)).toEqual(['auth'])
  })

  it('rejects a captured header belonging to another account before making requests', async () => {
    const mixed = new SynthIdClient(app.ctx, { ...fixture.config, bgToken: JSON.stringify([jwt('another-account'), null, null, null, null, fixture.config.bgToken]) })
    await expect(mixed.detect(image())).rejects.toMatchObject({ kind: 'config' })
    expect(fake.calls).toEqual([])
  })

  it('rejects conflicting account claims even when token refresh repeats the expected user id', async () => {
    fixture.auth = { json: { id_token: jwt('different-account'), user_id: fixture.userId } }
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'config' })
    expect(fake.calls.map(phase)).toEqual(['auth'])
  })

  it('refuses redirects instead of forwarding credentials or image bytes to a second destination', async () => {
    fixture.start = { status: 302, headers: { location: fake.url + '/capture' }, body: Buffer.alloc(0) }
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'network' })
    expect(fake.calls.map(phase)).toEqual(['auth', 'start'])
  })

  it.each([
    { refreshToken: '' }, { refreshToken: 'a\rb' }, { pushFilename: 'users/a/files/b/extra' }, { bgToken: '[broken' }, { bgToken: '' },
    { pushFilename: 'https://example.test/users/a/files/b' }, { pushFilename: '//users/a/files/b' }, { pushFilename: 'users/a/files/../b' },
  ])('rejects incomplete or malformed credentials before making requests', async change => {
    const invalid = new SynthIdClient(app.ctx, { ...fixture.config, ...change })
    await expect(invalid.detect(image())).rejects.toMatchObject({ kind: 'config' })
    expect(fake.calls).toEqual([])
  })

  it('rejects empty, oversized and unsupported images before uploading', async () => {
    for (const value of [image(Buffer.alloc(0)), image(Buffer.alloc(20 * 1024 * 1024 + 1)), { ...image(), type: 'image/svg+xml' }]) {
      await expect(client.detect(value)).rejects.toMatchObject({ kind: 'request' })
    }
    expect(fake.calls).toEqual([])
  })

  it('times out a stalled request and releases the account queue', async () => {
    fixture.start.delay = 100
    const short = new SynthIdClient(app.ctx, { ...fixture.config, timeout: 20 })
    await expect(short.detect(image())).rejects.toMatchObject({ kind: 'timeout' })
    fixture.start.delay = 0
    expect(await client.detect(image())).toMatchObject({ status: 'detected' })
  })

  it('cancels in-flight and queued detections when its plugin is unloaded', async () => {
    fixture.uploaded.delay = 200
    let scoped!: SynthIdClient
    const fiber = await app.ctx.plugin({ name: 'synthid-test', inject: ['http'], apply(ctx) { scoped = new SynthIdClient(ctx, fixture.config) } })
    const results = Promise.allSettled([scoped.detect(image()), scoped.detect(image())])
    await vi.waitFor(() => expect(fake.calls.some(call => phase(call) === 'upload, finalize')).toBe(true))
    await fiber.dispose()
    expect(await results).toEqual([
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ kind: 'cancelled' }) }),
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ kind: 'cancelled' }) }),
    ])
    expect(fake.calls.filter(call => phase(call) === 'detect')).toHaveLength(0)
  })

  it('keeps the timeout active while receiving a stalled response body', async () => {
    fixture.detection = { sse: ['partial response'], hold: true }
    const short = new SynthIdClient(app.ctx, { ...fixture.config, timeout: 100 })
    await expect(short.detect(image())).rejects.toMatchObject({ kind: 'timeout' })
    expect(fake.calls.filter(call => phase(call) === 'detect')).toHaveLength(1)
  })

  it.each([
    [401, 'auth', 'refresh_token'],
    [403, 'permission', '拒绝'],
  ])('reports safe manual recovery instructions for detection HTTP %s', async (status, kind, instruction) => {
    fixture.detection = { status: Number(status), body: Buffer.from(JSON.stringify(fixture.config)) }
    let caught: unknown
    try { await client.detect(image()) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(ManualSynthIdError)
    expect(caught).toMatchObject({ kind })
    const message = describeManualSynthIdFailure(caught as ManualSynthIdError)
    expect(message).toContain(instruction)
    expect(message).not.toContain('浏览器')
    if (kind === 'permission') expect(message).not.toMatch(/失效|过期|重新登录|校验/)
    for (const value of [fixture.config.refreshToken, fixture.config.bgToken, fixture.config.pushFilename]) {
      expect(String(caught)).not.toContain(value)
      expect(message).not.toContain(value)
    }
  })

  it('does not leak network exception details that contain private credentials', async () => {
    vi.mocked(app.ctx.http.fetch).mockRejectedValueOnce(new Error(JSON.stringify(fixture.config)))
    let caught: unknown
    try { await client.detect(image()) } catch (error) { caught = error }
    expect(caught).toBeInstanceOf(ManualSynthIdError)
    expect(caught).toMatchObject({ kind: 'network' })
    expect(String(caught)).not.toContain(fixture.config.refreshToken)
    expect(String(caught)).not.toContain(fixture.config.bgToken)
  })
})
