import { describe, expect, it } from 'vitest'
import { describeSynthIdFailure, formatSynthId, parseSynthIdResponse, SynthIdError } from '../src/synthid-result.js'
import { frame, imageResult, rpc } from './fakeSynthid.js'

describe('SynthID request error descriptions', () => {
  it('describes proxy failures without echoing addresses, credentials, or claiming login expired', () => {
    const message = describeSynthIdFailure(new SynthIdError('proxy', 'http://private-user:private-password@proxy.invalid'))
    expect(message).toContain('代理')
    expect(message).not.toMatch(/private-user|private-password|proxy\.invalid|失效|过期|登录/)
  })

  it.each([7, 403])('describes permission denial %s without inferring a login or verification cause', code => {
    const message = describeSynthIdFailure(new SynthIdError('permission', 'request rejected', code))
    expect(message).toContain('服务拒绝了本次检测请求')
    expect(message).not.toMatch(/失效|过期|登录|校验/)
  })

  it.each([7, 403])('does not describe verification rejection %s as an expired login', code => {
    const message = describeSynthIdFailure(new SynthIdError('verification', 'request rejected', code))
    expect(message).toContain('本次请求未通过网页校验')
    expect(message).not.toMatch(/失效|过期|登录/)
  })
})

describe('SynthID RPC status classification', () => {
  const quotaMessage = (duration: string, type = 'Modality') =>
    `;${type} quota exceeded for user private-user-id and modality image. Please wait for ${duration};`
  const failure = (code: number, message: unknown): SynthIdError => {
    try {
      parseSynthIdResponse(frame([['wrb.fr', 'TZRKo', null, null, null, [code, message], 'generic']]))
    } catch (error) {
      if (error instanceof SynthIdError) return error
      throw error
    }
    throw new Error('Expected RPC failure')
  }

  it.each([
    ['45s', 45], ['1m30s', 90], ['2h3m4.1s', 7385], ['4h', 14400], ['2m', 120],
    ['0.001s', 1], ['-1h2m3s', 3723], ['0s', 0],
  ])('recognizes the exact website quota message and rounds %s to %s seconds', (duration, seconds) => {
    expect(failure(7, quotaMessage(String(duration)))).toMatchObject({ kind: 'rate-limit', code: 7, retryAfterSeconds: seconds })
  })

  it.each([7, 8])('recognizes a similarity quota in RPC %s without exposing its account', code => {
    const error = failure(code, quotaMessage('59.001s', 'Similarity'))
    expect(error).toMatchObject({ kind: 'rate-limit', code, retryAfterSeconds: 60 })
    expect(describeSynthIdFailure(error)).toContain('60 秒')
    expect(String(error) + JSON.stringify(error) + describeSynthIdFailure(error)).not.toContain('private-user-id')
  })

  it('keeps unknown permission messages generic and never retains echoed secrets', () => {
    const secret = 'private-token-and-users-path'
    const error = failure(7, `Verification expired for ${secret}; please sign in`)
    expect(error).toMatchObject({ kind: 'permission', code: 7, retryAfterSeconds: undefined })
    expect(error).not.toHaveProperty('status')
    expect(String(error) + error.stack + JSON.stringify(error) + describeSynthIdFailure(error)).not.toContain(secret)
    expect(describeSynthIdFailure(error)).not.toMatch(/失效|过期|登录|校验/)
  })

  it.each([
    quotaMessage(''), quotaMessage('-'), quotaMessage('--1s'), quotaMessage('1m2h'), quotaMessage('1..5s'),
    quotaMessage('Infinitys'), quotaMessage('NaNs'), quotaMessage('100ms'), quotaMessage('1e3s'),
    quotaMessage('1d'), quotaMessage('1234567890h'), quotaMessage('1s').slice(1),
    quotaMessage('1s') + '\n', 'unrelated prefix ' + quotaMessage('1s'), quotaMessage('1s') + ' unrelated suffix',
    quotaMessage('1s').replace('modality image.', 'modality unknown.'),
    quotaMessage('1s').replace('private-user-id', 'private-user-id; injected'),
    'quota exceeded; please wait for 1s', 'x'.repeat(1025), null, 123, { message: quotaMessage('1s') },
  ])('does not infer quota from malformed or unrelated status %j', message => {
    expect(failure(7, message)).toMatchObject({ kind: 'permission', code: 7, retryAfterSeconds: undefined })
  })

  it('keeps RPC 16 as authentication failure even when status text resembles a quota', () => {
    expect(failure(16, quotaMessage('1h'))).toMatchObject({ kind: 'auth', code: 16, retryAfterSeconds: undefined })
  })
})

describe('SynthID wire results', () => {
  const countedSeparatorFrame = (entries: unknown[]) => {
    const chunk = '\n' + JSON.stringify(entries) + '\n'
    return Buffer.byteLength(chunk) + chunk
  }

  it('accepts the website framing that counts the separator newline, including telemetry in the same chunk', () => {
    const body = ")]}'\n\n" + countedSeparatorFrame([
      ['wrb.fr', 'TZRKo', JSON.stringify([null, null, null, null, [[2]]]), null, null, null, 'generic'],
      ['di', 273], ['af.httprm', 272, 123456789, 2],
    ]) + countedSeparatorFrame([['e', 4, null, null, 166]])
    expect(parseSynthIdResponse(body)).toEqual({ status: 'not_detected' })
  })

  it('reads a permission error with the counted separator framing', () => {
    const body = ")]}'\n\n" + countedSeparatorFrame([['wrb.fr', 'TZRKo', null, null, null, [7], 'generic']])
    expect(() => parseSynthIdResponse(body)).toThrow(expect.objectContaining({ kind: 'permission', code: 7 }))
  })

  it('counts UTF-8 bytes with both framing conventions in one response', () => {
    const body = ")]}'\n\n" + countedSeparatorFrame([['wrb.fr', 'OtherRpc', '[]']])
      + frame([['di', 42]]) + countedSeparatorFrame([
        ['wrb.fr', 'TZRKo', JSON.stringify([null, null, null, null, [[3, null, null, null, null, null, null, null, null, null, 2, '合作方']]])],
      ])
    expect(parseSynthIdResponse(body)).toMatchObject({ status: 'detected', source: '合作方' })
  })

  it('rejects a counted separator frame with truncated JSON', () => {
    const body = countedSeparatorFrame([['wrb.fr', 'TZRKo', JSON.stringify([null, null, null, null, [[2]]])]])
    expect(() => parseSynthIdResponse(body.slice(0, -3))).toThrow('unrecognized response')
  })

  it('preserves the RPC permission error when the terminal telemetry frame omits its counted newline', () => {
    const body = rpc(null, 7).body!.toString() + '25' + String.fromCharCode(10) + '[[' + '"e",4,null,null,138]]'
    expect(() => parseSynthIdResponse(body)).toThrow(expect.objectContaining({ kind: 'permission', code: 7 }))
  })
  it.each([[1, null, 'google'], [2, 'openai', 'openai'], [2, 'nvidia', 'nvidia'], [2, 'kakao', 'kakao']])('reads provider %s / %s', (code, partner, source) => {
    expect(parseSynthIdResponse(imageResult(3, code as number, partner as string | null).body!.toString())).toEqual({
      status: 'detected', source, confidence: 'high',
    })
  })

  it('reads multiple length-prefixed frames containing UTF-8 without mistaking metadata for a result', () => {
    const result = imageResult(3, 2, '合作方').body!.toString()
    const body = result.replace(")]}'\n\n", ")]}'\n\n" + frame([['di', 42], ['wrb.fr', 'OtherRpc', '[]']])) + frame([['af.httprm', 10]])
    expect(parseSynthIdResponse(body)).toMatchObject({ status: 'detected', source: '合作方' })
  })

  it('also accepts an unframed response and leaves unknown sources unknown', () => {
    const body = JSON.stringify([['wrb.fr', 'TZRKo', JSON.stringify([null, null, null, null, [[3]]])]])
    const result = parseSynthIdResponse(body)
    expect(result).toEqual({ status: 'detected', source: undefined, confidence: undefined })
    expect(formatSynthId(result as Extract<typeof result, { status: 'detected' }>)).toBe('SynthID 检出 AI 生成标记。')
  })

  it('does not turn a false-positive metric into an AI probability', () => {
    const body = rpc([null, null, null, null, [[3, null, null, 0.00001, null, null, null, null, null, null, 1]]]).body!.toString()
    const result = parseSynthIdResponse(body)
    expect(result).toMatchObject({ status: 'detected', confidence: undefined })
    if (result.status === 'detected') expect(formatSynthId(result)).not.toContain('%')
  })

  it('keeps an inconclusive result separate from a negative result', () => {
    expect(parseSynthIdResponse(imageResult(2).body!.toString())).toEqual({ status: 'not_detected' })
    const result = parseSynthIdResponse(imageResult(1, 1, null, 2).body!.toString())
    expect(result).toEqual({ status: 'uncertain', reason: 2 })
    if (result.status === 'uncertain') expect(formatSynthId(result)).toBe('SynthID 无法判断：图片分辨率过低。')
  })

  it('reads quota backoff, including protobuf duration strings and nanoseconds', () => {
    const body = rpc([null, null, null, null, null, null, [[null, null, 1, ['12', 500000000]]]]).body!.toString()
    expect(parseSynthIdResponse(body)).toEqual({ status: 'quota_exceeded', retryAfterSeconds: 13 })
  })

  it.each([[16, 'auth'], [7, 'permission'], [8, 'rate-limit'], [3, 'request'], [13, 'server']])('reports RPC failure %s without treating HTTP 200 as success', (code, kind) => {
    try {
      parseSynthIdResponse(rpc(null, code as number).body!.toString())
      expect.fail('expected an RPC error')
    } catch (error) {
      expect(error).toMatchObject({ name: 'SynthIdError', kind, code })
    }
  })

  it.each([
    '<html>Sign in</html>',
    ")]}'\n999999\n[]",
    rpc({ error: 'changed schema' }).body!.toString(),
    rpc([null, null, null, null, []]).body!.toString(),
    imageResult(99).body!.toString(),
    rpc([null, null, null, null, null, null, [[null, null, 1, ['bad']]]]).body!.toString(),
  ])('rejects a missing or malformed result instead of reporting an unmarked image', body => {
    expect(() => parseSynthIdResponse(body)).toThrow(SynthIdError)
    expect(() => parseSynthIdResponse(body)).toThrow('unrecognized response')
  })
})
