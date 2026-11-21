import type { Context } from '@luckylillia-dev/plugin-sdk'

/** Downloaded once, for every check */
export interface Image {
  data: ArrayBuffer
  type: string
}

const MAX_SIZE = 20 * 1024 * 1024
// Exact QQ media hosts only. Message senders cannot introduce a domain they
// control, a local address, a different port, or a redirect destination.
const IMAGE_HOSTS = new Set(['gchat.qpic.cn', 'c2cpicdw.qpic.cn', 'multimedia.nt.qq.com.cn'])

function imageUrl(input: string): URL {
  if (typeof input !== 'string' || input.length > 16 * 1024 || /[\x00-\x20\x7f\\]/.test(input)) throw new Error('unsupported image URL')
  let url: URL
  try { url = new URL(input) } catch { throw new Error('unsupported image URL') }
  if (!['http:', 'https:'].includes(url.protocol) || !IMAGE_HOSTS.has(url.hostname)
    || url.port || url.username || url.password) throw new Error('unsupported image URL')
  // Older QQ adapters return http: URLs for the same CDN. Always use TLS.
  url.protocol = 'https:'
  url.hash = ''
  return url
}

function imageType(bytes: Uint8Array): string | undefined {
  const starts = (...signature: number[]) => signature.every((byte, index) => bytes[index] === byte)
  const text = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (['GIF87a', 'GIF89a'].includes(text(0, 6))) return 'image/gif'
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'image/webp'
  if (starts(0x42, 0x4d)) return 'image/bmp'
  if (starts(0x49, 0x49, 0x2a, 0) || starts(0x4d, 0x4d, 0, 0x2a)) return 'image/tiff'
  if (text(4, 8) === 'ftyp' && bytes.length >= 16) {
    const brands = [text(8, 12)]
    for (let offset = 16; offset + 4 <= Math.min(bytes.length, 64); offset += 4) brands.push(text(offset, offset + 4))
    if (brands.some(brand => ['avif', 'avis'].includes(brand))) return 'image/avif'
    if (brands.some(brand => ['heic', 'heix', 'hevc', 'hevx'].includes(brand))) return 'image/heic'
    if (brands.some(brand => ['mif1', 'msf1'].includes(brand))) return 'image/heif'
  }
}

export async function download(ctx: Context, url: string): Promise<Image> {
  const target = imageUrl(url)
  const response = await ctx.http.fetch(target.href, {
    redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30_000),
  }, { timeout: 30_000, proxyAgent: '' })
  const length = response.headers.get('content-length')
  if (!response.ok || response.redirected || length !== null && Number(length) > MAX_SIZE || !response.body) {
    await response.body?.cancel()
    throw new Error('image download was refused or exceeds 20 MB')
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_SIZE) throw new Error('the image is over 20 MB')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally { reader.releaseLock() }
  const data = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength }
  const type = imageType(data)
  if (!type) throw new Error('the response is not a supported image')
  return { data: data.buffer, type }
}
