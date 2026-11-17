// Diagnostic-only finalizer local-variable intervention. No interpreter rewrite.
import { Session } from 'node:inspector';
import { createHash, randomUUID } from 'node:crypto';
import { parse } from 'acorn';
import { inspectTokenEnvelope } from './token-envelope-inspector.mjs';

const OUTER = '000c4d17cba5e9ae982e545746ca1a43cebae5d9353043a6d3f2aa259c3f6cd9';
const INNER = '45242a678180fc46d7bbbc5486f2a78ff9fb8b4e7adbf077e35586a92b9c4273';
const BODY = '9c9d5eb5698291fa7c4ffdf9b63d4439ab8cb2e518f86c7f0b192e6cd3c03b4b';
const sha = value => createHash('sha256').update(value).digest('hex');
const activeCDP = new WeakSet();
let activeNode = false;
export class FinalBufferAblationError extends Error {
  constructor(code) { super('Final buffer ablation: ' + code); this.name = 'FinalBufferAblationError'; this.code = code; }
}
const error = code => new FinalBufferAblationError(code);
function visit(node, fn, parent) {
  if (!node || typeof node !== 'object') return;
  if (node.type) fn(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'start' || key === 'end') continue;
    if (Array.isArray(value)) for (const item of value) visit(item, fn, node);
    else if (value && typeof value === 'object') visit(value, fn, node);
  }
}
function referenceFor(source) {
  if (typeof source !== 'string' || source.length !== 66645 || sha(source) !== OUTER) throw error('UNREVIEWED_SOURCE');
  const matches = [];
  visit(parse(source, { ecmaVersion: 'latest' }), node => {
    if (node.type === 'ArrayExpression' && node.elements.every(e => e?.type === 'Literal' && typeof e.value === 'string') && node.elements.some(e => e.value.length > 50000)) matches.push(node);
  });
  if (matches.length !== 1) throw error('UNREVIEWED_SOURCE');
  const embedded = matches[0].elements.map(e => e.value).join('\n');
  if (embedded.length !== 62054 || sha(embedded) !== INNER || sha(embedded.slice(57774, 61625)) !== BODY || embedded.slice(60692, 60716) !== 'z=K(143,this),z.length>4') throw error('UNREVIEWED_SITE');
  return { fixture: false, length: 62054, hash: INNER, outerHash: OUTER, outerLength: 66645, maxPrefix: 8192, start: 57774, end: 61625, functionHash: BODY, boundaryStart: 60706, boundaryEnd: 60714 };
}
function fixtureReference(source) {
  if (typeof source !== 'string' || source.length > 65536 || !source.includes('final-buffer-ablation-owned-fixture')) throw error('INVALID_FIXTURE');
  const functions = [];
  visit(parse(source, { ecmaVersion: 'latest' }), (node, parent) => {
    if (node.type === 'FunctionExpression' && parent?.type === 'AssignmentExpression' && parent.left.property?.name === 'finalize') functions.push(node);
  });
  if (functions.length !== 1 || functions[0].params.map(p => p.name).join(',') !== 'input') throw error('INVALID_FIXTURE');
  const fn = functions[0], members = [];
  visit(fn.body, (node, parent) => {
    if (node.type === 'MemberExpression' && node.object.name === 'z' && node.property.name === 'length' && parent?.type === 'BinaryExpression' && parent.operator === '>' && parent.right.value === 4) members.push(node);
  });
  if (members.length !== 1) throw error('INVALID_FIXTURE');
  return { fixture: true, length: source.length, hash: sha(source), maxPrefix: 64, start: fn.start, end: fn.end, functionHash: sha(source.slice(fn.start, fn.end)), boundaryStart: members[0].start, boundaryEnd: members[0].end };
}
function optionsFor(options) {
  if (!['self', 'omit'].includes(options.mode)) throw error('INVALID_MODE');
  const maxBytes = options.maxBytes ?? 65535, maxDurationMs = options.maxDurationMs ?? 90000, maxHits = options.maxHits ?? 1000;
  if (!Number.isInteger(maxBytes) || maxBytes < 5 || maxBytes > 65535 || !Number.isInteger(maxDurationMs) || maxDurationMs < 100 || maxDurationMs > 240000 || !Number.isInteger(maxHits) || maxHits < 1 || maxHits > 10000) throw error('INVALID_OPTIONS');
  return { mode: options.mode, maxBytes, maxDurationMs, maxHits };
}
function positions(source) {
  const lines = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) lines.push(i + 1);
  return {
    location(offset, scriptId) { let lo = 0, hi = lines.length; while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (lines[mid] <= offset) lo = mid; else hi = mid; } return { scriptId, lineNumber: lo, columnNumber: offset - lines[lo] }; },
    offset(location) { return location && Number.isInteger(location.lineNumber) && Number.isInteger(location.columnNumber) && location.lineNumber >= 0 && location.lineNumber < lines.length ? lines[location.lineNumber] + location.columnNumber : -1; },
  };
}
// Retained only by an inspector object handle; this adds no realm globals.
function makePrivateHelper(maxBytes) {
  'use strict';
  const isArray = Array.isArray, getOwn = Object.getOwnPropertyDescriptor, getProto = Object.getPrototypeOf, proto = Array.prototype, integer = Number.isInteger;
  let expected = null, replacement = null, original = null, omitMode = false, prepared = false, checked = false;
  function wipe(array) { if (!array) return; for (let i = 0; i < array.length; i++) array[i] = 0; array.length = 0; }
  function clear() { wipe(expected); wipe(replacement); expected = replacement = original = null; prepared = checked = false; return true; }
  function bytes(array, minimum) {
    if (!isArray(array) || getProto(array) !== proto) return false;
    const length = getOwn(array, 'length');
    if (!length || !integer(length.value) || length.value < minimum || length.value > maxBytes) return false;
    for (let i = 0; i < length.value; i++) { const d = getOwn(array, String(i)); if (!d || !('value' in d) || !integer(d.value) || d.value < 0 || d.value > 255) return false; }
    return true;
  }
  return {
    prepare(value, omit) {
      if (prepared || !bytes(value, 5) || typeof omit !== 'boolean') throw new Error('ABLATION_PREPARE');
      original = value; expected = []; replacement = []; omitMode = omit;
      for (let i = 0; i < value.length; i++) { const n = getOwn(value, String(i)).value; expected[i] = n; replacement[i] = n; }
      if (omit) wipe(replacement);
      prepared = true; return replacement;
    },
    check(value) {
      let originalEqual = prepared && bytes(original, 5) && original.length === expected.length;
      for (let i = 0; originalEqual && i < expected.length; i++) originalEqual = getOwn(original, String(i)).value === expected[i];
      let copyEqual = prepared && value === replacement && value !== original && bytes(value, 0) && value.length === (omitMode ? 0 : expected.length);
      for (let i = 0; copyEqual && i < value.length; i++) copyEqual = getOwn(value, String(i)).value === expected[i];
      checked = originalEqual && copyEqual;
      return { valid: checked, originalUnchanged: originalEqual, replacementIdentity: value === replacement, independentCopy: value !== original, selfEqual: !omitMode && copyEqual, emptyReplacement: omitMode && copyEqual };
    },
    verify(values) {
      let equal = prepared && checked && bytes(values, 0) && values.length === (omitMode ? 0 : expected.length);
      for (let i = 0; equal && i < values.length; i++) equal = getOwn(values, String(i)).value === expected[i];
      clear(); return equal;
    },
    clear,
  };
}
function nodeTransport() {
  if (activeNode) throw error('ALREADY_ACTIVE');
  const session = new Session(); activeNode = true;
  try { session.connect(); } catch { activeNode = false; throw error('CONNECT_FAILED'); }
  const listeners = [];
  return { sync: true, on(name, fn) { const wrapped = ({ params }) => fn(params); session.on(name, wrapped); listeners.push([name, wrapped]); },
    send(method, params) { let done = false, failure, result; session.post(method, params, (e, r) => { done = true; failure = e; result = r; }); if (!done || failure) throw error('PROTOCOL_FAILED'); return result; },
    close() { for (const [name, fn] of listeners) session.off(name, fn); session.disconnect(); activeNode = false; },
  };
}
function cdpTransport(cdp) {
  if (!cdp || typeof cdp.send !== 'function' || typeof cdp.on !== 'function' || typeof cdp.off !== 'function') throw error('INVALID_CDP');
  if (activeCDP.has(cdp)) throw error('ALREADY_ACTIVE'); activeCDP.add(cdp); const listeners = [];
  return { sync: false, on(name, fn) { cdp.on(name, fn); listeners.push([name, fn]); },
    async send(method, params) { let timer; try { return await Promise.race([Promise.resolve().then(() => cdp.send(method, params)), new Promise((_, reject) => { timer = setTimeout(() => reject(error('PROTOCOL_TIMEOUT')), 2000); })]); } catch { throw error('PROTOCOL_FAILED'); } finally { clearTimeout(timer); } },
    close() { for (const [name, fn] of listeners) cdp.off(name, fn); activeCDP.delete(cdp); },
  };
}
function runSync(iterator, transport) { let op = 'next', value; while (true) { const step = iterator[op](value); if (step.done) return step.value; try { value = transport.send(step.value.method, step.value.params); op = 'next'; } catch (e) { value = e; op = 'throw'; } } }
async function runAsync(iterator, transport) { let op = 'next', value; while (true) { const step = iterator[op](value); if (step.done) return step.value; try { value = await transport.send(step.value.method, step.value.params); op = 'next'; } catch (e) { value = e; op = 'throw'; } } }
async function createProbe(reference, options, transport) {
  const state = { diagnosticOnly: true, fixture: reference.fixture, sourceSiteOnly: true, exactCalleeIdentityVerified: false, sourceModified: false, extraGlobalsAdded: false, selfMode: options.mode === 'self', omitMode: options.mode === 'omit', failed: false, sourceVerified: false, sourceMatches: 0, sourceCandidates: 0, sourceMismatches: 0, installedBreakpoints: 0, removedBreakpoints: 0, pauses: 0, instrumentationPauses: 0, boundaryHits: 0, outOfPhaseHits: 0, selectedHits: 0, replacements: 0, appliedOnce: false, cloneVerified: false, selfCopyEqual: false, emptyReplacement: false, originalUnchanged: false, verificationCalls: 0, tokenVerified: false, envelopeComplete: false, diagnosticsPresent: false, commitmentVerified: false, multipleHits: false, targetLost: false, mutationFailed: false, sourceFailure: false, protocolFailed: false, verificationFailed: false, limitReached: false, durationReached: false, cleanupFailed: false, cleanupComplete: false, privateCopiesCleared: true, disposed: false };
  const group = 'final-buffer-ablation-' + randomUUID(), pauseGroup = group + '-pause';
  const helpers = new Map(), metadata = new Map(), checked = new Set(), breakpoints = new Map();
  let phase = 'init', queue = Promise.resolve(), accepting = true, cleanupStarted = false, runtimeEnabled = false, debuggerEnabled = false, armed = false, instrumentationId = null, timer, selectedContext = null;
  const command = (method, params = {}) => ({ method, params });
  function fail(field) { state.failed = true; state[field] = true; accepting = false; }
  function dispatch(iterator) {
    if (transport.sync) { try { return runSync(iterator, transport); } catch { fail('protocolFailed'); return undefined; } }
    const operation = queue.then(() => runAsync(iterator, transport));
    queue = operation.catch(() => { fail('protocolFailed'); }); return operation;
  }
  function* helper(contextId) {
    if (helpers.has(contextId)) return helpers.get(contextId);
    if (!Number.isInteger(contextId) || helpers.size >= 32) throw error('CONTEXT_LIMIT');
    const result = yield command('Runtime.evaluate', { contextId, expression: '(' + makePrivateHelper.toString() + ')(' + options.maxBytes + ')', objectGroup: group, returnByValue: false, generatePreview: false, silent: true, disableBreaks: true, userGesture: false });
    if (result.exceptionDetails || !result.result?.objectId) throw error('HELPER_FAILED');
    helpers.set(contextId, result.result.objectId); return result.result.objectId;
  }
  function* callHelper(contextId, method, args = [], byValue = true, resultGroup = pauseGroup) {
    const id = helpers.get(contextId); if (!id) throw error('HELPER_LOST');
    const declarations = { prepare: 'function(value,omit){return this.prepare(value,omit)}', check: 'function(value){return this.check(value)}', verify: 'function(value){return this.verify(value)}', clear: 'function(){return this.clear()}' };
    const result = yield command('Runtime.callFunctionOn', { objectId: id, functionDeclaration: declarations[method], arguments: args, objectGroup: resultGroup, returnByValue: byValue, generatePreview: false, silent: true, userGesture: false });
    if (result.exceptionDetails || !result.result) throw error('HELPER_OPERATION_FAILED'); return result.result;
  }
  function* inspectScript(params) {
    if (!accepting || checked.has(params.scriptId) || !Number.isInteger(params.length) || params.length < reference.length || params.length > reference.length + reference.maxPrefix) return;
    checked.add(params.scriptId);
    if (++state.sourceCandidates > 32) { fail('limitReached'); return; }
    const source = (yield command('Debugger.getScriptSource', { scriptId: params.scriptId })).scriptSource;
    if (reference.outerHash && typeof source === 'string' && source.length === reference.outerLength && sha(source) === reference.outerHash) return;
    const prefix = typeof source === 'string' ? source.length - reference.length : -1;
    if (prefix < 0 || prefix > reference.maxPrefix || !/^\n*$/.test(source.slice(0, prefix)) || sha(source.slice(prefix)) !== reference.hash) { state.sourceMismatches++; return; }
    if (state.sourceMatches || sha(source.slice(prefix + reference.start, prefix + reference.end)) !== reference.functionHash) { fail('sourceFailure'); return; }
    const mapped = positions(source), start = prefix + reference.boundaryStart, end = prefix + reference.boundaryEnd;
    const locations = (yield command('Debugger.getPossibleBreakpoints', { start: mapped.location(start, params.scriptId), end: mapped.location(end, params.scriptId), restrictToFunction: true })).locations || [];
    const location = locations.filter(l => l.scriptId === params.scriptId && mapped.offset(l) >= start && mapped.offset(l) < end && l.type !== 'return').sort((a, b) => mapped.offset(a) - mapped.offset(b))[0];
    if (!location) { fail('sourceFailure'); return; }
    const installed = yield command('Debugger.setBreakpoint', { location });
    if (typeof installed.breakpointId !== 'string') throw error('BREAKPOINT_FAILED');
    breakpoints.set(installed.breakpointId, { scriptId: params.scriptId, contextId: params.executionContextId, mapped, offset: mapped.offset(location), functionStart: prefix + reference.start, functionEnd: prefix + reference.end }); state.installedBreakpoints++;
    if (installed.actualLocation?.scriptId !== params.scriptId || mapped.offset(installed.actualLocation) !== mapped.offset(location)) { fail('sourceFailure'); return; }
    state.sourceMatches++; state.sourceVerified = true;
    if (instrumentationId) { yield command('Debugger.removeBreakpoint', { breakpointId: instrumentationId }); instrumentationId = null; }
  }
  function* intervene(frame, definition) {
    state.boundaryHits++;
    if (phase !== 'snapshot') { state.outOfPhaseHits++; return; }
    if (++state.selectedHits !== 1) { fail('multipleHits'); return; }
    if (!frame || frame.location?.scriptId !== definition.scriptId || definition.mapped.offset(frame.location) !== definition.offset) throw error('FRAME_MISMATCH');
    const scopeNumber = frame.scopeChain?.findIndex(scope => scope.type === 'local');
    if (!Number.isInteger(scopeNumber) || scopeNumber < 0) throw error('LOCAL_SCOPE_MISSING');
    selectedContext = definition.contextId; yield* helper(selectedContext);
    const original = yield command('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression: 'z', objectGroup: pauseGroup, returnByValue: false, generatePreview: false, silent: true, throwOnSideEffect: true });
    if (original.exceptionDetails || !original.result?.objectId || original.result.subtype !== 'array') throw error('LOCAL_VALUE_UNAVAILABLE');
    state.privateCopiesCleared = false;
    const replacement = yield* callHelper(selectedContext, 'prepare', [{ objectId: original.result.objectId }, { value: state.omitMode }], false);
    if (!replacement.objectId || replacement.subtype !== 'array') throw error('CLONE_UNAVAILABLE');
    yield command('Debugger.setVariableValue', { scopeNumber, variableName: 'z', newValue: { objectId: replacement.objectId }, callFrameId: frame.callFrameId });
    const assigned = yield command('Debugger.evaluateOnCallFrame', { callFrameId: frame.callFrameId, expression: 'z', objectGroup: pauseGroup, returnByValue: false, generatePreview: false, silent: true, throwOnSideEffect: true });
    if (assigned.exceptionDetails || !assigned.result?.objectId) throw error('ASSIGNMENT_UNAVAILABLE');
    const result = (yield* callHelper(selectedContext, 'check', [{ objectId: assigned.result.objectId }])).value;
    if (result?.valid !== true || result.originalUnchanged !== true || result.replacementIdentity !== true || result.independentCopy !== true) throw error('ASSIGNMENT_MISMATCH');
    state.cloneVerified = true; state.selfCopyEqual = result.selfEqual === true; state.emptyReplacement = result.emptyReplacement === true; state.originalUnchanged = true; state.replacements++; state.appliedOnce = state.replacements === 1;
  }
  function* clearPrivate() {
    let cleared = true;
    for (const contextId of helpers.keys()) try { if ((yield* callHelper(contextId, 'clear', [], true, group)).value !== true) cleared = false; } catch { cleared = false; }
    state.privateCopiesCleared = cleared; if (!cleared) { state.cleanupFailed = true; state.failed = true; }
  }
  function* shutdown() {
    if (cleanupStarted) return; cleanupStarted = true; accepting = false; clearTimeout(timer);
    try {
      yield* clearPrivate();
      for (const id of [...breakpoints.keys()]) { try { yield command('Debugger.removeBreakpoint', { breakpointId: id }); state.removedBreakpoints++; } catch { state.cleanupFailed = true; } breakpoints.delete(id); }
      if (instrumentationId) { try { yield command('Debugger.removeBreakpoint', { breakpointId: instrumentationId }); } catch { state.cleanupFailed = true; } instrumentationId = null; }
      for (const objectGroup of [pauseGroup, group]) try { yield command('Runtime.releaseObjectGroup', { objectGroup }); } catch { state.cleanupFailed = true; }
      if (debuggerEnabled) { try { yield command('Debugger.disable'); } catch { state.cleanupFailed = true; } debuggerEnabled = false; }
      if (runtimeEnabled) { try { yield command('Runtime.disable'); } catch { state.cleanupFailed = true; } runtimeEnabled = false; }
    } finally { transport.close(); helpers.clear(); metadata.clear(); checked.clear(); state.disposed = true; state.cleanupComplete = !state.cleanupFailed && state.privateCopiesCleared && state.installedBreakpoints === state.removedBreakpoints; if (!state.cleanupComplete) state.failed = true; }
  }
  function* paused(params) {
    state.pauses++;
    try {
      if (state.pauses > options.maxHits) fail('limitReached');
      if (accepting && params.reason === 'instrumentation') { state.instrumentationPauses++; const about = metadata.get(params.data?.scriptId || params.callFrames?.[0]?.location?.scriptId); if (about) yield* inspectScript(about); for (const meta of metadata.values()) yield* inspectScript(meta); }
      else if (accepting) { const selected = (params.hitBreakpoints || []).map(id => breakpoints.get(id)).filter(Boolean); if (selected.length > 1) fail('multipleHits'); else if (selected.length === 1) yield* intervene(params.callFrames?.[0], selected[0]); }
    } catch { fail('mutationFailed'); }
    finally {
      if (params.reason !== 'instrumentation') try { yield command('Runtime.releaseObjectGroup', { objectGroup: pauseGroup }); } catch { fail('protocolFailed'); }
      try { yield command('Debugger.resume'); } catch { fail('protocolFailed'); }
    }
    if (state.failed) yield* shutdown();
  }
  transport.on('Runtime.executionContextCreated', params => { if (accepting && Number.isInteger(params.context?.id) && (transport.sync || !armed)) dispatch(helper(params.context.id))?.catch?.(() => {}); });
  transport.on('Runtime.executionContextDestroyed', params => { if (!cleanupStarted && (selectedContext === params.executionContextId || [...breakpoints.values()].some(b => b.contextId === params.executionContextId))) fail('targetLost'); helpers.delete(params.executionContextId); });
  transport.on('Runtime.executionContextsCleared', () => { if (!cleanupStarted && state.sourceVerified) fail('targetLost'); helpers.clear(); });
  transport.on('Debugger.scriptParsed', params => {
    if (!accepting) return; if (metadata.size >= 4096) { fail('limitReached'); return; }
    metadata.set(params.scriptId, { scriptId: params.scriptId, length: params.length, executionContextId: params.executionContextId });
    if (transport.sync) dispatch(inspectScript(params))?.catch?.(() => {});
  });
  transport.on('Debugger.paused', params => dispatch(paused(params))?.catch?.(() => {}));
  const controller = {
    snapshot() { return { ...state }; },
    setPhase(next) { if (!['init', 'events', 'snapshot'].includes(next)) throw error('INVALID_PHASE'); if (state.disposed) throw error('DISPOSED'); phase = next; },
    async flush() { let previous; do { previous = queue; await previous; } while (queue !== previous); },
    async verifyToken(token) {
      await controller.flush(); state.verificationCalls++;
      let bytes, values;
      try {
        if (state.failed || state.disposed || state.verificationCalls !== 1 || !state.appliedOnce || !state.sourceVerified || !state.cloneVerified || selectedContext === null) throw error('VERIFICATION_STATE');
        const envelope = inspectTokenEnvelope(token); state.envelopeComplete = envelope.complete === true; state.diagnosticsPresent = envelope.diagnosticsPresent === true;
        if (!envelope.complete || envelope.ambiguous || envelope.diagnosticsLengthWrapped || envelope.oversizeMarkers || (state.omitMode ? envelope.diagnosticsPresent : !envelope.diagnosticsPresent || envelope.diagnosticsLength > options.maxBytes)) throw error('ENVELOPE_MISMATCH');
        bytes = Buffer.from(token.startsWith('!') ? token.slice(1) : token, token.startsWith('!') ? 'base64url' : 'hex');
        values = state.omitMode ? [] : Array.from(bytes.subarray(bytes.length - envelope.diagnosticsLength));
        const verified = await dispatch(callHelper(selectedContext, 'verify', [{ value: values }], true, group));
        if (verified?.value !== true) throw error('COMMIT_MISMATCH');
        state.privateCopiesCleared = true; state.tokenVerified = true; state.commitmentVerified = true; return true;
      } catch { fail('verificationFailed'); await dispatch(clearPrivate()); return false; }
      finally { if (values) { values.fill(0); values.length = 0; } bytes?.fill(0); }
    },
    async dispose() { accepting = false; await dispatch(shutdown()); await controller.flush(); },
  };
  try {
    if (transport.sync) { runSync((function* () { runtimeEnabled = true; yield command('Runtime.enable'); debuggerEnabled = true; yield command('Debugger.enable'); })(), transport); }
    else {
      runtimeEnabled = true; await transport.send('Runtime.enable', {}); await controller.flush(); debuggerEnabled = true; await transport.send('Debugger.enable', {});
      for (const meta of metadata.values()) await runAsync(inspectScript(meta), transport);
      armed = true;
      if (!state.sourceVerified) { const installed = await transport.send('Debugger.setInstrumentationBreakpoint', { instrumentation: 'beforeScriptExecution' }); if (typeof installed.breakpointId !== 'string') throw error('INSTRUMENTATION_FAILED'); instrumentationId = installed.breakpointId; }
    }
    await controller.flush(); if (state.failed) throw error('SETUP_FAILED');
  } catch { await controller.dispose(); throw error('SETUP_FAILED'); }
  timer = setTimeout(() => { fail('durationReached'); controller.dispose().catch(() => {}); }, options.maxDurationMs); timer.unref?.();
  return controller;
}
export async function createFinalBufferAblationInspector({ originalInterpreter, ...options } = {}) { return createProbe(referenceFor(originalInterpreter), optionsFor(options), nodeTransport()); }
export async function createFinalBufferAblationCDPInspector({ originalInterpreter, cdp, ...options } = {}) { return createProbe(referenceFor(originalInterpreter), optionsFor(options), cdpTransport(cdp)); }
// Separate authored-fixture entry point cannot loosen production source pins.
export async function createFinalBufferAblationInspectorFixture({ source, cdp, ...options } = {}) { return createProbe(fixtureReference(source), optionsFor(options), cdp ? cdpTransport(cdp) : nodeTransport()); }
