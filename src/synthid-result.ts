/** Image-only decoding of synthid.com's TZRKo response. Protocol reference: docs/synthid.md. */
export type SynthIdResult =
  | { status: 'detected'; source?: string; confidence?: 'very-high' | 'high' | 'medium' }
  | { status: 'not_detected' }
  | { status: 'uncertain'; reason?: number }
  | { status: 'quota_exceeded'; retryAfterSeconds: number }

export type SynthIdErrorKind = 'config' | 'browser' | 'proxy' | 'terms' | 'auth' | 'permission' | 'verification' | 'rate-limit' | 'busy'
  | 'network' | 'timeout' | 'request' | 'response' | 'server' | 'cancelled'

export type SynthIdNetworkCode = 'ECONNRESET' | 'ECONNREFUSED' | 'ENOTFOUND' | 'EAI_AGAIN' | 'ETIMEDOUT'

/** Messages contain no response bodies, tokens, or upload paths: they are safe to log. */
export class SynthIdError extends Error {
  readonly name = 'SynthIdError'

  constructor(readonly kind: SynthIdErrorKind, message: string, readonly code?: number, readonly retryAfterSeconds?: number, readonly networkCode?: SynthIdNetworkCode) {
    super(message)
  }
}

function invalid(): never {
  throw new SynthIdError('response', 'SynthID returned an unrecognized response')
}

function json(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return invalid()
  }
}

/** Boq counts UTF-8 bytes, including for non-ASCII partner names. A response may contain several frames. */
function* frames(text: string): Generator<unknown> {
  let body = text.trimStart()
  if (body.startsWith(")]}'")) body = body.slice(4).trimStart()
  const bytes = Buffer.from(body, 'utf8')
  let offset = 0
  while (offset < bytes.length) {
    while (offset < bytes.length && [9, 10, 13, 32].includes(bytes[offset])) offset++
    if (offset === bytes.length) break
    // Some responses contain just the JSON array, without a length prefix.
    if (bytes[offset] === 91) {
      const frame = json(bytes.subarray(offset).toString('utf8'))
      if (!Array.isArray(frame)) return invalid()
      yield* frame
      break
    }
    const newline = bytes.indexOf(10, offset)
    if (newline < 0) return invalid()
    const lengthText = bytes.subarray(offset, newline).toString('ascii').trim()
    if (!/^\d+$/.test(lengthText)) return invalid()
    const size = Number(lengthText)
    if (!Number.isSafeInteger(size) || size <= 0) return invalid()
    let frame: unknown[] | undefined
    // Google's current framing counts the newline between the length and JSON.
    // Other responses count from the JSON itself. Accept either exact byte span,
    // requiring a complete array so a truncated frame cannot become a result.
    for (const start of [newline + 1, newline]) {
      if (size > bytes.length - start) continue
      try {
        const candidate: unknown = JSON.parse(bytes.subarray(start, start + size).toString('utf8'))
        if (!Array.isArray(candidate)) continue
        frame = candidate
        offset = start + size
        break
      } catch { /* Try the framing convention that includes the separator. */ }
    }
    if (!frame) return invalid()
    yield* frame
  }
}

/** Recognize only the website's delimited quota status, without retaining its account identifier. */
function quotaWait(message: unknown): number | undefined {
  if (typeof message !== 'string' || message.length > 1024) return undefined
  const match = /^;[A-Za-z][A-Za-z0-9 _-]{0,63} quota exceeded for user [A-Za-z0-9_-]{1,128} and modality (?:image|audio|video)\. Please wait for -?(?:(\d{1,9})h)?(?:(\d{1,9})m)?(?:(\d{1,9}(?:\.\d{1,9})?)s)?;$/i.exec(message)
  if (!match || match[0] !== message || match.slice(1).every(value => value === undefined)) return undefined
  // The website treats a leading minus as the magnitude of the remaining wait.
  const seconds = Math.ceil(Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0))
  return Number.isSafeInteger(seconds) ? seconds : undefined
}

export function parseSynthIdResponse(text: string): SynthIdResult {
  // The terminal telemetry frame can omit its counted trailing newline. Stop
  // after our complete RPC frame so a footer cannot mask a real auth result.
  let frame: unknown[] | undefined
  for (const value of frames(text)) {
    if (Array.isArray(value) && value[0] === 'wrb.fr' && value[1] === 'TZRKo') { frame = value; break }
  }
  if (!frame) return invalid()
  if (frame[2] === null) {
    const status = Array.isArray(frame[5]) ? frame[5] : undefined
    const code = typeof status?.[0] === 'number' ? status[0] : undefined
    const retryAfterSeconds = code === 7 || code === 8 ? quotaWait(status?.[1]) : undefined
    const kind: SynthIdErrorKind = retryAfterSeconds !== undefined ? 'rate-limit'
      : code === 16 ? 'auth' : code === 7 ? 'permission'
      : code === 8 ? 'rate-limit' : code === 3 ? 'request' : code === 13 ? 'server' : 'response'
    throw new SynthIdError(kind, `SynthID RPC failed (${code ?? 'unknown'})`, code, retryAfterSeconds)
  }
  if (typeof frame[2] !== 'string') return invalid()
  const payload = json(frame[2])
  if (!Array.isArray(payload)) return invalid()
  if (Array.isArray(payload[6]) && payload[6].length) {
    const quota = payload[6][0]
    if (!Array.isArray(quota)) return invalid()
    const duration = quota[3]
    const seconds = Array.isArray(duration) ? Number(duration[0] ?? 0) + Number(duration[1] ?? 0) / 1e9 : 0
    if (!Number.isFinite(seconds) || seconds < 0) return invalid()
    return { status: 'quota_exceeded', retryAfterSeconds: Math.ceil(seconds) }
  }
  const entry = Array.isArray(payload[4]) ? payload[4][0] : undefined
  if (!Array.isArray(entry)) return invalid()
  switch (entry[0]) {
    case 3: {
      // Missing or new provider codes must not silently become Google.
      const source = entry[10] === 1 ? 'google'
        : entry[10] === 2 && typeof entry[11] === 'string' ? entry[11].trim().replace(/\s+/g, ' ').slice(0, 80) || undefined
        : undefined
      const confidence = entry[12] === 6 ? 'very-high' : entry[12] === 5 ? 'high' : entry[12] === 4 ? 'medium' : undefined
      // Field 4 is a false-positive metric, not the probability that the whole image is AI-made.
      return { status: 'detected', source, confidence }
    }
    case 2: return { status: 'not_detected' }
    case 1: return { status: 'uncertain', reason: typeof entry[9] === 'number' ? entry[9] : undefined }
    default: return invalid()
  }
}

export function formatSynthId(result: Exclude<SynthIdResult, { status: 'quota_exceeded' }>): string {
  if (result.status === 'not_detected') return '未检出支持的 AI 水印，不能据此确认是人工图片。'
  if (result.status === 'uncertain') {
    const reasons: Record<number, string> = {
      1: '图片为空',
      2: '图片分辨率过低',
      3: '图片细节不足',
      5: '图片质量过低',
      6: '图片可能经过修改，或只在局部使用了 AI',
    }
    return `SynthID 无法判断：${reasons[result.reason ?? 0] ?? '没有足够的信息'}。`
  }
  const sources: Record<string, string> = { google: 'Google', openai: 'OpenAI', nvidia: 'NVIDIA', kakao: 'Kakao' }
  const source = result.source && (Object.hasOwn(sources, result.source.toLowerCase()) ? sources[result.source.toLowerCase()] : result.source)
  const levels = { 'very-high': '很高', high: '高', medium: '中等' }
  return `SynthID 检出${source ? `来自 ${source} 的` : ''} AI 生成标记。`
    + (result.confidence ? `水印置信度：${levels[result.confidence]}。` : '')
}

export function describeSynthIdFailure(error: SynthIdError): string {
  switch (error.kind) {
    case 'config':
    case 'browser': return 'SynthID 浏览器无法启动，请确认运行 Bot 的电脑已安装 Chrome 或 Edge，并且能打开桌面窗口。'
    case 'proxy': return 'SynthID 浏览器无法使用当前代理，请检查「代理」插件的地址与账号密码；浏览器不支持带账号密码的 SOCKS5 代理。'
    case 'terms': return '请在插件设置中点击「登录 SynthID」，完成登录窗口中的首次使用提示。'
    case 'auth': return 'SynthID 尚未登录或登录已失效，请在插件设置中点击「登录 SynthID」。'
    case 'permission': return 'SynthID 服务拒绝了本次检测请求。'
    case 'verification': return 'SynthID 本次请求未通过网页校验，请稍后再试。'
    case 'rate-limit': return error.retryAfterSeconds
      ? `SynthID 检测额度暂时用完，请约 ${error.retryAfterSeconds} 秒后再试。`
      : 'SynthID 检测过于频繁或额度暂时用完，请稍后再试。'
    case 'busy': return 'SynthID 检测队列已满，请稍后再试。'
    case 'network': {
      const reasons: Record<SynthIdNetworkCode, string> = {
        ECONNRESET: '连接被重置（ECONNRESET）', ECONNREFUSED: '连接被拒绝（ECONNREFUSED）',
        ENOTFOUND: '域名解析失败（ENOTFOUND）', EAI_AGAIN: '域名解析暂时失败（EAI_AGAIN）', ETIMEDOUT: '连接超时（ETIMEDOUT）',
      }
      return error.networkCode && reasons[error.networkCode]
        ? `登录页加载失败：${reasons[error.networkCode]}。请在 Bot「代理」插件中测试 https://synthid.com/，确认该网站能通过当前代理访问后重试。`
        : '连不上 SynthID 检测服务，请检查网络或代理设置。'
    }
    case 'timeout': return '连不上 SynthID 检测服务，请检查网络或代理设置。'
    case 'request': return 'SynthID 无法处理这张图片，请尝试发送原图。'
    case 'response': return 'SynthID 返回了无法识别的结果，检测接口可能已变更。'
    case 'cancelled': return 'SynthID 检测已取消。'
    default: return 'SynthID 检测失败，请稍后再试。'
  }
}
