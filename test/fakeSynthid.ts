import type { FakeAnswer } from './fakeAi.js'

export function frame(entries: unknown[]): string {
  const text = JSON.stringify(entries) + '\n'
  return Buffer.byteLength(text) + '\n' + text
}

/** Synthetic wire fixtures following the documented JSPB fields; no real account data. */
export function rpc(payload: unknown, code?: number): FakeAnswer {
  return {
    body: Buffer.from(")]}'\n\n" + frame([['wrb.fr', 'TZRKo', payload === null ? null : JSON.stringify(payload), null, null, code === undefined ? null : [code], 'generic']])),
    type: 'application/json; charset=utf-8',
  }
}

export function imageResult(status = 3, source = 1, partner: string | null = null, reason: number | null = null): FakeAnswer {
  return rpc([null, null, null, null, [[status, null, null, 0.001, null, null, null, null, null, reason, source, partner, 5]]])
}
