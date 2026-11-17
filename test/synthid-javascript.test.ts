import { describe, expect, it } from 'vitest'
// @ts-expect-error JSDOM's private binding integration is checked at runtime.
import { JSDOM } from 'jsdom'
// @ts-expect-error The runtime installer is a packaged JavaScript module.
import { installJavascriptBindings } from '../src/synthid-http-runtime/runtime-javascript-bindings.mjs'

describe('JavaScript WebIDL compatibility', () => {
  it('replaces the identity-only webdriver getter while preserving function reflection and restoring descriptors', () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://fixture.invalid', runScripts: 'outside-only' })
    const top = dom.window, hostRenderer = Function.prototype.toString, previous = top.Function.prototype.toString
    const identityOnly = function webdriver(this: unknown) { if (this !== top.navigator) throw new top.TypeError('Illegal invocation'); return false }
    Object.defineProperty(top.Navigator.prototype, 'webdriver', { get: identityOnly, configurable: true, enumerable: true })
    let control
    try {
      control = installJavascriptBindings(top, { children: true })
      const frame = top.document.createElement('iframe'); top.document.body.append(frame)
      const child = frame.contentWindow
      const webdriver = Object.getOwnPropertyDescriptor(top.Navigator.prototype, 'webdriver')!.get!
      expect(webdriver.call(child.navigator)).toBe(false)
      const callback = child.eval('(function authoredCallback(value) { return value; })')
      for (const realm of [top, child]) {
        const render = realm.Function.prototype.toString
        expect(render.call(render)).toBe(hostRenderer.call(render))
        expect(render.call(callback)).toBe(hostRenderer.call(callback))
        expect(render.call(realm.Array)).toBe(hostRenderer.call(realm.Array))
        expect(() => render.call({})).toThrow(realm.TypeError)
        for (const owner of [top, child]) {
          for (const key of ['plugins', 'mimeTypes', 'webdriver']) {
            const getter = Object.getOwnPropertyDescriptor(owner.Navigator.prototype, key)!.get!
            expect(render.call(getter)).toBe(hostRenderer.call(getter))
            expect(getter.name).toBe(`get ${key}`)
            expect(getter.length).toBe(0)
            expect(Object.hasOwn(getter, 'prototype')).toBe(false)
          }
          expect(render.call(owner.HTMLMediaElement.prototype.canPlayType)).toBe(hostRenderer.call(owner.HTMLMediaElement.prototype.canPlayType))
        }
      }
      frame.remove()
      const childRenderer = child.Function.prototype.toString
      const getter = Object.getOwnPropertyDescriptor(top.Navigator.prototype, 'plugins')!.get!
      expect(childRenderer.call(getter)).toBe(hostRenderer.call(getter))
      expect(Function.prototype.toString).toBe(hostRenderer)
      const disposed = control.dispose()
      expect(disposed).toMatchObject({ installedDescriptors: 8, restoredDescriptors: 8, restoreConflicts: 0, restoreFailures: 0 })
      expect(top.Function.prototype.toString).toBe(previous)
      expect(Object.getOwnPropertyDescriptor(top.Navigator.prototype, 'webdriver')!.get).toBe(identityOnly)
      expect(child.Function.prototype.toString).toBe(childRenderer)
    } finally { control?.dispose(); dom.window.close() }
  })

  it('preserves real values and enforces declaring-realm errors for borrowed getters', () => {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://fixture.invalid', runScripts: 'outside-only' })
    let control
    try {
      const top = dom.window, renderer = top.Function.prototype.toString
      const plugins = top.navigator.plugins, mimeTypes = top.navigator.mimeTypes
      control = installJavascriptBindings(top, { children: true })
      const frame = top.document.createElement('iframe'); top.document.body.append(frame)
      const child = frame.contentWindow
      for (const owner of [top, child]) {
        for (const receiver of [top.navigator, child.navigator]) {
          for (const key of ['plugins', 'mimeTypes', 'webdriver']) {
            const get = Object.getOwnPropertyDescriptor(owner.Navigator.prototype, key)!.get!
            expect(get.call(receiver)).toBe(key === 'webdriver' ? false : receiver[key])
            for (const invalid of [null, undefined, {}, owner.Object.create(owner.Navigator.prototype)]) {
              let error; try { get.call(invalid) } catch (caught) { error = caught }
              expect(error).toBeInstanceOf(owner.TypeError)
              expect(error).not.toBeInstanceOf(TypeError)
              expect((error as Error).message).toBe('Illegal invocation')
            }
          }
        }
        const media = owner.HTMLMediaElement.prototype.canPlayType
        expect(media.call(top.document.createElement('video'), 'video/webm')).toBe('')
        expect(media.call(child.document.createElement('audio'), 'audio/ogg')).toBe('')
        expect(() => media.call({})).toThrow(owner.TypeError)
      }
      expect(top.navigator.plugins).toBe(plugins)
      expect(top.navigator.mimeTypes).toBe(mimeTypes)
      const invoke = top.eval('(function compare(getter) { function ownedCaller() { getter.call({}); } try { ownedCaller(); } catch (error) { return error; } })\n//# sourceURL=owned-binding-fixture.js')
      const error = invoke(Object.getOwnPropertyDescriptor(top.Navigator.prototype, 'plugins')!.get)
      expect(error.stack.split('\n')[1]).toContain('at ownedCaller (owned-binding-fixture.js:')
      expect(error.stack).not.toContain('runtime-javascript-bindings.mjs')
      expect(top.Function.prototype.toString).toBe(renderer)
      frame.remove()
      const getter = Object.getOwnPropertyDescriptor(child.Navigator.prototype, 'plugins')!.get!
      expect(getter.call(top.navigator)).toBe(plugins)
      const disposed = control.dispose()
      expect(disposed).toMatchObject({ disposed: true, nativeAddonUsed: false, installedDescriptors: 8, restoredDescriptors: 8,
        childFactoryRestored: true, restoreFailures: 0, restoreConflicts: 0, childFailures: 0 })
      expect(Object.hasOwn(top.Navigator.prototype, 'webdriver')).toBe(false)
      expect(control.dispose()).toEqual(disposed)
    } finally { control?.dispose(); dom.window.close() }
  })
})
