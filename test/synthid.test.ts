import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, type TestApp } from '@luckylillia/plugin-sdk/testing'
import { SynthIdClient, handleSynthId } from '../src/synthid.js'
import { HttpSynthIdClient } from '../src/synthid-http.js'
import { launchSynthIdBrowser } from '../src/synthid-browser.js'
import { SynthIdError, type SynthIdResult } from '../src/synthid-result.js'
import { PNG } from './fakeAi.js'

vi.mock('../src/synthid-browser.js', () => ({ launchSynthIdBrowser: vi.fn() }))
let app: TestApp, client: SynthIdClient
const config = { timeout: 1000 }
const credentials = { refreshToken: 'captured-fixture' }
const account = 'sample@example.test'
const found: SynthIdResult = { status: 'detected', source: 'google' }
const image = () => ({ data: Uint8Array.from(PNG).buffer, type: 'image/png' })
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
function fakeBrowser() {
  const browser = {
    closed: false, info: { loggedIn: true, accepted: true, email: account },
    account: vi.fn(async () => browser.info), isClosed: vi.fn(() => browser.closed),
    bringToFront: vi.fn(async () => {}), detect: vi.fn(async () => found),
    captureCredentials: vi.fn(async () => ({ ...credentials, pushFilename: '', bgToken: '' })),
    close: vi.fn(async () => { browser.closed = true }),
  }
  return browser
}
async function loggedIn(browser = fakeBrowser()) {
  vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
  await client.login()
  await vi.waitFor(async () => expect(await client.status()).toMatchObject({ state: 'ready', account }), { timeout: 4000, interval: 10 })
  await vi.waitFor(() => expect(browser.close).toHaveBeenCalledOnce())
  return browser
}
beforeEach(async () => {
  app = await createTestApp()
  vi.mocked(launchSynthIdBrowser).mockImplementation(async () => fakeBrowser())
  vi.spyOn(app.ctx.http, 'fetch').mockRejectedValue(Error('Network is forbidden in session tests'))
  vi.spyOn(HttpSynthIdClient.prototype, 'detect').mockResolvedValue(found)
  client = new SynthIdClient(app.ctx, config)
})
afterEach(async () => { await app.dispose(); vi.restoreAllMocks() })

describe('SynthID login and HTTP routing', () => {
  it('requires credentials without opening a browser for detection', async () => {
    expect(await client.status()).toEqual({ state: 'logged-out' })
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'auth' })
    expect(launchSynthIdBrowser).not.toHaveBeenCalled()
  })
  it('uses a refresh token alone and ignores the obsolete per-image credentials', async () => {
    client.update({ ...config, credentials })
    expect(await client.detect(image())).toEqual(found)
    client.update({ ...config, credentials: { ...credentials, pushFilename: 'invalid-old-path', bgToken: 'invalid-old-token' } })
    expect(await client.detect(image())).toEqual(found)
    expect(launchSynthIdBrowser).not.toHaveBeenCalled()
    expect(app.ctx.http.fetch).not.toHaveBeenCalled()
  })
  it('waits for Google login and terms, captures only the login secret, then closes the window', async () => {
    const browser = fakeBrowser(); browser.info.accepted = false
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
    await client.login()
    await vi.waitFor(() => expect(browser.account).toHaveBeenCalled())
    expect(await client.status()).toMatchObject({ state: 'awaiting-login' })
    expect(browser.captureCredentials).not.toHaveBeenCalled()
    browser.info.accepted = true
    await vi.waitFor(async () => expect(await client.status()).toMatchObject({ state: 'ready' }), { timeout: 2500 })
    await vi.waitFor(() => expect(browser.close).toHaveBeenCalledOnce())
    expect(browser.detect).not.toHaveBeenCalled()
    expect(await client.detect(image())).toEqual(found)
    expect(launchSynthIdBrowser).toHaveBeenCalledOnce()
  })
  it('reuses and cancels an in-progress login window', async () => {
    const browser = fakeBrowser(); browser.info.loggedIn = false
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
    await client.login()
    await vi.waitFor(() => expect(browser.account).toHaveBeenCalled())
    await client.login()
    expect(browser.bringToFront).toHaveBeenCalledOnce()
    expect(await client.cancel()).toEqual({ state: 'logged-out' })
    expect(browser.closed).toBe(true)
    expect(launchSynthIdBrowser).toHaveBeenCalledOnce()
  })
  it('waits for pending launch cancellation and releases the owned window', async () => {
    const opening = deferred<ReturnType<typeof fakeBrowser>>()
    vi.mocked(launchSynthIdBrowser).mockReturnValueOnce(opening.promise)
    await client.login()
    await vi.waitFor(() => expect(launchSynthIdBrowser).toHaveBeenCalled())
    const cancelled = client.cancel(), browser = fakeBrowser()
    opening.resolve(browser)
    expect(await cancelled).toEqual({ state: 'logged-out' })
    expect(browser.closed).toBe(true)
  })
  it('restores persisted refresh-only credentials after reload without a browser', async () => {
    await loggedIn()
    await client.dispose()
    vi.mocked(launchSynthIdBrowser).mockClear()
    client = new SynthIdClient(app.ctx, config)
    expect(await client.status()).toMatchObject({ state: 'ready', account })
    expect(await client.detect(image())).toEqual(found)
    expect(launchSynthIdBrowser).not.toHaveBeenCalled()
  })
  it('migrates an old saved capture while generating new per-image parameters', async () => {
    const root = join(await app.ctx.storage.dir(), 'synthid-session')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'account.json'), JSON.stringify({ loggedIn: true, account,
      captured: { revision: 'fixture', credentials: { ...credentials, pushFilename: 'old-path', bgToken: '!old-token' } } }))
    expect(await client.detect(image())).toEqual(found)
    expect(launchSynthIdBrowser).not.toHaveBeenCalled()
  })
  it('prefers explicitly saved form credentials over the session account', async () => {
    await loggedIn()
    client.update({ ...config, credentials: { refreshToken: 'explicit-account' } })
    await client.detect(image())
    const used = vi.mocked(HttpSynthIdClient.prototype.detect).mock.contexts[0] as any
    expect(used.options.refreshToken).toBe('explicit-account')
  })
  it('does not retain a previous session account after logout and a new login', async () => {
    await loggedIn(); await client.detect(image()); await client.logout()
    const next = fakeBrowser()
    next.captureCredentials.mockResolvedValue({ refreshToken: 'new-account', pushFilename: '', bgToken: '' })
    await loggedIn(next); await client.detect(image())
    const contexts = vi.mocked(HttpSynthIdClient.prototype.detect).mock.contexts as any[]
    expect(contexts[0].options.refreshToken).toBe(credentials.refreshToken)
    expect(contexts[1].options.refreshToken).toBe('new-account')
  })
  it('preserves configured credentials when clearing the optional browser session', async () => {
    client.update({ ...config, credentials }); await client.logout()
    expect(await client.detect(image())).toEqual(found)
  })
  it('forgets saved login on logout and does not recover it after reload', async () => {
    await loggedIn(); await client.logout(); await client.dispose()
    client = new SynthIdClient(app.ctx, config)
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'auth' })
  })
  it('reports sanitized login errors while independent credentials remain usable', async () => {
    vi.mocked(launchSynthIdBrowser).mockRejectedValueOnce(Error('PRIVATE_SECRET'))
    await client.login()
    await vi.waitFor(async () => expect(await client.status()).toMatchObject({ state: 'error' }))
    expect(JSON.stringify(await client.status())).not.toContain('PRIVATE_SECRET')
    client.update({ ...config, credentials })
    expect(await client.detect(image())).toEqual(found)
  })
  it('keeps login state when the detector refuses a request', async () => {
    await loggedIn()
    vi.mocked(HttpSynthIdClient.prototype.detect).mockRejectedValueOnce(new SynthIdError('permission', 'refused', 7))
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'permission', code: 7 })
    expect(await client.status()).toMatchObject({ state: 'ready' })
  })
  it('serializes clients sharing one profile and blocks login/logout during active detection', async () => {
    client.update({ ...config, credentials })
    const held = deferred<SynthIdResult>()
    vi.mocked(HttpSynthIdClient.prototype.detect).mockReturnValueOnce(held.promise)
    const first = client.detect(image())
    await vi.waitFor(() => expect(HttpSynthIdClient.prototype.detect).toHaveBeenCalledOnce())
    const other = new SynthIdClient(app.ctx, { ...config, credentials })
    const second = other.detect(image())
    try {
      await expect(client.login()).rejects.toMatchObject({ kind: 'busy' })
      await expect(client.logout()).rejects.toMatchObject({ kind: 'busy' })
      expect(HttpSynthIdClient.prototype.detect).toHaveBeenCalledOnce()
    } finally { held.resolve(found) }
    expect(await first).toEqual(found); expect(await second).toEqual(found)
  })
  it('snapshots settings for an active request and retires its client only when it settles', async () => {
    client.update({ ...config, credentials })
    const held = deferred<SynthIdResult>(), disposed = vi.spyOn(HttpSynthIdClient.prototype, 'dispose')
    vi.mocked(HttpSynthIdClient.prototype.detect).mockReturnValueOnce(held.promise)
    const first = client.detect(image())
    await vi.waitFor(() => expect(HttpSynthIdClient.prototype.detect).toHaveBeenCalledOnce())
    const old = vi.mocked(HttpSynthIdClient.prototype.detect).mock.contexts[0]
    client.update({ timeout: 2000, credentials: { refreshToken: 'new-configuration' } })
    expect(disposed.mock.contexts).not.toContain(old)
    held.resolve(found); await first; await client.detect(image())
    await vi.waitFor(() => expect(disposed.mock.contexts).toContain(old))
    const next = vi.mocked(HttpSynthIdClient.prototype.detect).mock.contexts[1] as any
    expect(next.options).toMatchObject({ refreshToken: 'new-configuration', timeout: 2000 })
  })
  it('reuses a client across equivalent normalized settings', async () => {
    client.update({ ...config, credentials }); await client.detect(image())
    client.update({ ...config, credentials: { refreshToken: '  captured-fixture  ' } }); await client.detect(image())
    const contexts = vi.mocked(HttpSynthIdClient.prototype.detect).mock.contexts
    expect(contexts[0]).toBe(contexts[1])
  })
  it('passes disposal to the HTTP request and prevents revival after unload', async () => {
    client.update({ ...config, credentials })
    vi.mocked(HttpSynthIdClient.prototype.detect).mockImplementationOnce((_image, signal) => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new SynthIdError('cancelled', 'cancelled')), { once: true })
    }))
    const task = client.detect(image()), check = expect(task).rejects.toMatchObject({ kind: 'cancelled' })
    await vi.waitFor(() => expect(HttpSynthIdClient.prototype.detect).toHaveBeenCalled())
    await client.dispose(); await check
    expect(() => client.update(config)).toThrow(expect.objectContaining({ kind: 'cancelled' }))
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'cancelled' })
  })
  it.each(['text/plain', 'image/svg+xml'])('rejects unsupported %s before any network or browser operation', async type => {
    await expect(client.detect({ ...image(), type })).rejects.toMatchObject({ kind: 'request' })
    expect(HttpSynthIdClient.prototype.detect).not.toHaveBeenCalled()
    expect(launchSynthIdBrowser).not.toHaveBeenCalled()
  })
})

describe('SynthID authenticated WebUI API', () => {
  const request = (action: string, method = 'GET') => new Request('http://localhost/api/aiimgdetector/synthid/' + action, { method })
  const credentialRequest = (revision: unknown) => new Request('http://localhost/api/aiimgdetector/synthid/credentials', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision }),
  })
  it('returns credentials for the current revision only, with caching disabled', async () => {
    await loggedIn()
    const revision = (await client.status()).credentialRevision!
    const response = await handleSynthId(client, credentialRequest(revision))
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ success: true, data: { revision, credentials } })
    for (const bad of [undefined, 'bad']) expect((await handleSynthId(client, credentialRequest(bad))).status).toBe(400)
    await client.logout()
    expect((await handleSynthId(client, credentialRequest(revision))).status).toBe(503)
  })
  it('does not expose secrets or browser internals through status', async () => {
    await loggedIn()
    const response = await handleSynthId(client, request('status'))
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.text()
    expect(body).not.toContain(credentials.refreshToken)
    expect(JSON.parse(body).data).toMatchObject({ state: 'ready', account })
  })
  it.each(['login', 'cancel', 'logout', 'credentials'])('requires POST for %s', async action => {
    expect((await handleSynthId(client, request(action))).status).toBe(405)
    expect(launchSynthIdBrowser).not.toHaveBeenCalled()
  })
  it('rejects invalid status methods and unrelated paths', async () => {
    expect((await handleSynthId(client, request('status', 'POST'))).status).toBe(405)
    expect((await handleSynthId(client, request('unknown'))).status).toBe(404)
    expect((await handleSynthId(client, new Request('http://localhost/other/status'))).status).toBe(404)
  })
  it('returns conflicts and sanitized errors', async () => {
    vi.spyOn(client, 'logout').mockRejectedValue(new SynthIdError('busy', 'PRIVATE_DETAILS'))
    const busy = await handleSynthId(client, request('logout', 'POST'))
    expect(busy.status).toBe(409); expect(await busy.text()).not.toContain('PRIVATE_DETAILS')
    vi.spyOn(client, 'status').mockRejectedValue(Error('PRIVATE_SECRET'))
    const error = await handleSynthId(client, request('status'))
    expect(error.status).toBe(503); expect(await error.text()).not.toContain('PRIVATE_SECRET')
  })
})
