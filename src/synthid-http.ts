import { randomUUID } from 'node:crypto'
import type { Context } from '@luckylillia/plugin-sdk'
import type { Image } from './image.js'
import { SynthIdTokenStore, type SynthIdTokens } from './synthid-auth.js'
import { parseSynthIdResponse, SynthIdError, type SynthIdResult } from './synthid-result.js'
import type { LifecycleClient, RequestReference } from './synthid-http-runtime/entry.mjs'

const ORIGIN = 'https://synthid.com'
const TOKEN = 'https://securetoken.googleapis.com/v1/token?key=AIzaSyCjADz3UffE3DF5HZ--7MgVEXrbt6Bgcck'
const CREATE = 'https://waa-pa.clients6.google.com/$rpc/google.internal.waa.v1.Waa/Create'
const UPLOAD = 'https://content-push.googleapis.com/upload/'
const DROPZONE = '/synthid-demo-drop-zone/ttl_1d/'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36'
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/bmp': 'bmp', 'image/avif': 'avif', 'image/heic': 'heic', 'image/heif': 'heif', 'image/tiff': 'tiff',
}
export interface HttpSynthIdOptions {
  refreshToken: string
  timeout: number
  /** Replace the interpreter process in isolated wire tests. */
  loadRuntime?: () => Promise<typeof import('./synthid-http-runtime/entry.mjs')>
}
interface Operation { signal: AbortSignal; reference: RequestReference }
interface Job {
  run?: () => Promise<SynthIdResult>
  resolve: (result: SynthIdResult) => void
  reject: (error: unknown) => void
  detach: () => void
}
interface Account { queue: Job[]; running: boolean; retryAt: number }
const accounts = new Map<string, Account>()
const cancelled = () => new SynthIdError('cancelled', 'SynthID detection was cancelled')
function prune(key: string, account: Account): void {
  if (!account.running && !account.queue.length && account.retryAt <= Date.now() && accounts.get(key) === account) accounts.delete(key)
}
function drain(key: string, account: Account): void {
  if (account.running) return
  const job = account.queue.shift()
  if (!job) return prune(key, account)
  const run = job.run!
  job.run = undefined
  job.detach()
  account.running = true
  void Promise.resolve().then(run).then(result => {
    if (result.status === 'quota_exceeded') account.retryAt = Date.now() + (result.retryAfterSeconds || 60) * 1000
    job.resolve(result)
  }, error => {
    if (error instanceof SynthIdError && error.kind === 'rate-limit') account.retryAt = Date.now() + (error.retryAfterSeconds || 60) * 1000
    job.reject(error)
  }).finally(() => { account.running = false; drain(key, account) })
}
function retryAfter(value: string | null): number {
  const seconds = value && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : value ? (Date.parse(value) - Date.now()) / 1000 : 60
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60
}
function failure(error: unknown, signal: AbortSignal): SynthIdError {
  if (error instanceof SynthIdError) return error
  if (signal.aborted) return signal.reason?.name === 'TimeoutError' ? new SynthIdError('timeout', 'SynthID detection timed out') : cancelled()
  const code = (error as { code?: unknown })?.code
  return new SynthIdError(['WORKER_TIMEOUT', 'OPERATION_TIMEOUT', 'LIFETIME_TIMEOUT'].includes(String(code)) ? 'timeout' : 'response', 'SynthID interpreter could not complete detection')
}

/** All remote I/O uses the host HTTP service. Every image gets a fresh
 * interpreter process, upload path and verification token bound to that path. */
export class HttpSynthIdClient {
  private readonly abort = new AbortController()
  private readonly active = new Set<Promise<SynthIdResult>>()
  private readonly tokens: SynthIdTokenStore
  private runtime?: Promise<typeof import('./synthid-http-runtime/entry.mjs')>

  constructor(private readonly ctx: Context, private readonly options: HttpSynthIdOptions) {
    if (typeof options.refreshToken !== 'string' || !/^[\x21-\x7e]+$/.test(options.refreshToken.trim())
      || !Number.isInteger(options.timeout) || options.timeout < 1 || options.timeout > 120_000) {
      throw new SynthIdError('config', 'SynthID login credential or timeout is invalid')
    }
    this.options = { ...options }
    this.tokens = new SynthIdTokenStore(ctx, options.refreshToken.trim())
    ctx.effect(() => () => this.dispose())
  }

  async dispose(): Promise<void> {
    this.abort.abort()
    await Promise.allSettled([...this.active])
  }

  detect(image: Image, external?: AbortSignal): Promise<SynthIdResult> {
    const signal = external ? AbortSignal.any([this.abort.signal, external]) : this.abort.signal
    const mime = image.type.split(';')[0].trim().toLowerCase()
    if (signal.aborted) return Promise.reject(cancelled())
    if (!Object.hasOwn(EXTENSIONS, mime) || !image.data.byteLength || image.data.byteLength > 20 * 1024 * 1024) {
      return Promise.reject(new SynthIdError('request', 'SynthID needs a supported, non-empty image of at most 20 MB'))
    }
    if (this.active.size >= 4) return Promise.reject(new SynthIdError('busy', 'SynthID account queue is full'))
    const task = this.prepare(image, mime, signal).catch(error => { throw failure(error, signal) })
    this.active.add(task)
    void task.then(() => this.active.delete(task), () => this.active.delete(task))
    return task
  }

  private async prepare(image: Image, mime: string, signal: AbortSignal): Promise<SynthIdResult> {
    if (!this.options.loadRuntime && Number(process.versions.node.split('.')[0]) < 24) {
      throw new SynthIdError('runtime', 'SynthID HTTP runtime requires Node.js 24 or later')
    }
    this.runtime ??= (this.options.loadRuntime ?? (() => import('./synthid-http-runtime/entry.mjs')))()
    const entry = await this.runtime
    const reference = entry.createIndependentRequestReference({ userAgent: USER_AGENT })
    const started = Date.now()
    const tokens = await this.authenticate({ signal: AbortSignal.any([signal, AbortSignal.timeout(this.options.timeout)]), reference })
    signal.throwIfAborted()
    const authElapsed = Date.now() - started
    for (const [key, account] of accounts) prune(key, account)
    const key = tokens.userId
    const account = accounts.get(key) ?? { queue: [], running: false, retryAt: 0 }
    accounts.set(key, account)
    if (account.queue.length + Number(account.running) >= 4) throw new SynthIdError('busy', 'SynthID account queue is full')
    return new Promise<SynthIdResult>((resolve, reject) => {
      const job: Job = {
        run: async () => {
          signal.throwIfAborted()
          if (account.retryAt > Date.now()) throw new SynthIdError('rate-limit', 'SynthID account is cooling down', undefined, Math.ceil((account.retryAt - Date.now()) / 1000))
          const deadline = AbortSignal.timeout(Math.max(1, this.options.timeout - authElapsed))
          const operation = { reference, signal: AbortSignal.any([signal, deadline]) }
          try {
            for (let attempt = 0, auth = tokens; ; attempt++) {
              try { return await this.detectQueued(image, mime, auth, operation, entry) }
              catch (error) {
                if (!(error instanceof SynthIdError) || error.code !== 16 || attempt) throw error
                auth = await this.authenticate(operation, true)
              }
            }
          } catch (error) { throw failure(error, operation.signal) }
        }, resolve, reject, detach: () => signal.removeEventListener('abort', cancel),
      }
      const cancel = () => {
        const index = account.queue.indexOf(job)
        if (index < 0) return
        account.queue.splice(index, 1)
        job.run = undefined
        job.detach()
        reject(cancelled())
        prune(key, account)
      }
      signal.addEventListener('abort', cancel, { once: true })
      account.queue.push(job)
      drain(key, account)
    })
  }

  private async request(operation: Operation, url: string, init: RequestInit, stage: string): Promise<Response> {
    const { signal, reference } = operation
    signal.throwIfAborted()
    const headers = new Headers(init.headers)
    for (const [key, value] of Object.entries(reference.stages[stage]?.headers ?? {})) if (!headers.has(key)) headers.set(key, value)
    headers.set('user-agent', USER_AGENT)
    headers.set('referer', ORIGIN + '/')
    headers.set('accept-language', 'en-US,en;q=0.9')
    headers.delete('content-length')
    let response: Response
    try { response = await this.ctx.http.fetch(url, { ...init, headers, signal, redirect: 'error' }) }
    catch {
      if (signal.aborted) throw failure(undefined, signal)
      throw new SynthIdError('network', `SynthID ${stage} could not connect`)
    }
    if (!response.ok) {
      await response.body?.cancel()
      const status = response.status
      const kind = status === 429 ? 'rate-limit' : status === 401 || stage === 'auth' && status === 400 ? 'auth'
        : status === 403 ? 'permission' : status >= 500 ? 'server' : 'request'
      throw new SynthIdError(kind, `SynthID ${stage} returned HTTP ${status}`, stage === 'detect' && status === 401 ? 16 : status,
        status === 429 ? retryAfter(response.headers.get('retry-after')) : undefined)
    }
    const limit = stage === 'page' || stage === 'challenge' ? 4 * 1024 * 1024 : 1024 * 1024
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    const abort = () => { void reader?.cancel().catch(() => {}) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      if (reader) for (;;) {
        signal.throwIfAborted()
        const { done, value } = await reader.read()
        signal.throwIfAborted()
        if (done) break
        if ((size += value.byteLength) > limit) throw new SynthIdError('response', `SynthID ${stage} returned an oversized response`)
        chunks.push(value)
      }
      return new Response(Buffer.concat(chunks, size), { status: response.status, headers: response.headers })
    } catch (error) { throw failure(error, signal) }
    finally {
      signal.removeEventListener('abort', abort)
      if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock() }
    }
  }

  private authenticate(operation: Operation, force = false): Promise<SynthIdTokens> {
    return this.tokens.get(async refreshToken => {
      const response = await this.request(operation, TOKEN, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
      }, 'auth')
      try { return await response.json() as Record<string, unknown> }
      catch { throw new SynthIdError('response', 'SynthID token refresh returned an invalid response') }
    }, force, operation.signal).catch(error => { throw failure(error, operation.signal) })
  }

  private async detectQueued(image: Image, mime: string, auth: SynthIdTokens, operation: Operation,
    entry: typeof import('./synthid-http-runtime/entry.mjs')): Promise<SynthIdResult> {
    let lifecycle: LifecycleClient | undefined
    const request = (url: string, init: RequestInit = {}, stage: string) => this.request(operation, url, init, stage)
    try {
      const session = await entry.createLifecycleWebSession({ fetch: (url, init = {}) => request(url, init,
        new URL(url).pathname.endsWith('/batchexecute') ? 'detect' : new URL(url).pathname.endsWith('/bscframe') ? 'frame' : 'page') },
      USER_AGENT, { networkMeasurements: true, collapseConnectionTiming: true })
      if (session.config.eptZe !== '/_/WatermarkApp/') throw new SynthIdError('response', 'SynthID page route is not supported')
      const challenge = entry.parseOfficialChallenge(await (await request(CREATE, {
        method: 'POST', body: JSON.stringify(['UzdguikIn08nBCK5a0xw']),
        headers: { Origin: ORIGIN, 'Content-Type': 'application/json+protobuf', 'X-Goog-Api-Key': 'AIzaSyBGb5fGAyC-pRcRU6MUHb__b_vKha71HRE', 'X-User-Agent': 'grpc-web-javascript/0.1' },
      }, 'challenge')).json())
      let interpreter = challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue
      let interpreterSourceUrl: string | undefined
      if (!interpreter) {
        const raw = challenge.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue
        const url = new URL(String(raw), ORIGIN)
        if (!raw || url.protocol !== 'https:' || !['www.google.com', 'www.gstatic.com'].includes(url.hostname)
          || url.port || url.username || url.password || !url.pathname.startsWith('/js/')) throw new SynthIdError('response', 'SynthID interpreter location is not supported')
        interpreterSourceUrl = url.href
        interpreter = await (await request(url.href, {}, 'interpreter')).text()
      }
      let frameUrl: string | undefined, frameHTML: string | undefined
      const suffix = challenge.program.lastIndexOf('//')
      if (suffix >= 0) {
        const url = new URL(Buffer.from(challenge.program.slice(suffix + 2), 'base64').toString('utf8'), ORIGIN)
        if (url.protocol !== 'https:' || !['synthid.com', 'www.google.com', 'www.gstatic.com'].includes(url.hostname)
          || url.port || url.username || url.password) throw new SynthIdError('response', 'SynthID frame location is not supported')
        frameUrl = url.href
        frameHTML = await (url.origin === ORIGIN ? await session.request(frameUrl) : await request(frameUrl, {}, 'frame')).text()
      }
      lifecycle = entry.createLifecycleClient({ signal: operation.signal,
        webidlBrandErrors: true,
        timeouts: { init: Math.min(this.options.timeout, 25_000), snapshot: Math.min(this.options.timeout, 15_000) }, maxLifetimeMs: Math.max(100, this.options.timeout) })
      const initialized = await lifecycle.initialize({ ...await session.environment(),
        program: challenge.program, globalName: challenge.globalName, rawExperiments: challenge.clientExperimentsStateBlob ?? '',
        experiments: entry.normalizeOfficialExperimentState(challenge.clientExperimentsStateBlob),
        interpreter, interpreterSourceUrl, frameUrl, frameHTML, userAgent: USER_AGENT,
        eventClockCompatibility: true, enablePointerDiagnostics: true, clockPrecision100us: true,
        runtimeWebCompatibility: true, runtimeChildWebCompatibility: true, runtimeNavigatorCompatibility: true,
        runtimeWindowStateCompatibility: true, runtimeNetworkCompatibility: true, runtimeDetachedFrameCompatibility: true,
        runtimeWebIdlRealmCompatibility: true, runtimeWebIdlCallableControl: true, runtimePermissionsBinding: true,
        runtimeAnchorHrefTranslate: true, runtimeMouseMediaCompatibility: true, runtimeChromeCsi: true, runtimeCssProperties: true,
        javascriptBindings: true, activationStateControl: true, activationTimingControl: true,
        virtualFocusControl: true, webidlBrandErrors: true,
      })
      if (!initialized.success || !(await lifecycle.dispatchPointerDiagnostics()).success) throw new SynthIdError('response', 'SynthID interpreter initialization failed')
      const path = 'users/' + auth.userId + '/files/' + randomUUID()
      const blobref = DROPZONE + path
      const generated = await lifecycle.snapshot(blobref)
      if (!generated.success || typeof generated.bgToken !== 'string' || !/^![\x21-\x7e]+$/.test(generated.bgToken)) throw new SynthIdError('response', 'SynthID verification token generation failed')
      const headers = { Authorization: 'Basic amI5dChNbS0qNjFlczJJVzpyZyRHNUp1QENpV29OJVNS', 'Push-ID': 'feeds/szvztmw263lqqp',
        'Push-Filename': path, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }
      const start = await request(UPLOAD, { method: 'POST', body: `file_name image.${EXTENSIONS[mime]}`,
        headers: { ...headers, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(image.data.byteLength) } }, 'start')
      let uploadUrl: URL
      try {
        uploadUrl = new URL(start.headers.get('x-goog-upload-url') ?? '')
        if (uploadUrl.origin !== 'https://content-push.googleapis.com' || uploadUrl.username || uploadUrl.password
          || !/^\/upload(?:\/|$)/.test(uploadUrl.pathname)) throw new Error()
      } catch { throw new SynthIdError('response', 'SynthID upload URL is not supported') }
      const uploaded = await request(uploadUrl.href, { method: 'POST', body: image.data,
        headers: { ...headers, 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' } }, 'upload, finalize')
      if (uploaded.headers.get('x-goog-upload-status') !== 'final' || (await uploaded.text()).trim() !== blobref) throw new SynthIdError('response', 'SynthID upload did not finalize at the generated path')
      const endpoint = new URL('/_/WatermarkApp/data/batchexecute', ORIGIN)
      if (typeof session.config.cfb2h !== 'string' || !session.config.cfb2h || typeof session.config.FdrFJe !== 'string' || !session.config.FdrFJe) throw new SynthIdError('response', 'SynthID page metadata is incomplete')
      endpoint.search = new URLSearchParams({ rpcids: 'TZRKo', 'source-path': '/image-detection', bl: session.config.cfb2h,
        'f.sid': session.config.FdrFJe, hl: session.config.hl || 'en-US', _reqid: session.nextRequestId(), rt: 'c' }).toString()
      const form = entry.attachWebXsrf(new URLSearchParams({ 'f.req': JSON.stringify([[['TZRKo', JSON.stringify([null, [[[mime, null, null, null, null, null, blobref]]], 0]), null, 'generic']]]) }), session.config)
      const response = await session.request(endpoint.href, { method: 'POST', body: form.toString() + '&', headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', 'X-Same-Domain': '1',
        'X-Goog-Ext-525006476-Jspb': JSON.stringify([auth.idToken, null, null, null, null, generated.bgToken]),
      } })
      generated.bgToken = ''
      return parseSynthIdResponse(await response.text())
    } finally {
      if (lifecycle) {
        const disposed = await lifecycle.dispose()
        if (!disposed.success || lifecycle.telemetry.exited === false) throw new SynthIdError('runtime', 'SynthID interpreter cleanup failed')
      }
    }
  }
}
