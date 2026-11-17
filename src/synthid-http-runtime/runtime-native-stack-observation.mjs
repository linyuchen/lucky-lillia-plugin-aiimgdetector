// Dedicated Node inspector diagnostic. Requires exclusive inspector ownership
// and --allow-inspector under Node permissions. Native breakpoints change timing;
// this is observation, never a token compatibility fix. One selected getter per
// run avoids V8 native breakpoint-ID collisions between distinct realm getters.
import { Session } from 'node:inspector';
import { randomBytes } from 'node:crypto';
import WindowModule from 'jsdom/lib/jsdom/browser/Window.js';
import jsdomPackage from 'jsdom/package.json' with { type: 'json' };
const HostError = Error, descriptorOf = Object.getOwnPropertyDescriptor;
const functionSource = Function.prototype.toString;
const KINDS = ['host', 'top', 'sourced', 'sourceless'], PHASES = ['init', 'events', 'snapshot'];
let activeOwner;
const increment = (object, key) => { object[key] = Math.min(1000000, object[key] + 1); };
const counters = names => Object.fromEntries(names.map(name => [name, 0]));
const ownData = (object, key) => { const descriptor = descriptorOf(object, key); return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined; };
const native = value => typeof value === 'function' && /^function(?: [^\s(]*)?\(\) \{ \[native code\] \}$/.test(Reflect.apply(functionSource, value, []));

/** Install after creating the top JSDOM window, before the interpreter.
 * The 32-realm bound includes host and top. targetIndex is zero-based within
 * targetKind; selected children may be created after installation. Child kinds
 * describe only the factory URL (about:blank versus another primitive URL).
 * They do not prove whether an iframe had a src attribute. V8 may also pause for
 * native clones with different JS identities; a hit proves a native getter call,
 * not its receiver realm. A zero count never proves other getters were covered.
 * setPhase selects workload stages; snapshot() only copies diagnostic counters.
 * Install/dispose in LIFO order with other WindowModule.createWindow hooks. */
export function installRuntimeNativeStackObservation(window, options = {}) {
  if (activeOwner) throw new HostError('NATIVE_STACK_ALREADY_INSTALLED');
  if (!options || typeof options !== 'object') throw new HostError('NATIVE_STACK_INVALID_OPTIONS');
  const option = (name, fallback) => {
    const descriptor = descriptorOf(options, name);
    if (descriptor && !Object.hasOwn(descriptor, 'value')) throw new HostError('NATIVE_STACK_INVALID_OPTIONS');
    return descriptor?.value === undefined ? fallback : descriptor.value;
  };
  const limits = {};
  for (const [name, fallback, minimum, maximum] of [
    ['maximumRealms', 32, 2, 32], ['maximumHits', 500, 1, 500], ['maximumRecords', 64, 1, 64], ['targetIndex', 0, 0, 31],
  ]) {
    const value = option(name, fallback);
    if (!Number.isInteger(value) || value < minimum || value > maximum) throw new HostError('NATIVE_STACK_INVALID_OPTIONS');
    limits[name] = value;
  }
  const targetKind = option('targetKind', 'top');
  if (!KINDS.includes(targetKind)) throw new HostError('NATIVE_STACK_INVALID_OPTIONS');
  const originalFactory = descriptorOf(WindowModule, 'createWindow');
  if (jsdomPackage.version !== '26.1.0' || !originalFactory?.writable || typeof originalFactory.value !== 'function'
      || !window || typeof window !== 'object') throw new HostError('NATIVE_STACK_UNSUPPORTED_RUNTIME');
  const owner = {}; activeOwner = owner;
  const session = new Session(), getters = new Map(), realms = [];
  const objectGroup = 'native-stack-' + randomBytes(16).toString('hex');
  const state = { diagnosticOnly: true, inspectorOwnership: 'exclusive-required', getterCallsObserved: true,
    getterCallsAreFormattingCounts: false, callerRealmProven: false, getterIdentityAtPauseProven: false,
    coverage: 'one-selected-native-breakpoint', coverageMayIncludeNativeAliases: true,
    unregisteredRealmCoverageProven: false, sourceRequests: 0, errorObjectsExposed: 0, stackValuesRead: 0,
    receiverInspections: 0, exceptionPausingEnabled: false, pageGlobalsModified: false, prototypesModified: false,
    temporaryHostGetterRegistry: true, childKindBasis: 'factory-url-about-blank',
    ...limits, targetKind, targetMatches: 0, targetGetterRegistered: false, sameGetterRealms: 0, sameGetterRealmKinds: [],
    phase: 'init', registrationAttempts: 0, registeredRealms: 0, registeredKinds: counters(KINDS), uniqueGetters: 0,
    sharedRegistrations: 0, observedChildren: 0, skippedFactories: 0, unsupportedRealms: 0, installationFailures: 0,
    totalHits: 0, hitsBySelectedKind: counters(KINDS), hitsByPhase: counters(PHASES),
    unknownPauses: 0, records: [], recordLimitReached: false, realmLimitReached: false, hitLimitReached: false,
    installedBreakpoints: 0, removedBreakpoints: 0, inspectorErrors: 0, resumeFailures: 0,
    restoreConflict: false, restoreFailures: 0, retainedRealmsReleased: 0, disposed: false };
  let connected = false, runtimeEnabled = false, debuggerEnabled = false, hookInstalled = false, closing = false;
  let breakpointId, selectedEntry;
  function post(method, params = {}) {
    let done = false, failure, response;
    session.post(method, params, (error, result) => { done = true; failure = error; response = result; });
    if (!done || failure) throw new HostError('NATIVE_STACK_PROTOCOL_FAILED');
    return response;
  }
  function removeBreakpoint() {
    if (!breakpointId) return;
    try { post('Debugger.removeBreakpoint', { breakpointId }); breakpointId = undefined; increment(state, 'removedBreakpoints'); }
    catch { increment(state, 'inspectorErrors'); }
  }
  function paused({ params }) {
    try {
      if (closing || state.disposed) return;
      if (!breakpointId || !Array.isArray(params?.hitBreakpoints) || !params.hitBreakpoints.includes(breakpointId)) { increment(state, 'unknownPauses'); return; }
      if (state.hitLimitReached) return;
      const sameGetterRealmKinds = KINDS.filter(kind => selectedEntry.kinds.has(kind));
      increment(state, 'totalHits'); increment(state.hitsBySelectedKind, targetKind); increment(state.hitsByPhase, state.phase);
      if (state.records.length < limits.maximumRecords) state.records.push({ phase: state.phase, selectedTargetKind: targetKind,
        sameGetterRealmKinds, registeredIdentityShared: selectedEntry.registrations > 1, attribution: 'selected-breakpoint-only' });
      else state.recordLimitReached = true;
      if (state.totalHits >= limits.maximumHits) { state.hitLimitReached = true; removeBreakpoint(); }
    } catch { increment(state, 'inspectorErrors'); }
    finally { try { post('Debugger.resume'); } catch { increment(state, 'resumeFailures'); } }
  }
  function installGetter(getter, entry) {
    let handle;
    const registryKey = '__native_stack_getter_' + randomBytes(16).toString('hex');
    if (descriptorOf(globalThis, registryKey)) throw new HostError('NATIVE_STACK_REGISTRY_COLLISION');
    Object.defineProperty(globalThis, registryKey, { configurable: true, value: getter });
    try {
      const response = post('Runtime.evaluate', { expression: 'globalThis[' + JSON.stringify(registryKey) + ']', objectGroup, generatePreview: false, returnByValue: false, silent: true });
      if (response.exceptionDetails || response.result?.type !== 'function' || typeof response.result?.objectId !== 'string') throw new HostError('NATIVE_STACK_GETTER_HANDLE_FAILED');
      handle = response.result.objectId;
    } finally { delete globalThis[registryKey]; }
    try {
      const result = post('Debugger.setBreakpointOnFunctionCall', { objectId: handle });
      if (typeof result.breakpointId !== 'string') throw new HostError('NATIVE_STACK_BREAKPOINT_FAILED');
      breakpointId = result.breakpointId; selectedEntry = entry;
      state.targetGetterRegistered = true; increment(state, 'installedBreakpoints');
    } finally { if (handle) post('Runtime.releaseObject', { objectId: handle }); }
  }
  function register(realm, kind, ErrorConstructor) {
    const selected = kind === targetKind && state.targetMatches === limits.targetIndex;
    if (kind === targetKind) increment(state, 'targetMatches');
    if (state.registrationAttempts >= limits.maximumRealms) { state.realmLimitReached = true; return; }
    increment(state, 'registrationAttempts');
    // Construct locally only to obtain the OWN getter descriptor. The Error
    // itself never crosses CDP; stack, this and remote error values are unused.
    if (!native(ErrorConstructor) || ownData(ErrorConstructor, 'name') !== 'Error') { increment(state, 'unsupportedRealms'); return; }
    const error = Reflect.construct(ErrorConstructor, []), getter = descriptorOf(error, 'stack')?.get;
    if (!native(getter)) { increment(state, 'unsupportedRealms'); return; }
    let entry = getters.get(getter);
    if (entry) { entry.kinds.add(kind); entry.registrations++; increment(state, 'sharedRegistrations'); }
    else { entry = { kinds: new Set([kind]), registrations: 1 }; getters.set(getter, entry); increment(state, 'uniqueGetters'); }
    realms.push({ realm, getter }); increment(state, 'registeredRealms'); increment(state.registeredKinds, kind);
    if (selected) installGetter(getter, entry);
    if (selectedEntry) { state.sameGetterRealms = selectedEntry.registrations; state.sameGetterRealmKinds = KINDS.filter(value => selectedEntry.kinds.has(value)); }
  }
  function createWindowWithNativeStackObservation(factoryOptions) {
    const child = Reflect.apply(originalFactory.value, this, arguments);
    if (closing || state.disposed) return child;
    if (!factoryOptions || !descriptorOf(factoryOptions, 'parentOrigin')) { increment(state, 'skippedFactories'); return child; }
    increment(state, 'observedChildren');
    if (ownData(factoryOptions, 'runScripts') !== 'outside-only') { increment(state, 'unsupportedRealms'); return child; }
    try {
      const proxy = ownData(child, '_globalProxy'), url = ownData(factoryOptions, 'url');
      if (!proxy || typeof url !== 'string') { increment(state, 'unsupportedRealms'); return child; }
      register(proxy, url === 'about:blank' ? 'sourceless' : 'sourced', ownData(proxy, 'Error'));
    } catch { increment(state, 'installationFailures'); }
    return child;
  }
  function dispose() {
    if (state.disposed || closing) return;
    closing = true;
    if (hookInstalled) {
      try {
        if (descriptorOf(WindowModule, 'createWindow')?.value === createWindowWithNativeStackObservation) Object.defineProperty(WindowModule, 'createWindow', originalFactory);
        else state.restoreConflict = true;
      } catch { state.restoreConflict = true; increment(state, 'restoreFailures'); }
    }
    if (connected) {
      removeBreakpoint();
      try { post('Runtime.releaseObjectGroup', { objectGroup }); } catch { increment(state, 'inspectorErrors'); }
      if (debuggerEnabled) try { post('Debugger.disable'); } catch { increment(state, 'inspectorErrors'); }
      if (runtimeEnabled) try { post('Runtime.disable'); } catch { increment(state, 'inspectorErrors'); }
      session.off('Debugger.paused', paused);
      try { session.disconnect(); } catch { increment(state, 'inspectorErrors'); }
    }
    state.retainedRealmsReleased = realms.length; realms.length = 0; getters.clear(); selectedEntry = undefined;
    state.disposed = true; if (activeOwner === owner) activeOwner = undefined;
  }
  try {
    session.connect(); connected = true; session.on('Debugger.paused', paused);
    post('Runtime.enable'); runtimeEnabled = true; post('Debugger.enable'); debuggerEnabled = true;
    register(globalThis, 'host', HostError); register(window, 'top', ownData(window, 'Error'));
    Object.defineProperty(WindowModule, 'createWindow', { ...originalFactory, value: createWindowWithNativeStackObservation }); hookInstalled = true;
  } catch { dispose(); throw new HostError('NATIVE_STACK_INSTALL_FAILED'); }
  return {
    setPhase(phase) {
      if (!PHASES.includes(phase)) throw new HostError('NATIVE_STACK_INVALID_PHASE');
      if (state.disposed) throw new HostError('NATIVE_STACK_DISPOSED');
      state.phase = phase;
    },
    snapshot() { return JSON.parse(JSON.stringify(state)); },
    dispose,
  };
}
