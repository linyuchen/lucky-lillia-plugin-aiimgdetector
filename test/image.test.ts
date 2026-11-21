import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestApp, type TestApp } from '@luckylillia/plugin-sdk/testing'
import { download } from '../src/image.js'
import { PNG } from './fakeAi.js'

let app: TestApp
beforeEach(async () => { app = await createTestApp() })
afterEach(async () => { await app.dispose(); vi.restoreAllMocks() })

describe('message image download boundary', () => {
  it.each([
    'http://127.0.0.1/private', 'https://[::1]/', 'http://2130706433/', 'http://0x7f000001/',
    'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/', 'http://192.168.1.1/',
    'http://localhost/', 'https://sender-controlled.example/image.png',
    'https://gchat.qpic.cn.attacker.example/', 'https://gchat.qpic.cn@127.0.0.1/',
    'https://user:password@gchat.qpic.cn/image.png', 'https://gchat.qpic.cn:8443/image.png',
    'file:///C:/secret.png', 'data:image/png;base64,c2VjcmV0', 'ftp://gchat.qpic.cn/image.png',
    '//gchat.qpic.cn/image.png', 'https://gchat.qpic.cn./image.png',
  ])('refuses %s before making any request', async url => {
    const fetch = vi.spyOn(app.ctx.http, 'fetch').mockRejectedValue(Error('must not connect'))
    await expect(download(app.ctx, url)).rejects.toThrow('unsupported image URL')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('upgrades QQ CDN URLs to HTTPS and preserves signed queries without allowing redirects', async () => {
    const fetch = vi.spyOn(app.ctx.http, 'fetch').mockResolvedValue(new Response(Uint8Array.from(PNG), {
      headers: { 'content-type': 'application/octet-stream' },
    }))
    const result = await download(app.ctx, 'http://gchat.qpic.cn/image.png?key=signed%2Bvalue#ignored')
    expect(result).toEqual({ data: Uint8Array.from(PNG).buffer, type: 'image/png' })
    expect(fetch).toHaveBeenCalledWith('https://gchat.qpic.cn/image.png?key=signed%2Bvalue',
      expect.objectContaining({ redirect: 'error', credentials: 'omit', signal: expect.any(AbortSignal) }),
      expect.objectContaining({ proxyAgent: '' }))
  })

  it.each([301, 302, 307, 308])('does not follow a %s response pointing at an internal address', async status => {
    const fetch = vi.spyOn(app.ctx.http, 'fetch').mockResolvedValue(new Response(null, {
      status, headers: { location: 'http://127.0.0.1/private' },
    }))
    await expect(download(app.ctx, 'https://gchat.qpic.cn/image.png')).rejects.toThrow()
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0][1]?.redirect).toBe('error')
  })

  it('rejects non-image response bytes even when the server calls them an image', async () => {
    vi.spyOn(app.ctx.http, 'fetch').mockResolvedValue(new Response('PRIVATE-NON-IMAGE-RESPONSE', {
      headers: { 'content-type': 'image/png' },
    }))
    await expect(download(app.ctx, 'https://gchat.qpic.cn/image.png')).rejects.toThrow('not a supported image')
  })

  it('cancels oversized bodies before reading them when Content-Length is known', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({ cancel })
    vi.spyOn(app.ctx.http, 'fetch').mockResolvedValue(new Response(body, {
      headers: { 'content-length': String(20 * 1024 * 1024 + 1) },
    }))
    await expect(download(app.ctx, 'https://gchat.qpic.cn/image.png')).rejects.toThrow('20 MB')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('enforces the limit while streaming even when Content-Length is absent', async () => {
    const cancel = vi.fn(), chunk = new Uint8Array(1024 * 1024)
    const body = new ReadableStream({ pull(controller) { controller.enqueue(chunk) }, cancel })
    vi.spyOn(app.ctx.http, 'fetch').mockResolvedValue(new Response(body))
    await expect(download(app.ctx, 'https://gchat.qpic.cn/image.png')).rejects.toThrow('20 MB')
    expect(cancel).toHaveBeenCalledOnce()
  })
})
