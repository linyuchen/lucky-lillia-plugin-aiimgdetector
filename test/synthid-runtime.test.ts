import { describe, expect, it } from 'vitest'
import { createLifecycleClient } from '../src/synthid-http-runtime/entry.mjs'

const input = {
  program: 'authored-fixture', globalName: 'fixture', experiments: '[]',
  interpreter: 'globalThis.fixture = { a() {} };',
  pageUrl: 'https://synthid.com/image-detection', pageHTML: '<!doctype html><body></body>',
}

describe('isolated JavaScript interpreter process', () => {
  it('rejects removed native modes and closes the process without granting addon permission', async () => {
    const client = createLifecycleClient({ maxLifetimeMs: 5000 })
    try {
      await expect(client.initialize({ ...input, nativePluginGetters: true })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    } finally { await client.dispose() }
    expect(client.telemetry).toMatchObject({ nativeAddonPermission: false, exited: true, exitCode: 0 })
  })

  it('terminates a program that never supplies its ready callback', async () => {
    const client = createLifecycleClient({ timeouts: { init: 100 }, maxLifetimeMs: 5000 })
    try {
      await expect(client.initialize(input)).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' })
    } finally { await client.dispose() }
    expect(client.telemetry).toMatchObject({ timedOut: true, nativeAddonPermission: false, exited: true })
  })

  it('kills the interpreter when the owning operation is cancelled', async () => {
    const controller = new AbortController()
    const client = createLifecycleClient({ signal: controller.signal, maxLifetimeMs: 5000 })
    const initializing = client.initialize(input)
    controller.abort()
    try { await expect(initializing).rejects.toMatchObject({ code: 'ABORTED' }) }
    finally { await client.dispose() }
    expect(client.telemetry).toMatchObject({ nativeAddonPermission: false, exited: true, disposed: true })
  })
})
