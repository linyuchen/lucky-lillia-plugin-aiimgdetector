import { randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { Context, Http } from '@luckylillia/plugin-sdk'
import type { Image } from './image.js'
import { launchSynthIdBrowser, type SynthIdBrowserSession } from './synthid-browser.js'
import { ManualSynthIdClient, synthIdCredentialIdentity, type ManualSynthIdCredentials, type SynthIdCredentialIdentity } from './synthid-manual.js'
import { describeSynthIdFailure, SynthIdError, type SynthIdResult } from './synthid-result.js'

export interface SynthIdConfig {
  timeout: number
  credentials?: false | ManualSynthIdCredentials
}
export interface SynthIdStatus {
  state: 'logged-out' | 'opening' | 'awaiting-login' | 'capturing' | 'ready' | 'error'
  account?: string
  message?: string
  credentialRevision?: string
}

interface CapturedCredentials {
  revision: string
  credentials: ManualSynthIdCredentials
}

// All entries in one instance share a profile and queue. The last owner closes
// the browser and removes this entry, including during plugin reload.
const sessions = new Map<string, ManagedSession>()
const supported = /^image\/(?:jpeg|png|webp|gif|bmp|avif|heic|heif|tiff)$/
const cancelled = () => new SynthIdError('cancelled', 'SynthID operation was cancelled')

class ManagedSession {
  readonly owners = new Set<SynthIdClient>()
  readonly ready: Promise<void>
  readonly profile: string
  private readonly stateFile: string
  private state: SynthIdStatus = { state: 'logged-out' }
  private captured?: CapturedCredentials
  // A failed initialization is not evidence that the recognized account logged out.
  // Keep only a sanitized, transient error; never persist it or return failed credentials.
  private initializationFailure?: SynthIdError
  // Retain origin bindings even after logout, so saved browser-filled values
  // never silently become a static HTTP replay on the next request or reload.
  private readonly browserCredentialKeys = new Set<string>()
  private browser?: SynthIdBrowserSession
  private browserProxy?: string
  private launch?: Promise<SynthIdBrowserSession>
  private browserAbort?: AbortController
  private loginTask?: Promise<void>
  private loginAbort?: AbortController
  private tail: Promise<void> = Promise.resolve()
  private controls: Promise<void> = Promise.resolve()
  private pending = 0
  private retryAt = 0
  private epoch = 0
  closing?: Promise<void>

  constructor(readonly root: string) {
    this.profile = join(root, 'browser')
    this.stateFile = join(root, 'account.json')
    this.ready = this.restore()
  }

  private async restore(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    try {
      const saved = JSON.parse(await readFile(this.stateFile, 'utf8'))
      if (Array.isArray(saved?.browserCredentialKeys)) {
        for (const key of saved.browserCredentialKeys) {
          if (typeof key === 'string' && /^[a-f0-9]{64}$/.test(key)) this.browserCredentialKeys.add(key)
        }
      }
      if (saved?.loggedIn === true && typeof saved.account === 'string') {
        this.state = { state: 'ready', account: saved.account, message: '已保存登录状态' }
        if (typeof saved.captured?.revision === 'string' && validCredentials(saved.captured.credentials)) {
          this.captured = saved.captured
          this.state.credentialRevision = this.captured!.revision
          const identity = synthIdCredentialIdentity(this.captured!.credentials)
          if (identity) this.browserCredentialKeys.add(identity.key)
        }
      }
    } catch { this.state = { state: 'logged-out' } }
  }

  status(): SynthIdStatus { return { ...this.state } }

  credentials(revision: string): CapturedCredentials {
    if (this.state.state !== 'ready' || !this.captured || this.captured.revision !== revision) {
      throw new SynthIdError('auth', 'SynthID captured credentials are no longer available')
    }
    return { revision, credentials: { ...this.captured.credentials } }
  }

  control<T>(action: () => Promise<T>): Promise<T> {
    const task = this.controls.then(() => {
      if (this.closing) throw cancelled()
      return action()
    })
    this.controls = task.then(() => {}, () => {})
    return task
  }

  private async save(account: string, captured: CapturedCredentials): Promise<void> {
    const identity = synthIdCredentialIdentity(captured.credentials)
    if (identity) this.browserCredentialKeys.add(identity.key)
    await this.writeState({ loggedIn: true, account, captured })
  }

  private async writeState(value: Record<string, unknown>): Promise<void> {
    const temporary = this.stateFile + '.' + randomUUID() + '.tmp'
    try {
      // Keep the captured form values private, alongside our isolated browser profile.
      await writeFile(temporary, JSON.stringify({ ...value, browserCredentialKeys: [...this.browserCredentialKeys] }), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await rename(temporary, this.stateFile)
    } finally { await unlink(temporary).catch(() => {}) }
  }

  private async forget(): Promise<void> {
    this.state = { state: 'logged-out' }
    this.captured = undefined
    this.initializationFailure = undefined
    if (this.browserCredentialKeys.size) await this.writeState({ loggedIn: false })
    else await unlink(this.stateFile).catch(error => { if (error.code !== 'ENOENT') throw error })
  }

  private async open(headed: boolean, timeout: number): Promise<SynthIdBrowserSession> {
    const owner = [...this.owners].find(owner => !owner.disposed)
    if (!owner) throw cancelled()
    let proxy: string | undefined
    try { proxy = typeof owner.http.proxy === 'function' ? owner.http.proxy('https://synthid.com') : undefined }
    catch { throw new SynthIdError('proxy', 'SynthID proxy settings could not be resolved') }
    if (this.browser && !this.browser.isClosed()) {
      if (proxy === this.browserProxy) return this.browser
      await this.closeBrowser()
    }
    if (!this.launch) {
      // Use a live owner for every request even if the first entry was disposed.
      const http = { fetch: (...args: Parameters<Http['fetch']>) => {
        const owner = [...this.owners].find(owner => !owner.disposed)
        if (!owner) return Promise.reject(cancelled())
        return owner.http.fetch(...args)
      }, ...(proxy === undefined ? {} : { proxy: () => proxy! }) }
      this.browserProxy = proxy
      this.browserAbort = new AbortController()
      this.launch = launchSynthIdBrowser({ profileDir: this.profile, headed, timeout, http, signal: this.browserAbort.signal })
        .then(browser => { this.browser = browser; return browser })
        .finally(() => { this.launch = undefined })
    }
    return this.launch
  }

  private async closeBrowser(expected?: SynthIdBrowserSession): Promise<void> {
    if (expected && expected !== this.browser) {
      await expected.close()
      return
    }
    this.browserAbort?.abort()
    const browser = this.browser ?? await this.launch?.catch(() => undefined)
    this.browser = undefined
    if (browser) await browser.close()
  }

  async login(timeout: number): Promise<SynthIdStatus> {
    await this.ready
    if (this.closing) throw cancelled()
    if (this.pending) throw new SynthIdError('busy', 'SynthID is currently detecting an image')
    if (this.loginTask) {
      await this.browser?.bringToFront()
      return this.status()
    }
    const epoch = ++this.epoch
    const controller = this.loginAbort = new AbortController()
    let keepBrowser = false
    this.initializationFailure = undefined
    this.state = { state: 'opening', message: '正在 Bot 所在电脑打开登录窗口…' }
    this.loginTask = (async () => {
      await this.closeBrowser()
      if (controller.signal.aborted) return
      const browser = await this.open(true, timeout)
      if (controller.signal.aborted) return
      this.state = { state: 'awaiting-login', message: '请在打开的窗口中登录 Google，并完成 SynthID 页面上的首次使用提示。' }
      const deadline = Date.now() + 10 * 60_000
      while (!controller.signal.aborted && Date.now() < deadline) {
        if (browser.isClosed()) { await this.forget(); return }
        const info = await browser.account()
        if (controller.signal.aborted || epoch !== this.epoch) return
        if (info.loggedIn && info.accepted) {
          const account = info.email || 'Google 账号'
          this.state = { state: 'capturing', account, message: '已登录，正在使用内置测试图片获取检测凭证…' }
          const credentials = await browser.captureCredentials(Math.max(timeout, 60_000))
          if (controller.signal.aborted || epoch !== this.epoch) return
          if (!validCredentials(credentials)) throw new SynthIdError('response', 'SynthID returned incomplete credentials')
          const captured = { revision: randomUUID(), credentials }
          await this.save(account, captured)
          if (controller.signal.aborted || epoch !== this.epoch) { await this.forget(); return }
          this.captured = captured
          this.initializationFailure = undefined
          this.state = { state: 'ready', account, credentialRevision: captured.revision, message: '登录成功，已获取检测凭证。' }
          // Keep the live page that completed the ordinary website flow. Its next
          // upload uses the site's Back action, preserving transient login/page state.
          keepBrowser = true
          return
        }
        await delay(1000, undefined, { signal: controller.signal })
      }
      if (!controller.signal.aborted) {
        this.initializationFailure = new SynthIdError('timeout', 'SynthID login initialization timed out')
        this.state = { state: 'error', message: '登录等待已超时，请重新点击登录。' }
      }
    })().catch(error => {
      if (!controller.signal.aborted && epoch === this.epoch) {
        const failure = safeInitializationError(error)
        this.initializationFailure = failure?.kind === 'cancelled' ? undefined : failure
        const account = this.state.state === 'capturing' ? this.state.account : undefined
        // Preserve the signed-in window for inspection. A retry is explicit and
        // starts a fresh browser operation; never ask the user to supply a test image.
        keepBrowser = !!account && !!this.browser && !this.browser.isClosed()
        const message = account && error instanceof SynthIdError && error.kind === 'verification'
          ? '网站校验未通过，稍后可点击「重新获取凭证」。'
          : account && error instanceof SynthIdError && error.kind === 'timeout'
            ? '自动获取超时，可点击「重新获取凭证」再试。'
            : account && error instanceof SynthIdError && error.kind === 'cancelled'
              ? '浏览器已关闭，可点击「重新获取凭证」再试。' : safeError(failure ?? error)
        this.state = { state: 'error', ...(account ? { account } : {}),
          message: (account ? '已登录，但自动获取检测凭证失败。' : '') + message }
      }
    }).finally(async () => {
      if (!keepBrowser || controller.signal.aborted) await this.closeBrowser().catch(() => {})
      if (epoch === this.epoch) { this.loginTask = undefined; this.loginAbort = undefined }
    })
    return this.status()
  }

  async cancel(): Promise<SynthIdStatus> {
    this.initializationFailure = undefined
    if (this.loginTask) {
      this.epoch++
      this.loginAbort?.abort()
      await this.closeBrowser()
      await this.loginTask
      this.loginTask = undefined
      this.loginAbort = undefined
      await this.forget()
    } else if (this.state.state === 'error') {
      await this.closeBrowser()
      await this.forget()
    }
    return this.status()
  }

  async logout(): Promise<SynthIdStatus> {
    if (this.pending) throw new SynthIdError('busy', 'SynthID is currently detecting an image')
    await this.cancel()
    await this.closeBrowser()
    // Resolve and check our own profile before recursive deletion.
    const root = await realpath(this.root)
    const profile = await realpath(this.profile).catch(error => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (profile) {
      if (dirname(resolve(profile)) !== resolve(root) || resolve(profile) !== resolve(root, 'browser')) {
        throw new SynthIdError('config', 'SynthID profile is outside its storage directory')
      }
      await rm(profile, { recursive: true, force: true })
    }
    await this.forget()
    this.retryAt = 0
    return this.status()
  }

  async detect(image: Image, timeout: number, signal: AbortSignal, manual?: ManualSynthIdClient, configuredIdentity?: SynthIdCredentialIdentity): Promise<SynthIdResult> {
    await this.ready
    await this.controls
    if (signal.aborted || this.closing) throw cancelled()
    // Choose the credential source before any upload. Independently entered
    // credentials remain usable without a browser or a saved browser login.
    if (manual && (!configuredIdentity || !this.browserCredentialKeys.has(configuredIdentity.key))) {
      return manual.detect(image)
    }
    if (this.loginTask) throw new SynthIdError('busy', 'SynthID login is in progress')
    const binding = configuredIdentity ?? (this.captured && synthIdCredentialIdentity(this.captured.credentials))
    this.checkBinding(binding)
    if (this.pending >= 4) throw new SynthIdError('busy', 'SynthID account queue is full')
    this.pending++
    let started = false
    let released = false
    const release = () => {
      if (!released) { released = true; this.pending-- }
    }
    let queuedImage: Image | undefined = image
    const task = this.tail.then(async () => {
      if (signal.aborted || this.closing) throw cancelled()
      started = true
      const input = queuedImage!
      queuedImage = undefined
      if (this.retryAt > Date.now()) throw new SynthIdError('rate-limit', 'SynthID account is cooling down', undefined, Math.ceil((this.retryAt - Date.now()) / 1000))
      this.checkBinding(binding)
      const browser = await this.open(false, timeout)
      const abort = () => { void browser.close().catch(() => {}) }
      signal.addEventListener('abort', abort, { once: true })
      try {
        if (signal.aborted) throw cancelled()
        this.checkBinding(binding)
        const result = await browser.detect(input, timeout, binding?.userId)
        if (signal.aborted) throw cancelled()
        if (result.status === 'quota_exceeded') this.retryAt = Date.now() + (result.retryAfterSeconds || 60) * 1000
        return result
      } catch (error) {
        // A failed website operation must not leave its pending navigation or
        // response listeners attached to a subsequent, different image.
        await this.closeBrowser(browser).catch(() => {})
        if (signal.aborted) throw cancelled()
        if (error instanceof SynthIdError) {
          if (error.kind === 'auth') await this.forget()
          if (error.kind === 'rate-limit') this.retryAt = Date.now() + (error.retryAfterSeconds || 60) * 1000
        }
        throw error
      } finally { signal.removeEventListener('abort', abort) }
    })
    this.tail = task.then(release, release)
    let onCancel!: () => void
    const cancellation = new Promise<never>((_, reject) => {
      onCancel = () => { queuedImage = undefined; reject(cancelled()) }
      signal.addEventListener('abort', onCancel, { once: true })
      if (signal.aborted) onCancel()
    })
    try { return await Promise.race([task, cancellation]) } finally {
      signal.removeEventListener('abort', onCancel)
      queuedImage = undefined
      // Queued cancellations release memory/capacity immediately. An active
      // operation keeps login/logout blocked until its browser has unwound.
      if (!started) release()
    }
  }

  private checkBinding(binding?: SynthIdCredentialIdentity): void {
    if (this.state.state !== 'ready') {
      // Return a fresh error so callers cannot mutate the remembered classification.
      throw safeInitializationError(this.initializationFailure) ?? new SynthIdError('auth', 'SynthID needs login')
    }
    if (binding && (!this.captured || synthIdCredentialIdentity(this.captured.credentials)?.key !== binding.key)) {
      throw new SynthIdError('auth', 'SynthID configured browser credentials no longer match the saved session')
    }
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      this.initializationFailure = undefined
      this.epoch++
      this.loginAbort?.abort()
      await this.closeBrowser()
      await this.controls
      await this.loginTask
      await this.tail
    })()
    return this.closing
  }
}

export class SynthIdClient {
  readonly http: Http
  private readonly abort = new AbortController()
  private current!: {
    timeout: number
    credentials?: ManualSynthIdCredentials
    identity?: SynthIdCredentialIdentity
    manual?: ManualSynthIdClient
    scope?: ReturnType<Context['plugin']>
    users: number
    closing?: Promise<void>
  }
  private readonly configurations = new Set<SynthIdClient['current']>()
  private manager?: Promise<ManagedSession>
  private closing?: Promise<void>
  get disposed(): boolean { return this.abort.signal.aborted }

  constructor(private readonly ctx: Context, config: SynthIdConfig) {
    this.http = ctx.http
    this.update(config)
    ctx.effect(() => () => this.dispose())
  }

  update(config: SynthIdConfig): void {
    if (this.disposed) throw cancelled()
    const previous = this.current
    const credentials = config.credentials && Object.values(config.credentials).some(value => typeof value === 'string' && value.trim())
      ? { ...config.credentials } : undefined
    if (previous && previous.timeout === config.timeout
      && previous.credentials?.refreshToken === credentials?.refreshToken
      && previous.credentials?.pushFilename === credentials?.pushFilename
      && previous.credentials?.bgToken === credentials?.bgToken) return
    const next: SynthIdClient['current'] = { timeout: config.timeout, credentials, users: 0 }
    if (credentials) {
      next.identity = synthIdCredentialIdentity(credentials)
      // Each generation owns its effects; disposing it also unregisters the
      // manual client's unload handler instead of accumulating saved secrets.
      next.scope = this.ctx.plugin((ctx: Context) => {
        next.manual = new ManualSynthIdClient(ctx, { ...credentials, timeout: next.timeout })
      })
    }
    this.current = next
    this.configurations.add(next)
    if (previous) void this.retire(previous)
  }

  private retire(settings: SynthIdClient['current']): Promise<void> {
    if (!this.disposed && (settings === this.current || settings.users)) return Promise.resolve()
    settings.closing ??= (async () => {
      try { await settings.scope?.dispose() }
      catch { this.ctx.logger('aiimgdetector').warn('Could not dispose retired SynthID credential resources') }
      finally {
        this.configurations.delete(settings)
        settings.credentials = undefined
        settings.manual = undefined
        settings.scope = undefined
      }
    })()
    return settings.closing
  }

  private async session(): Promise<ManagedSession> {
    if (this.disposed) throw cancelled()
    this.manager ??= (async () => {
      const root = resolve(await this.ctx.storage.dir(), 'synthid-session')
      let session = sessions.get(root)
      while (session?.closing) {
        await session.closing
        if (sessions.get(root) === session) sessions.delete(root)
        session = sessions.get(root)
      }
      if (this.disposed) throw cancelled()
      if (!session) { session = new ManagedSession(root); sessions.set(root, session) }
      session.owners.add(this)
      try { await session.ready } catch (error) {
        session.owners.delete(this)
        if (!session.owners.size && sessions.get(root) === session) sessions.delete(root)
        throw error
      }
      return session
    })()
    return this.manager
  }

  async status(): Promise<SynthIdStatus> { return (await this.session()).status() }
  async credentials(revision: string): Promise<CapturedCredentials> { return (await this.session()).credentials(revision) }
  async login(): Promise<SynthIdStatus> { return this.control('login') }
  async cancel(): Promise<SynthIdStatus> { return this.control('cancel') }
  async logout(): Promise<SynthIdStatus> { return this.control('logout') }

  private async control(action: 'login' | 'cancel' | 'logout'): Promise<SynthIdStatus> {
    const timeout = this.current.timeout
    const session = await this.session()
    return session.control(() => {
      if (this.disposed) throw cancelled()
      return action === 'login' ? session.login(timeout) : session[action]()
    })
  }

  async detect(image: Image): Promise<SynthIdResult> {
    if (this.disposed) throw cancelled()
    const mime = image.type.split(';')[0].trim().toLowerCase()
    if (!supported.test(mime) || !image.data.byteLength || image.data.byteLength > 20 * 1024 * 1024) {
      throw new SynthIdError('request', 'SynthID needs a supported image of at most 20 MB')
    }
    // Snapshot before either context initialization or the shared queue waits.
    // An update affects only subsequent requests, including credential identity.
    const settings = this.current
    settings.users++
    try {
      await settings.scope
      if (this.disposed) throw cancelled()
      return await (await this.session()).detect({ ...image, type: mime }, settings.timeout, this.abort.signal, settings.manual, settings.identity)
    } finally {
      settings.users--
      await this.retire(settings)
    }
  }

  dispose(): Promise<void> {
    this.abort.abort()
    this.closing ??= (async () => {
      await Promise.all([...this.configurations].map(settings => this.retire(settings)))
      const session = await this.manager?.catch(() => undefined)
      if (!session) return
      session.owners.delete(this)
      if (!session.owners.size) {
        try { await session.close() } finally { if (sessions.get(session.root) === session) sessions.delete(session.root) }
      }
    })()
    return this.closing
  }
}

function safeInitializationError(error: unknown): SynthIdError | undefined {
  if (!(error instanceof SynthIdError)) return
  return new SynthIdError(error.kind, 'SynthID login initialization failed',
    typeof error.code === 'number' && Number.isFinite(error.code) ? error.code : undefined,
    typeof error.retryAfterSeconds === 'number' && Number.isFinite(error.retryAfterSeconds) && error.retryAfterSeconds >= 0
      ? error.retryAfterSeconds : undefined,
    error.networkCode && ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT'].includes(error.networkCode)
      ? error.networkCode : undefined)
}

function safeError(error: unknown): string {
  return error instanceof SynthIdError ? describeSynthIdFailure(error) : '无法启动或保存 SynthID 登录，请检查浏览器、网络和插件数据目录。'
}

function validCredentials(value: unknown): value is ManualSynthIdCredentials {
  if (!value || typeof value !== 'object') return false
  const fields = value as Record<string, unknown>
  return ['refreshToken', 'pushFilename', 'bgToken'].every(key => typeof fields[key] === 'string' && !!fields[key].trim())
}

/** Protected by host WebUI authentication. Status never includes credentials. */
export async function handleSynthId(client: SynthIdClient, request: Request): Promise<Response> {
  const path = new URL(request.url).pathname
  const action = path.slice('/api/aiimgdetector/synthid/'.length)
  if (path !== '/api/aiimgdetector/synthid/' + action || !['status', 'login', 'cancel', 'logout', 'credentials'].includes(action)) {
    return Response.json({ success: false, message: 'not found' }, { status: 404 })
  }
  if (request.method !== (action === 'status' ? 'GET' : 'POST')) {
    return Response.json({ success: false, message: 'method not allowed' }, { status: 405 })
  }
  try {
    if (action === 'credentials') {
      const body = await request.json().catch(() => null) as { revision?: unknown } | null
      if (typeof body?.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(body.revision)) {
        return Response.json({ success: false, message: '凭证版本无效，请重新获取登录状态。' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
      }
      const data = await client.credentials(body.revision)
      return Response.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const data = action === 'status' ? await client.status() : action === 'login' ? await client.login()
      : action === 'cancel' ? await client.cancel() : await client.logout()
    return Response.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({ success: false, message: safeError(error) }, {
      status: error instanceof SynthIdError && error.kind === 'busy' ? 409 : 503, headers: { 'Cache-Control': 'no-store' },
    })
  }
}
