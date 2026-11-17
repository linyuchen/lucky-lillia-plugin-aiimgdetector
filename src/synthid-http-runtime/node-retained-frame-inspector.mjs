// Local inspector breakpoints on original JSDOM functions only. No source,
// prototype, export, result or argument replacements and no listening port.
import { Session } from 'node:inspector';
import { randomUUID } from 'node:crypto';
import FrameModule from 'jsdom/lib/jsdom/living/nodes/HTMLFrameElement-impl.js';
import utils from 'jsdom/lib/jsdom/living/generated/utils.js';

const APIS = ['document', 'setTimeout', 'setInterval'];
const KINDS = ['helper', 'transient', 'otherFrame'];
const CALLERS = ['officialNamed', 'officialGenerated', 'officialStack', 'helper', 'jsdom', 'other', 'unknown'];
const PHASES = ['beforeDocumentDeletion', 'afterDocumentDeletion'];
const ERRORS = new Set(['INVALID_OPTIONS', 'ALREADY_ACTIVE', 'INSPECTOR_SETUP_FAILED']);
const increment = value => Math.min(1000000, value + 1);
const own = (object, key) => {
  if (!object || (typeof object !== 'object' && typeof object !== 'function')) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
};
const counters = names => Object.fromEntries(names.map(name => [name, 0]));
const calls = () => Object.fromEntries(APIS.map(api => [api, Object.fromEntries(PHASES.map(phase =>
  [phase, { total: 0, ...counters(CALLERS) }]))]));
let activeInstallation;
export class NodeRetainedFrameInspectorError extends Error {
  constructor(code) {
    const safeCode = ERRORS.has(code) ? code : 'INSPECTOR_SETUP_FAILED';
    super('Node retained frame inspector failed: ' + safeCode);
    this.name = 'NodeRetainedFrameInspectorError'; this.code = safeCode;
  }
}
function sourceKind(url) {
  if (!url) return 'anonymous';
  const path = url.replaceAll(String.fromCharCode(92), '/');
  const basename = path.split('/').at(-1);
  if (basename === 'google-botguard-interpreter.js') return 'officialNamed';
  const helpers = ['node-retained-frame-inspector', 'synthid-lifecycle-realm', 'synthid-lifecycle-worker', 'lifecycle-worker',
    'runtime-diagnostics', 'runtime-exception-diagnostics', 'runtime-read-diagnostics', 'event-getter-diagnostics',
    'event-listener-diagnostics', 'realm-pointer-diagnostic', 'node-platform-event-diagnostic', 'node-navigation-inspector'];
  if (helpers.some(name => [name + '.mjs', name + '.js', name + '.selftest.mjs', name + '.selftest.js'].includes(basename))) return 'helper';
  if (path.includes('/jsdom/lib/')) return 'jsdom';
  return 'other';
}

/** Install after creating top JSDOM and before executing the original program.
 * Own _detach is paused at entry, before its super call and child.close(). The
 * child APIs are installed during that same pause. Do not combine with another
 * debugger controller. Diagnostic counters are evidence of accesses, not cause. */
export async function createNodeRetainedFrameInspector(topWindow, { maximumFrames = 8, maxHits = 512,
  maxDurationMs = 30000 } = {}) {
  const detach = own(FrameModule.implementation?.prototype, '_detach');
  if (!own(topWindow, utils.implSymbol) || typeof detach !== 'function' ||
      !Number.isInteger(maximumFrames) || maximumFrames < 1 || maximumFrames > 16 ||
      !Number.isInteger(maxHits) || maxHits < 1 || maxHits > 5000 ||
      !Number.isInteger(maxDurationMs) || maxDurationMs < 100 || maxDurationMs > 120000)
    throw new NodeRetainedFrameInspectorError('INVALID_OPTIONS');
  if (activeInstallation) throw new NodeRetainedFrameInspectorError('ALREADY_ACTIVE');
  const owner = {}; activeInstallation = owner;
  const expectedTop = own(topWindow, '_globalProxy') || topWindow;
  const helpers = new WeakSet(), windows = new Map(), scripts = new Map(), breakpoints = new Map();
  const originalFunctions = new Map();
  const state = { diagnosticOnly: true, sourceModified: false, prototypesModified: false, exportsReplaced: false,
    valuesRecorded: false, installedAtDetachEntry: true, pauses: 0, detachCalls: 0, capturedRealms: 0,
    repeatedDetach: 0, outsideScope: 0, noChildWindow: 0, alreadyClosedAtEntry: 0, documentPresentAtEntry: 0,
    attachedAtEntry: 0, apiCalls: 0, inspectionFailures: 0, unexpectedPauses: 0, inspectorErrors: 0,
    scriptLimitReached: false, frameLimitReached: false, hitLimitReached: false, durationReached: false,
    installedBreakpoints: 0, removedBreakpoints: 0, duplicateFunctionLocations: 0, disposed: false,
    capturedByKind: counters(KINDS), apiUnavailable: counters(APIS), calls: calls(),
    frameCalls: Object.fromEntries(KINDS.map(kind => [kind, calls()])), detachCallers: counters(CALLERS) };
  const session = new Session();
  const registryKey = '__synthid_retained_frames_' + randomUUID().replaceAll('-', '');
  const objectGroup = 'synthid-retained-frames-' + randomUUID();
  const registry = { detach, pending: [], capture, summarize };
  let active = false, connected = false, disposed = false, registryPresent = false, timer, cleanupPromise;
  let removals = Promise.resolve();
  const post = (method, params = {}) => new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new NodeRetainedFrameInspectorError('INSPECTOR_SETUP_FAILED')), 1000);
    try { session.post(method, params, (error, result) => { clearTimeout(deadline); error ? reject(error) : resolve(result); }); }
    catch (error) { clearTimeout(deadline); reject(error); }
  });
  function postSync(method, params = {}) {
    let completed = false, failure, response;
    session.post(method, params, (error, result) => { completed = true; failure = error; response = result; });
    // V8 can apply a function-call breakpoint to every closure sharing the same
    // original function body. In that case another realm returns this precise
    // duplicate-location error; owning-window filtering still runs at each hit.
    if (completed && method === 'Debugger.setBreakpointOnFunctionCall' && failure &&
        typeof own(failure, 'message') === 'string' && own(failure, 'message').includes('Breakpoint at specified location already exists'))
      return { existingFunctionLocation: true };
    // A local same-thread inspector currently completes these callbacks before
    // returning. Fail closed if this stops being true; never inspect stale frames.
    if (!completed || failure || response?.exceptionDetails) throw new NodeRetainedFrameInspectorError('INSPECTOR_SETUP_FAILED');
    return response;
  }
  function resume() {
    if (!connected) return;
    try { session.post('Debugger.resume', {}, error => { if (error && !disposed) state.inspectorErrors = increment(state.inspectorErrors); }); }
    catch { if (!disposed) state.inspectorErrors = increment(state.inspectorErrors); }
  }
  function belongs(child) { return own(child, '_top') === expectedTop; }
  function frameKind(frame) {
    if (helpers.has(frame)) return 'helper';
    const attributes = own(frame, '_attributeList');
    if (!Array.isArray(attributes)) return 'otherFrame';
    for (let index = 0; index < Math.min(64, own(attributes, 'length') || 0); index++) {
      const name = own(own(attributes, String(index)), '_localName');
      if (name === 'src' || name === 'srcdoc') return 'otherFrame';
    }
    return 'transient';
  }
  function capture(frame) {
    registry.pending = [];
    const child = own(own(frame, '_contentDocument'), '_defaultView');
    if (!child) { state.noChildWindow = increment(state.noChildWindow); return { captured: false }; }
    if (!belongs(child)) { state.outsideScope = increment(state.outsideScope); return { captured: false }; }
    const window = own(child, '_globalObject') || child;
    state.detachCalls = increment(state.detachCalls);
    if (windows.has(window)) { state.repeatedDetach = increment(state.repeatedDetach); return { captured: false }; }
    if (windows.size >= maximumFrames) { state.frameLimitReached = true; return { captured: false }; }
    const kind = frameKind(frame);
    const hadDocument = !!own(window, '_document');
    const record = { window, kind };
    windows.set(window, record);
    state.capturedRealms = increment(state.capturedRealms); state.capturedByKind[kind] = increment(state.capturedByKind[kind]);
    if (own(frame, '_attached') === true) state.attachedAtEntry = increment(state.attachedAtEntry);
    if (hadDocument) state.documentPresentAtEntry = increment(state.documentPresentAtEntry);
    else state.alreadyClosedAtEntry = increment(state.alreadyClosedAtEntry);
    const getter = Object.getOwnPropertyDescriptor(window, 'document')?.get;
    for (const api of APIS) {
      const fn = api === 'document' ? getter : own(window, api);
      if (typeof fn !== 'function') { state.apiUnavailable[api] = increment(state.apiUnavailable[api]); continue; }
      registry.pending.push({ fn, api });
    }
    return { captured: true };
  }
  function summarize(window) {
    const record = windows.get(window);
    if (!record) return { matched: false };
    return { matched: true, kind: record.kind, deleted: !Object.getOwnPropertyDescriptor(window, '_document') };
  }
  function parsed({ params }) {
    if (scripts.size >= 6000 && !scripts.has(params.scriptId)) { state.scriptLimitReached = true; return; }
    scripts.set(params.scriptId, { kind: sourceKind(params.url),
      parents: (params.stackTrace?.callFrames || []).slice(0, 24).map(frame => frame.scriptId).filter(Boolean) });
  }
  function kindFor(scriptId, seen = new Set()) {
    if (!scriptId || seen.size >= 32 || seen.has(scriptId)) return 'unknown';
    seen.add(scriptId);
    const entry = scripts.get(scriptId);
    if (!entry) return 'unknown';
    if (entry.kind !== 'anonymous') return entry.kind;
    // Stop at the nearest recognized origin. A helper/JSDOM eval with an
    // official caller deeper in its stack must not become official code.
    for (const id of entry.parents) {
      const kind = kindFor(id, new Set(seen));
      if (kind === 'officialNamed' || kind === 'officialGenerated') return 'officialGenerated';
      if (kind === 'helper' || kind === 'jsdom') return kind;
    }
    return 'unknown';
  }
  function callerKind(frames) {
    const direct = kindFor(frames?.[1]?.location?.scriptId);
    if (direct !== 'unknown') return direct;
    for (const frame of (frames || []).slice(2, 26)) {
      const kind = kindFor(frame.location?.scriptId);
      if (kind === 'helper' || kind === 'jsdom') return kind;
      if (kind === 'officialNamed' || kind === 'officialGenerated') return 'officialStack';
    }
    return 'unknown';
  }
  function installPendingSync() {
    try {
      for (let index = 0; index < registry.pending.length; index++) {
        const { fn, api } = registry.pending[index];
        if (originalFunctions.has(fn)) continue;
        const response = postSync('Runtime.evaluate', { expression: 'globalThis[' + JSON.stringify(registryKey) + '].pending[' + index + '].fn',
          returnByValue: false, silent: true, objectGroup });
        if (!response.result?.objectId) throw new NodeRetainedFrameInspectorError('INSPECTOR_SETUP_FAILED');
        const installed = postSync('Debugger.setBreakpointOnFunctionCall', { objectId: response.result.objectId });
        if (installed.existingFunctionLocation && [...originalFunctions.values()].includes(api)) {
          originalFunctions.set(fn, api); state.duplicateFunctionLocations = increment(state.duplicateFunctionLocations); continue;
        }
        if (typeof installed.breakpointId !== 'string') throw new NodeRetainedFrameInspectorError('INSPECTOR_SETUP_FAILED');
        originalFunctions.set(fn, api);
        if (!breakpoints.has(installed.breakpointId)) state.installedBreakpoints = increment(state.installedBreakpoints);
        breakpoints.set(installed.breakpointId, api);
      }
    } finally {
      registry.pending = [];
      postSync('Runtime.releaseObjectGroup', { objectGroup });
    }
  }
  function removeOwnBreakpoints() {
    const pending = [...breakpoints.keys()]; breakpoints.clear();
    const batch = pending.map(breakpointId => post('Debugger.removeBreakpoint', { breakpointId })
      .then(() => { state.removedBreakpoints = increment(state.removedBreakpoints); }, () => { state.inspectorErrors = increment(state.inspectorErrors); }));
    removals = Promise.all([removals, ...batch]).then(() => {});
    return removals;
  }
  function paused({ params }) {
    try {
      const kinds = new Set((params.hitBreakpoints || []).map(id => breakpoints.get(id)).filter(Boolean));
      if (!kinds.size) { state.unexpectedPauses = increment(state.unexpectedPauses); return; }
      if (!active || disposed) return;
      state.pauses = increment(state.pauses);
      const callFrameId = params.callFrames?.[0]?.callFrameId;
      if (!callFrameId) throw new NodeRetainedFrameInspectorError('INSPECTOR_SETUP_FAILED');
      const kind = callerKind(params.callFrames);
      if (kinds.has('detach')) {
        const response = postSync('Debugger.evaluateOnCallFrame', { callFrameId,
          expression: 'globalThis[' + JSON.stringify(registryKey) + '].capture(this)', returnByValue: true, silent: true });
        if (response.result?.value?.captured === true) {
          state.detachCallers[kind] = increment(state.detachCallers[kind]);
          installPendingSync();
        }
      } else {
        // All three original Window.js functions close over the owning window.
        // This handles detached calls with a different/undefined `this`, and
        // rejects unrelated closures if V8 shares a breakpoint source location.
        const response = postSync('Debugger.evaluateOnCallFrame', { callFrameId,
          expression: 'globalThis[' + JSON.stringify(registryKey) + '].summarize(window)', returnByValue: true, silent: true });
        const safe = response.result?.value;
        if (safe?.matched === false) state.outsideScope = increment(state.outsideScope);
        else {
          if (safe?.matched !== true || !KINDS.includes(safe.kind) || typeof safe.deleted !== 'boolean')
            throw new NodeRetainedFrameInspectorError('INSPECTOR_SETUP_FAILED');
          const phase = safe.deleted ? 'afterDocumentDeletion' : 'beforeDocumentDeletion';
          for (const api of kinds) if (APIS.includes(api)) {
            state.apiCalls = increment(state.apiCalls);
            for (const group of [state.calls, state.frameCalls[safe.kind]]) {
              group[api][phase].total = increment(group[api][phase].total);
              group[api][phase][kind] = increment(group[api][phase][kind]);
            }
          }
        }
      }
    } catch { state.inspectionFailures = increment(state.inspectionFailures); }
    finally {
      if (state.pauses >= maxHits && active) { active = false; state.hitLimitReached = true; void removeOwnBreakpoints(); }
      resume();
    }
  }
  async function dispose() {
    if (cleanupPromise) return cleanupPromise;
    active = false;
    cleanupPromise = (async () => {
      clearTimeout(timer);
      await removeOwnBreakpoints();
      registry.pending = [];
      if (registryPresent) { delete globalThis[registryKey]; registryPresent = false; }
      if (connected) {
        await post('Runtime.releaseObjectGroup', { objectGroup }).catch(() => { state.inspectorErrors = increment(state.inspectorErrors); });
        await post('Debugger.disable').catch(() => { state.inspectorErrors = increment(state.inspectorErrors); });
        session.off('Debugger.paused', paused); session.off('Debugger.scriptParsed', parsed);
        try { session.disconnect(); } catch { state.inspectorErrors = increment(state.inspectorErrors); }
        connected = false;
      }
      windows.clear(); scripts.clear(); originalFunctions.clear();
      disposed = true; state.disposed = true;
      if (activeInstallation === owner) activeInstallation = undefined;
    })();
    return cleanupPromise;
  }
  try {
    session.connect(); connected = true;
    session.on('Debugger.paused', paused); session.on('Debugger.scriptParsed', parsed);
    await post('Debugger.enable');
    Object.defineProperty(globalThis, registryKey, { value: registry, configurable: true }); registryPresent = true;
    const response = await post('Runtime.evaluate', { expression: 'globalThis[' + JSON.stringify(registryKey) + '].detach',
      returnByValue: false, silent: true, objectGroup });
    if (response.exceptionDetails || !response.result?.objectId) throw new NodeRetainedFrameInspectorError('INSPECTOR_SETUP_FAILED');
    const installed = await post('Debugger.setBreakpointOnFunctionCall', { objectId: response.result.objectId });
    if (typeof installed.breakpointId !== 'string') throw new NodeRetainedFrameInspectorError('INSPECTOR_SETUP_FAILED');
    breakpoints.set(installed.breakpointId, 'detach'); state.installedBreakpoints++;
    await post('Runtime.releaseObjectGroup', { objectGroup });
    active = true;
    timer = setTimeout(() => { state.durationReached = true; void dispose(); }, maxDurationMs); timer.unref?.();
  } catch { await dispose(); throw new NodeRetainedFrameInspectorError('INSPECTOR_SETUP_FAILED'); }
  return {
    noteHelperFrame(frame) { const implementation = own(frame, utils.implSymbol); if (!disposed && implementation) helpers.add(implementation); },
    snapshot() { return JSON.parse(JSON.stringify(state)); },
    dispose,
  };
}
