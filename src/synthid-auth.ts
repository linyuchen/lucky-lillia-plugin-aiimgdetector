import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@luckylillia/plugin-sdk'
import { SynthIdError } from './synthid-result.js'

export interface SynthIdTokens { refreshToken: string; idToken: string; userId: string }
const locks = new Map<string, Promise<void>>()
export function tokenClaims(token: string): Record<string, unknown> {
  try {
    const value = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}
const validSecret = (value: unknown): value is string => typeof value === 'string' && /^[\x21-\x7e]+$/.test(value)
function waitForLock(lock: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return lock
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    void lock.then(() => { signal.removeEventListener('abort', abort); resolve() }, reject)
  })
}

/** Trust account identity only after the HTTPS refresh endpoint responds.
 * Persist rotated refresh tokens atomically; a disk JWT is never authority. */
export class SynthIdTokenStore {
  private tokens?: SynthIdTokens
  private file?: string
  private updatedAt = 0
  constructor(private readonly ctx: Context, private readonly initial: string) {}

  async get(refresh: (token: string) => Promise<Record<string, unknown>>, force = false, signal?: AbortSignal): Promise<SynthIdTokens> {
    signal?.throwIfAborted()
    if (!force && this.tokens && Number(tokenClaims(this.tokens.idToken).exp) > Date.now() / 1000 + 180) return { ...this.tokens }
    const directory = join(await this.ctx.storage.dir(), 'synthid-http')
    const file = this.file ??= join(directory, createHash('sha256').update(this.initial).digest('hex') + '.json')
    const previous = locks.get(file) ?? Promise.resolve()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const tail = previous.then(() => gate)
    locks.set(file, tail)
    try {
      await waitForLock(previous, signal)
      signal?.throwIfAborted()
      if (!force && this.tokens && Number(tokenClaims(this.tokens.idToken).exp) > Date.now() / 1000 + 180) return { ...this.tokens }
      let refreshToken = this.tokens?.refreshToken ?? this.initial
      try {
        const saved = JSON.parse(await readFile(file, 'utf8'))
        if (validSecret(saved?.refreshToken) && (!this.tokens || saved.updatedAt >= this.updatedAt)) refreshToken = saved.refreshToken
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') this.ctx.logger('aiimgdetector').warn('Could not load SynthID login cache')
      }
      const value = await refresh(refreshToken)
      if (!validSecret(value.id_token)) throw new SynthIdError('response', 'SynthID token refresh returned an invalid token')
      const claims = tokenClaims(value.id_token)
      const userId = claims.user_id ?? claims.sub
      if (typeof userId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(userId)
        || claims.sub !== undefined && claims.sub !== userId || claims.user_id !== undefined && claims.user_id !== userId
        || value.user_id !== undefined && value.user_id !== userId || this.tokens && this.tokens.userId !== userId) {
        throw new SynthIdError('auth', 'SynthID token refresh returned inconsistent account information')
      }
      if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000) {
        throw new SynthIdError('response', 'SynthID token refresh returned an invalid expiry')
      }
      this.tokens = { userId, idToken: value.id_token, refreshToken: validSecret(value.refresh_token) ? value.refresh_token : refreshToken }
      this.updatedAt = Math.max(Date.now(), this.updatedAt + 1)
      const temporary = file + '.' + randomUUID() + '.tmp'
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 })
        // Only the rotating secret is needed after a restart.
        await writeFile(temporary, JSON.stringify({ refreshToken: this.tokens.refreshToken, updatedAt: this.updatedAt }), { mode: 0o600, flag: 'wx' })
        await rename(temporary, file)
      } catch { this.ctx.logger('aiimgdetector').warn('Could not save SynthID login cache; login may need renewing after restart') }
      finally { await unlink(temporary).catch(() => {}) }
      return { ...this.tokens }
    } finally {
      release()
      void tail.then(() => { if (locks.get(file) === tail) locks.delete(file) })
    }
  }
}
