import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@luckylillia/plugin-sdk'
import type { Image } from './image.js'
import { describeSynthIdFailure, parseSynthIdResponse, SynthIdError, type SynthIdResult } from './synthid-result.js'

export interface ManualSynthIdCredentials {
  refreshToken: string
  pushFilename: string
  bgToken: string
}

export interface SynthIdCredentialIdentity {
  key: string
  userId: string
}

/** Credential recovery instructions, for typed and browser-filled credentials alike. */
export class ManualSynthIdError extends SynthIdError {}

export function describeManualSynthIdFailure(error: SynthIdError): string {
  switch (error.kind) {
    case 'config': return 'SynthID 凭证不完整、格式错误或账号不一致，请使用浏览器登录自动填写，或按插件设置中的获取说明重新填写。'
    case 'auth': return 'SynthID 登录凭证已失效，请重新登录自动填写，或重新获取登录凭据（refresh_token）。'
    case 'verification': return 'SynthID 未接受本次请求提供的网页校验凭据，请确认上传标识与网页校验凭据来自同一次检测，或在网页完成新检测后一起更新。'
    default: return describeSynthIdFailure(error)
  }
}

function manualError(error: unknown): ManualSynthIdError {
  if (error instanceof ManualSynthIdError) return error
  if (error instanceof SynthIdError) return new ManualSynthIdError(error.kind, error.message, error.code, error.retryAfterSeconds)
  return new ManualSynthIdError('response', 'SynthID manual detection failed')
}

// Public web-app protocol constants, not an account's credentials. See docs/synthid.md.
const ORIGIN = 'https://synthid.com'
const UPLOAD = 'https://content-push.googleapis.com/upload/'
const TOKEN = 'https://securetoken.googleapis.com/v1/token?key=AIzaSyCjADz3UffE3DF5HZ--7MgVEXrbt6Bgcck'
const DETECT = ORIGIN + '/_/WatermarkApp/data/batchexecute?rpcids=TZRKo&source-path=%2Fimage-detection&hl=en-US&rt=c'
const DROPZONE = '/synthid-demo-drop-zone/ttl_1d/'
const WEB_HEADERS = {
  Origin: ORIGIN,
  Referer: ORIGIN + '/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
}
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/bmp': 'bmp', 'image/avif': 'avif', 'image/heic': 'heic', 'image/heif': 'heif', 'image/tiff': 'tiff',
}

interface Credentials {
  refreshToken: string
  pushFilename: string
  bgToken: string
  userId: string
}

interface Tokens {
  refreshToken: string
  idToken: string
  updatedAt: number
}

interface Account {
  queue: Job[]
  running: boolean
  retryAt: number
}

interface Job {
  run?: () => Promise<SynthIdResult>
  resolve: (value: SynthIdResult) => void
  reject: (error: ManualSynthIdError) => void
  detach: () => void
}

// Shared across plugin entries in this process, because a second upload can replace the first one's blob.
const accounts = new Map<string, Account>()

function credentials(config: ManualSynthIdCredentials): Credentials {
  if (typeof config.refreshToken !== 'string' || typeof config.pushFilename !== 'string' || typeof config.bgToken !== 'string') {
    throw new ManualSynthIdError('config', 'Missing or invalid SynthID manual credentials')
  }
  const refreshToken = config.refreshToken.trim()
  const pushFilename = config.pushFilename.trim().replace(/^\/synthid-demo-drop-zone\/ttl_1d\//, '')
  const userId = /^users\/([A-Za-z0-9_-]+)\/files\/[A-Za-z0-9_-]+$/.exec(pushFilename)?.[1]
  let bgToken = config.bgToken.trim()
  let idToken = ''
  if (bgToken.startsWith('[')) {
    try {
      const header: unknown = JSON.parse(bgToken)
      if (!Array.isArray(header) || typeof header[5] !== 'string' || (header[0] != null && typeof header[0] !== 'string')) throw new Error()
      bgToken = header[5]
      idToken = typeof header[0] === 'string' ? header[0] : ''
    } catch {
      throw new ManualSynthIdError('config', 'Invalid SynthID verification header')
    }
  }
  if (!refreshToken || !/^[\x21-\x7e]+$/.test(refreshToken) || !userId || !/^![\x21-\x7e]+$/.test(bgToken)) {
    throw new ManualSynthIdError('config', 'Missing or invalid SynthID manual credentials')
  }
  if (idToken) {
    const value = claims(idToken)
    if ((value.user_id ?? value.sub) !== userId || value.user_id && value.sub && value.user_id !== value.sub) {
      throw new ManualSynthIdError('config', 'SynthID credentials belong to different accounts')
    }
  }
  // A captured JWT is unverified. Only a successful refresh or our own cache supplies the ID token.
  return { refreshToken, pushFilename, bgToken, userId }
}

/** Internal source identity only; never include this key in status, logs or WebUI responses. */
export function synthIdCredentialIdentity(config: ManualSynthIdCredentials): SynthIdCredentialIdentity | undefined {
  try {
    const normalized = credentials(config)
    const key = createHash('sha256').update(JSON.stringify([
      normalized.refreshToken, normalized.pushFilename, normalized.bgToken,
    ])).digest('hex')
    return { key, userId: normalized.userId }
  } catch {
    return undefined
  }
}

function claims(token: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function retryAfter(value: string | null): number {
  if (!value) return 60
  const seconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : (Date.parse(value) - Date.now()) / 1000
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 60
}

function pruneAccount(key: string, account: Account): void {
  if (!account.running && !account.queue.length && account.retryAt <= Date.now() && accounts.get(key) === account) accounts.delete(key)
}

function drain(key: string, account: Account): void {
  if (account.running) return
  const job = account.queue.shift()
  if (!job) return pruneAccount(key, account)
  const run = job.run!
  job.run = undefined
  job.detach()
  account.running = true
  // Keep the account occupied until the active request has actually stopped, even on cancellation.
  void Promise.resolve().then(run).then(result => {
    if (result.status === 'quota_exceeded') account.retryAt = Date.now() + (result.retryAfterSeconds || 60) * 1000
    job.resolve(result)
  }, error => {
    const failure = manualError(error)
    if (failure.kind === 'rate-limit') account.retryAt = Date.now() + (failure.retryAfterSeconds || 60) * 1000
    job.reject(failure)
  }).finally(() => {
    account.running = false
    drain(key, account)
  })
}

export class ManualSynthIdClient {
  private readonly abort = new AbortController()
  private readonly active = new Set<Promise<SynthIdResult>>()
  private tokens?: Tokens
  private cachePath?: string
  private readonly logger

  constructor(private readonly ctx: Context, private readonly config: ManualSynthIdCredentials & { timeout: number }) {
    this.config = { ...config }
    this.logger = ctx.logger('aiimgdetector')
    ctx.effect(() => () => this.dispose())
  }

  async dispose(): Promise<void> {
    this.abort.abort()
    await Promise.allSettled([...this.active])
  }

  detect(image: Image): Promise<SynthIdResult> {
    try {
      return this.enqueue(image)
    } catch (error) {
      return Promise.reject(manualError(error))
    }
  }

  private enqueue(image: Image): Promise<SynthIdResult> {
    const auth = credentials(this.config)
    const mime = image.type.split(';')[0].trim().toLowerCase()
    if (!Object.hasOwn(EXTENSIONS, mime) || !image.data.byteLength || image.data.byteLength > 20 * 1024 * 1024) {
      throw new ManualSynthIdError('request', 'SynthID needs a supported, non-empty image of at most 20 MB')
    }
    for (const [key, entry] of accounts) pruneAccount(key, entry)
    const account = accounts.get(auth.userId) ?? { queue: [], running: false, retryAt: 0 }
    accounts.set(auth.userId, account)
    this.checkReady(account)
    // Bound the number of images retained while a shared account is busy. Includes the running request.
    if (account.queue.length + Number(account.running) >= 4) throw new ManualSynthIdError('busy', 'SynthID account queue is full')
    const task = new Promise<SynthIdResult>((resolve, reject) => {
      const job: Job = {
        run: () => { this.checkReady(account); return this.detectQueued(image, mime, auth) },
        resolve, reject,
        detach: () => this.abort.signal.removeEventListener('abort', cancel),
      }
      const cancel = () => {
        const index = account.queue.indexOf(job)
        if (index < 0) return
        account.queue.splice(index, 1)
        // Release retained image bytes and the owning client immediately, without waiting for other clients.
        job.run = undefined
        job.detach()
        reject(new ManualSynthIdError('cancelled', 'SynthID client was disposed'))
        pruneAccount(auth.userId, account)
      }
      this.abort.signal.addEventListener('abort', cancel, { once: true })
      account.queue.push(job)
      drain(auth.userId, account)
    })
    this.active.add(task)
    void task.then(() => this.active.delete(task), () => this.active.delete(task))
    return task
  }

  private checkReady(account: Account): void {
    if (this.abort.signal.aborted) throw new ManualSynthIdError('cancelled', 'SynthID client was disposed')
    if (account.retryAt > Date.now()) {
      throw new ManualSynthIdError('rate-limit', 'SynthID account is cooling down', undefined, Math.ceil((account.retryAt - Date.now()) / 1000))
    }
  }

  private async detectQueued(image: Image, mime: string, auth: Credentials): Promise<SynthIdResult> {
    const tokens = await this.loadTokens(auth)
    await this.refresh(auth, tokens)
    for (let attempt = 0; ; attempt++) {
      const blob = await this.upload(image, mime, auth)
      try {
        const media = [mime, null, null, null, null, null, blob]
        const request = JSON.stringify([null, [[media]], 0])
        const result = await this.post(DETECT, {
          body: new URLSearchParams({ 'f.req': JSON.stringify([[['TZRKo', request, null, 'generic']]]) }),
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
            'X-Same-Domain': '1',
            'X-Goog-Ext-525006476-Jspb': JSON.stringify([tokens.idToken, null, null, null, null, auth.bgToken]),
          },
        }, 'detect')
        return parseSynthIdResponse(result.text)
      } catch (error) {
        if (!(error instanceof SynthIdError) || error.code !== 16 || attempt > 0) throw error
        // Only retry a rejected login once. Re-upload: a blob may already have been consumed.
        await this.refresh(auth, tokens, true)
      }
    }
  }

  private async upload(image: Image, mime: string, auth: Credentials): Promise<string> {
    const headers = {
      Authorization: 'Basic amI5dChNbS0qNjFlczJJVzpyZyRHNUp1QENpV29OJVNS',
      'Push-ID': 'feeds/szvztmw263lqqp',
      'Push-Filename': auth.pushFilename,
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    }
    const start = await this.post(UPLOAD, {
      body: `file_name image.${EXTENSIONS[mime]}`,
      headers: { ...headers, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(image.data.byteLength) },
    }, 'upload')
    let uploadUrl: URL
    try {
      uploadUrl = new URL(start.headers.get('x-goog-upload-url') ?? '')
      if (uploadUrl.origin !== 'https://content-push.googleapis.com' || uploadUrl.username || uploadUrl.password
        || !/^\/upload(?:\/|$)/.test(uploadUrl.pathname)) throw new Error()
    } catch {
      throw new ManualSynthIdError('response', 'SynthID returned an invalid upload URL')
    }
    const uploaded = await this.post(uploadUrl.href, {
      body: image.data,
      headers: { ...headers, 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' },
    }, 'upload')
    const blob = uploaded.text.trim()
    if (uploaded.headers.get('x-goog-upload-status') !== 'final' || blob !== DROPZONE + auth.pushFilename) {
      throw new ManualSynthIdError('response', 'SynthID upload did not finalize at the configured path')
    }
    return blob
  }

  private async post(url: string, init: { body: BodyInit; headers: Record<string, string> }, stage: 'auth' | 'upload' | 'detect'): Promise<{ headers: Headers; text: string }> {
    const timeout = AbortSignal.timeout(this.config.timeout)
    const signal = AbortSignal.any([timeout, this.abort.signal])
    try {
      signal.throwIfAborted()
      const response = await this.ctx.http.fetch(url, {
        ...init, method: 'POST', headers: { ...WEB_HEADERS, ...init.headers }, signal, redirect: 'error',
      })
      if (!response.ok) {
        await response.body?.cancel()
        const status = response.status
        const kind = status === 429 ? 'rate-limit'
          : status === 403 ? 'permission'
          : status === 401 || status === 400 && stage === 'auth' ? 'auth'
          : status >= 500 ? 'server' : 'request'
        throw new ManualSynthIdError(kind, `SynthID ${stage} returned HTTP ${status}`, stage === 'detect' && status === 401 ? 16 : status,
          status === 429 ? retryAfter(response.headers.get('retry-after')) : undefined)
      }
      return { headers: response.headers, text: await response.text() }
    } catch (error) {
      if (error instanceof SynthIdError) throw error
      if (this.abort.signal.aborted) throw new ManualSynthIdError('cancelled', 'SynthID client was disposed')
      const expired = timeout.aborted || (error as Error)?.name === 'TimeoutError' || (error as { code?: string })?.code === 'ETIMEDOUT'
      throw new ManualSynthIdError(expired ? 'timeout' : 'network', `SynthID ${stage} ${expired ? 'timed out' : 'could not connect'}`)
    }
  }

  private async refresh(auth: Credentials, tokens: Tokens, force = false): Promise<void> {
    const current = claims(tokens.idToken)
    if (!force && typeof current.exp === 'number' && current.exp > Date.now() / 1000 + 180
      && (current.user_id ?? current.sub) === auth.userId && (!current.sub || current.sub === auth.userId)) return
    const response = await this.post(TOKEN, {
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, 'auth')
    let value: Record<string, unknown>
    try {
      value = JSON.parse(response.text)
      if (!value || typeof value.id_token !== 'string' || !value.id_token) throw new Error()
    } catch {
      throw new ManualSynthIdError('response', 'SynthID token refresh returned an invalid response')
    }
    const next = claims(value.id_token as string)
    if ((next.user_id ?? next.sub) !== auth.userId || value.user_id && value.user_id !== auth.userId || next.sub && next.sub !== auth.userId) {
      throw new ManualSynthIdError('config', 'SynthID credentials belong to different accounts')
    }
    if (typeof next.exp !== 'number' || !Number.isFinite(next.exp) || next.exp <= Date.now() / 1000) {
      throw new ManualSynthIdError('response', 'SynthID token refresh returned an invalid expiry')
    }
    tokens.idToken = value.id_token as string
    if (typeof value.refresh_token === 'string' && /^[\x21-\x7e]+$/.test(value.refresh_token)) tokens.refreshToken = value.refresh_token
    tokens.updatedAt = Math.max(Date.now(), tokens.updatedAt + 1)
    await this.saveTokens(auth, tokens)
  }

  private async tokenFile(auth: Credentials): Promise<string> {
    if (!this.cachePath) {
      const directory = join(await this.ctx.storage.dir(), 'synthid-manual')
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const key = createHash('sha256').update(auth.userId + '\0' + auth.refreshToken).digest('hex')
      this.cachePath = join(directory, key + '.json')
    }
    return this.cachePath
  }

  private async loadTokens(auth: Credentials): Promise<Tokens> {
    this.tokens ??= { refreshToken: auth.refreshToken, idToken: '', updatedAt: 0 }
    try {
      const stored: unknown = JSON.parse(await readFile(await this.tokenFile(auth), 'utf8'))
      const saved = stored as Partial<Tokens> | null
      if (!saved || typeof saved.refreshToken !== 'string' || !/^[\x21-\x7e]+$/.test(saved.refreshToken) || typeof saved.idToken !== 'string'
        || typeof saved.updatedAt !== 'number' || !Number.isFinite(saved.updatedAt)) throw new Error()
      const current = claims(saved.idToken)
      if ((current.user_id ?? current.sub) !== auth.userId || current.sub && current.sub !== auth.userId) throw new Error()
      // Observe token rotation by another entry using the same credentials. Keep newer in-memory tokens if a write failed.
      if (saved.updatedAt >= this.tokens.updatedAt) this.tokens = saved as Tokens
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') this.logger.warn('cannot load SynthID token cache; using available credentials')
    }
    return this.tokens
  }

  private async saveTokens(auth: Credentials, tokens: Tokens): Promise<void> {
    let temporary: string | undefined
    try {
      const file = await this.tokenFile(auth)
      temporary = file + '.' + randomUUID() + '.tmp'
      await writeFile(temporary, JSON.stringify(tokens), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await rename(temporary, file)
    } catch {
      this.logger.warn('cannot save SynthID token cache; credentials may need updating after a restart')
    } finally {
      if (temporary) await unlink(temporary).catch(() => {})
    }
  }
}
