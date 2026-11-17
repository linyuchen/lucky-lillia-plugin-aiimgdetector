import generatedUtils from 'jsdom/lib/jsdom/living/generated/utils.js'

// JSDOM 26 public beforeParse hook with one version-sensitive internal parser option.
// Keep runScripts=outside-only: inline/external page scripts remain inert, while
// noscript is parsed as on a scripting-enabled page. No DOM/API values are faked.
export function enableScriptingParsingForOutsideOnly(window) {
  const document = generatedUtils.implForWrapper(window.document)
  if (!document || window._runScripts !== 'outside-only' || document._scriptingDisabled ||
      !document._parseOptions || typeof document._parseOptions !== 'object') {
    throw new Error('unsupported JSDOM scripting parser configuration')
  }
  document._parseOptions.scriptingEnabled = true
}
