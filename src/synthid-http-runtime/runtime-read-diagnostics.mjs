import { createHash } from 'node:crypto'

// Diagnostic transformer for the exact retained public interpreter only.
// Modifies source and timing. A transformed run cannot validate ordinary acceptance.
export const reviewedInterpreterSha256 = '231468acebdbbfd37651d9060ee7a7420065b3bf0e6fb2be0d8a2b7a5922bad2'
export const readProbeNames = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'indexedDB', 'Worker', 'SharedWorker',
  'PerformanceObserver', 'IntersectionObserver', 'ResizeObserver', 'matchMedia',
  'requestAnimationFrame', 'requestIdleCallback', 'TextEncoder', 'TextDecoder',
  'crypto', 'subtle', 'getRandomValues', 'OffscreenCanvas', 'CSS', 'supports',
  'getContext', 'toDataURL', 'toBlob', 'storage', 'userAgentData', 'localStorage',
  'sessionStorage', 'navigator', 'document', 'window', 'parent', 'self', 'top',
  'location', 'origin', 'referrer', 'cookie', 'visibilityState', 'readyState',
  'performance', 'now', 'timing', 'getEntries', 'getEntriesByType',
  'createElement', 'getBoundingClientRect', 'getComputedStyle', 'getClientRects',
  'screen', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'userAgent', 'platform',
  'hardwareConcurrency', 'deviceMemory', 'languages', 'language', 'plugins',
  'mimeTypes', 'permissions', 'query', 'webdriver', 'addEventListener',
  'removeEventListener', 'isTrusted', 'clientX', 'clientY', 'movementX', 'movementY',
  'timeStamp', 'button', 'buttons', 'pointerType', 'key', 'code',
  // Fixed standard-event vocabulary only; values/coordinates are never recorded.
  'Event', 'MouseEvent', 'PointerEvent', 'dispatchEvent', 'type', 'target', 'currentTarget',
  'eventPhase', 'bubbles', 'cancelable', 'composed', 'defaultPrevented', 'view', 'detail',
  'relatedTarget', 'pageX', 'pageY', 'screenX', 'screenY', 'offsetX', 'offsetY',
  'pointerId', 'isPrimary',
  'contentWindow', 'contentDocument', 'write', 'writeln', 'close', 'open',
  'appendChild', 'insertBefore', 'removeChild', 'innerHTML', 'outerHTML',
  'textContent', 'src', 'srcdoc', 'Function', 'eval', 'setAttribute',
  'getAttribute', 'hasAttribute', 'querySelector', 'querySelectorAll',
  'getElementById', 'remove', 'body', 'head', 'style',
  // Fixed public environment vocabulary; only equality matches and result
  // types are observed. Location/document identifiers and sizes stay private.
  'width', 'height', 'availWidth', 'availHeight', 'colorDepth', 'pixelDepth',
  'vendor', 'appVersion', 'appName', 'product', 'productSub', 'maxTouchPoints',
  'userActivation', 'connection', 'cookieEnabled', 'pdfViewerEnabled', 'onLine',
  'rtt', 'downlink', 'effectiveType', 'saveData',
  'timeOrigin', 'Object', 'Reflect', 'getOwnPropertyDescriptor',
  'getOwnPropertyNames', 'getPrototypeOf', 'defineProperty', 'hasOwnProperty',
  'prototype', 'constructor', 'toString', 'name', 'length',
  'href', 'protocol', 'host', 'hostname', 'pathname', 'search', 'hash',
  'ownerDocument', 'parentNode', 'parentElement', 'nodeName', 'tagName', 'id',
  'className', 'documentElement', 'URL', 'baseURI', 'hidden', 'hasFocus',
]

export const readProbeStageNames = ['read', 'presence', 'call', 'dynamicEval', 'constructor']

export const evalProbeErrorCategories = ['arrayThrown', 'missingReference', 'undefinedPropertyRead', 'nullPropertyRead', 'notCallable', 'notConstructor', 'invalidReceiver', 'nullishObjectConversion', 'stackOverflow', 'syntaxFailure', 'other']
export const evalProbeErrorNames = ['Error', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'SecurityError', 'InvalidStateError', 'NotSupportedError', 'AbortError', 'NetworkError', 'InvalidCharacterError']

// This scanner only normalizes JavaScript ASCII hex/unicode escapes for matching.
// It does not execute, retain or return source; matches remain static mentions.
export function decodeAsciiSourceEscapes(source) {
  if (typeof source !== 'string' || source.length > 1048576) return ''
  let decoded = source
  for (let pass = 0; pass < 2; pass++) {
    const next = decoded.replace(/\\(?:u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2}))/g, (match, brace, unicode, hex) => {
      const code = Number.parseInt(brace || unicode || hex, 16)
      return code <= 127 ? String.fromCharCode(code) : match
    })
    if (next === decoded) break
    decoded = next
  }
  return decoded
}

export function findPublicApiMentions(source) {
  const decoded = decodeAsciiSourceEscapes(source)
  if (!decoded) return []
  return readProbeNames.filter(name => new RegExp('(^|[^A-Za-z0-9_$])' + name + '([^A-Za-z0-9_$]|$)').test(decoded))
}

function installEvalDiagnostics(names, errorNames, decodeEscapes) {
  const allowed = new Set(names)
  const errors = new Set(errorNames)
  const patterns = names.map(name => [name, new RegExp('(^|[^A-Za-z0-9_$])' + name + '([^A-Za-z0-9_$]|$)')])
  const associations = new WeakMap()
  const state = {
    evaluations: 0, functionResults: 0, nonFunctionResults: 0, oversizedSources: 0,
    associatedCalls: 0, unassociatedCalls: 0, associatedThrows: 0, unassociatedThrows: 0,
    sourceMentions: {}, calledSourceMentions: {}, thrownSourceMentions: {}, allEvalSourceMentions: {}, escapedEvalSourceMentions: {},
    stringArgumentCalls: {}, stringArgumentThrows: {}, errorNames: {}, errorCategories: {}, missingNames: {},
  }
  const increment = (object, key) => { object[key] = Math.min(1000000, (object[key] || 0) + 1) }
  const argumentNames = args => {
    const found = new Set()
    // VM qH creates a plain argument array. Data descriptors avoid evaluating
    // accessor arguments during observation; p.apply still reads them normally.
    if (!Array.isArray(args)) return found
    try {
      const length = Object.getOwnPropertyDescriptor(args, 'length')?.value
      for (let i = 0; i < Math.min(32, Number.isInteger(length) ? length : 0); i++) {
        const value = Object.getOwnPropertyDescriptor(args, String(i))?.value
        if (typeof value === 'string' && allowed.has(value)) found.add(value)
      }
    } catch {}
    return found
  }
  const recordError = error => {
    let name, message = ''
    try {
      let current = error
      for (let i = 0; current && i < 4; i++, current = Object.getPrototypeOf(current)) {
        const value = Object.getOwnPropertyDescriptor(current, 'name')?.value
        if (typeof value === 'string') { name = value; break }
      }
      const value = error && Object.getOwnPropertyDescriptor(error, 'message')?.value
      if (typeof value === 'string') message = value
    } catch {}
    increment(state.errorNames, errors.has(name) ? name : 'other')
    let category = 'other'
    if (Array.isArray(error)) category = 'arrayThrown'
    else if (name === 'SyntaxError') category = 'syntaxFailure'
    else if (message.startsWith('Cannot read properties of undefined')) category = 'undefinedPropertyRead'
    else if (message.startsWith('Cannot read properties of null')) category = 'nullPropertyRead'
    else if (message.includes('is not defined')) category = 'missingReference'
    else if (message.includes('is not a function')) category = 'notCallable'
    else if (message.includes('is not a constructor')) category = 'notConstructor'
    else if (message.includes('incompatible receiver') || message.includes('Illegal invocation')) category = 'invalidReceiver'
    else if (message.includes('Cannot convert undefined or null to object')) category = 'nullishObjectConversion'
    else if (message.includes('Maximum call stack size exceeded')) category = 'stackOverflow'
    increment(state.errorCategories, category)
    for (const api of names) {
      if (message.startsWith(api + ' is not defined') ||
          message.startsWith("Cannot read properties of undefined (reading '" + api + "')") ||
          message.startsWith("Cannot read properties of null (reading '" + api + "')")) increment(state.missingNames, api)
    }
  }
  Object.defineProperty(globalThis, '__synthidEvalAssociate', { value(source, result) {
    increment(state, 'evaluations')
    const mentions = []
    if (typeof source === 'string' && source.length <= 1048576) {
      const decoded = decodeEscapes(source)
      for (const [name, pattern] of patterns) if (pattern.test(decoded)) {
        mentions.push(name)
        increment(state.allEvalSourceMentions, name)
        if (!pattern.test(source)) increment(state.escapedEvalSourceMentions, name)
      }
    } else increment(state, 'oversizedSources')
    if (typeof result === 'function') {
      increment(state, 'functionResults')
      for (const name of mentions) increment(state.sourceMentions, name)
      associations.set(result, mentions)
    } else increment(state, 'nonFunctionResults')
    return result
  } })
  Object.defineProperty(globalThis, '__synthidEvalBeforeCall', { value(fn, args) {
    const mentions = typeof fn === 'function' ? associations.get(fn) : undefined
    increment(state, mentions ? 'associatedCalls' : 'unassociatedCalls')
    for (const name of mentions || []) increment(state.calledSourceMentions, name)
    for (const name of argumentNames(args)) increment(state.stringArgumentCalls, name)
  } })
  Object.defineProperty(globalThis, '__synthidEvalCallThrew', { value(fn, args, error) {
    const mentions = typeof fn === 'function' ? associations.get(fn) : undefined
    increment(state, mentions ? 'associatedThrows' : 'unassociatedThrows')
    for (const name of mentions || []) increment(state.thrownSourceMentions, name)
    for (const name of argumentNames(args)) increment(state.stringArgumentThrows, name)
    recordError(error)
  } })
  Object.defineProperty(globalThis, '__synthidEvalDiagnosticReport', { value() { return JSON.parse(JSON.stringify(state)) } })
}

export function createEvalProbeSetup() {
  return '(' + installEvalDiagnostics.toString() + ')(' + JSON.stringify(readProbeNames) + ',' + JSON.stringify(evalProbeErrorNames) + ',' + decodeAsciiSourceEscapes.toString() + ');'
}

export function createReadProbeSetup() {
  return '(function(){const allowed=new Set(' + JSON.stringify(readProbeNames) + ');const stages=new Set(' + JSON.stringify(readProbeStageNames) + ');const counts=Object.create(null),flow=Object.create(null),calls=Object.create(null),functionNames=new WeakMap();' +
    'Object.defineProperty(globalThis,"__synthidRuntimeNote",{value:function(stage,value){if(!stages.has(stage))return;flow[stage]=Math.min(1000000,(flow[stage]||0)+1);if(stage==="call"&&typeof value==="function"){const name=functionNames.get(value);if(name)calls[name]=Math.min(1000000,(calls[name]||0)+1);}}});' +
    'Object.defineProperty(globalThis,"__synthidRuntimeFlowReport",{value:function(){return JSON.parse(JSON.stringify({stages:flow,knownCalls:calls}));}});' +
    'Object.defineProperty(globalThis,"__synthidReadNote",{value:function(key,outcome,value){' +
    'if(typeof key!=="string"||!allowed.has(key)||!["defined","undefined","null","throws","inTrue","inFalse","inThrows"].includes(outcome))return;' +
    'const item=counts[key]||(counts[key]={});item[outcome]=Math.min(1000000,(item[outcome]||0)+1);if(typeof value==="function")functionNames.set(value,key);}});' +
    'Object.defineProperty(globalThis,"__synthidReadDiagnosticReport",{value:function(){return JSON.parse(JSON.stringify(counts));}});})();\n'
}

// Evaluated in the official child realm so original property exceptions retain that realm.
// Each underlying property getter or in check runs exactly once; values are returned unchanged.
export const readProbeHelpers = 'function __synthidReadProbe(object,key){globalThis.parent.__synthidRuntimeNote("read");let value;try{value=object[key]}catch(error){globalThis.parent.__synthidReadNote(key,"throws");throw error}globalThis.parent.__synthidReadNote(key,value===undefined?"undefined":value===null?"null":"defined",value);return value}' +
  'function __synthidHasProbe(object,key){globalThis.parent.__synthidRuntimeNote("presence");let value;try{value=key in object}catch(error){globalThis.parent.__synthidReadNote(key,"inThrows");throw error}globalThis.parent.__synthidReadNote(key,value?"inTrue":"inFalse");return value}' +
  'var __synthidNativeApply=Reflect.apply;function __synthidInvokeProbe(fn,apply,receiver,args){globalThis.parent.__synthidRuntimeNote("call",fn);globalThis.parent.__synthidEvalBeforeCall(fn,args);try{return __synthidNativeApply(apply,fn,[receiver,args])}catch(error){globalThis.parent.__synthidEvalCallThrew(fn,args,error);throw error}}'

export function transformOfficialInterpreterForReadDiagnostics(source) {
  if (typeof source !== 'string' || createHash('sha256').update(source).digest('hex') !== reviewedInterpreterSha256) {
    throw new Error('unreviewed interpreter for read diagnostics')
  }
  const patches = [
    ['mM(J[R],z,q)', 'mM(__synthidReadProbe(J,R),z,q)', 1, 'decoded-string property read'],
    ['R[p]),z,W)', '__synthidReadProbe(R,p)),z,W)', 1, 'computed property read'],
    ['z in J|0', '__synthidHasProbe(J,z)|0', 1, 'decoded-string property presence'],
    ['R in d|0', '__synthidHasProbe(d,R)|0', 1, 'computed property presence'],
    ['new p[r]', 'new (__synthidReadProbe(p,r))', 5, 'constructor property read'],
    ['p.apply(Q,d.m)', '__synthidInvokeProbe(p,p.apply,Q,d.m)', 1, 'function invocation'],
    ['function(R){return eval(R)}', 'function(R){globalThis.parent.__synthidRuntimeNote("dynamicEval");return globalThis.parent.__synthidEvalAssociate(R,eval(R))}', 1, 'dynamic code evaluation'],
    ['u=J==0?new ', 'u=(globalThis.parent.__synthidRuntimeNote("constructor"),J)==0?new ', 1, 'constructor invocation'],
    ['var CM=244', readProbeHelpers + 'var CM=244', 1, 'child-realm helper installation'],
  ]
  let transformed = source
  for (const [needle, replacement, count] of patches) {
    if (transformed.split(needle).length - 1 !== count) throw new Error('read diagnostics source anchor mismatch')
    transformed = transformed.split(needle).join(replacement)
  }
  return {
    interpreter: createReadProbeSetup() + createEvalProbeSetup() + transformed,
    metadata: { sourceSha256: reviewedInterpreterSha256, propertyReadHandlers: 2, presenceHandlers: 2, constructorBranches: 5, diagnosticOnly: true },
  }
}
