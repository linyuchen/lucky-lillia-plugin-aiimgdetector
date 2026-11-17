// Optional Node inspector session for caught runtime exceptions. It opens no TCP port.
// In a --permission worker this needs --allow-inspector. It is diagnostic only:
// pause/resume instrumentation affects timing and must not be used as a token fix.
import { findPublicApiMentions, readProbeNames, evalProbeErrorNames } from './runtime-read-diagnostics.mjs'
import { webIdlConstructorNames } from './webidl-realm-catalog.mjs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const errorNames = evalProbeErrorNames
const knownNames = readProbeNames
const increment = (object, key) => {
  const previous = Object.hasOwn(object, key) ? object[key] : 0
  object[key] = Number.isSafeInteger(previous) && previous >= 0
    ? Math.min(Number.MAX_SAFE_INTEGER, previous + 1) : 1
}
const diagnosticUrl = value => typeof value === 'string' && /(?:^|[/\\])runtime-(?:diagnostics|exception-diagnostics|read-diagnostics)\.mjs(?:$|[?#])/.test(value)
const normalizePath = value => {
  const path = resolve(value).replace(/\\/g, '/')
  return process.platform === 'win32' ? path.toLowerCase() : path
}
const runtimeDirectory = normalizePath(fileURLToPath(new URL('.', import.meta.url))) + '/'
const jsdomDirectory = normalizePath(fileURLToPath(new URL('.', import.meta.resolve('jsdom/package.json')))) + '/'
const markerPath = value => {
  const path = value.replace(/\\/g, '/')
  return process.platform === 'win32' ? path.toLowerCase() : path
}
const runtimeUrlDirectory = markerPath(new URL('.', import.meta.url).href)
const jsdomUrlDirectory = markerPath(new URL('.', import.meta.resolve('jsdom/package.json')).href)
// NodeFilter is the fixed standard callback interface already present in the
// standard-property catalog; its missing prototype excludes it from constructors.
const jsdomInterfaceFiles = [...webIdlConstructorNames, 'NodeFilter'].map(name => ({
  name, path: markerPath(jsdomDirectory + 'lib/jsdom/living/generated/' + name + '.js'),
  url: markerPath(jsdomUrlDirectory + 'lib/jsdom/living/generated/' + name + '.js'),
}))
// Fixed public callable labels from pinned HTMLMediaElement.js, read offline.
// Match only this interface's first formatted frame, never discover member names.
const htmlMediaElementMemberNames = [
  'load', 'canPlayType', 'play', 'pause', 'addTextTrack',
  'get src', 'set src', 'get currentSrc', 'get crossOrigin', 'set crossOrigin',
  'get networkState', 'get preload', 'set preload', 'get buffered', 'get readyState',
  'get seeking', 'get currentTime', 'set currentTime', 'get duration', 'get paused',
  'get defaultPlaybackRate', 'set defaultPlaybackRate', 'get playbackRate', 'set playbackRate',
  'get played', 'get seekable', 'get ended', 'get autoplay', 'set autoplay',
  'get loop', 'set loop', 'get controls', 'set controls', 'get volume', 'set volume',
  'get muted', 'set muted', 'get defaultMuted', 'set defaultMuted',
  'get audioTracks', 'get videoTracks', 'get textTracks',
]
const ownedSourceFiles = [
  'lifecycle-worker.mjs', 'runtime-web-compat.mjs', 'runtime-window-state-compat.mjs',
  'runtime-anchor-href-translate.mjs', 'runtime-detached-frame-compat.mjs',
  'runtime-webidl-callable-control.mjs', 'runtime-permissions-binding.mjs',
  'runtime-function-tostring-observation.mjs',
]
// Exact authored names of the guards/methods/getters that can reach the narrow
// Illegal invocation branches in runtime-web-compat.mjs. Never discover names.
const authoredWebCompatFunctionNames = [
  'checkPerformance', 'checkNavigator', 'getEntries', 'getEntriesByType', 'getEntriesByName',
  'webdriver', 'maxTouchPoints', 'userActivation', 'connection', 'platform', 'deviceMemory',
  'screenDimension', 'get isActive', 'get hasBeenActive', 'get rtt', 'get downlink',
  'get effectiveType', 'get saveData',
]
const authoredFunctionLabel = frame => authoredWebCompatFunctionNames.find(name => name === frame?.functionName) || 'unknown'
const containsDirectory = (text, directory) => {
  for (let index = text.indexOf(directory); index >= 0; index = text.indexOf(directory, index + 1)) {
    if (index === 0 || /[\s("'=:/]/.test(text[index - 1])) return true
  }
  return false
}
const containsSourceFile = (text, path, truncated) => {
  for (let index = text.indexOf(path); index >= 0; index = text.indexOf(path, index + 1)) {
    const after = index + path.length
    if ((index === 0 || /[\s("'=:/]/.test(text[index - 1])) &&
        (after === text.length ? !truncated : /[\s)"':?#]/.test(text[after]))) return true
  }
  return false
}
const sourceFileLabels = (text, truncated = false) => {
  const paths = markerPath(text)
  return ownedSourceFiles.filter(name => containsSourceFile(paths, runtimeDirectory + name, truncated) || containsSourceFile(paths, runtimeUrlDirectory + name, truncated))
}
const jsdomInterfaceLabel = (text, truncated) => {
  const paths = markerPath(text)
  let label = 'other'
  for (const entry of jsdomInterfaceFiles) {
    if (!containsSourceFile(paths, entry.path, truncated) && !containsSourceFile(paths, entry.url, truncated)) continue
    // Multiple different generated files on one eval-origin line are ambiguous.
    if (label !== 'other') return 'other'
    label = entry.name
  }
  return label
}
const jsdomMemberLabel = (line, interfaceName) => {
  if (interfaceName !== 'HTMLMediaElement') return 'other'
  const label = /^[ \t]+at[ \t]+([^()\r\n]+?)[ \t]+\(/.exec(line)?.[1]
  if (!label) return 'other'
  for (const name of htmlMediaElementMemberNames) {
    if (label === name || label === 'Object.' + name || label === 'HTMLMediaElement.' + name ||
        label === 'HTMLAudioElement.' + name || label === 'HTMLVideoElement.' + name) return name
  }
  return 'other'
}
const countMarkers = (text, pattern) => {
  let count = 0
  while (count < 32 && pattern.exec(text)) count++
  return count
}
// Inspect only the description already supplied by the inspector. These are
// text markers, not parsed frame identities; never read the thrown Error.stack.
const descriptionMarkers = description => {
  const text = description.slice(0, 65536)
  const paths = markerPath(text)
  return {
    hasNewline: text.includes('\n'),
    hasFormattedFrames: /(?:^|\r?\n)[ \t]+at[ \t]+\S/.test(text),
    descriptionTruncated: description.length > 65536,
    containsNodeInternal: /(?:^|[\s(])node:/.test(text),
    containsJsdomPath: containsDirectory(paths, jsdomDirectory) || containsDirectory(paths, jsdomUrlDirectory) || /(?:^|[\/\s("'=])node_modules\/jsdom(?:\/|$)/.test(paths),
    containsOwnedRuntimePath: containsDirectory(paths, runtimeDirectory) || containsDirectory(paths, runtimeUrlDirectory),
    containsPublicResource: /(?:^|[\s("'=])https:\/\/(?:www\.gstatic\.com|www\.google\.com|synthid\.google\.com)(?::443)?(?:[/?#]|$)/i.test(text),
    evalAtOccurrences: countMarkers(text, /\beval at[ \t]/g),
    anonymousOccurrences: countMarkers(text, /<anonymous>/g),
  }
}
const firstFormattedFrame = description => {
  const prefix = description.slice(0, 65536)
  const match = /^[ \t]+at[ \t]+\S[^\r\n]*/m.exec(prefix)
  const line = match?.[0] || ''
  const markers = descriptionMarkers(line)
  // A first line reaching the truncated prefix boundary is conservatively cut.
  markers.descriptionTruncated = description.length > prefix.length &&
    (!match || match.index + line.length === prefix.length)
  const jsdomInterface = jsdomInterfaceLabel(line, markers.descriptionTruncated)
  return { markers, ownedSourceFiles: sourceFileLabels(line, markers.descriptionTruncated),
    jsdomInterface, jsdomMember: jsdomMemberLabel(line, jsdomInterface) }
}
const originCategory = value => {
  if (value === '') return 'dynamic'
  if (value.startsWith('node:')) return 'node-internal'
  if (/^https:\/\/(?:www\.gstatic\.com|www\.google\.com|synthid\.google\.com)(?::443)?(?:[/?#]|$)/i.test(value)) return 'public-resource'
  let path
  if (value.startsWith('file:')) path = fileURLToPath(value)
  else if (/^(?:[a-zA-Z]:[/\\]|\/|\\\\)/.test(value)) path = value
  else return 'other'
  path = normalizePath(path)
  if (path.startsWith(jsdomDirectory)) return 'jsdom'
  if (path.startsWith(runtimeDirectory)) return 'owned-runtime'
  return 'other'
}

export async function createExceptionDiagnostics({ maximum = 500, observeDynamicSources = false, maximumScripts = 500 } = {}) {
  const { Session } = await import('node:inspector')
  const session = new Session()
  session.connect()
  const state = { caughtAndUncaughtExceptions: 0, diagnosticExceptionsExcluded: 0, names: {}, knownMissingNames: {}, limitReached: false, inspectorErrors: 0, invalidFrameMetadata: 0, illegalInvocationFrames: [] }
  if (observeDynamicSources) state.dynamicSources = { inspectedScripts: 0, skippedScripts: 0, diagnosticScriptsExcluded: 0, parseNotifications: 0, sourceMentions: {}, exceptionScriptMentions: {}, exceptionStackMentions: {} }
  const cap = Math.max(1, Math.min(5000, Math.floor(maximum) || 500))
  const scriptCap = Math.max(1, Math.min(2000, Math.floor(maximumScripts) || 500))
  const scriptNames = new Map()
  // Retain only the most recent bounded script IDs and fixed categories.
  // Debugger.enable announces existing scripts before capturing becomes true.
  const scriptOrigins = new Map()
  const originScriptCap = Math.min(500, scriptCap)
  const diagnosticScripts = new Set()
  let observedExceptions = 0
  let observedScripts = 0
  let capturing = false
  let disposed = false
  const post = (method, params = {}) => new Promise((resolve, reject) => {
    session.post(method, params, (error, result) => error ? reject(error) : resolve(result))
  })
  const resume = () => session.post('Debugger.resume', {}, error => { if (error && !disposed) state.inspectorErrors++ })
  const fromDiagnosticFrame = frame => diagnosticUrl(frame?.url) || diagnosticScripts.has(frame?.scriptId || frame?.location?.scriptId)
  const invalidMetadata = () => { state.invalidFrameMetadata = Math.min(1000000, state.invalidFrameMetadata + 1) }
  const rememberOrigin = params => {
    if (typeof params?.scriptId !== 'string' || !params.scriptId || typeof params.url !== 'string') { invalidMetadata(); return }
    let category
    try { category = originCategory(params.url) } catch { invalidMetadata(); return }
    scriptOrigins.delete(params.scriptId)
    if (scriptOrigins.size >= originScriptCap) scriptOrigins.delete(scriptOrigins.keys().next().value)
    scriptOrigins.set(params.scriptId, category)
  }
  const recordIllegalInvocationFrames = (frames, description) => {
    if (state.illegalInvocationFrames.length >= 16) return
    if (!Array.isArray(frames)) { invalidMetadata(); return }
    const categories = frames.slice(0, 10).map(frame => {
      const scriptId = frame?.location?.scriptId
      const category = typeof scriptId === 'string' ? scriptOrigins.get(scriptId) : undefined
      if (category) return category
      // Empty call-frame URLs can mean missing metadata, not dynamic code.
      if (typeof frame?.url === 'string' && frame.url !== '') {
        try { return originCategory(frame.url) } catch {}
      }
      invalidMetadata()
      return 'other'
    })
    const firstFrame = firstFormattedFrame(description)
    const ownedFunctionEligible = firstFrame.ownedSourceFiles.includes('runtime-web-compat.mjs') || categories[0] === 'owned-runtime'
    const firstOwnedFunctionLabel = ownedFunctionEligible ? authoredFunctionLabel(frames[0]) : 'unknown'
    // The two common guards do not identify their caller API on their own.
    const nextOwnedFunctionLabels = firstOwnedFunctionLabel === 'checkPerformance' || firstOwnedFunctionLabel === 'checkNavigator'
      ? frames.slice(1, 4).map(authoredFunctionLabel) : []
    state.illegalInvocationFrames.push({ categories, totalFrameCount: Math.min(32, frames.length), moreThan10: frames.length > 10,
      descriptionMarkers: descriptionMarkers(description), firstFormattedFrameMarkers: firstFrame.markers,
      firstFormattedFrameJsdomInterface: firstFrame.jsdomInterface,
      firstFormattedFrameJsdomMember: firstFrame.jsdomMember,
      ownedSourceFiles: sourceFileLabels(description.slice(0, 65536), description.length > 65536), firstFormattedFrameOwnedSourceFiles: firstFrame.ownedSourceFiles,
      firstOwnedFunctionLabel, nextOwnedFunctionLabels })
  }
  const parsed = ({ params }) => {
    if (disposed) return
    rememberOrigin(params)
    if (!params || typeof params !== 'object') return
    const diagnostic = diagnosticUrl(params.url) || params.stackTrace?.callFrames?.some(fromDiagnosticFrame)
    if (diagnostic) diagnosticScripts.add(params.scriptId)
    // Empty URL selects eval-generated scripts and excludes named initialization,
    // worker and module source. Never output a script ID, URL or source text.
    if (!capturing || disposed || !observeDynamicSources || params.url !== '') return
    increment(state.dynamicSources, 'parseNotifications')
    if (diagnostic) { increment(state.dynamicSources, 'diagnosticScriptsExcluded'); return }
    if (observedScripts++ >= scriptCap) { increment(state.dynamicSources, 'skippedScripts'); return }
    session.post('Debugger.getScriptSource', { scriptId: params.scriptId }, (error, result) => {
      if (disposed) return
      if (error || typeof result?.scriptSource !== 'string' || result.scriptSource.length > 1048576) {
        increment(state.dynamicSources, 'skippedScripts')
        return
      }
      const names = findPublicApiMentions(result.scriptSource)
      // Only fixed names persist; source and script metadata leave scope here.
      scriptNames.set(params.scriptId, names)
      increment(state.dynamicSources, 'inspectedScripts')
      for (const name of names) increment(state.dynamicSources.sourceMentions, name)
    })
  }
  const paused = ({ params }) => {
    if (disposed) return
    try {
      if (params.reason === 'exception' || params.reason === 'promiseRejection') {
        observedExceptions++
        if (params.callFrames?.some(fromDiagnosticFrame)) {
          state.diagnosticExceptionsExcluded++
        } else {
        state.caughtAndUncaughtExceptions++
        const description = typeof params.data?.description === 'string' ? params.data.description : ''
        if (/^TypeError: Illegal invocation(?:\r?\n|$)/.test(description)) recordIllegalInvocationFrames(params.callFrames, description)
        const className = params.data?.className
        const name = errorNames.includes(className) ? className : errorNames.find(candidate => description.startsWith(candidate + ':'))
        increment(state.names, name || 'other')
        // Match against fixed API names; never retain the arbitrary identifier or message.
        for (const api of knownNames) {
          if (description.startsWith('ReferenceError: ' + api + ' is not defined') ||
              description.startsWith("TypeError: Cannot read properties of undefined (reading '" + api + "')") ||
              description.startsWith("TypeError: Cannot read properties of null (reading '" + api + "')")) {
            increment(state.knownMissingNames, api)
          }
        }
        if (observeDynamicSources) {
          const frames = Array.isArray(params.callFrames) ? params.callFrames.slice(0, 32) : []
          for (const name of scriptNames.get(frames[0]?.location?.scriptId) || []) increment(state.dynamicSources.exceptionScriptMentions, name)
          const seen = new Set()
          for (const frame of frames) for (const name of scriptNames.get(frame.location?.scriptId) || []) seen.add(name)
          for (const name of seen) increment(state.dynamicSources.exceptionStackMentions, name)
        }
        }
      }
      if (observedExceptions >= cap) {
        state.limitReached = true
        session.post('Debugger.setPauseOnExceptions', { state: 'none' }, error => { if (error) state.inspectorErrors++; resume() })
      } else resume()
    } catch { state.inspectorErrors++; resume() }
  }
  session.on('Debugger.paused', paused)
  session.on('Debugger.scriptParsed', parsed)
  try {
    await post('Debugger.enable')
    capturing = true
    await post('Debugger.setPauseOnExceptions', { state: 'all' })
  } catch (error) {
    session.off('Debugger.paused', paused)
    session.off('Debugger.scriptParsed', parsed)
    scriptOrigins.clear()
    session.disconnect()
    throw error
  }
  return {
    snapshot() { return JSON.parse(JSON.stringify(state)) },
    async dispose() {
      if (disposed) return
      await post('Debugger.setPauseOnExceptions', { state: 'none' }).catch(() => {})
      disposed = true
      session.off('Debugger.paused', paused)
      session.off('Debugger.scriptParsed', parsed)
      scriptNames.clear()
      scriptOrigins.clear()
      diagnosticScripts.clear()
      session.disconnect()
    },
  }
}
