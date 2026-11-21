import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import type { Http } from '@luckylillia-dev/plugin-sdk'
import type { ManualSynthIdCredentials } from './synthid-manual.js'
import { accountScript, refreshTokenScript } from './synthid-page.js'
import { SynthIdError, type SynthIdNetworkCode } from './synthid-result.js'

const ORIGIN = 'https://synthid.com'
// Keep Playwright's CommonJS bootstrap at its canonical path. The host's ESM
// reload query must not propagate into the bundle's circular imports.
const { chromium, errors } = createRequire(import.meta.url)('playwright-core') as typeof import('playwright-core')
export interface SynthIdBrowserAccount {
  loggedIn: boolean
  email?: string
  accepted: boolean
}

export interface SynthIdBrowserSession {
  isClosed(): boolean
  account(): Promise<SynthIdBrowserAccount>
  captureCredentials(timeout: number): Promise<ManualSynthIdCredentials>
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

/** Read the refresh token only after the user completed the browser login. */
async function readRefreshToken(page: Page, userId?: string): Promise<string> {
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
    // Connect only to the browser process started above, on its loopback endpoint.
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
    return {
      account, close, isClosed: () => closed,
      async captureCredentials(_captureTimeout) {
        if (closed) throw new SynthIdError('cancelled', 'SynthID browser was closed')
        const page = browser.pages().find(isSynthIdPage)
        if (!page || closed) throw new SynthIdError('auth', 'Sign in to SynthID first')
        const info = await readAccount(page)
        if (!info.loggedIn || !info.accepted) throw new SynthIdError('auth', 'Complete SynthID sign-in first')
        return { refreshToken: await readRefreshToken(page), pushFilename: '', bgToken: '' }
      },
      async bringToFront() {
        if (closed) throw new SynthIdError('cancelled', 'SynthID browser was closed')
        try {
          // OAuth can open a popup. Bring that window forward while the user signs in.
          const page = browser.pages().filter(page => !page.isClosed()).at(-1)
          if (page) await page.bringToFront()
        } catch (error) { throw failure(error, closed) }
      },
    }
  } catch (error) {
    const problem = (!closed && !signal.aborted && startupFailure) || failure(error, closed)
    await close()
    throw problem
  }
}
