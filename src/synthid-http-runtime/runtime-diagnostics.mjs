// Optional passive diagnostics. This does not implement, replace or fake browser APIs.
// Reports contain only a fixed vocabulary of names, booleans and bounded counters.
import { parseFragment } from 'parse5'
const errorNames = new Set(['Error', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'SecurityError', 'InvalidStateError', 'NotSupportedError', 'AbortError', 'NetworkError'])
const jsdomTypes = new Set(['not implemented', 'unhandled exception', 'resource loading', 'css parsing'])
const apiNames = [
  'HTMLCanvasElement.prototype.getContext', 'HTMLCanvasElement.prototype.toDataURL',
  'HTMLCanvasElement.prototype.toBlob', 'HTMLMediaElement.prototype.load',
  'HTMLMediaElement.prototype.play', 'HTMLMediaElement.prototype.pause',
  'window.alert', 'window.confirm', 'window.prompt', 'window.focus', 'window.blur',
  'window.open', 'window.print', 'window.scroll', 'window.scrollBy', 'window.scrollTo',
  'navigation',
]
const featurePaths = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'indexedDB', 'Worker', 'SharedWorker',
  'PerformanceObserver', 'IntersectionObserver', 'ResizeObserver', 'matchMedia',
  'requestAnimationFrame', 'requestIdleCallback', 'TextEncoder', 'TextDecoder',
  'crypto.getRandomValues', 'crypto.subtle', 'OffscreenCanvas', 'CSS.supports',
  'navigator.storage', 'navigator.userAgentData', 'localStorage', 'sessionStorage',
]
const increment = (object, name) => { object[name] = Math.min(1000000, (object[name] || 0) + 1) }

function inertSrcdocShape(markup) {
  if (markup.length > 1048576) return { oversized: true }
  const root = parseFragment(markup, { scriptingEnabled: true })
  const result = { scripts: 0, inlineScripts: 0, externalScripts: 0, frames: 0 }
  const visit = node => {
    if (node.tagName === 'script') {
      result.scripts++
      if (node.attrs?.some(attr => attr.name === 'src')) result.externalScripts++
      else if (node.childNodes?.some(child => child.nodeName === '#text' && child.value.length > 0)) result.inlineScripts++
    }
    if (node.tagName === 'iframe' || node.tagName === 'frame') result.frames++
    for (const child of node.childNodes || []) visit(child)
  }
  visit(root)
  return result
}

function featureInventory(window) {
  const features = {}
  for (const path of featurePaths) {
    try {
      let value = window
      for (const part of path.split('.')) value = value?.[part]
      features[path] = value !== undefined && value !== null
    } catch {
      features[path] = false
    }
  }
  return features
}

function framePolicy(frame) {
  const result = { sandboxPresent: null, sandboxEmpty: null, allowSameOrigin: null, allowScripts: null,
    srcCategory: 'unavailable', effectiveOrigin: 'unavailable', connected: null }
  try {
    const sandbox = frame.getAttribute('sandbox')
    result.sandboxPresent = sandbox !== null
    if (sandbox === null || sandbox.length <= 8192) {
      const tokens = (sandbox || '').split(/[\t\n\f\r ]+/).filter(Boolean)
      result.sandboxEmpty = sandbox !== null && tokens.length === 0
      result.allowSameOrigin = sandbox !== null && tokens.includes('allow-same-origin')
      result.allowScripts = sandbox !== null && tokens.includes('allow-scripts')
    }
    result.connected = frame.isConnected === true
    const parent = frame.ownerDocument.defaultView
    const parentOrigin = parent.origin
    const source = frame.getAttribute('src')
    if (source === null) result.srcCategory = 'absent'
    else if (source.length <= 8192) {
      const url = new URL(source || 'about:blank', frame.ownerDocument.baseURI)
      result.srcCategory = url.protocol === 'about:' && url.pathname === 'blank' ? 'about-blank'
        : url.origin === 'null' ? 'opaque-url'
        : parentOrigin !== 'null' && url.origin === parentOrigin ? 'same-origin' : 'other-origin'
    }
    // window.origin is the effective origin; location.origin instead serializes
    // the URL and is null even for an inherited-origin about:blank document.
    const child = frame.contentWindow
    if (child && child.document) {
      const origin = child.origin
      result.effectiveOrigin = origin === 'null' ? 'opaque'
        : typeof origin === 'string' && origin && parentOrigin !== 'null'
          ? origin === parentOrigin ? 'same-as-parent' : 'other' : 'unavailable'
    }
  } catch {}
  return result
}

export function createRuntimeDiagnostics(virtualConsole) {
  const state = {
    events: {}, errors: {}, jsdomErrorTypes: {}, unimplementedApis: {},
    resources: {}, realms: [], frameHistory: [],
  }
  const cleanups = []
  const realmWindows = []
  const observedWindows = new WeakSet()
  const observedFrames = new WeakSet()
  const frameRecords = new WeakMap()
  let disposed = false
  const recordError = error => {
    let name
    try { name = error?.name } catch {}
    increment(state.errors, errorNames.has(name) ? name : 'other')
  }
  const onJsdomError = error => {
    if (disposed) return
    let type
    let message
    try { type = error?.type; message = error?.message } catch {}
    increment(state.jsdomErrorTypes, jsdomTypes.has(type) ? type : 'other')
    if (type === 'not implemented') {
      const api = typeof message === 'string' ? apiNames.find(name => message.startsWith('Not implemented: ' + name)) : undefined
      increment(state.unimplementedApis, api || 'other')
    }
    if (type === 'unhandled exception') {
      try { recordError(error?.detail) } catch { increment(state.errors, 'other') }
    }
  }
  virtualConsole.on('jsdomError', onJsdomError)
  cleanups.push(() => virtualConsole.removeListener('jsdomError', onJsdomError))

  const listen = (target, eventName, callback) => {
    target.addEventListener(eventName, callback)
    cleanups.push(() => target.removeEventListener(eventName, callback))
  }

  function observeWindow(window, kind = 'child') {
    if (disposed || !window || observedWindows.has(window)) return
    try { if (!window.document) return } catch { return }
    observedWindows.add(window)
    increment(state.events, 'realmsObserved')
    // Keep output bounded even if official code retries frame creation repeatedly.
    if (state.realms.length < 32) {
      state.realms.push({ kind: kind === 'top' ? 'top' : 'child', features: featureInventory(window) })
      realmWindows.push(window)
    }
    const scan = () => {
      try {
        const document = window.document
        if (!document) return
        for (const frame of [...document.getElementsByTagName('iframe'), ...document.getElementsByTagName('frame')]) observeFrame(frame)
      } catch { increment(state.events, 'frameInspectionFailure') }
    }
    try {
      listen(window, 'error', event => {
        increment(state.events, 'windowError')
        recordError(event.error)
      })
      listen(window, 'unhandledrejection', event => {
        increment(state.events, 'unhandledRejection')
        recordError(event.reason)
      })
      listen(window, 'load', () => { increment(state.events, 'windowLoad'); scan() })
      listen(window.document, 'DOMContentLoaded', () => { increment(state.events, 'domContentLoaded'); scan() })
      const observer = new window.MutationObserver(records => {
        const visit = (node, removed) => {
          if (node.localName === 'iframe' || node.localName === 'frame') { recordFrame(node, removed); observeFrame(node) }
          if (typeof node.getElementsByTagName === 'function') {
            for (const frame of [...node.getElementsByTagName('iframe'), ...node.getElementsByTagName('frame')]) { recordFrame(frame, removed); observeFrame(frame) }
          }
        }
        for (const record of records) {
          if (record.type === 'attributes' && (record.target.localName === 'iframe' || record.target.localName === 'frame')) recordFrame(record.target, false, true)
          for (const node of record.addedNodes || []) visit(node, false)
          for (const node of record.removedNodes || []) visit(node, true)
        }
        scan()
      })
      observer.observe(window.document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcdoc', 'sandbox'] })
      cleanups.push(() => observer.disconnect())
      scan()
    } catch { increment(state.events, 'windowObservationFailure') }
  }

  function observeFrame(frame) {
    if (observedFrames.has(frame)) return
    observedFrames.add(frame)
    recordFrame(frame)
    increment(state.events, 'framesObserved')
    const child = () => {
      try { observeWindow(frame.contentWindow, 'child') } catch { increment(state.events, 'frameAccessFailure') }
    }
    listen(frame, 'load', () => { increment(state.events, 'frameLoad'); recordFrame(frame); child() })
    listen(frame, 'error', () => increment(state.events, 'frameError'))
    child()
  }

  function recordFrame(frame, removed = false, changed = false) {
    let record = frameRecords.get(frame)
    if (!record) {
      if (state.frameHistory.length >= 32) return
      const policy = framePolicy(frame)
      record = { hasSrc: false, hasSrcdoc: false, removed: false, attributeChanges: 0,
        firstPolicy: policy, policy, observedConnected: policy.connected === true,
        firstObservedDisconnected: policy.connected === false, onlyObservedAfterRemoval: false }
      frameRecords.set(frame, record)
      state.frameHistory.push(record)
    }
    if (removed) record.removed = true
    if (changed) increment(record, 'attributeChanges')
    record.policy = framePolicy(frame)
    if (record.policy.connected === true) record.observedConnected = true
    record.onlyObservedAfterRemoval = record.removed && !record.observedConnected
    try {
      record.hasSrc = frame.hasAttribute('src')
      record.hasSrcdoc = frame.hasAttribute('srcdoc')
      if (record.hasSrcdoc && (!record.srcdoc || changed)) record.srcdoc = inertSrcdocShape(frame.getAttribute('srcdoc') || '')
    } catch { record.inspectionFailed = true }
  }

  return {
    observeWindow,
    // Call this from ResourceLoader.fetch. Never pass a URL or resource contents.
    noteResource(element, outcome = 'blocked') {
      if (disposed) return
      let name
      try { name = element?.localName } catch {}
      const type = ['iframe', 'frame', 'script', 'link', 'img'].includes(name) ? name : 'other'
      const action = ['supplied', 'blocked', 'error'].includes(outcome) ? outcome : 'other'
      increment(state.resources, type + ':' + action)
    },
    snapshot() {
      const snapshot = JSON.parse(JSON.stringify(state))
      snapshot.domShapes = realmWindows.map(window => {
        try {
          const document = window.document
          if (!document) return { closed: true }
          const scripts = [...document.getElementsByTagName('script')]
          const iframes = [...document.getElementsByTagName('iframe')]
          const noscripts = [...document.getElementsByTagName('noscript')]
          return {
            readyState: ['loading', 'interactive', 'complete'].includes(document.readyState) ? document.readyState : 'other',
            scripts: scripts.length,
            inlineScripts: scripts.filter(script => !script.hasAttribute('src') && script.textContent.length > 0).length,
            externalScripts: scripts.filter(script => script.hasAttribute('src')).length,
            frames: iframes.length + document.getElementsByTagName('frame').length,
            srcdocFrames: iframes.filter(frame => frame.hasAttribute('srcdoc')).length,
            noscriptElements: noscripts.length,
            noscriptElementChildren: noscripts.reduce((sum, node) => sum + node.childElementCount, 0),
            refreshMetaElements: [...document.getElementsByTagName('meta')].filter(node => node.getAttribute('http-equiv')?.toLowerCase() === 'refresh').length,
          }
        } catch { return { inspectionFailed: true } }
      })
      return snapshot
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const cleanup of cleanups.reverse()) { try { cleanup() } catch {} }
      cleanups.length = 0
      realmWindows.length = 0
    },
  }
}
