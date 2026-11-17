import { CookieJar } from 'tough-cookie'

const ORIGIN = 'https://synthid.com'
export function attachWebXsrf(body, config) {
  const form = new URLSearchParams(body)
  if (typeof config.SNlM0e === 'string' && config.SNlM0e) form.set('at', config.SNlM0e)
  return form
}
export function readWebConfig(html) {
  const assignment = /(?:window\.)?WIZ_global_data\s*=\s*\{/.exec(html)
  if (!assignment) throw new Error('Missing web config')
  const start = assignment.index + assignment[0].length - 1
  let quoted = false, escaped = false, depth = 0
  for (let index = start; index < html.length; index++) {
    const character = html[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
    } else if (character === '"') quoted = true
    else if (character === '{') depth++
    else if (character === '}' && --depth === 0) {
      const data = JSON.parse(html.slice(start, index + 1))
      return Object.fromEntries(['FdrFJe', 'cfb2h', 'SNlM0e', 'eptZe', 'hl', 'QrtxK', 'DpimGf', 'TSDtV'].filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]))
    }
  }
  throw new Error('Incomplete web config')
}

export async function createWebSession(http, userAgent) {
  const cookies = new CookieJar()
  const request = async (url, init = {}) => {
    if (new URL(url).origin !== ORIGIN) throw new Error('Web session origin mismatch')
    const headers = new Headers(init.headers)
    headers.set('user-agent', userAgent)
    const cookie = await cookies.getCookieString(url)
    if (cookie) headers.set('cookie', cookie)
    const response = await http.fetch(url, { ...init, headers, redirect: 'error' })
    for (const cookie of response.headers.getSetCookie()) await cookies.setCookie(cookie, url)
    return response
  }
  const response = await request(ORIGIN + '/image-detection', { signal: AbortSignal.timeout(30000) })
  if (!response.ok) { await response.body?.cancel(); throw new Error('Page fetch failed') }
  const html = await response.text()
  if (html.length > 4 * 1024 * 1024) throw new Error('Oversize page')
  const config = readWebConfig(html)
  return {
    config, request,
    summary: {
      httpStatus: response.status,
      htmlBytes: Buffer.byteLength(html),
      cachedBuildMarkerPresent: html.includes('Bz_3Tem3Q0o'),
      publicBundlePaths: [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].flatMap(match => {
        try {
          const url = new URL(match[1].replaceAll('&amp;', '&'), ORIGIN)
          return url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/_/mss/boq-deepmind-visualization/') && !url.search ? [url.pathname] : []
        } catch { return [] }
      }),
      fieldTypes: Object.fromEntries(Object.entries(config).map(([key, value]) => [key, typeof value])),
      fieldNonempty: Object.fromEntries(Object.entries(config).map(([key, value]) => [key, typeof value === 'string' && value.length > 0])),
      cookieNames: (await cookies.getCookies(ORIGIN + '/image-detection')).map(cookie => cookie.key),
    },
  }
}
