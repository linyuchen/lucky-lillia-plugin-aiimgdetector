import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import type { Browser, BrowserContext, FileChooser, Page, Request as BrowserRequest, Response as BrowserResponse } from 'playwright-core'
import type { Http } from '@luckylillia/plugin-sdk'
import type { Image } from './image.js'
import type { ManualSynthIdCredentials } from './synthid-manual.js'
import { accountScript, refreshTokenScript } from './synthid-page.js'
import { parseSynthIdResponse, SynthIdError, type SynthIdNetworkCode, type SynthIdResult } from './synthid-result.js'

const ORIGIN = 'https://synthid.com'
// Keep Playwright's CommonJS bootstrap at its canonical path. The host's ESM
// reload query must not propagate into the bundle's circular imports.
const { chromium, errors } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core')
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/bmp': 'bmp', 'image/avif': 'avif', 'image/heic': 'heic', 'image/heif': 'heif', 'image/tiff': 'tiff',
}

export interface SynthIdBrowserAccount {
  loggedIn: boolean
  email?: string
  accepted: boolean
}

export interface SynthIdBrowserSession {
  isClosed(): boolean
  account(): Promise<SynthIdBrowserAccount>
  captureCredentials(timeout: number): Promise<ManualSynthIdCredentials>
  detect(image: Image, timeout: number, expectedUserId?: string): Promise<SynthIdResult>
  bringToFront(): Promise<void>
  close(): Promise<void>
}

export interface SynthIdBrowserOptions {
  profileDir: string
  headed: boolean
  timeout: number
  http: Pick<Http, 'fetch'> & { proxy?(url: string | URL): string }
  signal: AbortSignal
}

function browserExecutable(): string {
  const paths = process.platform === 'win32' ? [
    join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
    join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    join(process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env.PROGRAMFILES || 'C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'),
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : [
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/opt/google/chrome/chrome',
  ]
  paths.push(chromium.executablePath())
  const executable = paths.find(path => existsSync(path))
  if (!executable) throw new SynthIdError('config', 'SynthID needs an installed Chrome, Edge, or Chromium browser')
  return executable
}

function failure(error: unknown, closed: boolean): SynthIdError {
  if (error instanceof SynthIdError) return error
  if (closed) return new SynthIdError('cancelled', 'SynthID browser was closed')
  if (error instanceof errors.TimeoutError) return new SynthIdError('timeout', 'SynthID browser request timed out')
  if (error instanceof Error && /net::ERR_(?:PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|NO_SUPPORTED_PROXIES|SOCKS_CONNECTION_FAILED|PROXY_AUTH_UNSUPPORTED)/.test(error.message)) {
    return new SynthIdError('proxy', 'SynthID browser could not connect through the configured proxy')
  }
  // Playwright exceptions can contain URLs, page text, or request data. Never expose them to logs or WebUI.
  return new SynthIdError('network', 'SynthID browser could not complete the request')
}

interface PausedRequest {
  requestId: string
  resourceType?: string
  request: {
    url: string
    method: string
    headers: Record<string, string>
    postData?: string
    postDataEntries?: { bytes?: string }[]
    hasPostData?: boolean
  }
}

type CdpSend = (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<unknown>
interface ProxyCredentials { username: string; password: string }

/** Ask the host's proxy plugin, without reading its config files or inspecting its dispatcher. */
function nativeProxy(http: SynthIdBrowserOptions['http']): { server: string; credentials?: ProxyCredentials } | undefined {
  if (typeof http.proxy !== 'function') return undefined
  try {
    const address = http.proxy(ORIGIN)
    if (address === '') return { server: '' }
    const url = new URL(address)
    if (url.protocol === 'socks:') url.protocol = 'socks5:'
    if (!['http:', 'https:', 'socks5:'].includes(url.protocol) || !url.hostname
      || url.pathname !== '/' && url.pathname !== '' || url.search || url.hash) throw new Error()
    const credentials = url.username || url.password
      ? { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) } : undefined
    // Chromium supports HTTP proxy authentication, but not authenticated SOCKS5. Fail before launch.
    if (url.protocol === 'socks5:' && credentials) throw new Error()
    url.username = ''; url.password = ''
    return { server: url.origin === 'null' ? 'socks5://' + url.host : url.origin, credentials }
  } catch { throw new SynthIdError('proxy', 'SynthID browser proxy settings are not supported') }
}

/** Retain only known transport codes, never exception text, URLs or proxy credentials. */
function navigationFailure(error: unknown): SynthIdError | undefined {
  const seen = new Set<unknown>()
  const codes: readonly string[] = ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT']
  for (let cause = error; cause && typeof cause === 'object' && !seen.has(cause);) {
    seen.add(cause)
    const detail = cause as { code?: unknown; cause?: unknown }
    if (typeof detail.code === 'string' && codes.includes(detail.code)) {
      return new SynthIdError('network', 'SynthID login page connection failed', undefined, undefined, detail.code as SynthIdNetworkCode)
    }
    cause = detail.cause
  }
}

/** Chromium retains its cookie jar and redirect rules; Node handles only one HTTP exchange at a time. */
async function forward(event: PausedRequest, sessionId: string, send: CdpSend, http: Pick<Http, 'fetch'>, signal: AbortSignal, timeout: number, onNavigationFailure: (error: unknown) => void): Promise<void> {
  const { request, requestId } = event
  try {
    const url = new URL(request.url)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      await send('Fetch.continueRequest', { requestId }, sessionId)
      return
    }
    const headers = Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), value]))
    for (const name of ['host', 'connection', 'content-length', 'accept-encoding', 'transfer-encoding']) delete headers[name]
    // CDP includes the raw upload bytes as base64. In particular, never re-encode image data as UTF-8.
    const data = request.postDataEntries?.length
      ? Buffer.concat(request.postDataEntries.map(entry => Buffer.from(entry.bytes || '', 'base64')))
      : request.postData === undefined ? undefined : Buffer.from(request.postData)
    if (request.hasPostData && data === undefined) throw new Error('Missing request bytes')
    const response = await http.fetch(url, {
      method: request.method, headers, redirect: 'manual',
      body: data === undefined ? undefined : new Uint8Array(data),
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
    }, { timeout })
    const responseHeaders: { name: string; value: string }[] = []
    response.headers.forEach((value, name) => {
      // Node fetch already decompresses the payload. Let Chromium calculate its new length.
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie'].includes(name)) {
        responseHeaders.push({ name, value })
      }
    })
    for (const value of response.headers.getSetCookie()) responseHeaders.push({ name: 'set-cookie', value })
    await send('Fetch.fulfillRequest', {
      requestId, responseCode: response.status, responseHeaders,
      body: Buffer.from(await response.arrayBuffer()).toString('base64'),
    }, sessionId)
  } catch (error) {
    if (!signal.aborted && event.resourceType === 'Document' && (request.url === ORIGIN || request.url.startsWith(ORIGIN + '/'))) {
      onNavigationFailure(error)
    }
    await send('Fetch.failRequest', { requestId, errorReason: signal.aborted ? 'Aborted' : 'Failed' }, sessionId).catch(() => {})
  }
}

/**
 * Playwright route() deliberately lets redirected requests bypass its handler. CDP interception is
 * necessary for OAuth: attach before new pages/iframes execute, including the popup's first request.
 */
async function forwardBrowser(endpoint: string, http: Pick<Http, 'fetch'>, signal: AbortSignal, timeout: number, onNavigationFailure: (error: unknown) => void, proxyCredentials?: ProxyCredentials): Promise<{ close(): void; shutdown(): Promise<void> }> {
  const socket = new WebSocket(endpoint)
  let nextId = 0
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  const targets = new Set<Promise<unknown>>()
  const targetRequests = new Map<string, AbortController>()
  const authenticatedRequests = new Set<string>()
  const finish = () => {
    for (const controller of targetRequests.values()) controller.abort()
    targetRequests.clear()
    authenticatedRequests.clear()
    for (const task of pending.values()) task.reject(new Error('Browser transport closed'))
    pending.clear()
  }
  const close = () => { signal.removeEventListener('abort', close); socket.close(); finish() }
  socket.addEventListener('close', finish)
  socket.addEventListener('error', finish)
  const send: CdpSend = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) { reject(new Error('Browser transport unavailable')); return }
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const attach = async (sessionId: string, type: string) => {
    targetRequests.set(sessionId, new AbortController())
    // This must be the first command: popup navigation can begin before Network.enable returns.
    await send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }],
      ...(proxyCredentials ? { handleAuthRequests: true } : {}) }, sessionId)
    await send('Network.enable', { maxPostDataSize: 20 * 1024 * 1024 }, sessionId)
    if (type === 'page' || type === 'iframe') {
      if (!proxyCredentials) await send('Network.setBypassServiceWorker', { bypass: true }, sessionId)
      await send('Target.setAutoAttach', {
        autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
        filter: [{ type: 'page' }, { type: 'iframe' }, { type: 'shared_worker' }, { exclude: true }],
      }, sessionId)
    }
    await send('Runtime.runIfWaitingForDebugger', {}, sessionId)
  }
  socket.addEventListener('message', event => {
    let message: { id?: number; result?: unknown; error?: unknown; method?: string; params?: unknown; sessionId?: string }
    try { message = JSON.parse(String(event.data)) } catch { return }
    if (message.id !== undefined) {
      const task = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) task?.reject(new Error('Browser transport command failed'))
      else task?.resolve(message.result)
    } else if (message.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo } = message.params as { sessionId: string; targetInfo: { type: string } }
      const task = attach(sessionId, targetInfo.type)
      targets.add(task)
      void task.finally(() => targets.delete(task)).catch(() => { close() })
    } else if (message.method === 'Target.detachedFromTarget') {
      const { sessionId } = message.params as { sessionId: string }
      targetRequests.get(sessionId)?.abort()
      targetRequests.delete(sessionId)
    } else if (message.method === 'Fetch.requestPaused' && message.sessionId) {
      if (proxyCredentials) {
        const { requestId } = message.params as PausedRequest
        void send('Fetch.continueRequest', { requestId }, message.sessionId).catch(() => {})
        return
      }
      const target = targetRequests.get(message.sessionId)
      void forward(message.params as PausedRequest, message.sessionId, send, http,
        target ? AbortSignal.any([signal, target.signal]) : signal, timeout, onNavigationFailure)
    } else if (message.method === 'Fetch.authRequired' && message.sessionId && proxyCredentials) {
      const { requestId, authChallenge } = message.params as { requestId: string; authChallenge: { source: string } }
      const key = message.sessionId + ':' + requestId
      // Never send proxy credentials to an origin-server challenge, or loop after rejected credentials.
      const answer = authChallenge.source !== 'Proxy' ? { response: 'Default' }
        : authenticatedRequests.has(key) ? { response: 'CancelAuth' }
          : { response: 'ProvideCredentials', ...proxyCredentials }
      authenticatedRequests.add(key)
      void send('Fetch.continueWithAuth', { requestId, authChallengeResponse: answer }, message.sessionId).catch(() => {})
    }
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Browser transport timed out')), timeout)
      socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Browser transport unavailable')) }, { once: true })
      socket.addEventListener('close', () => { clearTimeout(timer); reject(new Error('Browser transport closed')) }, { once: true })
    })
    signal.addEventListener('abort', close, { once: true })
    if (signal.aborted) throw new Error('Browser transport cancelled')
    await send('Target.setAutoAttach', {
      autoAttach: true, waitForDebuggerOnStart: true, flatten: true,
      filter: [{ type: 'page' }, { type: 'iframe' }, { type: 'shared_worker' }, { exclude: true }],
    })
    await Promise.all([...targets])
    return { close, shutdown: async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([send('Browser.close').catch(() => {}), new Promise<void>(resolve => {
          timer = setTimeout(resolve, 2000)
        })])
      } finally { clearTimeout(timer); close() }
    } }
  } catch (error) { close(); throw error }
}

async function unusedPort(): Promise<number> {
  const server = createServer()
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    return (server.address() as { port: number }).port
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
}

async function browserEndpoint(port: number, child: ChildProcess, signal: AbortSignal, timeout: number): Promise<string> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (signal.aborted || !child.pid || child.exitCode !== null) throw new Error('Browser startup cancelled')
    try {
      // Only the private loopback DevTools connection uses direct fetch.
      const response = await fetch('http://127.0.0.1:' + port + '/json/version', {
        signal: AbortSignal.any([signal, AbortSignal.timeout(500)]),
      })
      const result = await response.json() as { webSocketDebuggerUrl?: string }
      const endpoint = new URL(result.webSocketDebuggerUrl || '')
      if (endpoint.protocol === 'ws:' && endpoint.hostname === '127.0.0.1' && endpoint.port === String(port)
        && endpoint.pathname.startsWith('/devtools/browser/')) return endpoint.href
    } catch { /* Chrome may still be creating its profile. */ }
    await delay(100, undefined, { signal })
  }
  throw new SynthIdError('timeout', 'SynthID browser startup timed out')
}

function isSynthIdPage(page: Page): boolean {
  try { return !page.isClosed() && new URL(page.url()).origin === ORIGIN } catch { return false }
}

function isDetectionResponse(response: BrowserResponse): boolean {
  const url = new URL(response.url())
  return url.origin === ORIGIN && url.pathname === '/_/WatermarkApp/data/batchexecute'
    && (url.searchParams.get('rpcids') || '').split(',').includes('TZRKo')
    && response.request().method() === 'POST'
}

async function detectionResult(response: BrowserResponse): Promise<SynthIdResult> {
  if (!response.ok()) {
    const status = response.status()
    const kind = status === 401 ? 'auth' : status === 403 ? 'permission'
      : status === 429 ? 'rate-limit' : status >= 500 ? 'server' : 'request'
    const retry = status === 429 ? await response.headerValue('retry-after') : undefined
    const seconds = retry && (/^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) : (Date.parse(retry) - Date.now()) / 1000)
    throw new SynthIdError(kind, 'SynthID returned HTTP ' + status, status,
      typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined)
  }
  return parseSynthIdResponse(await response.text())
}

/** Both values must come from this page's same detection request, never another tab or upload. */
async function detectionCredentials(response: BrowserResponse): Promise<{ pushFilename: string; bgToken: string; userId: string }> {
  try {
    const request = response.request()
    const header: unknown = JSON.parse(await request.headerValue('x-goog-ext-525006476-jspb') || 'null')
    if (!Array.isArray(header) || typeof header[0] !== 'string' || typeof header[5] !== 'string'
      || !/^![\x21-\x7e]+$/.test(header[5])) throw new Error()
    const batches: unknown = JSON.parse(new URLSearchParams(request.postData() || '').get('f.req') || 'null')
    if (!Array.isArray(batches)) throw new Error()
    const calls = batches.flatMap(batch => Array.isArray(batch) ? batch : []).filter(
      call => Array.isArray(call) && call[0] === 'TZRKo' && typeof call[1] === 'string',
    )
    if (calls.length !== 1) throw new Error()
    const payload = JSON.parse(calls[0][1])
    const blob = payload?.[1]?.[0]?.[0]?.[6]
    if (typeof blob !== 'string') throw new Error()
    const match = /^\/synthid-demo-drop-zone\/ttl_1d\/(users\/([A-Za-z0-9_-]+)\/files\/[A-Za-z0-9_-]+)$/.exec(blob)
    if (!match) throw new Error()
    const claims = JSON.parse(Buffer.from(header[0].split('.')[1], 'base64url').toString('utf8'))
    if ((claims?.user_id ?? claims?.sub) !== match[2]
      || claims.user_id && claims.sub && claims.user_id !== claims.sub) throw new Error()
    return { pushFilename: match[1], bgToken: header[5], userId: match[2] }
  } catch {
    throw new SynthIdError('response', 'SynthID did not provide matching detection credentials')
  }
}

/** Read only the refresh token for the UID actually used by the successful detection. */
async function readRefreshToken(page: Page, userId: string): Promise<string> {
  const token = await page.evaluate<string>(refreshTokenScript + '(' + JSON.stringify(userId) + ')')
  if (!/^[\x21-\x7e]+$/.test(token)) throw new SynthIdError('auth', 'SynthID did not provide a reusable login credential')
  return token
}

/** Read metadata from the live Firebase user, falling back to persisted auth. */
async function readAccount(page: Page): Promise<SynthIdBrowserAccount> {
  return page.evaluate<SynthIdBrowserAccount>(accountScript)
}

export async function launchSynthIdBrowser(options: SynthIdBrowserOptions): Promise<SynthIdBrowserSession> {
  const { profileDir, headed, timeout, http, signal } = options
  if (signal.aborted) throw new SynthIdError('cancelled', 'SynthID browser startup was cancelled')
  await mkdir(profileDir, { recursive: true, mode: 0o700 })
  let context: BrowserContext | undefined
  let nativeBrowser: Browser | undefined
  let child: ChildProcess | undefined
  let childDone: Promise<void> | undefined
  let transport: { close(): void; shutdown(): Promise<void> } | undefined
  let startupFailure: SynthIdError | undefined
  let starting = true
  let closeTask: Promise<void> | undefined
  let closed = false
  const abort = new AbortController()
  const closing = new AbortController()
  const close = (): Promise<void> => {
    if (closeTask) return closeTask
    closed = true
    closing.abort()
    signal.removeEventListener('abort', onAbort)
    closeTask = (async () => {
      // Closing through CDP flushes the profile. Playwright close only disconnects an attached browser.
      if (transport) await transport.shutdown()
      else if (nativeBrowser) {
        const cdp = await nativeBrowser.newBrowserCDPSession().catch(() => undefined)
        await cdp?.send('Browser.close').catch(() => {})
      } else child?.kill()
      abort.abort()
      transport?.close()
      await nativeBrowser?.close().catch(() => {})
      if (child && child.exitCode === null) {
        await Promise.race([childDone, delay(3000)])
        if (child.exitCode === null) child.kill()
        await childDone
      }
    })()
    return closeTask
  }
  const onAbort = () => { void close() }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const proxy = nativeProxy(http)
    const port = await unusedPort()
    if (signal.aborted) throw new SynthIdError('cancelled', 'SynthID browser startup was cancelled')
    // Use an ordinary installed browser with its sandbox, dedicated profile, and nonzero debugging port.
    // Playwright's launch flags (including its pipe) mark even the visible login window as a test browser.
    child = spawn(browserExecutable(), [
      '--user-data-dir=' + profileDir, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port,
      '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', '--lang=en-US',
      '--disable-background-networking', '--disable-component-update', '--disable-popup-blocking',
      // Native Chromium requests retain their headers, TLS and worker networking. Older hosts
      // without proxy resolution keep the existing fail-closed HTTP bridge.
      ...(proxy?.server === '' ? ['--no-proxy-server'] : [
        '--proxy-server=' + (proxy?.server ?? 'http://127.0.0.1:1'), '--proxy-bypass-list=<-loopback>',
      ]),
      ...(headed ? [] : ['--headless=new']), 'about:blank',
    ], { stdio: 'ignore', windowsHide: !headed })
    childDone = new Promise(resolve => { child!.once('exit', () => resolve()); child!.once('error', () => resolve()) })
    const endpoint = await browserEndpoint(port, child, abort.signal, timeout)
    nativeBrowser = await chromium.connectOverCDP(endpoint, { timeout })
    context = nativeBrowser.contexts()[0]
    if (!context) throw new Error('Browser context missing')
    if (closed || signal.aborted) {
      closeTask = undefined
      await close()
      throw new SynthIdError('cancelled', 'SynthID browser startup was cancelled')
    }
    context.on('close', () => { closed = true; closing.abort(); abort.abort(); signal.removeEventListener('abort', onAbort) })
    if (!proxy || proxy.credentials) {
      transport = await forwardBrowser(endpoint, http, abort.signal, timeout, error => {
        if (starting) startupFailure = navigationFailure(error)
      }, proxy?.credentials)
    }
    const landing = context.pages()[0] || await context.newPage()
    await landing.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout })
    // Wait for the application, including its initial consent state, to be mounted.
    await landing.locator('input[type="file"]').first().waitFor({ state: 'attached', timeout })
    starting = false
    const browser = context
    let uploadBusy = false
    let uploadUnavailable = false
    const account = async () => {
      if (closed) throw new SynthIdError('cancelled', 'SynthID browser was closed')
      const page = browser.pages().find(isSynthIdPage)
      if (!page) return { loggedIn: false, accepted: false }
      try { return await readAccount(page) } catch (error) {
        if (closed) throw failure(error, true)
        // OAuth redirects replace execution contexts; the login manager polls again after navigation.
        return { loggedIn: false, accepted: false }
      }
    }
    const upload = async <T>(
      uploadTimeout: number,
      prepareFile: (page: Page) => Promise<{ name: string; mimeType: string; buffer: Buffer }>,
      consume: (response: BrowserResponse, result: SynthIdResult, userId: string, remaining: () => number) => Promise<T>,
      expectedUserId?: string,
    ): Promise<T> => {
      if (closed || closing.signal.aborted) throw new SynthIdError('cancelled', 'SynthID browser was closed')
      if (uploadBusy) throw new SynthIdError('busy', 'SynthID website upload is already running')
      if (uploadUnavailable) throw new SynthIdError('auth', 'Reopen SynthID before uploading again')
      const capturePage = browser.pages().find(isSynthIdPage)
      if (!capturePage) throw new SynthIdError('auth', 'Sign in to SynthID in the browser first')
      uploadBusy = true
      const deadline = Date.now() + uploadTimeout
      let finished = false
      let completed = false
      let submitted = false
      let timer: ReturnType<typeof setTimeout> | undefined
      let chooser: FileChooser | undefined
      let clickTask: Promise<void> | undefined
      let clickDone = false
      let onCancel: () => void = () => {}
      let resolveChooser!: (value: FileChooser) => void
      let resolveResponse!: (value: BrowserResponse) => void
      const requests = new Set<BrowserRequest>()
      const remaining = () => {
        if (closed || closing.signal.aborted || capturePage.isClosed()) throw new SynthIdError('cancelled', 'SynthID browser was closed')
        const duration = deadline - Date.now()
        if (finished || duration <= 0) throw new SynthIdError('timeout', 'SynthID website upload timed out')
        return duration
      }
      const onChooser = (value: FileChooser) => {
        if (finished) { void value.setFiles([]).catch(() => {}); return }
        chooser = value
        resolveChooser(value)
      }
      const onRequest = (request: BrowserRequest) => {
        if (!submitted || finished) return
        try {
          const url = new URL(request.url())
          if (request.frame().page() === capturePage && url.origin === ORIGIN
            && url.pathname === '/_/WatermarkApp/data/batchexecute'
            && (url.searchParams.get('rpcids') || '').split(',').includes('TZRKo')
            && request.method() === 'POST') requests.add(request)
        } catch {}
      }
      const onResponse = (response: BrowserResponse) => {
        if (!finished && requests.has(response.request()) && isDetectionResponse(response)) resolveResponse(response)
      }
      const run = async (): Promise<T> => {
        const select = capturePage.getByRole('button', { name: /^(Select file|选择文件)$/i }).first()
        const avatar = capturePage.locator('sid-account-avatar .profile-image').first()
        remaining()
        if (!await select.isVisible() && /^\/image-detection\/?$/.test(new URL(capturePage.url()).pathname)) {
          // The site's Back action clears its selected-file/result store while retaining live auth.
          const back = capturePage.getByRole('link', { name: /\bBack\b|返回/i }).first()
          await back.click({ timeout: remaining(), noWaitAfter: true })
          remaining()
        }
        let userId: string | undefined
        while (!userId) {
          remaining()
          const account = await readAccount(capturePage)
          remaining()
          // Firebase can finish restoring its live user after the page shell and file input mount.
          // Keep this browser expression as text so the host's tsx helper is never serialized.
          const liveUid = await capturePage.evaluate<string | undefined>(`(() => {
            const user = window.firebase?.apps?.[0]?.auth?.().currentUser;
            const token = user?.refreshToken || user?.stsTokenManager?.refreshToken;
            return user?.uid && !user.isAnonymous && typeof token === 'string' && token ? user.uid : undefined;
          })()`)
          remaining()
          if (liveUid && expectedUserId !== undefined && liveUid !== expectedUserId) {
            throw new SynthIdError('auth', 'SynthID account does not match the configured login')
          }
          if (account.loggedIn && account.accepted && liveUid && await avatar.isVisible()
            && await select.isVisible() && await select.isEnabled()) userId = liveUid
          else await delay(Math.min(100, remaining()), undefined, { signal: closing.signal })
        }
        await readRefreshToken(capturePage, userId)
        remaining()
        await capturePage.bringToFront()
        remaining()
        const file = await prepareFile(capturePage)
        remaining()
        const chosen = new Promise<FileChooser>(resolve => { resolveChooser = resolve })
        const response = new Promise<BrowserResponse>(resolve => { resolveResponse = resolve })
        capturePage.on('filechooser', onChooser)
        capturePage.on('request', onRequest)
        capturePage.on('response', onResponse)
        // Follow the page's ordinary button handler before supplying this upload's file.
        clickTask = select.click({ timeout: Math.min(1000, remaining()), noWaitAfter: true })
        void clickTask.finally(() => { clickDone = true }).catch(() => {})
        await clickTask
        remaining()
        const selection = await chosen
        remaining()
        const selectedUserId = await capturePage.evaluate<string | undefined>(`(() => {
          const user = window.firebase?.apps?.[0]?.auth?.().currentUser;
          return user && !user.isAnonymous ? user.uid : undefined;
        })()`)
        remaining()
        if (selectedUserId !== userId) throw new SynthIdError('auth', 'SynthID account changed before upload')
        submitted = true
        await selection.setFiles(file, { timeout: remaining() })
        remaining()
        const result = await response
        remaining()
        const detected = await detectionResult(result)
        remaining()
        const output = await consume(result, detected, userId, remaining)
        remaining()
        completed = true
        return output
      }
      try {
        return await Promise.race([run(), new Promise<never>((_, reject) => {
          onCancel = () => reject(new SynthIdError('cancelled', 'SynthID browser was closed'))
          closing.signal.addEventListener('abort', onCancel, { once: true })
          capturePage.on('close', onCancel)
          timer = setTimeout(() => reject(new SynthIdError('timeout', 'SynthID website upload timed out')), Math.max(1, deadline - Date.now()))
          if (closed || closing.signal.aborted || capturePage.isClosed()) onCancel()
        })])
      } catch (error) {
        throw failure(error, closed || closing.signal.aborted || capturePage.isClosed())
      } finally {
        finished = true
        uploadBusy = false
        // A delayed website response after failure must never satisfy a subsequent attempt.
        // The manager reopens this persistent profile for the next separate detection job or login retry.
        if (!completed) uploadUnavailable = true
        clearTimeout(timer)
        closing.signal.removeEventListener('abort', onCancel)
        capturePage.off('close', onCancel)
        capturePage.off('request', onRequest)
        capturePage.off('response', onResponse)
        requests.clear()
        const releaseChooser = () => {
          capturePage.off('filechooser', onChooser)
          if (chooser && !submitted) void chooser.setFiles([]).catch(() => {})
        }
        // If cancellation races the short native click, intercept and dismiss its late chooser.
        if (clickTask && !clickDone) void clickTask.catch(() => {}).finally(releaseChooser)
        else releaseChooser()
      }
    }
    return {
      account, close, isClosed: () => closed,
      captureCredentials(captureTimeout) {
        return upload(captureTimeout, async page => {
          // Only generated colour tiles are uploaded. No screenshot, user file or page content is read.
          const png = await page.evaluate(() => {
            const canvas = document.createElement('canvas')
            canvas.width = canvas.height = 512
            const painter = canvas.getContext('2d')!
            for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
              painter.fillStyle = 'hsl(' + (x * 31 + y * 47) % 360 + ' 65% ' + (35 + (x + y) % 4 * 10) + '%)'
              painter.fillRect(x * 32, y * 32, 32, 32)
            }
            return canvas.toDataURL('image/png').split(',')[1]
          })
          return { name: 'synthid-login-check.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }
        }, async (response, result, userId, remaining) => {
          if (result.status === 'quota_exceeded') throw new SynthIdError('rate-limit', 'SynthID detection quota was exceeded', undefined, result.retryAfterSeconds)
          const credentials = await detectionCredentials(response)
          remaining()
          if (credentials.userId !== userId) throw new SynthIdError('auth', 'SynthID account changed during credential capture')
          const refreshToken = await readRefreshToken(response.frame().page(), credentials.userId)
          remaining()
          return { refreshToken, pushFilename: credentials.pushFilename, bgToken: credentials.bgToken }
        })
      },
      async bringToFront() {
        if (closed) throw new SynthIdError('cancelled', 'SynthID browser was closed')
        try {
          // OAuth can open a popup. Bring that window forward while the user signs in.
          const page = browser.pages().filter(page => !page.isClosed()).at(-1)
          if (page) await page.bringToFront()
        } catch (error) { throw failure(error, closed) }
      },
      async detect(image, detectionTimeout, expectedUserId) {
        const extension = EXTENSIONS[image.type.toLowerCase()]
        if (!extension || !image.data.byteLength || image.data.byteLength > 20 * 1024 * 1024) {
          throw new SynthIdError('request', 'Unsupported SynthID image')
        }
        return upload(detectionTimeout, async () => ({
          name: 'image.' + extension, mimeType: image.type, buffer: Buffer.from(image.data),
        }), async (_response, result) => result, expectedUserId)
      },
    }
  } catch (error) {
    const problem = (!closed && !signal.aborted && startupFailure) || failure(error, closed)
    await close()
    throw problem
  }
}
