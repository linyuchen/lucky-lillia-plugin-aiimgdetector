import { Context, h, Schema, Session } from '@luckylillia/plugin-sdk'
import type { AiError } from 'lucky-lillia-aiprovider'
import { download, Image } from './image.js'
import { checkProvenance, provenanceService } from './provenance.js'
import { SynthIdClient, handleSynthId, type SynthIdConfig } from './synthid.js'
import { describeSynthIdFailure, formatSynthId, SynthIdError } from './synthid-result.js'
import { describeManualSynthIdFailure, ManualSynthIdError } from './synthid-manual.js'
import { judgeByVision, VisionResult } from './vision.js'

export const name = 'aiimgdetector'
export const inject = ['bots', 'ai', 'http', 'commands']

export interface Config {
  trigger: string
  cooldown: number
  provenance: false | { ai: string }
  synthid: false | SynthIdConfig
  vision: false | { ai: string; model: string }
}

export const Config: Schema<Config> = Schema.object({
  trigger: Schema.string().pattern(/^\s*\S*\s*$/).default('ai吗').description('触发词，不分大小写：对着图片回复它，或者它后面直接带图'),
  cooldown: Schema.natural().role('ms').default(10_000).description('同一个群（或私聊）两次检测至少隔多久'),
  provenance: Schema.union([
    Schema.const(false),
    Schema.object({
      ai: Schema.string().role('ai').extra('extra', {
        provider: 'openai',
        emptyHint: 'OpenAI 水印检测免费，但有调用频率限制；请求过于频繁时请稍后再试。',
      }).default('').description('服务'),
    }),
  ]).default({ ai: '' }).description('ChatGPT 图片检测，OpenAI 官方 API'),
  synthid: Schema.union([
    Schema.const(false).description('不用'),
    Schema.object({
      // Mask credentials from the previous version if an old saved config still contains them.
      // They are ignored by the browser login and are never displayed as form fields.
      refreshToken: Schema.string().role('secret').hidden(),
      bgToken: Schema.string().role('secret').hidden(),
      pushFilename: Schema.string().role('secret').hidden(),
      timeout: Schema.natural().min(1000).max(120_000).role('ms').default(30_000).description('检测超时'),
      credentials: Schema.union([
        Schema.object({
          refreshToken: Schema.string().role('secret').default('').description('登录凭据（refresh_token）'),
          pushFilename: Schema.string().role('secret').default('').description('上传标识（push_filename）：复制网站请求中的值，不是本机文件夹'),
          bgToken: Schema.string().role('secret').default('').description('网页校验凭据：可粘贴 x-goog-ext-525006476-jspb 请求头的完整 JSON 数组'),
        }),
        // Migrate the previous browser/manual switch without losing saved secrets.
        Schema.transform(Schema.const(false).hidden(), () => ({ refreshToken: '', pushFilename: '', bgToken: '' })),
      ]).default({ refreshToken: '', pushFilename: '', bgToken: '' }).description('登录凭证'),
    }).description('用'),
  ]).default(false).description('SynthID 检测, 支持检测 图片、视频、音频'),
  vision: Schema.union([
    Schema.const(false).description('不用'),
    Schema.object({
      ai: Schema.string().default('').description('服务'),
      model: Schema.string().default('').description('模型：请选择支持图片输入的模型'),
    }).role('ai-model').description('用'),
  ]).default({ ai: '', model: '' }).description('多模态模型判断：让能看图的 AI 从画面里找 AI 生成的破绽。只是推测，按图片计费'),
})

interface Picked {
  url: string
  /** The message the image is in, which the answer quotes */
  messageId?: string
}

const VERDICT_TEXT: Record<VisionResult['verdict'], string> = {
  ai: '疑似 AI 生成',
  real: '更像人工创作',
  unsure: '看不出来',
}

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('aiimgdetector')
  const trigger = config.trigger.trim()
  const lastCheck = new Map<string, number>()
  // Login is available before enabling detection; saving a config must not lose the browser session.
  const synthid = new SynthIdClient(ctx, config.synthid || { timeout: 30_000 })
  ctx.inject(['webuiServer'], (ctx) => {
    ctx.webuiServer.route('/api/aiimgdetector/synthid', { fetch: request => handleSynthId(synthid, request) })
  })
  let active = true
  ctx.effect(() => () => { active = false })
  ctx.on('internal/update', (next: Config, restart) => {
    if (next.trigger.trim() !== trigger) return restart()
    synthid.update(next.synthid || { timeout: 30_000 })
    config = next
  })

  function cooling(key: string): boolean {
    if (!config.cooldown) return false
    const now = Date.now()
    const last = lastCheck.get(key)
    if (last !== undefined && now - last < config.cooldown) return true
    lastCheck.set(key, now)
    for (const [other, at] of lastCheck) if (now - at >= config.cooldown) lastCheck.delete(other)
    return false
  }

  async function verdict(image: Image): Promise<string> {
    // Whether a check ran to the end without finding anything, and what failed on the way
    let checked = false
    let failure: unknown
    let inconclusive: string | undefined
    const watermarkAi = config.provenance
      ? provenanceService(ctx.ai, config.provenance.ai) : undefined
    if (watermarkAi) {
      try {
        const answer = await checkProvenance(ctx.ai, watermarkAi, image)
        if (answer.results?.some(result => result.outcome === 'detected')) return '图片由 OpenAI 制作。'
        checked = true
      } catch (e) {
        failure = e
        logger.warn('watermark check failed:', (e as Error).message)
      }
    }
    if (config.synthid && active) {
      try {
        const result = await synthid.detect(image)
        if (result.status === 'detected') return formatSynthId(result)
        if (result.status === 'not_detected') checked = true
        else if (result.status === 'uncertain') inconclusive = formatSynthId(result)
        else if (result.status === 'quota_exceeded') {
          failure ??= new SynthIdError('rate-limit', 'SynthID account quota exceeded', undefined, result.retryAfterSeconds)
        }
      } catch (e) {
        failure ??= e
        if (active) logger.warn('SynthID check failed:', (e as Error).message)
      }
    }
    if (config.vision && active) {
      try {
        const result = await judgeByVision(ctx.ai, config.vision, image)
        if (result) return formatVision(result)
        inconclusive ??= '看图模型没有返回检测结果，暂时无法判断。'
      } catch (e) {
        failure ??= e
        logger.warn('vision check failed:', (e as Error).message)
      }
    }
    if (failure) return describeFailure(failure)
    if (inconclusive) return inconclusive
    if (checked) return formatSynthId({ status: 'not_detected' })
    if (config.provenance) return config.provenance.ai
      ? '所选服务无法用于水印检测，请重新选择 OpenAI 官方服务，或打开看图判断。'
      : '没有可用于水印检测的 OpenAI 官方服务，请在 AI 服务中添加，或打开看图判断。'
    return '还没有打开任何检测，请在 aiimgdetector 插件的设置里打开。'
  }

  if (!trigger) return
  ctx.command(trigger, '检测图片是否由 AI 生成').action(async ({ session, next }) => {
    const picked = pickImage(session)
    // A message starting with the word is not always meant for this plugin
    if (!picked) return next()
    if (cooling(`${session.platform}:${session.channelId}`)) return next()
    // Quote the message the image is in: with several images in a busy group, that says which one it was about
    const reply = (text: string) => session.send(picked.messageId ? [h('quote', { id: picked.messageId }), h.text(text)] : h.text(text))
    let image: Image
    try {
      image = await download(ctx, picked.url)
    } catch (e) {
      logger.warn('cannot download the image:', (e as Error).message)
      await reply('图片下载失败，请稍后再试。')
      return
    }
    if (!active) return
    const answer = await verdict(image)
    if (active) await reply(answer)
  })
}

/** An image of the message itself first, then one of the message it quotes */
function pickImage(session: Session): Picked | undefined {
  const own = h.select(session.elements.filter(element => element.type !== 'quote'), 'img')[0]
  if (own) return { url: String(own.attrs.src ?? own.attrs.url), messageId: session.messageId }
  const quote = session.elements.find(element => element.type === 'quote')
  const quoted = quote && h.select(quote.children, 'img')[0]
  if (quoted) return { url: String(quoted.attrs.src ?? quoted.attrs.url), messageId: quote.attrs.id || session.messageId }
}

function formatVision(result: VisionResult): string {
  if (result.raw) return `${result.model} 判断：${result.raw}`
  const head = result.confidence ? `${VERDICT_TEXT[result.verdict]}（置信度 ${result.confidence}%）` : VERDICT_TEXT[result.verdict]
  return [`${result.model} 判断：${head}`, ...result.reasons.map(reason => `- ${reason}`)].join('\n')
}

/** What group members can act on; the details go to the log */
function describeFailure(error: unknown): string {
  if (error instanceof ManualSynthIdError) return describeManualSynthIdFailure(error)
  if (error instanceof SynthIdError) return describeSynthIdFailure(error)
  switch ((error as Partial<AiError>)?.kind) {
    case 'rate-limit': return '检测请求过于频繁，请稍后再试。'
    case 'quota': return 'AI 服务的余额或额度用完了。'
    case 'auth': return 'API Key 无效或没有权限。'
    case 'network':
    case 'timeout': return '连不上检测服务，请检查网络或代理设置。'
    case 'config': return 'AI 服务或模型尚未配置好。'
    default: return '检测失败，请稍后再试。'
  }
}
