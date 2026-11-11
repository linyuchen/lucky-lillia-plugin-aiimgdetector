import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, type TestApp } from '@luckylillia/plugin-sdk/testing'
import { SynthIdClient, handleSynthId } from '../src/synthid.js'
import { launchSynthIdBrowser } from '../src/synthid-browser.js'
import { SynthIdError, type SynthIdResult } from '../src/synthid-result.js'
import { ManualSynthIdClient, synthIdCredentialIdentity } from '../src/synthid-manual.js'
import type { Image } from '../src/image.js'
import { PNG } from './fakeAi.js'

vi.mock('../src/synthid-browser.js', () => ({ launchSynthIdBrowser: vi.fn() }))

let app: TestApp
let client: SynthIdClient
const config = { timeout: 1000 }
const image = (bytes = PNG) => ({ data: Uint8Array.from(bytes).buffer, type: 'image/png' })
const account = 'sample@example.test'
const capturedCredentials = { refreshToken: 'captured-fixture', pushFilename: 'users/example/files/capture1', bgToken: '!captured' }
const found: SynthIdResult = { status: 'detected', source: 'google', confidence: 'high' }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fakeBrowser() {
  const browser = {
    closed: false,
    info: { loggedIn: true, accepted: true, email: account },
    account: vi.fn(async () => browser.info),
    isClosed: vi.fn(() => browser.closed),
    bringToFront: vi.fn(async () => {}),
    detect: vi.fn(async (_image: Image, _timeout: number, _expectedUserId?: string): Promise<SynthIdResult> => found),
    captureCredentials: vi.fn(async (_timeout: number) => ({ ...capturedCredentials })),
    close: vi.fn(async () => { browser.closed = true }),
  }
  return browser
}

async function loggedIn(browser = fakeBrowser()) {
  vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
  await client.login()
  await vi.waitFor(async () => expect(await client.status()).toMatchObject({ state: 'ready', account }), { timeout: 4000, interval: 10 })
  return browser
}

beforeEach(async () => {
  app = await createTestApp()
  vi.mocked(launchSynthIdBrowser).mockImplementation(async () => fakeBrowser())
  vi.spyOn(app.ctx.http, 'fetch').mockRejectedValue(new Error('unexpected network request in browser lifecycle test'))
  client = new SynthIdClient(app.ctx, config)
})

afterEach(async () => {
  await app.dispose()
  vi.restoreAllMocks()
})

describe('SynthID login lifecycle', () => {
  it('starts logged out and asks for login without launching a browser for detection', async () => {
    expect(await client.status()).toEqual({ state: 'logged-out' })
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'auth' })
    expect(launchSynthIdBrowser).not.toHaveBeenCalled()
  })

  it('requires both Google login and the SynthID first-use confirmation before becoming ready', async () => {
    const browser = fakeBrowser()
    browser.info = { loggedIn: false, accepted: false, email: '' }
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
    await client.login()
    await vi.waitFor(() => expect(browser.account).toHaveBeenCalled())
    expect(await client.status()).toMatchObject({ state: 'awaiting-login' })
    browser.info = { loggedIn: true, accepted: false, email: account }
    await vi.waitFor(() => expect(browser.account.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2000 })
    expect(await client.status()).toMatchObject({ state: 'awaiting-login' })
    browser.info.accepted = true
    await vi.waitFor(async () => expect(await client.status()).toMatchObject({ state: 'ready', account }), { timeout: 2000 })
    expect(browser.close).not.toHaveBeenCalled()
    expect(launchSynthIdBrowser).toHaveBeenCalledWith(expect.objectContaining({ headed: true, timeout: 1000 }))
  })

  it('reuses the same login window on repeated clicks and cancels it cleanly', async () => {
    const browser = fakeBrowser()
    browser.info.loggedIn = false
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
    await client.login()
    await vi.waitFor(() => expect(browser.account).toHaveBeenCalled())
    await Promise.all([client.login(), client.login()])
    expect(launchSynthIdBrowser).toHaveBeenCalledTimes(1)
    expect(browser.bringToFront).toHaveBeenCalled()
    expect(await client.cancel()).toEqual({ state: 'logged-out' })
    expect(browser.isClosed()).toBe(true)
    await loggedIn()
    expect(launchSynthIdBrowser).toHaveBeenCalledTimes(2)
  })

  it('waits for an in-flight browser launch when cancelling and leaves no window behind', async () => {
    const opening = deferred<ReturnType<typeof fakeBrowser>>()
    const browser = fakeBrowser()
    vi.mocked(launchSynthIdBrowser).mockReturnValueOnce(opening.promise)
    await client.login()
    await vi.waitFor(() => expect(launchSynthIdBrowser).toHaveBeenCalled())
    const cancellation = client.cancel()
    opening.resolve(browser)
    expect(await cancellation).toEqual({ state: 'logged-out' })
    expect(browser.isClosed()).toBe(true)
  })

  it('closes a pending login when the plugin is unloaded', async () => {
    const browser = fakeBrowser()
    browser.info.loggedIn = false
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
    await client.login()
    await vi.waitFor(() => expect(browser.account).toHaveBeenCalled())
    await client.dispose()
    expect(browser.isClosed()).toBe(true)
    await expect(client.status()).rejects.toMatchObject({ kind: 'cancelled' })
    const restarted = new SynthIdClient(app.ctx, config)
    expect(await restarted.status()).toEqual({ state: 'logged-out' })
  })

  it('restores the saved account and reuses its browser profile after restart', async () => {
    const browser = await loggedIn()
    const profile = vi.mocked(launchSynthIdBrowser).mock.calls[0][0].profileDir
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'session.fixture'), 'retained browser session')
    await client.dispose()
    expect(browser.close).toHaveBeenCalledOnce()
    const restarted = new SynthIdClient(app.ctx, config)
    expect(await restarted.status()).toMatchObject({ state: 'ready', account })
    expect(launchSynthIdBrowser).toHaveBeenCalledTimes(1)
    expect(await restarted.detect(image())).toEqual(found)
    expect(launchSynthIdBrowser).toHaveBeenLastCalledWith(expect.objectContaining({ headed: false, profileDir: profile }))
    expect(await readFile(join(profile, 'session.fixture'), 'utf8')).toBe('retained browser session')
    const saved = JSON.parse(await readFile(join(profile, '..', 'account.json'), 'utf8'))
    expect(saved).toEqual({ loggedIn: true, account, captured: { revision: expect.any(String), credentials: capturedCredentials },
      browserCredentialKeys: [synthIdCredentialIdentity(capturedCredentials)!.key] })
    expect(await restarted.credentials(saved.captured.revision)).toEqual(saved.captured)
  })

  it('clears only the plugin browser profile on logout and requires login again', async () => {
    const browser = await loggedIn()
    const root = join(await app.ctx.storage.dir(), 'synthid-session')
    await mkdir(join(root, 'browser', 'Default'), { recursive: true })
    await writeFile(join(root, 'browser', 'Default', 'Cookies'), 'private fixture')
    await writeFile(join(root, 'keep.txt'), 'unrelated plugin data')
    expect(await client.logout()).toEqual({ state: 'logged-out' })
    expect(browser.close).toHaveBeenCalledOnce()
    expect(await readdir(root)).toEqual(['account.json', 'keep.txt'])
    expect(JSON.parse(await readFile(join(root, 'account.json'), 'utf8'))).toEqual({
      loggedIn: false, browserCredentialKeys: [synthIdCredentialIdentity(capturedCredentials)!.key],
    })
    await client.dispose()
    const restarted = new SynthIdClient(app.ctx, config)
    expect(await restarted.status()).toEqual({ state: 'logged-out' })
    await expect(restarted.detect(image())).rejects.toMatchObject({ kind: 'auth' })
  })

  it('shows a safe error if the login browser cannot start', async () => {
    vi.mocked(launchSynthIdBrowser).mockRejectedValueOnce(new Error('refresh_token=private-fixture'))
    await client.login()
    await vi.waitFor(async () => expect((await client.status()).state).toBe('error'))
    expect(JSON.stringify(await client.status())).not.toContain('private-fixture')
  })

  it('only reports ready after all three credentials have been captured and saved', async () => {
    const capturing = deferred<typeof capturedCredentials>()
    const browser = fakeBrowser()
    browser.captureCredentials.mockReturnValueOnce(capturing.promise)
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
    await client.login()
    await vi.waitFor(async () => expect(await client.status()).toMatchObject({ state: 'capturing' }))
    expect(browser.closed).toBe(false)
    expect((await client.status()).credentialRevision).toBeUndefined()
    await expect(client.credentials('missing')).rejects.toMatchObject({ kind: 'auth' })
    capturing.resolve(capturedCredentials)
    await vi.waitFor(async () => expect(await client.status()).toMatchObject({ state: 'ready' }))
    const status = await client.status()
    expect(await client.credentials(status.credentialRevision!)).toEqual({ revision: status.credentialRevision, credentials: capturedCredentials })
    expect(browser.closed).toBe(false)
  })

  it('does not present a failed credential capture as a successful login or expose its error details', async () => {
    const browser = fakeBrowser()
    browser.captureCredentials.mockRejectedValueOnce(new Error('refreshToken=private-fixture'))
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
    await client.login()
    await vi.waitFor(async () => expect(await client.status()).toMatchObject({ state: 'error' }))
    expect(await client.status()).toMatchObject({ account, message: expect.stringContaining('已登录，但自动获取检测凭证失败') })
    expect(JSON.stringify(await client.status())).not.toContain('private-fixture')
    expect((await client.status()).credentialRevision).toBeUndefined()
    await expect(readFile(join(await app.ctx.storage.dir(), 'synthid-session', 'account.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('cancels an ongoing credential capture and does not persist late results', async () => {
    const capturing = deferred<typeof capturedCredentials>()
    const browser = fakeBrowser()
    browser.captureCredentials.mockReturnValueOnce(capturing.promise)
    browser.close.mockImplementation(async () => { browser.closed = true; capturing.resolve(capturedCredentials) })
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
    await client.login()
    await vi.waitFor(async () => expect(await client.status()).toMatchObject({ state: 'capturing' }))
    expect(await client.cancel()).toEqual({ state: 'logged-out' })
    await expect(readFile(join(await app.ctx.storage.dir(), 'synthid-session', 'account.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each(['permission', 'verification', 'network', 'timeout', 'response', 'rate-limit', 'auth'] as const)('preserves capture %s for later detection without uploads or retries, then clears it after explicit successful login', async kind => {
    const manualDetect = vi.spyOn(ManualSynthIdClient.prototype, 'detect')
    const browser = fakeBrowser()
    const expected = { kind, code: kind === 'permission' ? 7 : kind === 'rate-limit' ? 8 : kind === 'auth' ? 16 : undefined,
      retryAfterSeconds: kind === 'rate-limit' ? 37 : undefined,
      networkCode: kind === 'network' ? 'ECONNRESET' as const : undefined }
    const originalError = Object.assign(new SynthIdError(kind, 'refreshToken=private-fixture', expected.code, expected.retryAfterSeconds, expected.networkCode),
      { cause: new Error('private-fixture cause'), privateData: capturedCredentials })
    browser.captureCredentials.mockRejectedValueOnce(originalError)
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
    await client.login()
    await vi.waitFor(async () => expect(await client.status()).toMatchObject({ state: 'error', account }))
    expect(browser.closed).toBe(false)
    expect(browser.captureCredentials).toHaveBeenCalledWith(60_000)
    expect(browser.captureCredentials).toHaveBeenCalledTimes(1)
    expect((await client.status()).message).not.toMatch(/选择.*图片|手动.*检测/)
    expect((await client.status()).credentialRevision).toBeUndefined()
    await expect(client.credentials('missing')).rejects.toMatchObject({ kind: 'auth' })
    await expect(readFile(join(await app.ctx.storage.dir(), 'synthid-session', 'account.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    const detectionError = await client.detect(image()).catch(error => error)
    expect(detectionError).toBeInstanceOf(SynthIdError)
    expect(detectionError).toMatchObject(expected)
    expect(detectionError).not.toBe(originalError)
    expect(detectionError.cause).toBeUndefined()
    expect(detectionError.privateData).toBeUndefined()
    expect(detectionError.message).not.toContain('private-fixture')
    expect(JSON.stringify(await client.status())).not.toContain('private-fixture')
    // A consumer mutating its returned error must not contaminate the remembered failure.
    detectionError.message = 'private-fixture caller mutation'
    const nextError = await client.detect(image()).catch(error => error)
    expect(nextError).toMatchObject(expected)
    expect(nextError).not.toBe(detectionError)
    expect(nextError.message).not.toContain('private-fixture')
    expect(browser.captureCredentials).toHaveBeenCalledOnce()
    expect(browser.detect).not.toHaveBeenCalled()
    expect(launchSynthIdBrowser).toHaveBeenCalledOnce()
    expect(manualDetect).not.toHaveBeenCalled()
    expect(app.ctx.http.fetch).not.toHaveBeenCalled()
    // An explicit retry opens a fresh operation using the retained account profile.
    const retryBrowser = fakeBrowser()
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(retryBrowser)
    await client.login()
    await vi.waitFor(async () => expect(await client.status()).toMatchObject({ state: 'ready', account }))
    expect(launchSynthIdBrowser).toHaveBeenCalledTimes(2)
    expect(browser.closed).toBe(true)
    expect(browser.captureCredentials).toHaveBeenCalledTimes(1)
    expect(vi.mocked(launchSynthIdBrowser).mock.calls[1][0].profileDir).toBe(vi.mocked(launchSynthIdBrowser).mock.calls[0][0].profileDir)
    const status = await client.status()
    expect(await client.credentials(status.credentialRevision!)).toEqual({ revision: status.credentialRevision, credentials: capturedCredentials })
    expect(await client.detect(image())).toEqual(found)
    expect(retryBrowser.detect).toHaveBeenCalledOnce()
    expect(launchSynthIdBrowser).toHaveBeenCalledTimes(2)
    expect(manualDetect).not.toHaveBeenCalled()
  })

  it.each(['network', 'timeout', 'auth'] as const)('preserves known %s initialization failures before capture without launching again', async kind => {
    const browser = fakeBrowser()
    const expected = { kind, code: kind === 'auth' ? 16 : undefined, networkCode: kind === 'network' ? 'ENOTFOUND' as const : undefined }
    browser.account.mockRejectedValueOnce(new SynthIdError(kind, 'private-fixture initialization', expected.code, undefined, expected.networkCode))
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
    await client.login()
    await vi.waitFor(async () => expect(await client.status()).toMatchObject({ state: 'error' }))
    const error = await client.detect(image()).catch(error => error)
    expect(error).toMatchObject(expected)
    expect(error.message).not.toContain('private-fixture')
    expect(JSON.stringify(await client.status())).not.toContain('private-fixture')
    expect(browser.captureCredentials).not.toHaveBeenCalled()
    expect(browser.detect).not.toHaveBeenCalled()
    expect(launchSynthIdBrowser).toHaveBeenCalledOnce()
    expect(app.ctx.http.fetch).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'logout'] as const)('clears a remembered startup failure on %s even when no browser exists', async action => {
    vi.mocked(launchSynthIdBrowser).mockRejectedValueOnce(new SynthIdError('network', 'private-fixture proxy', undefined, undefined, 'ECONNREFUSED'))
    await client.login()
    await vi.waitFor(async () => expect(await client.status()).toMatchObject({ state: 'error' }))
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'network', networkCode: 'ECONNREFUSED' })
    expect(await client[action]()).toEqual({ state: 'logged-out' })
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'auth', networkCode: undefined })
    expect(launchSynthIdBrowser).toHaveBeenCalledOnce()
    expect(app.ctx.http.fetch).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'logout', 'dispose'] as const)('closes a retained failed login browser and clears its error during %s', async action => {
    const browser = fakeBrowser()
    browser.captureCredentials.mockRejectedValueOnce(new SynthIdError('permission', 'website rejected probe', 7))
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
    await client.login()
    await vi.waitFor(async () => expect(await client.status()).toMatchObject({ state: 'error', account }))
    expect(browser.closed).toBe(false)
    await client[action]()
    if (action !== 'dispose') {
      expect(await client.status()).toEqual({ state: 'logged-out' })
      await expect(client.detect(image())).rejects.toMatchObject({ kind: 'auth', code: undefined })
    } else await expect(client.status()).rejects.toMatchObject({ kind: 'cancelled' })
    expect(browser.closed).toBe(true)
    await expect(readFile(join(await app.ctx.storage.dir(), 'synthid-session', 'account.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('SynthID browser proxy selection', () => {
  it.each(['', 'http://127.0.0.1:18791'])('passes the resolved proxy %j to the login browser without using HTTP forwarding', async address => {
    const proxy = vi.spyOn(app.ctx.http, 'proxy').mockReturnValue(address)
    await loggedIn()
    expect(proxy).toHaveBeenCalledWith('https://synthid.com')
    const options = vi.mocked(launchSynthIdBrowser).mock.calls[0][0]
    expect(options.http.proxy?.('https://synthid.com')).toBe(address)
    expect(app.ctx.http.fetch).not.toHaveBeenCalled()
  })

  it('preserves bridge compatibility when a legacy host has no proxy method', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(app.ctx.http, 'proxy')
    Object.defineProperty(app.ctx.http, 'proxy', { value: undefined, configurable: true })
    try {
      await loggedIn()
      const options = vi.mocked(launchSynthIdBrowser).mock.calls[0][0]
      expect(options.http.proxy).toBeUndefined()
      expect(typeof options.http.fetch).toBe('function')
    } finally {
      if (descriptor) Object.defineProperty(app.ctx.http, 'proxy', descriptor)
      else Reflect.deleteProperty(app.ctx.http, 'proxy')
    }
  })

  it('reopens the same saved login when its proxy changes, including switching to direct access', async () => {
    const proxy = vi.spyOn(app.ctx.http, 'proxy').mockReturnValue('http://127.0.0.1:18791')
    const first = await loggedIn()
    const status = await client.status()
    const profileDir = vi.mocked(launchSynthIdBrowser).mock.calls[0][0].profileDir
    const stateFile = join(profileDir, '..', 'account.json')
    const saved = await readFile(stateFile, 'utf8')
    const second = fakeBrowser()
    const direct = fakeBrowser()
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(second).mockResolvedValueOnce(direct)
    await client.detect(image())
    await client.detect(image())
    expect(launchSynthIdBrowser).toHaveBeenCalledTimes(1)
    expect(first.detect).toHaveBeenCalledTimes(2)
    expect(first.close).not.toHaveBeenCalled()

    proxy.mockReturnValue('http://127.0.0.1:18792')
    await client.detect(image())
    expect(first.close).toHaveBeenCalledOnce()
    expect(second.detect).toHaveBeenCalledOnce()
    expect(vi.mocked(launchSynthIdBrowser).mock.calls[1][0].http.proxy?.('https://synthid.com')).toBe('http://127.0.0.1:18792')

    proxy.mockReturnValue('')
    await client.detect(image())
    expect(second.close).toHaveBeenCalledOnce()
    expect(direct.detect).toHaveBeenCalledOnce()
    expect(launchSynthIdBrowser).toHaveBeenCalledTimes(3)
    expect(vi.mocked(launchSynthIdBrowser).mock.calls[2][0].http.proxy?.('https://synthid.com')).toBe('')
    for (const [options] of vi.mocked(launchSynthIdBrowser).mock.calls) expect(options.profileDir).toBe(profileDir)
    expect(first.captureCredentials).toHaveBeenCalledOnce()
    for (const browser of [second, direct]) expect(browser.captureCredentials).not.toHaveBeenCalled()
    expect(await client.status()).toEqual(status)
    expect(await readFile(stateFile, 'utf8')).toBe(saved)
    expect(await client.credentials(status.credentialRevision!)).toMatchObject({ credentials: capturedCredentials })
    expect(app.ctx.http.fetch).not.toHaveBeenCalled()
  })

  it.each([false, true])('preserves saved login when proxy resolution fails with an active browser: %s', async active => {
    const address = 'http://127.0.0.1:18791'
    const proxy = vi.spyOn(app.ctx.http, 'proxy').mockReturnValue(address)
    let browser = await loggedIn()
    if (!active) {
      await client.dispose()
      client = new SynthIdClient(app.ctx, config)
      browser = fakeBrowser()
      vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
    }
    if (active) await client.detect(image())
    const status = await client.status()
    const stateFile = join(vi.mocked(launchSynthIdBrowser).mock.calls[0][0].profileDir, '..', 'account.json')
    const saved = await readFile(stateFile, 'utf8')
    const launches = vi.mocked(launchSynthIdBrowser).mock.calls.length
    proxy.mockImplementation(() => { throw new Error('http://private-proxy-user:private-proxy-password@proxy.invalid') })
    const error = await client.detect(image()).catch(error => error)
    expect(error).toBeInstanceOf(SynthIdError)
    expect(error).toMatchObject({ kind: 'proxy' })
    expect(String(error)).not.toContain('private-proxy')
    expect(launchSynthIdBrowser).toHaveBeenCalledTimes(launches)
    expect(browser.detect).toHaveBeenCalledTimes(Number(active))
    expect(browser.close).not.toHaveBeenCalled()
    expect(await client.status()).toEqual(status)
    expect(await readFile(stateFile, 'utf8')).toBe(saved)
    expect(await client.credentials(status.credentialRevision!)).toMatchObject({ credentials: capturedCredentials })
    expect(app.ctx.http.fetch).not.toHaveBeenCalled()

    proxy.mockReturnValue(address)
    expect(await client.detect(image())).toEqual(found)
    expect(browser.detect).toHaveBeenCalledTimes(Number(active) + 1)
    expect(launchSynthIdBrowser).toHaveBeenCalledTimes(active ? launches : launches + 1)
  })

  it('does not resolve a browser proxy for independently configured manual credentials', async () => {
    const proxy = vi.spyOn(app.ctx.http, 'proxy').mockImplementation(() => { throw new Error('browser proxy unavailable') })
    const detect = vi.spyOn(ManualSynthIdClient.prototype, 'detect').mockResolvedValue(found)
    const manual = new SynthIdClient(app.ctx, { ...config, credentials: {
      refreshToken: 'manual-fixture', pushFilename: 'users/manual/files/file1', bgToken: '!manual',
    } })
    expect(await manual.detect(image())).toEqual(found)
    expect(detect).toHaveBeenCalledOnce()
    expect(proxy).not.toHaveBeenCalled()
    expect(launchSynthIdBrowser).not.toHaveBeenCalled()
  })
})

describe('SynthID detection sessions', () => {
  it('gives simultaneous reload clients one shared session after the previous browser has closed', async () => {
    const oldBrowser = await loggedIn()
    const closing = deferred<void>()
    oldBrowser.close.mockImplementation(async () => { await closing.promise; oldBrowser.closed = true })
    await client.detect(image())
    const disposal = client.dispose()
    await vi.waitFor(() => expect(oldBrowser.close).toHaveBeenCalled())
    const second = new SynthIdClient(app.ctx, config)
    const third = new SynthIdClient(app.ctx, config)
    const restored = Promise.all([second.status(), third.status()])
    closing.resolve()
    await disposal
    expect(await restored).toEqual([expect.objectContaining({ state: 'ready' }), expect.objectContaining({ state: 'ready' })])
    const nextBrowser = fakeBrowser()
    const firstDetection = deferred<SynthIdResult>()
    nextBrowser.detect.mockReturnValueOnce(firstDetection.promise)
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(nextBrowser)
    const detections = Promise.all([second.detect(image()), third.detect(image())])
    await vi.waitFor(() => expect(nextBrowser.detect).toHaveBeenCalledTimes(1))
    firstDetection.resolve(found)
    expect(await detections).toEqual([found, found])
    expect(launchSynthIdBrowser).toHaveBeenCalledTimes(2)
  })

  it('waits for an in-progress logout to finish before releasing the profile to a reloaded client', async () => {
    const browser = await loggedIn()
    const closing = deferred<void>()
    browser.close.mockImplementation(async () => { await closing.promise; browser.closed = true })
    await client.detect(image())
    const logout = client.logout()
    await vi.waitFor(() => expect(browser.close).toHaveBeenCalled())
    let disposed = false
    const disposal = client.dispose().then(() => { disposed = true })
    // Other tasks can run while Chromium is still flushing its profile.
    await new Promise(resolve => setTimeout(resolve, 20))
    const releasedBeforeLogout = disposed
    closing.resolve()
    await Promise.all([logout, disposal])
    expect(releasedBeforeLogout).toBe(false)
    const restarted = new SynthIdClient(app.ctx, config)
    expect(await restarted.status()).toEqual({ state: 'logged-out' })
  })

  it('cancels queued account actions from a disposed client without changing another owner session', async () => {
    const browser = fakeBrowser()
    browser.info.loggedIn = false
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
    await client.login()
    await vi.waitFor(() => expect(browser.account).toHaveBeenCalled())
    const second = new SynthIdClient(app.ctx, config)
    await second.status()
    const bringingToFront = deferred<void>()
    browser.bringToFront.mockReturnValueOnce(bringingToFront.promise)
    const secondLogin = second.login()
    await vi.waitFor(() => expect(browser.bringToFront).toHaveBeenCalled())
    const queuedLogout = client.logout().then(value => ({ value }), error => ({ error }))
    await client.dispose()
    bringingToFront.resolve()
    await secondLogin
    expect(await queuedLogout).toMatchObject({ error: { kind: 'cancelled' } })
    expect(await second.status()).toMatchObject({ state: 'awaiting-login' })
    expect(browser.closed).toBe(false)
  })

  it('serializes detections from all clients using the same profile', async () => {
    const browser = await loggedIn()
    const second = new SynthIdClient(app.ctx, config)
    await second.status()
    const firstDetection = deferred<SynthIdResult>()
    browser.detect.mockReturnValueOnce(firstDetection.promise)
    const one = client.detect(image(Buffer.from('first')))
    const two = second.detect(image(Buffer.from('second')))
    await vi.waitFor(() => expect(browser.detect).toHaveBeenCalledTimes(1))
    firstDetection.resolve(found)
    expect(await Promise.all([one, two])).toEqual([found, found])
    expect(browser.detect.mock.calls.map(([value]) => Buffer.from(value.data).toString())).toEqual(['first', 'second'])
  })

  it('releases cancelled queue entries without waiting for a different client detection to finish', async () => {
    const browser = await loggedIn()
    const second = new SynthIdClient(app.ctx, config)
    await second.status()
    const active = deferred<SynthIdResult>()
    browser.detect.mockReturnValueOnce(active.promise)
    const first = client.detect(image())
    await vi.waitFor(() => expect(browser.detect).toHaveBeenCalledTimes(1))
    let cancelledSettled = false
    const queued = Promise.allSettled(Array.from({ length: 3 }, () => second.detect(image())))
      .then(results => { cancelledSettled = true; return results })
    // Let the second client's requests enter the queue before unloading it.
    await new Promise(resolve => setTimeout(resolve, 20))
    await second.dispose()
    await new Promise(resolve => setTimeout(resolve, 20))
    const promptlyCancelled = cancelledSettled
    const next = client.detect(image()).then(value => ({ value }), error => ({ error }))
    active.resolve(found)
    await first
    const results = await queued
    expect(results).toEqual(Array.from({ length: 3 }, () => ({ status: 'rejected', reason: expect.objectContaining({ kind: 'cancelled' }) })))
    expect(promptlyCancelled).toBe(true)
    expect(await next).toEqual({ value: found })
  })

  it('limits the account queue to four requests and blocks login and logout while detecting', async () => {
    const browser = await loggedIn()
    const first = deferred<SynthIdResult>()
    browser.detect.mockReturnValueOnce(first.promise)
    const detections = Array.from({ length: 4 }, () => client.detect(image()))
    await vi.waitFor(() => expect(browser.detect).toHaveBeenCalledTimes(1))
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'busy' })
    await expect(client.login()).rejects.toMatchObject({ kind: 'busy' })
    await expect(client.logout()).rejects.toMatchObject({ kind: 'busy' })
    first.resolve(found)
    await expect(Promise.all(detections)).resolves.toHaveLength(4)
  })

  it('keeps login blocked while a cancelled active detection unwinds without closing the next login browser', async () => {
    const browser = await loggedIn()
    const second = new SynthIdClient(app.ctx, config)
    await second.status()
    const active = deferred<SynthIdResult>()
    browser.detect.mockReturnValueOnce(active.promise)
    const detection = client.detect(image()).then(value => ({ value }), error => ({ error }))
    await vi.waitFor(() => expect(browser.detect).toHaveBeenCalledOnce())
    await client.dispose()
    expect(await detection).toMatchObject({ error: { kind: 'cancelled' } })
    await expect(second.login()).rejects.toMatchObject({ kind: 'busy' })
    await expect(second.logout()).rejects.toMatchObject({ kind: 'busy' })
    const loginBrowser = fakeBrowser()
    loginBrowser.info.loggedIn = false
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(loginBrowser)
    active.reject(new SynthIdError('cancelled', 'old detection finished closing'))
    await vi.waitFor(async () => {
      expect(['opening', 'awaiting-login']).toContain((await second.login()).state)
    })
    await vi.waitFor(async () => expect(await second.status()).toMatchObject({ state: 'awaiting-login' }))
    expect(loginBrowser.closed).toBe(false)
    expect(loginBrowser.close).not.toHaveBeenCalled()
  })

  it('releases the queue after a failed detection so later requests can continue', async () => {
    const browser = await loggedIn()
    browser.detect.mockRejectedValueOnce(new SynthIdError('server', 'temporary failure'))
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'server' })
    expect(await client.detect(image())).toEqual(found)
  })

  it.each(['result', 'error'] as const)('honors quota backoff from a %s without uploading another image', async mode => {
    const browser = await loggedIn()
    if (mode === 'result') browser.detect.mockResolvedValueOnce({ status: 'quota_exceeded', retryAfterSeconds: 12 })
    else browser.detect.mockRejectedValueOnce(new SynthIdError('rate-limit', 'quota fixture', undefined, 12))
    const first = client.detect(image())
    if (mode === 'result') await expect(first).resolves.toMatchObject({ status: 'quota_exceeded' })
    else await expect(first).rejects.toMatchObject({ kind: 'rate-limit' })
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'rate-limit' })
    expect(browser.detect).toHaveBeenCalledTimes(1)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 13_000)
    expect(await client.detect(image())).toEqual(found)
  })

  it('invalidates persisted login after the service rejects authentication', async () => {
    const browser = await loggedIn()
    browser.detect.mockRejectedValueOnce(new SynthIdError('auth', 'expired browser session'))
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'auth' })
    expect(await client.status()).toEqual({ state: 'logged-out' })
    await client.dispose()
    const restarted = new SynthIdClient(app.ctx, config)
    expect(await restarted.status()).toEqual({ state: 'logged-out' })
    await expect(restarted.detect(image())).rejects.toMatchObject({ kind: 'auth' })
    expect(launchSynthIdBrowser).toHaveBeenCalledTimes(1)
  })

  it('cancels active and queued detections when the last client is disposed', async () => {
    const browser = await loggedIn()
    const pending = deferred<SynthIdResult>()
    browser.detect.mockReturnValueOnce(pending.promise)
    browser.close.mockImplementation(async () => { browser.closed = true; pending.reject(new Error('browser closed')) })
    const settled = Promise.allSettled([client.detect(image()), client.detect(image())])
    await vi.waitFor(() => expect(browser.detect).toHaveBeenCalledTimes(1))
    await client.dispose()
    expect(await settled).toEqual([
      { status: 'rejected', reason: expect.objectContaining({ kind: 'cancelled' }) },
      { status: 'rejected', reason: expect.objectContaining({ kind: 'cancelled' }) },
    ])
    expect(browser.closed).toBe(true)
    expect(browser.detect).toHaveBeenCalledTimes(1)
  })

  it('keeps a shared session usable after one idle client is disposed', async () => {
    const browser = await loggedIn()
    const second = new SynthIdClient(app.ctx, config)
    await second.status()
    await client.dispose()
    expect(browser.close).not.toHaveBeenCalled()
    expect(await second.detect(image())).toEqual(found)
    expect(browser.detect).toHaveBeenCalledWith(image(), config.timeout, 'example')
    expect(launchSynthIdBrowser).toHaveBeenCalledOnce()
    expect(await second.status()).toMatchObject({ state: 'ready', account })
  })

  it.each([
    { data: new ArrayBuffer(0), type: 'image/png' },
    { data: new ArrayBuffer(20 * 1024 * 1024 + 1), type: 'image/png' },
    { data: image().data, type: 'video/mp4' },
  ])('rejects unsupported input before opening a browser', async value => {
    await expect(client.detect(value)).rejects.toMatchObject({ kind: 'request' })
    expect(launchSynthIdBrowser).not.toHaveBeenCalled()
  })
})

describe('SynthID shared credential form', () => {
  const credentials = { refreshToken: 'manual-fixture', pushFilename: 'users/example/files/file1', bgToken: '!fixture' }

  it('uses the saved browser session for browser-filled credentials and forwards the account identity', async () => {
    const manualDetect = vi.spyOn(ManualSynthIdClient.prototype, 'detect')
    const browser = await loggedIn()
    const saved = new SynthIdClient(app.ctx, { ...config, credentials: capturedCredentials })
    expect(await saved.detect(image())).toEqual(found)
    expect(browser.detect).toHaveBeenCalledWith(image(), config.timeout, 'example')
    expect(browser.captureCredentials).toHaveBeenCalledOnce()
    expect(browser.close).not.toHaveBeenCalled()
    expect(launchSynthIdBrowser).toHaveBeenCalledOnce()
    expect(manualDetect).not.toHaveBeenCalled()
    expect(app.ctx.http.fetch).not.toHaveBeenCalled()
  })

  it('recognizes normalized full-path and full-header forms of the browser capture', async () => {
    const manualDetect = vi.spyOn(ManualSynthIdClient.prototype, 'detect')
    await loggedIn()
    const jwt = 'header.' + Buffer.from(JSON.stringify({ user_id: 'example', sub: 'example' })).toString('base64url') + '.signature'
    const saved = new SynthIdClient(app.ctx, { ...config, credentials: {
      refreshToken: '  ' + capturedCredentials.refreshToken + '  ',
      pushFilename: ' /synthid-demo-drop-zone/ttl_1d/' + capturedCredentials.pushFilename + ' ',
      bgToken: JSON.stringify([jwt, null, null, null, null, capturedCredentials.bgToken]),
    } })
    expect(await saved.detect(image())).toEqual(found)
    expect(manualDetect).not.toHaveBeenCalled()
  })

  it.each([
    { ...capturedCredentials, refreshToken: 'different-refresh' },
    { ...capturedCredentials, pushFilename: 'users/different/files/different' },
    { ...capturedCredentials, bgToken: '!different' },
    { ...capturedCredentials, refreshToken: '' },
    { ...capturedCredentials, pushFilename: '' },
    { ...capturedCredentials, bgToken: '' },
    { ...capturedCredentials, bgToken: JSON.stringify(['header.' + Buffer.from(JSON.stringify({ sub: 'different' })).toString('base64url') + '.signature', null, null, null, null, capturedCredentials.bgToken]) },
  ])('does not borrow the browser for a different, partial, or invalid tuple %#', async values => {
    const manualDetect = vi.spyOn(ManualSynthIdClient.prototype, 'detect').mockResolvedValue(found)
    await loggedIn()
    const manual = new SynthIdClient(app.ctx, { ...config, credentials: values })
    expect(await manual.detect(image())).toEqual(found)
    expect(manualDetect).toHaveBeenCalledOnce()
    expect(launchSynthIdBrowser).toHaveBeenCalledTimes(1)
  })

  it('keeps login after service refusal and never falls back to manual replay', async () => {
    const manualDetect = vi.spyOn(ManualSynthIdClient.prototype, 'detect')
    const browser = await loggedIn()
    const saved = new SynthIdClient(app.ctx, { ...config, credentials: capturedCredentials })
    browser.detect.mockRejectedValueOnce(new SynthIdError('permission', 'request refused', 7))
    await expect(saved.detect(image())).rejects.toMatchObject({ kind: 'permission' })
    expect(browser.detect).toHaveBeenCalledOnce()
    expect(browser.close).toHaveBeenCalled()
    expect(await saved.status()).toMatchObject({ state: 'ready' })
    // A separate user request can start cleanly; the rejected image is never retried.
    expect(await saved.detect(image(Buffer.from('another image')))).toEqual(found)
    expect(launchSynthIdBrowser).toHaveBeenCalledTimes(2)
    expect(manualDetect).not.toHaveBeenCalled()
  })

  it('preserves a failed recapture error for a saved browser-origin tuple without replaying old credentials', async () => {
    const manualDetect = vi.spyOn(ManualSynthIdClient.prototype, 'detect')
    const first = await loggedIn()
    const status = await client.status()
    const saved = new SynthIdClient(app.ctx, { ...config, credentials: capturedCredentials })
    const stateFile = join(await app.ctx.storage.dir(), 'synthid-session', 'account.json')
    const savedBefore = await readFile(stateFile, 'utf8')
    const recapturing = fakeBrowser()
    recapturing.captureCredentials.mockRejectedValueOnce(new SynthIdError('permission', 'private-fixture capture denied', 7))
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(recapturing)
    await saved.login()
    await vi.waitFor(async () => expect(await saved.status()).toMatchObject({ state: 'error', account }))
    await expect(saved.detect(image())).rejects.toMatchObject({ kind: 'permission', code: 7 })
    await expect(saved.credentials(status.credentialRevision!)).rejects.toMatchObject({ kind: 'auth' })
    expect((await saved.status()).credentialRevision).toBeUndefined()
    expect(first.detect).not.toHaveBeenCalled()
    expect(recapturing.detect).not.toHaveBeenCalled()
    expect(recapturing.captureCredentials).toHaveBeenCalledOnce()
    expect(launchSynthIdBrowser).toHaveBeenCalledTimes(2)
    expect(manualDetect).not.toHaveBeenCalled()
    expect(app.ctx.http.fetch).not.toHaveBeenCalled()
    expect(await readFile(stateFile, 'utf8')).toBe(savedBefore)
    expect(await saved.cancel()).toEqual({ state: 'logged-out' })
    await expect(saved.detect(image())).rejects.toMatchObject({ kind: 'auth', code: undefined })
    expect(manualDetect).not.toHaveBeenCalled()
  })

  it('allows independently entered manual credentials after browser capture failed without using the failed browser', async () => {
    const manualDetect = vi.spyOn(ManualSynthIdClient.prototype, 'detect').mockResolvedValue(found)
    const browser = fakeBrowser()
    browser.captureCredentials.mockRejectedValueOnce(new SynthIdError('permission', 'capture denied', 7))
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
    await client.login()
    await vi.waitFor(async () => expect(await client.status()).toMatchObject({ state: 'error', account }))
    const manual = new SynthIdClient(app.ctx, { ...config, credentials })
    expect(await manual.detect(image())).toEqual(found)
    expect(manualDetect).toHaveBeenCalledOnce()
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'permission', code: 7 })
    expect(launchSynthIdBrowser).toHaveBeenCalledOnce()
    expect(browser.captureCredentials).toHaveBeenCalledOnce()
    expect(browser.detect).not.toHaveBeenCalled()
    expect(app.ctx.http.fetch).not.toHaveBeenCalled()
  })

  it.each(['auth', 'logout'] as const)('retains browser origin after %s and reload without retaining captured secrets', async mode => {
    const manualDetect = vi.spyOn(ManualSynthIdClient.prototype, 'detect')
    const browser = await loggedIn()
    const saved = new SynthIdClient(app.ctx, { ...config, credentials: capturedCredentials })
    if (mode === 'auth') {
      browser.detect.mockRejectedValueOnce(new SynthIdError('auth', 'expired session'))
      await expect(saved.detect(image())).rejects.toMatchObject({ kind: 'auth' })
    } else await saved.logout()
    await expect(saved.detect(image())).rejects.toMatchObject({ kind: 'auth' })
    const stateFile = join(await app.ctx.storage.dir(), 'synthid-session', 'account.json')
    const state = JSON.parse(await readFile(stateFile, 'utf8'))
    expect(state).toEqual({ loggedIn: false, browserCredentialKeys: [synthIdCredentialIdentity(capturedCredentials)!.key] })
    await saved.dispose()
    await client.dispose()
    const restarted = new SynthIdClient(app.ctx, { ...config, credentials: capturedCredentials })
    await expect(restarted.detect(image())).rejects.toMatchObject({ kind: 'auth' })
    expect(await restarted.status()).toEqual({ state: 'logged-out' })
    expect(manualDetect).not.toHaveBeenCalled()
  })

  it('migrates an existing capture without origin metadata before an authentication failure', async () => {
    const manualDetect = vi.spyOn(ManualSynthIdClient.prototype, 'detect')
    const root = join(await app.ctx.storage.dir(), 'synthid-session')
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'account.json'), JSON.stringify({ loggedIn: true, account,
      captured: { revision: 'fixture', credentials: capturedCredentials } }))
    const saved = new SynthIdClient(app.ctx, { ...config, credentials: capturedCredentials })
    const browser = fakeBrowser()
    browser.detect.mockRejectedValueOnce(new SynthIdError('auth', 'expired session'))
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
    await expect(saved.detect(image())).rejects.toMatchObject({ kind: 'auth' })
    await saved.dispose()
    const restarted = new SynthIdClient(app.ctx, { ...config, credentials: capturedCredentials })
    await expect(restarted.detect(image())).rejects.toMatchObject({ kind: 'auth' })
    expect(manualDetect).not.toHaveBeenCalled()
  })

  it('does not use a different saved browser account for a formerly captured tuple', async () => {
    const manualDetect = vi.spyOn(ManualSynthIdClient.prototype, 'detect')
    await loggedIn()
    const saved = new SynthIdClient(app.ctx, { ...config, credentials: capturedCredentials })
    const browser = fakeBrowser()
    browser.captureCredentials.mockResolvedValue({ refreshToken: 'new-refresh', pushFilename: 'users/newuser/files/newfile', bgToken: '!new' })
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
    await client.login()
    await vi.waitFor(async () => expect(await client.status()).toMatchObject({ state: 'ready' }))
    await expect(saved.detect(image())).rejects.toMatchObject({ kind: 'auth' })
    expect(browser.detect).not.toHaveBeenCalled()
    expect(manualDetect).not.toHaveBeenCalled()
  })

  it('waits for queued logout before choosing the credential source or uploading', async () => {
    const manualDetect = vi.spyOn(ManualSynthIdClient.prototype, 'detect')
    const browser = await loggedIn()
    const saved = new SynthIdClient(app.ctx, { ...config, credentials: capturedCredentials })
    await saved.status()
    expect(await saved.detect(image())).toEqual(found)
    const closing = deferred<void>()
    browser.close.mockImplementationOnce(async () => { await closing.promise; browser.closed = true })
    const logout = client.logout()
    await vi.waitFor(() => expect(browser.close).toHaveBeenCalled())
    const detection = saved.detect(image()).then(value => ({ value }), error => ({ error }))
    closing.resolve()
    await logout
    expect(await detection).toMatchObject({ error: { kind: 'auth' } })
    expect(browser.detect).toHaveBeenCalledOnce()
    expect(manualDetect).not.toHaveBeenCalled()
  })

  it('rechecks a browser binding when an earlier queued request invalidates login', async () => {
    const manualDetect = vi.spyOn(ManualSynthIdClient.prototype, 'detect')
    const browser = await loggedIn()
    const saved = new SynthIdClient(app.ctx, { ...config, credentials: capturedCredentials })
    const active = deferred<SynthIdResult>()
    browser.detect.mockReturnValueOnce(active.promise)
    const detections = Promise.allSettled([saved.detect(image()), saved.detect(image(Buffer.from('queued')))])
    await vi.waitFor(() => expect(browser.detect).toHaveBeenCalledOnce())
    active.reject(new SynthIdError('auth', 'session ended'))
    expect(await detections).toEqual([
      { status: 'rejected', reason: expect.objectContaining({ kind: 'auth' }) },
      { status: 'rejected', reason: expect.objectContaining({ kind: 'auth' }) },
    ])
    expect(browser.detect).toHaveBeenCalledOnce()
    expect(manualDetect).not.toHaveBeenCalled()
  })

  it('uses manual detection without needing a browser session', async () => {
    const detect = vi.spyOn(ManualSynthIdClient.prototype, 'detect').mockResolvedValue(found)
    const manual = new SynthIdClient(app.ctx, { ...config, credentials })
    expect(await manual.status()).toEqual({ state: 'logged-out' })
    expect(await manual.detect(image())).toEqual(found)
    expect(detect).toHaveBeenCalledOnce()
    expect(launchSynthIdBrowser).not.toHaveBeenCalled()
  })

  it('uses saved form credentials until the newly captured values are saved to the form', async () => {
    const detect = vi.spyOn(ManualSynthIdClient.prototype, 'detect').mockResolvedValue(found)
    const manual = new SynthIdClient(app.ctx, { ...config, credentials })
    await manual.login()
    await vi.waitFor(async () => expect(await manual.status()).toMatchObject({ state: 'ready' }))
    const status = await manual.status()
    expect(await manual.credentials(status.credentialRevision!)).toMatchObject({ credentials: capturedCredentials })
    expect(await manual.detect(image())).toEqual(found)
    expect(detect).toHaveBeenCalledOnce()
    await manual.logout()
    expect(await manual.detect(image())).toEqual(found)
    expect(detect).toHaveBeenCalledTimes(2)
    expect(await client.status()).toEqual({ state: 'logged-out' })
  })

  it.each([false, { refreshToken: '', pushFilename: '', bgToken: '' }])('preserves an existing browser session for older or empty credential forms: %s', async credentials => {
    const detect = vi.spyOn(ManualSynthIdClient.prototype, 'detect')
    await loggedIn()
    const browser = new SynthIdClient(app.ctx, { ...config, credentials })
    expect(await browser.detect(image())).toEqual(found)
    expect(detect).not.toHaveBeenCalled()
  })

  it('does not silently reactivate legacy credentials from the pre-login version', async () => {
    const detect = vi.spyOn(ManualSynthIdClient.prototype, 'detect')
    const legacy = new SynthIdClient(app.ctx, { ...config, ...credentials })
    await expect(legacy.detect(image())).rejects.toMatchObject({ kind: 'auth' })
    expect(detect).not.toHaveBeenCalled()
  })

  it('disposes the manual client and rejects further detections', async () => {
    vi.spyOn(ManualSynthIdClient.prototype, 'detect').mockResolvedValue(found)
    const dispose = vi.spyOn(ManualSynthIdClient.prototype, 'dispose')
    const manual = new SynthIdClient(app.ctx, { ...config, credentials })
    expect(await manual.detect(image())).toEqual(found)
    await manual.dispose()
    expect(dispose).toHaveBeenCalled()
    await expect(manual.detect(image())).rejects.toMatchObject({ kind: 'cancelled' })
  })
})

describe('SynthID live configuration updates', () => {
  const manualCredentials = { refreshToken: 'manual-fixture', pushFilename: 'users/manual/files/file1', bgToken: '!manual' }

  it('keeps the exact login browser and saved capture across equivalent and normalized form saves', async () => {
    const manualDetect = vi.spyOn(ManualSynthIdClient.prototype, 'detect')
    const browser = await loggedIn()
    const status = await client.status()
    const stateFile = join(vi.mocked(launchSynthIdBrowser).mock.calls[0][0].profileDir, '..', 'account.json')
    const saved = await readFile(stateFile, 'utf8')
    const jwt = 'header.' + Buffer.from(JSON.stringify({ user_id: 'example', sub: 'example' })).toString('base64url') + '.signature'
    const normalized = {
      refreshToken: '  ' + capturedCredentials.refreshToken + '  ',
      pushFilename: ' /synthid-demo-drop-zone/ttl_1d/' + capturedCredentials.pushFilename + ' ',
      bgToken: JSON.stringify([jwt, null, null, null, null, capturedCredentials.bgToken]),
    }
    for (const settings of [
      config,
      { ...config, credentials: capturedCredentials },
      { timeout: 2000, credentials: { ...capturedCredentials } },
      { timeout: 3000, credentials: normalized },
      { timeout: 4000, credentials: false as const },
      { timeout: 5000, credentials: { refreshToken: '', pushFilename: '', bgToken: '' } },
    ]) {
      client.update(settings)
      expect(await client.detect(image())).toEqual(found)
      expect(browser.detect).toHaveBeenLastCalledWith(image(), settings.timeout, 'example')
      expect(await client.status()).toEqual(status)
    }
    expect(launchSynthIdBrowser).toHaveBeenCalledOnce()
    expect(browser.captureCredentials).toHaveBeenCalledOnce()
    expect(browser.detect).toHaveBeenCalledTimes(6)
    expect(browser.close).not.toHaveBeenCalled()
    expect(await readFile(stateFile, 'utf8')).toBe(saved)
    expect(await client.credentials(status.credentialRevision!)).toMatchObject({ credentials: capturedCredentials })
    expect(manualDetect).not.toHaveBeenCalled()
    expect(app.ctx.http.fetch).not.toHaveBeenCalled()
  })

  it('preserves the timeout snapshot for active and queued detections while later requests use the update', async () => {
    const browser = await loggedIn()
    const active = deferred<SynthIdResult>()
    browser.detect.mockReturnValueOnce(active.promise)
    const first = client.detect(image(Buffer.from('active')))
    await vi.waitFor(() => expect(browser.detect).toHaveBeenCalledOnce())
    const queued = client.detect(image(Buffer.from('queued')))
    client.update({ timeout: 2500, credentials: capturedCredentials })
    const updated = client.detect(image(Buffer.from('updated')))
    expect(browser.close).not.toHaveBeenCalled()
    active.resolve(found)
    expect(await Promise.all([first, queued, updated])).toEqual([found, found, found])
    expect(browser.detect.mock.calls.map(([value, timeout, uid]) => [Buffer.from(value.data).toString(), timeout, uid]))
      .toEqual([['active', 1000, 'example'], ['queued', 1000, 'example'], ['updated', 2500, 'example']])
    expect(launchSynthIdBrowser).toHaveBeenCalledOnce()
  })

  it('snapshots the requested login timeout and retains its window across a pending configuration save', async () => {
    const browser = fakeBrowser()
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
    const login = client.login()
    client.update({ timeout: 2500 })
    await login
    await vi.waitFor(async () => expect(await client.status()).toMatchObject({ state: 'ready', account }))
    expect(launchSynthIdBrowser).toHaveBeenCalledWith(expect.objectContaining({ timeout: 1000 }))
    expect(await client.detect(image())).toEqual(found)
    expect(browser.detect).toHaveBeenCalledWith(image(), 2500, 'example')
    expect(browser.close).not.toHaveBeenCalled()
    expect(launchSynthIdBrowser).toHaveBeenCalledOnce()
  })

  it('uses independent manual credentials after a save and reuses the retained browser when switching back', async () => {
    const manualDetect = vi.spyOn(ManualSynthIdClient.prototype, 'detect').mockResolvedValue(found)
    const browser = await loggedIn()
    const status = await client.status()
    client.update({ ...config, credentials: manualCredentials })
    expect(await client.detect(image())).toEqual(found)
    expect(manualDetect).toHaveBeenCalledOnce()
    expect(browser.detect).not.toHaveBeenCalled()
    expect(browser.close).not.toHaveBeenCalled()
    client.update({ timeout: 2500, credentials: capturedCredentials })
    expect(await client.detect(image())).toEqual(found)
    expect(browser.detect).toHaveBeenCalledWith(image(), 2500, 'example')
    expect(manualDetect).toHaveBeenCalledOnce()
    expect(await client.status()).toEqual(status)
    expect(launchSynthIdBrowser).toHaveBeenCalledOnce()
  })

  it('binds a request to its original credential source before an immediate config update', async () => {
    const manualDetect = vi.spyOn(ManualSynthIdClient.prototype, 'detect').mockResolvedValue(found)
    const browser = await loggedIn()
    client.update({ ...config, credentials: capturedCredentials })
    const browserRequest = client.detect(image())
    client.update({ timeout: 2500, credentials: manualCredentials })
    expect(await browserRequest).toEqual(found)
    expect(browser.detect).toHaveBeenCalledWith(image(), 1000, 'example')
    expect(manualDetect).not.toHaveBeenCalled()
    expect(await client.detect(image())).toEqual(found)
    expect(manualDetect).toHaveBeenCalledOnce()
    expect(browser.detect).toHaveBeenCalledOnce()
    expect(browser.close).not.toHaveBeenCalled()
  })

  it('rejects stale browser credentials after a new login until the new captured tuple is saved', async () => {
    const manualDetect = vi.spyOn(ManualSynthIdClient.prototype, 'detect')
    const previous = await loggedIn()
    client.update({ ...config, credentials: capturedCredentials })
    const browser = fakeBrowser()
    const replacement = { refreshToken: 'new-refresh', pushFilename: 'users/newuser/files/newfile', bgToken: '!new' }
    browser.info.email = 'other@example.test'
    browser.captureCredentials.mockResolvedValue(replacement)
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
    await client.login()
    await vi.waitFor(async () => expect(await client.status()).toMatchObject({ state: 'ready', account: 'other@example.test' }))
    expect(previous.close).toHaveBeenCalledOnce()
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'auth' })
    expect(browser.detect).not.toHaveBeenCalled()
    expect(manualDetect).not.toHaveBeenCalled()
    client.update({ ...config, credentials: replacement })
    expect(await client.detect(image())).toEqual(found)
    expect(browser.detect).toHaveBeenCalledWith(image(), config.timeout, 'newuser')
    expect(browser.close).not.toHaveBeenCalled()
    expect(launchSynthIdBrowser).toHaveBeenCalledTimes(2)
    expect(manualDetect).not.toHaveBeenCalled()
  })

  it('reuses the manual client for an identical save and retires it after changed settings', async () => {
    const manualDetect = vi.spyOn(ManualSynthIdClient.prototype, 'detect').mockResolvedValue(found)
    const manualDispose = vi.spyOn(ManualSynthIdClient.prototype, 'dispose')
    client.update({ ...config, credentials: manualCredentials })
    expect(await client.detect(image())).toEqual(found)
    const first = manualDetect.mock.contexts[0]
    client.update({ ...config, credentials: { ...manualCredentials } })
    expect(await client.detect(image())).toEqual(found)
    expect(manualDetect.mock.contexts[1]).toBe(first)
    expect(manualDispose).not.toHaveBeenCalled()
    client.update({ timeout: 2500, credentials: manualCredentials })
    expect(await client.detect(image())).toEqual(found)
    expect(manualDetect.mock.contexts[2]).not.toBe(first)
    await vi.waitFor(() => expect(manualDispose.mock.contexts).toContain(first))
    expect(launchSynthIdBrowser).not.toHaveBeenCalled()
  })

  it('keeps an active manual configuration alive until its request settles after an update', async () => {
    const active = deferred<SynthIdResult>()
    const manualDetect = vi.spyOn(ManualSynthIdClient.prototype, 'detect').mockResolvedValue(found).mockReturnValueOnce(active.promise)
    const manualDispose = vi.spyOn(ManualSynthIdClient.prototype, 'dispose')
    client.update({ ...config, credentials: manualCredentials })
    const first = client.detect(image(Buffer.from('old settings')))
    await vi.waitFor(() => expect(manualDetect).toHaveBeenCalledOnce())
    const previous = manualDetect.mock.contexts[0]
    client.update({ timeout: 2500, credentials: { ...manualCredentials, bgToken: '!updated' } })
    expect(await client.detect(image(Buffer.from('new settings')))).toEqual(found)
    expect(manualDetect.mock.contexts[1]).not.toBe(previous)
    expect(manualDispose.mock.contexts).not.toContain(previous)
    active.resolve(found)
    expect(await first).toEqual(found)
    await vi.waitFor(() => expect(manualDispose.mock.contexts).toContain(previous))
    expect(manualDispose.mock.contexts).not.toContain(manualDetect.mock.contexts[1])
    expect(launchSynthIdBrowser).not.toHaveBeenCalled()
  })

  it('closes the retained browser on actual unload after updates and cannot be revived by another save', async () => {
    const browser = await loggedIn()
    client.update({ timeout: 2500, credentials: capturedCredentials })
    expect(await client.detect(image())).toEqual(found)
    await client.dispose()
    expect(browser.close).toHaveBeenCalledOnce()
    expect(() => client.update(config)).toThrow(expect.objectContaining({ kind: 'cancelled' }))
    await expect(client.detect(image())).rejects.toMatchObject({ kind: 'cancelled' })
    expect(launchSynthIdBrowser).toHaveBeenCalledOnce()
  })
})

describe('SynthID WebUI login API', () => {
  const request = (action: string, method = 'GET') => new Request('http://localhost/api/aiimgdetector/synthid/' + action, { method })
  const credentialRequest = (revision: unknown) => new Request('http://localhost/api/aiimgdetector/synthid/credentials', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision }),
  })

  it('returns captured credentials only for the current revision and prevents caching', async () => {
    await loggedIn()
    const revision = (await client.status()).credentialRevision!
    const response = await handleSynthId(client, credentialRequest(revision))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ success: true, data: { revision, credentials: capturedCredentials } })
    expect((await handleSynthId(client, credentialRequest(undefined))).status).toBe(400)
    expect((await handleSynthId(client, credentialRequest('bad'))).status).toBe(400)
    await client.logout()
    const stale = await handleSynthId(client, credentialRequest(revision))
    expect(stale.status).toBe(503)
    expect(await stale.text()).not.toContain(capturedCredentials.refreshToken)
  })

  it('returns account status without browser internals or credentials and prevents caching', async () => {
    await loggedIn()
    const response = await handleSynthId(client, request('status'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json()
    expect(body).toEqual({ success: true, data: { state: 'ready', account, message: '登录成功，已获取检测凭证。', credentialRevision: expect.any(String) } })
    expect(JSON.stringify(body)).not.toContain(capturedCredentials.refreshToken)
  })

  it.each(['login', 'cancel', 'logout', 'credentials'])('requires POST for %s without changing login state on GET', async action => {
    expect((await handleSynthId(client, request(action))).status).toBe(405)
    expect(await client.status()).toEqual({ state: 'logged-out' })
    expect(launchSynthIdBrowser).not.toHaveBeenCalled()
  })

  it('requires GET for status and rejects unknown paths', async () => {
    expect((await handleSynthId(client, request('status', 'POST'))).status).toBe(405)
    expect((await handleSynthId(client, request('refreshToken'))).status).toBe(404)
    expect((await handleSynthId(client, new Request('http://localhost/not-the-plugin/status'))).status).toBe(404)
    expect(launchSynthIdBrowser).not.toHaveBeenCalled()
  })

  it('supports the login, cancel and logout buttons', async () => {
    const browser = fakeBrowser()
    browser.info.loggedIn = false
    vi.mocked(launchSynthIdBrowser).mockResolvedValueOnce(browser)
    expect((await handleSynthId(client, request('login', 'POST'))).status).toBe(200)
    await vi.waitFor(() => expect(browser.account).toHaveBeenCalled())
    const cancelled = await handleSynthId(client, request('cancel', 'POST'))
    expect(await cancelled.json()).toEqual({ success: true, data: { state: 'logged-out' } })
    await loggedIn()
    const loggedOut = await handleSynthId(client, request('logout', 'POST'))
    expect(await loggedOut.json()).toEqual({ success: true, data: { state: 'logged-out' } })
  })

  it('returns a conflict while detection is busy and does not expose internal error details', async () => {
    vi.spyOn(client, 'logout').mockRejectedValue(new SynthIdError('busy', 'private browser details'))
    const busy = await handleSynthId(client, request('logout', 'POST'))
    expect(busy.status).toBe(409)
    expect(await busy.text()).not.toContain('private browser details')
    vi.spyOn(client, 'status').mockRejectedValue(new Error('refresh_token=private-fixture'))
    const failed = await handleSynthId(client, request('status'))
    expect(failed.status).toBe(503)
    expect(await failed.text()).not.toContain('private-fixture')
  })
})
