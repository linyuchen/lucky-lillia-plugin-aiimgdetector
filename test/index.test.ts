import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createTestApp, type TestApp } from '@luckylillia/plugin-sdk/testing'
import * as Provider from '@luckylillia/plugin-aiprovider'
import * as AiImgDetector from '../src/index.js'
import { completion, FakeAnswer, FakeCall, PNG, startFakeAi } from './fakeAi.js'
import { SynthIdClient } from '../src/synthid.js'
import { SynthIdError } from '../src/synthid-result.js'
import { ManualSynthIdError } from '../src/synthid-manual.js'

let app: TestApp
let fake: Awaited<ReturnType<typeof startFakeAi>>
let provenance: FakeAnswer
let vision: FakeAnswer
let synthid: MockInstance<SynthIdClient['detect']>

const verdict = (value: unknown) => completion(JSON.stringify(value), 'vision-model-2026')

function route(call: FakeCall): FakeAnswer | undefined {
  // QQ sends some images as octet-stream: the plugin reads the type from the bytes
  if (call.path === '/img.png') return { body: PNG, type: 'application/octet-stream' }
  if (call.path === '/openai/v1/content_provenance_checks') return provenance
  if (call.path === '/vision/v1/chat/completions') return vision
}

async function setup(config: Partial<AiImgDetector.Config> = {}, defaultAi = 'Vision', official = true, extraAis: Partial<Provider.AiConfig>[] = [], emptyServices = false) {
  // Keep the real endpoint metadata, but route every official API request to the local fake.
  const fetch = app.ctx.http.fetch.bind(app.ctx.http)
  vi.spyOn(app.ctx.http, 'fetch').mockImplementation((url, init, options) => {
    const local = typeof url === 'string' && url.startsWith('https://api.openai.com/v1/')
      ? fake.url + '/openai/v1/' + url.slice('https://api.openai.com/v1/'.length) : url
    if (!String(local).startsWith(fake.url + '/')) throw new Error('unexpected external request in test')
    return fetch(local, init, options)
  })
  await app.ctx.plugin(Provider, {
    ais: emptyServices ? [] : [
      { name: 'OpenAI', baseUrl: official ? 'https://api.openai.com/v1' : `${fake.url}/openai/v1`, apiKey: 'sk-openai', models: ['gpt-4o'] },
      { name: 'Vision', baseUrl: `${fake.url}/vision/v1`, apiKey: 'sk-vision', models: ['vision-model', 'vision-large'] },
      ...extraAis,
    ],
    default: defaultAi,
  })
  await vi.waitFor(() => expect(app.ctx.get('ai')).toBeTruthy())
  return app.ctx.plugin(AiImgDetector, { cooldown: 0, vision: { ai: '', model: '' }, ...config })
}

const image = () => `<img src="${fake.url}/img.png"/>`

beforeEach(async () => {
  provenance = { json: { object: 'content_provenance_check', created_at: 1, results: [{ type: 'synthid', outcome: 'not_detected' }] } }
  vision = { json: verdict({ verdict: 'ai', confidence: 85, reasons: ['左手有六根手指', '招牌文字无法辨认'] }) }
  synthid = vi.spyOn(SynthIdClient.prototype, 'detect').mockResolvedValue({ status: 'detected', source: 'google', confidence: 'high' })
  fake = await startFakeAi(route)
  app = await createTestApp()
})

afterEach(async () => {
  await app.dispose()
  await fake.close()
  vi.restoreAllMocks()
})

describe('aiimgdetector', () => {
  it('migrates the old credential switch and retains saved values in the shared credential form', () => {
    const blank = { refreshToken: '', pushFilename: '', bgToken: '' }
    expect(AiImgDetector.Config({ synthid: { credentials: false } }).synthid).toMatchObject({ credentials: blank })
    expect(AiImgDetector.Config({ synthid: {} }).synthid).toMatchObject({ credentials: blank })
    const credentials = { refreshToken: 'fixture', pushFilename: 'users/test/files/1', bgToken: '!fixture' }
    expect(AiImgDetector.Config({ synthid: { credentials } }).synthid).toMatchObject({ credentials })
  })

  it('validates a custom trigger as a command name before registering it', async () => {
    expect(() => AiImgDetector.Config({ trigger: '检测 AI' })).toThrow()
    expect(() => AiImgDetector.Config({ trigger: 'ai吗 [text:text]' })).toThrow()
    await setup({ trigger: '  AI吗  ' })
    expect(app.ctx.commands.list().map(command => command.name)).toEqual(['AI吗'])
    expect(await app.bot().receive('/ai吗' + image())).toHaveLength(1)
  })

  it('keeps an empty trigger disabled', async () => {
    await setup({ trigger: '  ' })
    expect(app.ctx.commands.list()).toEqual([])
    expect(await app.bot().receive('/ai吗' + image())).toEqual([])
    expect(fake.calls).toEqual([])
  })

  it.each(['ai吗', '/ai吗', '/AI吗'])('detects an image directly after the registered command %s', async command => {
    provenance = { json: { results: [{ type: 'c2pa', outcome: 'detected' }] } }
    await setup()
    expect(app.ctx.commands.list()).toContainEqual(expect.objectContaining({ name: 'ai吗', description: '检测图片是否由 AI 生成' }))
    expect(await app.bot().receive(command + image())).toEqual(['<quote id="message-1"/>图片由 OpenAI 制作。'])
    expect(fake.calls.filter(call => call.path.endsWith('/content_provenance_checks'))).toHaveLength(1)
  })

  it('follows shared prefix settings and changes to bare commands with a custom name', async () => {
    app.commands.prefixes = ['!']
    app.commands.bare = false
    await setup({ trigger: '查图' })
    const bot = app.bot()
    for (const command of ['查图', '/查图', 'ai吗', '!ai吗']) expect(await bot.receive(command + image())).toEqual([])
    expect(fake.calls).toEqual([])
    expect(await bot.receive('!查图' + image())).toHaveLength(1)
    app.commands.bare = true
    expect(await bot.receive('查图' + image())).toHaveLength(1)
    expect(app.ctx.commands.list().map(command => command.name)).toEqual(['查图'])
  })

  it('unregisters the command when the plugin is unloaded', async () => {
    const fiber = await setup()
    expect(app.ctx.commands.list().map(command => command.name)).toEqual(['ai吗'])
    await fiber.dispose()
    expect(app.ctx.commands.list()).toEqual([])
    expect(await app.bot().receive('/ai吗' + image())).toEqual([])
  })

  it('ignores commands addressed to someone else and text continuing the command name', async () => {
    await setup()
    const bot = app.bot()
    for (const command of ['<at id="someone"/> /ai吗', '/ai吗呀', 'ai吗呀']) {
      expect(await bot.receive(command + image())).toEqual([])
    }
    expect(fake.calls).toEqual([])
  })

  it('defaults to automatic selection, preserves old selections and keeps an explicit false disabled', () => {
    expect(AiImgDetector.Config({}).provenance).toEqual({ ai: '' })
    expect(AiImgDetector.Config({ provenance: { ai: 'Old service' } }).provenance).toEqual({ ai: 'Old service' })
    expect(AiImgDetector.Config({ provenance: false }).provenance).toBe(false)
    expect(AiImgDetector.Config({}).synthid).toBe(false)
  })

  it.each(['OpenAI', 'Vision'])('matches the selector fallback independently of the vision service (default: %s)', async defaultAi => {
    provenance = { json: { results: [{ type: 'c2pa', outcome: 'detected' }] } }
    await setup({ vision: { ai: 'Second', model: 'unused' } }, defaultAi, true, [
      { name: 'Second', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-second', models: [] },
    ])
    await app.bot().receive('ai吗' + image())
    expect(fake.calls.find(call => call.path.endsWith('/content_provenance_checks'))?.headers.authorization).toBe('Bearer sk-openai')
  })

  it('uses the default official service when the selected vision service is not official', async () => {
    provenance = { json: { results: [{ type: 'c2pa', outcome: 'detected' }] } }
    await setup({ vision: { ai: 'Vision', model: 'vision-model' } }, 'Second', true, [
      { name: 'Second', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-second', models: [] },
    ])
    await app.bot().receive('ai吗' + image())
    expect(fake.calls.find(call => call.path.endsWith('/content_provenance_checks'))?.headers.authorization).toBe('Bearer sk-second')
  })

  it('skips watermark checks on an unofficial endpoint even if its name is OpenAI', async () => {
    await setup({}, 'Vision', false)
    expect(await app.bot().receive('ai吗' + image())).toEqual([expect.stringContaining('vision-model-2026 判断')])
    expect(fake.calls.some(call => call.path.endsWith('/content_provenance_checks'))).toBe(false)
  })

  it('explains a missing official service when vision checks are off, without claiming the image is unmarked', async () => {
    await setup({ vision: false }, 'Vision', false)
    expect(await app.bot().receive('ai吗' + image())).toEqual([expect.stringContaining('没有可用于水印检测的 OpenAI 官方服务')])
    expect(fake.calls.some(call => call.path.endsWith('/content_provenance_checks'))).toBe(false)
  })

  it('honors the watermark switch even with an official service configured', async () => {
    await setup({ provenance: false })
    await app.bot().receive('ai吗' + image())
    expect(fake.calls.some(call => call.path.endsWith('/content_provenance_checks'))).toBe(false)
  })

  it('honors an explicit official selection rather than the default', async () => {
    provenance = { json: { results: [{ type: 'c2pa', outcome: 'detected' }] } }
    await setup({ provenance: { ai: 'Second' } }, 'OpenAI', true, [
      { name: 'Second', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-second', models: [] },
    ])
    await app.bot().receive('ai吗' + image())
    expect(fake.calls.find(call => call.path.endsWith('/content_provenance_checks'))?.headers.authorization).toBe('Bearer sk-second')
  })

  it.each(['Vision', 'removed'])('never sends a watermark request to an incompatible or removed selection: %s', async ai => {
    await setup({ provenance: { ai }, vision: false })
    expect(await app.bot().receive('ai吗' + image())).toEqual([expect.stringContaining('所选服务无法用于水印检测')])
    expect(fake.calls.some(call => call.path.endsWith('/content_provenance_checks'))).toBe(false)
  })

  it('reports what OpenAI\'s watermark check finds, quoting the image', async () => {
    provenance = { json: { object: 'content_provenance_check', created_at: 1, results: [{ type: 'c2pa', outcome: 'detected' }] } }
    await setup()
    const bot = app.bot()
    expect(await bot.receive(`ai吗${image()}`, { guildId: 'G1' })).toEqual(['<quote id="message-1"/>图片由 OpenAI 制作。'])
    const check = fake.calls.find(call => call.path === '/openai/v1/content_provenance_checks')!
    expect(check.headers.authorization).toBe('Bearer sk-openai')
    expect(check.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(check.raw.includes(PNG)).toBe(true)
    // A certain answer: no guessing after it
    expect(fake.calls.some(call => call.path.startsWith('/vision'))).toBe(false)
  })

  it('asks the vision model about what carries no watermark, on the quoted message\'s image', async () => {
    await setup()
    const answer = await app.bot().receive(`<quote id="q-9">${image()}</quote><at id="bot"/> /AI吗`, { guildId: 'G1' })
    expect(answer).toEqual(['<quote id="q-9"/>vision-model-2026 判断：疑似 AI 生成（置信度 85%）\n- 左手有六根手指\n- 招牌文字无法辨认'])
    const ask = fake.calls.find(call => call.path === '/vision/v1/chat/completions')!
    expect(ask.headers.authorization).toBe('Bearer sk-vision')
    expect(ask.json).toMatchObject({ model: 'vision-model', temperature: 0 })
    expect(ask.json.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: `data:image/png;base64,${PNG.toString('base64')}` } })
  })

  it('passes on what the model says when it gives no JSON, and escapes it', async () => {
    vision = { json: completion('看不太出来 <b>真</b>', 'vision-model') }
    await setup({ provenance: false })
    expect(await app.bot().receive(`ai吗${image()}`)).toEqual(['<quote id="message-1"/>vision-model 判断：看不太出来 &lt;b&gt;真&lt;/b&gt;'])
  })

  it('uses the AI service and model selected by this plugin instead of the defaults', async () => {
    await setup({ provenance: false, vision: { ai: 'Vision', model: 'vision-large' } }, 'OpenAI')
    expect(await app.bot().receive(`ai吗${image()}`)).toHaveLength(1)
    const ask = fake.calls.find(call => call.path === '/vision/v1/chat/completions')!
    expect(ask.json.model).toBe('vision-large')
    expect(ask.headers.authorization).toBe('Bearer sk-vision')
  })

  it('says so when nothing turns up, and why when the checks failed', async () => {
    await setup({ vision: false })
    const bot = app.bot()
    expect(await bot.receive(`ai吗${image()}`)).toEqual(['<quote id="message-1"/>未检出支持的 AI 水印，不能据此确认是人工图片。'])
    provenance = { status: 401, json: { error: { message: 'Incorrect API key provided' } } }
    expect(await bot.receive(`ai吗${image()}`)).toEqual(['<quote id="message-2"/>API Key 无效或没有权限。'])
  })

  it('falls back on the vision model when the watermark check fails, and names the failure when both do', async () => {
    provenance = { status: 403, json: { error: { message: 'unsupported_country_region_territory' } } }
    await setup()
    const bot = app.bot()
    expect(await bot.receive(`ai吗${image()}`)).toEqual([expect.stringContaining('vision-model-2026 判断：疑似 AI 生成')])
    vision = { status: 429, json: { error: { message: 'Rate limit reached' } } }
    // The watermark check's failure is the one reported
    expect(await bot.receive(`ai吗${image()}`)).toEqual(['<quote id="message-2"/>API Key 无效或没有权限。'])
  })

  it('reports a busy model, and one out of balance', async () => {
    vision = { status: 429, json: { error: { message: 'Rate limit reached' } } }
    await setup({ provenance: false })
    const bot = app.bot()
    expect(await bot.receive(`ai吗${image()}`)).toEqual(['<quote id="message-1"/>检测请求过于频繁，请稍后再试。'])
    vision = { status: 402, json: { error: { message: 'Insufficient Balance' } } }
    expect(await bot.receive(`ai吗${image()}`)).toEqual(['<quote id="message-2"/>AI 服务的余额或额度用完了。'])
  })

  it('reports an AI service that is not configured', async () => {
    await setup({ provenance: false, vision: { ai: '已删掉的', model: '' } })
    expect(await app.bot().receive(`ai吗${image()}`)).toEqual(['<quote id="message-1"/>AI 服务或模型尚未配置好。'])
  })

  it('leaves the message to others without an image, and keeps to the cooldown per chat', async () => {
    await setup({ cooldown: 60_000 })
    const passed: string[] = []
    app.ctx.on('bot/message', (session) => {
      passed.push(session.stripped.content)
    })
    const bot = app.bot()
    expect(await bot.receive('/ai吗')).toEqual([])
    expect(await bot.receive('ai吗？')).toEqual([])
    expect(await bot.receive(`今天 ai吗${image()}`)).toEqual([])
    expect(await bot.receive(`ai吗${image()}`, { guildId: 'G1' })).toHaveLength(1)
    expect(await bot.receive(`ai吗${image()}`, { guildId: 'G1' })).toEqual([])
    expect(await bot.receive(`ai吗${image()}`, { guildId: 'G2' })).toHaveLength(1)
    expect(passed).toEqual(['/ai吗', 'ai吗？', `今天 ai吗${image()}`, `ai吗${image()}`])
  })

  it('says when the image cannot be downloaded', async () => {
    await setup()
    expect(await app.bot().receive(`ai吗<img src="${fake.url}/missing.png"/>`)).toEqual(['<quote id="message-1"/>图片下载失败，请稍后再试。'])
  })
})

describe('SynthID integration', () => {
  const enabled = { timeout: 1000 }

  it('keeps the new detector disabled for existing configurations', async () => {
    await setup()
    await app.bot().receive('ai吗' + image())
    expect(synthid).not.toHaveBeenCalled()
  })

  it('checks SynthID after OpenAI and returns its source before asking a vision model', async () => {
    synthid.mockImplementation(async value => {
      expect(fake.calls.map(call => call.path)).toEqual(['/img.png', '/openai/v1/content_provenance_checks'])
      expect(Buffer.from(value.data)).toEqual(PNG)
      expect(value.type).toBe('image/png')
      return { status: 'detected', source: 'google', confidence: 'high' }
    })
    await setup({ synthid: enabled })
    expect(await app.bot().receive('ai吗' + image())).toEqual(['<quote id="message-1"/>SynthID 检出来自 Google 的 AI 生成标记。水印置信度：高。'])
    expect(synthid).toHaveBeenCalledTimes(1)
    expect(fake.calls.filter(call => call.path === '/img.png')).toHaveLength(1)
    expect(fake.calls.some(call => call.path.startsWith('/vision/'))).toBe(false)
  })

  it('stops after a positive OpenAI check', async () => {
    provenance = { json: { results: [{ type: 'c2pa', outcome: 'detected' }] } }
    await setup({ synthid: enabled })
    expect(await app.bot().receive('ai吗' + image())).toEqual(['<quote id="message-1"/>图片由 OpenAI 制作。'])
    expect(synthid).not.toHaveBeenCalled()
  })

  it('can still detect a source when the earlier OpenAI request failed', async () => {
    provenance = { status: 401 }
    synthid.mockResolvedValue({ status: 'detected', source: 'openai', confidence: 'high' })
    await setup({ synthid: enabled })
    expect(await app.bot().receive('ai吗' + image())).toEqual([expect.stringContaining('SynthID 检出来自 OpenAI 的 AI 生成标记')])
  })

  it.each([
    ['negative', { status: 'not_detected' }],
    ['uncertain', { status: 'uncertain', reason: 2 }],
    ['quota', { status: 'quota_exceeded', retryAfterSeconds: 12 }],
  ] as const)('falls back to vision after a %s SynthID result', async (_label, result) => {
    synthid.mockResolvedValue(result)
    await setup({ synthid: enabled })
    expect(await app.bot().receive('ai吗' + image())).toEqual([expect.stringContaining('vision-model-2026 判断：疑似 AI 生成')])
    expect(fake.calls.filter(call => call.path.startsWith('/vision/'))).toHaveLength(1)
  })

  it.each(['auth', 'permission', 'verification', 'response'] as const)('falls back to vision after a SynthID %s failure', async kind => {
    synthid.mockRejectedValue(new SynthIdError(kind, 'service fixture error'))
    await setup({ synthid: enabled })
    expect(await app.bot().receive('ai吗' + image())).toEqual([expect.stringContaining('vision-model-2026 判断：疑似 AI 生成')])
    expect(fake.calls.filter(call => call.path.startsWith('/vision/'))).toHaveLength(1)
  })

  it('works with both other detectors disabled and no configured AI services', async () => {
    await setup({ provenance: false, synthid: enabled, vision: false }, '', false, [], true)
    expect(await app.bot().receive('ai吗' + image())).toEqual([expect.stringContaining('SynthID 检出来自 Google')])
    expect(fake.calls.some(call => call.path.startsWith('/vision/') || call.path.startsWith('/openai/'))).toBe(false)
  })

  it('does not call an unmarked image human-made', async () => {
    synthid.mockResolvedValue({ status: 'not_detected' })
    await setup({ provenance: false, synthid: enabled, vision: false })
    expect(await app.bot().receive('ai吗' + image())).toEqual(['<quote id="message-1"/>未检出支持的 AI 水印，不能据此确认是人工图片。'])
  })

  it('explains why SynthID could not decide when vision is off', async () => {
    synthid.mockResolvedValue({ status: 'uncertain', reason: 6 })
    await setup({ synthid: enabled, vision: false })
    expect(await app.bot().receive('ai吗' + image())).toEqual(['<quote id="message-1"/>SynthID 无法判断：图片可能经过修改，或只在局部使用了 AI。'])
  })

  it('does not hide quota failure behind an earlier negative watermark check', async () => {
    synthid.mockResolvedValue({ status: 'quota_exceeded', retryAfterSeconds: 12 })
    await setup({ synthid: enabled, vision: false })
    expect(await app.bot().receive('ai吗' + image())).toEqual(['<quote id="message-1"/>SynthID 检测额度暂时用完，请约 12 秒后再试。'])
  })

  it('asks the user to log in when the browser session is missing or expired', async () => {
    synthid.mockRejectedValue(new SynthIdError('auth', 'login required'))
    await setup({ provenance: false, synthid: enabled, vision: false })
    const replies = await app.bot().receive('ai吗' + image())
    expect(replies).toEqual([expect.stringContaining('登录')])
    expect(replies[0]).not.toMatch(/上传路径|更新凭据|refreshToken|bgToken/)
  })

  it.each(['config', 'auth', 'verification'] as const)('explains how to fix manual %s failures', async kind => {
    synthid.mockRejectedValue(new ManualSynthIdError(kind, 'private-manual-credential-fixture'))
    await setup({ provenance: false, synthid: enabled, vision: false })
    const replies = await app.bot().receive('ai吗' + image())
    expect(replies).toEqual([expect.stringMatching(/凭证|上传标识/)])
    expect(replies[0]).not.toContain('private-manual-credential-fixture')
    expect(replies[0]).not.toContain('浏览器无法启动')
  })

  it('reports a protocol change instead of an unmarked image', async () => {
    synthid.mockRejectedValue(new SynthIdError('response', 'malformed response'))
    await setup({ synthid: enabled, vision: false })
    expect(await app.bot().receive('ai吗' + image())).toEqual([expect.stringContaining('SynthID 返回了无法识别的结果')])
  })

  it.each([SynthIdError, ManualSynthIdError])('reports a denied request without asking for login or exposing its raw error', async ErrorType => {
    synthid.mockRejectedValue(new ErrorType('permission', 'private-account-and-credential-fixture', 7))
    await setup({ provenance: false, synthid: enabled, vision: false })
    const replies = await app.bot().receive('ai吗' + image())
    expect(replies).toEqual([expect.stringContaining('拒绝')])
    expect(replies[0]).not.toMatch(/private-account|失效|过期|登录|校验|未检出/)
  })

  it('escapes a source name supplied by the detection service', async () => {
    synthid.mockResolvedValue({ status: 'detected', source: '<b>partner</b>', confidence: 'high' })
    await setup({ synthid: enabled, vision: false })
    expect(await app.bot().receive('ai吗' + image())).toEqual([expect.stringContaining('&lt;b&gt;partner&lt;/b&gt;')])
  })

  it('reports an empty vision response without claiming the picture is unmarked', async () => {
    vision = { json: completion('   ') }
    await setup({ provenance: false })
    expect(await app.bot().receive('ai吗' + image())).toEqual([expect.stringContaining('看图模型没有返回检测结果')])
  })
})

describe('configuration updates', () => {
  const enabled = { timeout: 1000 }
  const detectionOnly = { cooldown: 0, provenance: false, synthid: enabled, vision: false } as const

  it('saves filled credentials without disposing the client or replacing its command', async () => {
    const dispose = vi.spyOn(SynthIdClient.prototype, 'dispose')
    const fiber = await setup(detectionOnly)
    const bot = app.bot()
    await bot.receive('ai吗' + image())
    const initialClient = synthid.mock.contexts[0]
    const credentials = { refreshToken: 'save-fixture', pushFilename: 'users/test/files/1', bgToken: '!fixture' }
    await fiber.update(AiImgDetector.Config({ ...detectionOnly, trigger: '  ai吗  ', synthid: { timeout: 2500, credentials } }))
    expect(dispose).not.toHaveBeenCalled()
    expect(app.ctx.commands.list().map(command => command.name)).toEqual(['ai吗'])
    expect(await bot.receive('ai吗' + image())).toHaveLength(1)
    expect(synthid.mock.contexts[1]).toBe(initialClient)
    await fiber.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(app.ctx.commands.list()).toEqual([])
  })

  it('keeps cooldown history while applying a newly saved interval', async () => {
    const fiber = await setup({ ...detectionOnly, cooldown: 60_000 })
    const bot = app.bot()
    expect(await bot.receive('ai吗' + image())).toHaveLength(1)
    await fiber.update(AiImgDetector.Config({ ...detectionOnly, cooldown: 120_000 }))
    expect(await bot.receive('ai吗' + image())).toEqual([])
    expect(synthid).toHaveBeenCalledTimes(1)
    await fiber.update(AiImgDetector.Config(detectionOnly))
    expect(await bot.receive('ai吗' + image())).toHaveLength(1)
    expect(synthid).toHaveBeenCalledTimes(2)
  })

  it('releases retired credential contexts after repeated saves', async () => {
    const fiber = await setup(detectionOnly)
    const effects = fiber.getEffects().length
    for (let revision = 0; revision < 12; revision++) {
      const credentials = { refreshToken: 'fixture-' + revision, pushFilename: 'users/test/files/1', bgToken: '!fixture' }
      await fiber.update(AiImgDetector.Config({ ...detectionOnly, synthid: { ...enabled, credentials } }))
    }
    await vi.waitFor(() => expect(fiber.getEffects()).toHaveLength(effects + 1))
    await fiber.update(AiImgDetector.Config({ ...detectionOnly, synthid: false }))
    await vi.waitFor(() => expect(fiber.getEffects()).toHaveLength(effects))
    expect(synthid).not.toHaveBeenCalled()
    expect(fake.calls).toEqual([])
  })

  it('keeps the login route attached to the same client across saves and detection switches', async () => {
    let fetch!: (request: Request) => Promise<Response>
    const route = vi.fn((_prefix: string, handler: { fetch: typeof fetch }) => {
      if (_prefix === '/api/aiimgdetector/synthid') fetch = handler.fetch
      return () => {}
    })
    app.ctx.provide('webuiServer', { route })
    const status = vi.spyOn(SynthIdClient.prototype, 'status').mockResolvedValue({ state: 'ready', account: 'fixture@example.test' })
    const login = vi.spyOn(SynthIdClient.prototype, 'login').mockResolvedValue({ state: 'opening' })
    const fiber = await setup(detectionOnly)
    await vi.waitFor(() => expect(fetch).toBeTypeOf('function'))
    const statusRequest = () => fetch(new Request('http://localhost/api/aiimgdetector/synthid/status'))
    expect(await (await statusRequest()).json()).toMatchObject({ success: true, data: { state: 'ready' } })
    const initialClient = status.mock.contexts[0]
    await fiber.update(AiImgDetector.Config({ ...detectionOnly, synthid: false }))
    expect(await (await statusRequest()).json()).toMatchObject({ success: true, data: { state: 'ready' } })
    expect(await (await fetch(new Request('http://localhost/api/aiimgdetector/synthid/login', { method: 'POST' }))).json())
      .toMatchObject({ success: true, data: { state: 'opening' } })
    expect(status.mock.contexts[1]).toBe(initialClient)
    expect(login.mock.contexts[0]).toBe(initialClient)
    expect(route.mock.calls.filter(([prefix]) => prefix === '/api/aiimgdetector/synthid')).toHaveLength(1)
  })

  it('applies detector switches and selected providers to later messages without restarting', async () => {
    const dispose = vi.spyOn(SynthIdClient.prototype, 'dispose')
    const fiber = await setup(detectionOnly, 'Vision', true, [
      { name: 'Second OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-second', models: [] },
      { name: 'Second Vision', baseUrl: fake.url + '/vision/v1', apiKey: 'sk-second-vision', models: ['vision-large'] },
    ])
    const bot = app.bot()
    await bot.receive('ai吗' + image())
    provenance = { json: { results: [{ outcome: 'detected' }] } }
    await fiber.update(AiImgDetector.Config({ ...detectionOnly, synthid: false, provenance: { ai: 'Second OpenAI' } }))
    expect(await bot.receive('ai吗' + image())).toEqual(['<quote id="message-2"/>图片由 OpenAI 制作。'])
    expect(fake.calls.find(call => call.path.endsWith('/content_provenance_checks'))?.headers.authorization).toBe('Bearer sk-second')
    await fiber.update(AiImgDetector.Config({ ...detectionOnly, synthid: false, vision: { ai: 'Second Vision', model: 'vision-large' } }))
    expect(await bot.receive('ai吗' + image())).toEqual([expect.stringContaining('vision-model-2026 判断')])
    const visionCall = fake.calls.find(call => call.path.endsWith('/chat/completions'))!
    expect(visionCall.headers.authorization).toBe('Bearer sk-second-vision')
    expect(visionCall.json.model).toBe('vision-large')
    expect(synthid).toHaveBeenCalledTimes(1)
    await fiber.update(AiImgDetector.Config(detectionOnly))
    expect(await bot.receive('ai吗' + image())).toEqual([expect.stringContaining('SynthID 检出来自 Google')])
    expect(synthid.mock.contexts[1]).toBe(synthid.mock.contexts[0])
    expect(dispose).not.toHaveBeenCalled()
  })

  it('uses normal restart and command replacement when the trigger changes', async () => {
    const dispose = vi.spyOn(SynthIdClient.prototype, 'dispose')
    const fiber = await setup(detectionOnly)
    const bot = app.bot()
    await bot.receive('ai吗' + image())
    await fiber.update(AiImgDetector.Config({ ...detectionOnly, trigger: '查图' }))
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(app.ctx.commands.list().map(command => command.name)).toEqual(['查图'])
    expect(await bot.receive('ai吗' + image())).toEqual([])
    expect(await bot.receive('查图' + image())).toHaveLength(1)
    expect(synthid.mock.contexts[1]).not.toBe(synthid.mock.contexts[0])
  })
})
