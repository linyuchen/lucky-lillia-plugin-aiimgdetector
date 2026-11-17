import { JSDOM, VirtualConsole, ResourceLoader, CookieJar } from 'jsdom';
import jsdomUtils from 'jsdom/lib/jsdom/living/generated/utils.js';
import internalConstants from 'jsdom/lib/jsdom/living/helpers/internal-constants.js';
import { Script } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { totalmem, platform, arch } from 'node:os';
import { createRuntimeDiagnostics } from './runtime-diagnostics.mjs';
import { readProbeNames, readProbeStageNames, evalProbeErrorNames, evalProbeErrorCategories } from './runtime-read-diagnostics.mjs';
import { enableScriptingParsingForOutsideOnly } from './scripting-parser.mjs';
import { createEventListenerDiagnostics } from './event-listener-diagnostics.mjs';
import { installEventClockCompatibility } from './jsdom-event-clock-compat.mjs';
import { createNodeNavigationDiagnostics } from './node-navigation-diagnostics.mjs';
import { createNodePlatformFailureDiagnostics } from './node-platform-failure-diagnostics.mjs';
import { sendPrivatePayload } from './payload-private-send.mjs';
import { copyNumericVectorPacket, clearNumericVectorPacket } from './numeric-vector-intervention-y.mjs';
import { createSnapshotProgressEmitter } from './snapshot-progress-bd.mjs';

// Experimental, persistent interpreter child. All secrets travel only over its
// private pipes. The parent owns a second deadline and hard process termination.
// Node filesystem permissions and supplied resources are NOT a network sandbox.
const VERSION = 1;
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const SYNC_TIMEOUT = 5000;
let dom, context, probe, phase = 'empty', stopping = false, inputBuffer = '';
let initializedAt = 0, snapshotCount = 0;
let collectPropertyReads = false;
let observeScalarCandidates = false;
let enablePointerDiagnostics = false;
let enableEventGetterDiagnostics = false;
let enablePlatformEventDiagnostics = false;
let eventListenerProbe;
let eventClockCompatibility;
let clockPrecisionControl;
let nativeTimerResolutionControl;
let rafCallableControl;
let displayFrameControl;
let runtimeWebCompatibility;
let runtimeNavigatorCompatibility;
let runtimeWindowStateCompatibility;
let runtimeChildWebCompatibility;
let runtimeDetachedFrameCompatibility;
let webidlBrandErrorAdapter;
let runtimeWebIdlRealmCompatibility;
let runtimeWebIdlCallableControl;
let nativePluginGetters;
let runtimeAbstractWebGlBindings;
let runtimeAbstractWebGlBindingsDisposeFailed = false;
let runtimeAbstractWebGlBindingsChildren = false;
let runtimeAbstractInterfaceBindings;
let runtimeAbstractInterfaceBindingsDisposeFailed = false;
let runtimePermissionsControl;
let runtimeAnchorHrefTranslate;
let runtimeChromeCsi;
let runtimeCssProperties;
let platformFailureDiagnostics;
let restoreActivationState;
let activationDiagnostic;
let activationDiagnosticSource, activationTransientMs = 0;
let createActivationStateDiagnostic;
const descendantActivationControllers = new Map();
const activationPropagation = { operations: 0, descendantOperations: 0, lastVisitedDescendants: 0,
  lastSameOriginDescendants: 0, lastActivatedDescendants: 0, lastCrossOriginDescendants: 0,
  lastUnavailableDescendants: 0, lastFailures: 0, controllersCreated: 0, controllerRearms: 0,
  controllersDisposed: 0, disposeFailures: 0 };
let navigationProbe;
let navigationInspector;
let retainedFrameInspector;
let originalOpcodeInspector;
let originalGeneratedReadInspector;
let originalGeneratedSinkInspector;
let originalOutputInspector;
let currentOutputInspector;
let finalBufferAblationMode;
let numericVectorMode, numericVectorPacketInstalled = false, observeCipherWitness = false;
let functionToStringObservation;
let ownPropertyNamesObservation;
let anchorClickObserver;
let eventGetterProbe;
let exceptionProbe;
let nativeStackObservation;
let nativeWebdriverControl;
let nativeMediaControl;
let privateBootstrapBinding;
const diagnostics = { domErrors: 0, suppliedFrameRequests: 0, refusedResources: 0 };

class OperationError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const send = envelope => new Promise(resolve => process.stdout.write(JSON.stringify({ version: VERSION, ...envelope }) + '\n', resolve));
const bounded = async (promise, timeoutMs) => {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new OperationError('OPERATION_TIMEOUT')), timeoutMs); })]);
  } finally { clearTimeout(timer); }
};
const timeoutFor = (request, fallback) => Number.isInteger(request.timeoutMs) && request.timeoutMs >= 10 && request.timeoutMs <= (request.op === 'init' && request.input?.observeScalarCandidates === true ? 180000 : 120000) ? request.timeoutMs : fallback;
const run = source => new Script(source, { filename: 'synthid-lifecycle-realm.js' }).runInContext(context, { timeout: SYNC_TIMEOUT });
const runPrivateBootstrap = (operation, argument) => {
  if (!privateBootstrapBinding || !['initialize', 'snapshot', 'metrics', 'shutdown', 'shutdownStatus', 'seal'].includes(operation)) throw new OperationError('PRIVATE_BOOTSTRAP_UNAVAILABLE');
  const parameters = argument === undefined ? '' : 'JSON.parse(' + JSON.stringify(JSON.stringify(argument)) + ')';
  return run(privateBootstrapBinding + '.' + operation + '(' + parameters + ')');
};
const metrics = () => {
  if (!context) return { errors: [] };
  // Read metrics inside the bounded realm, not via untrusted host-side getters.
  const encoded = privateBootstrapBinding ? runPrivateBootstrap('metrics') : run('JSON.stringify({experimentCount: __metrics.experimentCount, stateField5: __metrics.stateField5, errors: __metrics.errors.filter(Number.isSafeInteger).slice(0, 20)})');
  return typeof encoded === 'string' && encoded.length < 4096 ? JSON.parse(encoded) : { errors: [] };
};
const propertyReadMetrics = () => {
  if (!context || !collectPropertyReads) return undefined;
  const encoded = run('JSON.stringify(globalThis.__synthidReadDiagnosticReport?.() || {})');
  if (typeof encoded !== 'string' || encoded.length > 65536) return { invalid: true };
  const raw = JSON.parse(encoded);
  return Object.fromEntries(readProbeNames.filter(name => raw[name] && typeof raw[name] === 'object').map(name => [name,
    Object.fromEntries(['defined', 'undefined', 'null', 'throws', 'inTrue', 'inFalse', 'inThrows'].filter(outcome => Number.isInteger(raw[name][outcome]) && raw[name][outcome] >= 0 && raw[name][outcome] <= 1000000).map(outcome => [outcome, raw[name][outcome]])),
  ]));
};
const inspect = () => ({
  success: true, phase, snapshotCount, aliveMs: initializedAt ? Date.now() - initializedAt : 0,
  engine: { node: process.versions.node, v8: process.versions.v8, modules: process.versions.modules },
  diagnostics: { ...diagnostics }, metrics: metrics(),
  platformFailures: platformFailureDiagnostics?.snapshot(),
  clockPrecisionControl: clockPrecisionControl?.snapshot(),
  runtimeDiagnostics: probe?.snapshot(),
  propertyReads: propertyReadMetrics(),
  runtimeFlow: runtimeFlowMetrics(),
  evalDiagnostics: evalMetrics(),
  exceptionDiagnostics: exceptionProbe?.snapshot(),
  nativeStackObservation: nativeStackObservation?.snapshot(),
  nativeWebdriverControl: nativeWebdriverControl?.snapshot(),
  nativeMediaControl: nativeMediaControl?.snapshot(),
  eventListeners: eventListenerProbe?.snapshot(),
  navigationDiagnostics: navigationProbe?.snapshot(),
  navigationInspector: navigationInspector?.snapshot(),
  retainedFrameInspector: retainedFrameInspector?.snapshot(),
  originalOpcodeInspector: originalOpcodeInspector?.snapshot(),
  originalGeneratedReadInspector: originalGeneratedReadInspector?.snapshot(),
  originalGeneratedSinkInspector: originalGeneratedSinkInspector?.snapshot(),
  originalOutputInspector: originalOutputInspector?.snapshot(),
  currentOutputInspector: currentOutputInspector?.snapshot(),
  functionToStringObservation: functionToStringObservation?.snapshot(),
  ownPropertyNamesObservation: ownPropertyNamesObservation?.snapshot(), nativeTimerResolutionControl:nativeTimerResolutionControl?.snapshot(), rafCallableControl:rafCallableControl?.snapshot(), displayFrameControl:displayFrameControl?.snapshot(),
  anchorClickObservation: anchorClickObserver?.snapshot(),
  runtimeChildWebCompatibility: runtimeChildWebCompatibility?.snapshot(),
  runtimeDetachedFrameCompatibility: runtimeDetachedFrameCompatibility?.snapshot(),
  webidlBrandErrors: webidlBrandErrorAdapter?.webidlBrandErrorSnapshot(),
  runtimeWebIdlRealmCompatibility: runtimeWebIdlRealmCompatibility?.snapshot(),
  runtimeWebIdlCallableControl: runtimeWebIdlCallableControl?.snapshot(),
  nativePluginGetters: nativePluginGetters?.snapshot(),
  runtimeAbstractWebGlBindings: runtimeAbstractWebGlBindings?.snapshot(),
  runtimeAbstractInterfaceBindings: runtimeAbstractInterfaceBindings?.snapshot(),
  runtimePermissionsControl: runtimePermissionsControl?.snapshot(),
  runtimeAnchorHrefTranslate: runtimeAnchorHrefTranslate?.snapshot(),
  runtimeChromeCsi: runtimeChromeCsi?.snapshot(),
  runtimeCssProperties: runtimeCssProperties?.snapshot(),
  runtimeMediaQueries: runtimeWebCompatibility?.snapshot()?.mediaQueries,
  runtimeNavigatorCompatibility: runtimeNavigatorCompatibility?.snapshot(),
  runtimeWindowStateCompatibility: runtimeWindowStateCompatibility?.snapshot(),
  activationDiagnostic: activationDiagnostic?.snapshot(),
  activationPropagation: { ...activationPropagation },
  runtimeUserActivationReads: {
    topController: runtimeWebCompatibility?.snapshot()?.userActivationReads,
    childControllers: runtimeChildWebCompatibility?.snapshot()?.userActivationReads,
  },
});
function disposeDescendantActivation(document) {
  const controller = descendantActivationControllers.get(document);
  if (!controller) return;
  try { controller.dispose(); activationPropagation.controllersDisposed++; }
  catch { activationPropagation.disposeFailures++; }
  descendantActivationControllers.delete(document);
}
function activateDiagnostics(sameOriginDescendants) {
  if (typeof sameOriginDescendants !== 'boolean') throw new OperationError('INVALID_INPUT');
  if (phase !== 'ready' || typeof activationDiagnostic?.activate !== 'function') throw new OperationError('NOT_READY');
  for (const name of ['lastVisitedDescendants', 'lastSameOriginDescendants', 'lastActivatedDescendants',
    'lastCrossOriginDescendants', 'lastUnavailableDescendants', 'lastFailures']) activationPropagation[name] = 0;
  activationPropagation.operations++;
  if (!sameOriginDescendants) { activationDiagnostic.activate(); return inspect(); }
  activationPropagation.descendantOperations++;
  const topDocument = jsdomUtils.implForWrapper(dom.window.document);
  // JSDOM stores inherited about:blank origin here; location.origin would be
  // "null". Its serialized opaque origins cannot prove equality, so reject.
  if (!topDocument || typeof topDocument._origin !== 'string' || topDocument._origin === 'null') throw new OperationError('ACTIVATION_ORIGIN_UNAVAILABLE');
  const documents = new Set([topDocument]), queue = [{ document: topDocument, sandboxed: false }], targets = [];
  let visitedNodes = 0;
  for (let index = 0; index < queue.length; index++) {
    const { document, sandboxed } = queue[index], roots = [document];
    // Traverse the actual connected DOM tree, independent of overwritten page
    // querySelectorAll/window.length. Cross-origin documents are traversed only
    // to find same-origin descendants; their realms are never evaluated here.
    for (let rootIndex = 0; rootIndex < roots.length; rootIndex++) for (const node of internalConstants.domSymbolTree.treeIterator(roots[rootIndex])) {
      if (++visitedNodes > 100000) throw new OperationError('ACTIVATION_TREE_LIMIT');
      if (node._shadowRoot) roots.push(node._shadowRoot);
      if (node._localName !== 'iframe' && node._localName !== 'frame') continue;
      if (node._ownerDocument !== document) continue;
      const childDocument = node._contentDocument;
      if (!childDocument || documents.has(childDocument)) continue;
      if (documents.size >= 256) throw new OperationError('ACTIVATION_FRAME_LIMIT');
      const sandbox = node.getAttributeNS(null, 'sandbox');
      const childSandboxed = sandboxed || sandbox !== null && !sandbox.toLowerCase().split(/\s+/).includes('allow-same-origin');
      documents.add(childDocument); queue.push({ document: childDocument, sandboxed: childSandboxed });
      activationPropagation.lastVisitedDescendants++;
      // JSDOM does not model sandbox opaque-origin identity. Never treat its
      // serialized URL origin as evidence of same origin for that subtree.
      if (childSandboxed) activationPropagation.lastUnavailableDescendants++;
      else if (childDocument._origin === topDocument._origin) {
        targets.push(childDocument); activationPropagation.lastSameOriginDescendants++;
      } else activationPropagation.lastCrossOriginDescendants++;
    }
  }
  for (const document of descendantActivationControllers.keys()) {
    if (!documents.has(document)) disposeDescendantActivation(document);
  }
  activationDiagnostic.activate();
  for (const document of targets) {
    try {
      let controller = descendantActivationControllers.get(document);
      if (controller) { controller.activate(); activationPropagation.controllerRearms++; }
      else {
        const window = document._defaultView;
        if (!window) { activationPropagation.lastUnavailableDescendants++; continue; }
        if (createActivationStateDiagnostic) controller = createActivationStateDiagnostic(window, activationTransientMs);
        else {
          if (!window.navigator?.userActivation) { activationPropagation.lastUnavailableDescendants++; continue; }
          const childContext = Object.getOwnPropertyDescriptor(window, '_globalObject')?.value;
          controller = new Script(activationDiagnosticSource + '(' + activationTransientMs + ')',
            { filename: 'synthid-activation-diagnostic.js' }).runInContext(childContext, { timeout: SYNC_TIMEOUT });
        }
        descendantActivationControllers.set(document, controller); activationPropagation.controllersCreated++;
      }
      activationPropagation.lastActivatedDescendants++;
    } catch { activationPropagation.lastFailures++; }
  }
  return inspect();
}
function runtimeFlowMetrics() {
  if (!context || !collectPropertyReads) return undefined;
  const encoded = run('JSON.stringify(globalThis.__synthidRuntimeFlowReport?.() || {})');
  if (typeof encoded !== 'string' || encoded.length > 65536) return { invalid: true };
  const raw = JSON.parse(encoded);
  const counters = (input, names) => Object.fromEntries(names.filter(name => Number.isInteger(input?.[name]) && input[name] >= 0 && input[name] <= 1000000).map(name => [name, input[name]]));
  return { stages: counters(raw.stages, readProbeStageNames), knownCalls: counters(raw.knownCalls, readProbeNames) };
}
function evalMetrics() {
  if (!context || !collectPropertyReads) return undefined;
  const encoded = run('JSON.stringify(globalThis.__synthidEvalDiagnosticReport?.() || {})');
  if (typeof encoded !== 'string' || encoded.length > 65536) return { invalid: true };
  const raw = JSON.parse(encoded);
  const counters = (input, names) => Object.fromEntries(names.filter(name => Number.isInteger(input?.[name]) && input[name] >= 0 && input[name] <= 1000000).map(name => [name, input[name]]));
  return { ...counters(raw, ['evaluations', 'functionResults', 'nonFunctionResults', 'oversizedSources', 'associatedCalls', 'unassociatedCalls', 'associatedThrows', 'unassociatedThrows']),
    ...Object.fromEntries(['sourceMentions', 'calledSourceMentions', 'thrownSourceMentions', 'stringArgumentCalls', 'stringArgumentThrows', 'missingNames'].map(field => [field, counters(raw[field], readProbeNames)])),
    errorNames: counters(raw.errorNames, [...evalProbeErrorNames, 'other']), errorCategories: counters(raw.errorCategories, evalProbeErrorCategories),
  };
}
const closeDom = () => {
  // The lexical controller retains the original state even if its Window key
  // was replaced. Seal before closing the realm; late setup cannot revive it.
  if (privateBootstrapBinding && context) { try { runPrivateBootstrap('seal'); } catch {} }
  privateBootstrapBinding = undefined;
  for (const document of descendantActivationControllers.keys()) disposeDescendantActivation(document);
  try { nativeStackObservation?.dispose(); } catch {}
  try { ownPropertyNamesObservation?.dispose(); } catch {}
  try { functionToStringObservation?.dispose(); } catch {}
  if (runtimeAbstractInterfaceBindings) try {
    const disposed = runtimeAbstractInterfaceBindings.dispose();
    if (disposed?.disposed !== true || disposed.restoreConflicts !== 0 || disposed.restoreFailures !== 0
        || disposed.bindingsRestored !== disposed.bindingsInstalled || disposed.childFailures !== 0) runtimeAbstractInterfaceBindingsDisposeFailed = true;
  } catch { runtimeAbstractInterfaceBindingsDisposeFailed = true; }
  if (runtimeAbstractWebGlBindings) try {
    const disposed = runtimeAbstractWebGlBindings.dispose();
    if (disposed?.disposed !== true || disposed.restoreConflicts !== 0 || disposed.restoreFailures !== 0
        || disposed.bindingsRestored !== disposed.bindingsInstalled
        || runtimeAbstractWebGlBindingsChildren && disposed.childFactoryRestored !== true) runtimeAbstractWebGlBindingsDisposeFailed = true;
  } catch { runtimeAbstractWebGlBindingsDisposeFailed = true; }
  try { rafCallableControl?.dispose(); } catch {}
  try { displayFrameControl?.dispose(); } catch {}
  try { nativeMediaControl?.dispose(); } catch {}
  try { nativeWebdriverControl?.dispose(); } catch {}
  try { anchorClickObserver?.dispose(); } catch {}
  try { runtimeAnchorHrefTranslate?.dispose(); } catch {}
  try { runtimePermissionsControl?.dispose(); } catch {}
  try { nativePluginGetters?.dispose(); } catch {}
  try { runtimeWebIdlCallableControl?.dispose(); } catch {}
  try { runtimeWebIdlRealmCompatibility?.dispose(); } catch {}
  try { runtimeCssProperties?.dispose(); } catch {}
  try { runtimeWindowStateCompatibility?.dispose(); } catch {}
  try { runtimeNavigatorCompatibility?.dispose(); } catch {}
  if (clockPrecisionControl) try { runtimeDetachedFrameCompatibility?.dispose(); } catch {}
  try { runtimeChildWebCompatibility?.dispose(); } catch {}
  try { restoreActivationState?.(); } catch {}
  try { runtimeWebCompatibility?.dispose(); } catch {}
  if (!clockPrecisionControl) try { runtimeDetachedFrameCompatibility?.dispose(); } catch {}
  void eventGetterProbe?.dispose().catch(() => {});
  void navigationInspector?.dispose().catch(() => {});
  void retainedFrameInspector?.dispose().catch(() => {});
  void originalOpcodeInspector?.dispose().catch(() => {});
  void originalGeneratedReadInspector?.dispose().catch(() => {});
  void originalGeneratedSinkInspector?.dispose().catch(() => {});
  void originalOutputInspector?.dispose().catch(() => {});
  void currentOutputInspector?.dispose().catch(() => {});
  try { eventListenerProbe?.dispose(); } catch {}
  try { navigationProbe?.dispose(); } catch {}
  try { probe?.dispose(); } catch {}
  try { runtimeChromeCsi?.dispose(); } catch {}
  try { dom?.window.close(); } catch {}
  try { eventClockCompatibility?.dispose(); } catch {}
  try { clockPrecisionControl?.dispose(); } catch {}
  try { nativeTimerResolutionControl?.dispose(); } catch {}
  dom = undefined; context = undefined;
};
async function shutdown(timeoutMs) {
  let shutdownInvoked = false, shutdownCompleted = false;
  if (context) {
    try {
      if (privateBootstrapBinding) {
        const readSummary = encoded => {
          if (typeof encoded !== 'string' || encoded.length > 4096) throw new OperationError('PRIVATE_BOOTSTRAP_INVALID_SUMMARY');
          const result = JSON.parse(encoded);
          shutdownInvoked = result.shutdownInvoked === true;
          shutdownCompleted = result.shutdownCompleted === true;
        };
        const completion = runPrivateBootstrap('shutdown');
        readSummary(runPrivateBootstrap('shutdownStatus'));
        readSummary(await bounded(Promise.resolve(completion), timeoutMs));
      } else {
        shutdownInvoked = run('typeof globalThis.__shutdown === "function"');
        if (shutdownInvoked) {
          await bounded(Promise.resolve(run('(() => { const shutdown = globalThis.__shutdown; return shutdown(); })()')), timeoutMs);
          shutdownCompleted = true;
        }
      }
    } catch {}
  }
  await eventGetterProbe?.dispose().catch(() => {});
  await navigationInspector?.dispose().catch(() => {});
  await retainedFrameInspector?.dispose().catch(() => {});
  await originalOpcodeInspector?.dispose().catch(() => {});
  await originalGeneratedReadInspector?.dispose().catch(() => {});
  await originalGeneratedSinkInspector?.dispose().catch(() => {});
  await originalOutputInspector?.dispose().catch(() => {});
  await currentOutputInspector?.dispose().catch(() => {});
  closeDom();
  if(displayFrameControl)try{await bounded(displayFrameControl.drain(),timeoutMs);}catch{}
  await exceptionProbe?.dispose().catch(() => {});
  phase = 'disposed';
  return { success: !runtimeAbstractWebGlBindingsDisposeFailed && !runtimeAbstractInterfaceBindingsDisposeFailed, phase, snapshotCount, shutdownInvoked, shutdownCompleted, originalGeneratedSinkInspector: originalGeneratedSinkInspector?.snapshot(), runtimeAbstractWebGlBindings: runtimeAbstractWebGlBindings?.snapshot(), runtimeAbstractWebGlBindingsDisposeFailed, runtimeAbstractInterfaceBindings: runtimeAbstractInterfaceBindings?.snapshot(), runtimeAbstractInterfaceBindingsDisposeFailed, activationPropagation: { ...activationPropagation }, currentOutputInspector:currentOutputInspector?.snapshot(), ownPropertyNamesObservation: ownPropertyNamesObservation?.snapshot(), nativeTimerResolutionControl:nativeTimerResolutionControl?.snapshot(), rafCallableControl:rafCallableControl?.snapshot(), displayFrameControl:displayFrameControl?.snapshot(), functionToStringObservation:functionToStringObservation?.snapshot(), clockPrecisionControl: clockPrecisionControl?.snapshot(), runtimeChromeCsi: runtimeChromeCsi?.snapshot(), runtimeCssProperties: runtimeCssProperties?.snapshot() };
}
function validateInput(input) {
  if (!input || typeof input !== 'object') throw new OperationError('INVALID_INPUT');
  if (input.runtimePrivateBootstrapState !== undefined && typeof input.runtimePrivateBootstrapState !== 'boolean') throw new OperationError('INVALID_INPUT');
  if (input.userActivationWebIdlCompatibility !== undefined && (typeof input.userActivationWebIdlCompatibility !== 'boolean'
      || input.userActivationWebIdlCompatibility && !input.runtimeWebCompatibility)) throw new OperationError('INVALID_INPUT');
  if(input.nativeDisplayFrames!==undefined&&typeof input.nativeDisplayFrames!=='boolean')throw new OperationError('INVALID_INPUT');
  if(input.chromiumTimeClamper!==undefined&&(typeof input.chromiumTimeClamper!=='boolean'||input.chromiumTimeClamper&&(!input.nativeDisplayFrames||!input.clockPrecision100us)))throw new OperationError('INVALID_INPUT');
  if(input.rafCallableControl!==undefined&&typeof input.rafCallableControl!=='boolean')throw new OperationError('INVALID_INPUT');
  if(input.nativeTimerResolution!==undefined&&typeof input.nativeTimerResolution!=='boolean')throw new OperationError('INVALID_INPUT');
  if (input.clockPrecision100us !== undefined && (typeof input.clockPrecision100us !== 'boolean' || (input.clockPrecision100us && (!input.eventClockCompatibility || !input.runtimeWebCompatibility || !input.runtimeChildWebCompatibility)))) throw new OperationError('INVALID_INPUT');
  if(input.toStringComparison!==undefined&&(!input.functionToStringObservation||!Array.isArray(input.toStringComparison?.keyBytes)||input.toStringComparison.keyBytes.length!==32||input.toStringComparison.keyBytes.some(value=>!Number.isInteger(value)||value<0||value>255)))throw new OperationError('INVALID_INPUT');
  if(input.sortComparison!==undefined&&(!input.ownNamesUntrackedSortResults||!Array.isArray(input.sortComparison?.keyBytes)||input.sortComparison.keyBytes.length!==32||input.sortComparison.keyBytes.some(value=>!Number.isInteger(value)||value<0||value>255)))throw new OperationError('INVALID_INPUT');
  const sortIdentityRegistryKey=input.sortIdentityRegistryKey;
  if(sortIdentityRegistryKey!==undefined&&(typeof sortIdentityRegistryKey!=='string'||!/^__synthid_sort_identity_[a-f0-9]{32}$/.test(sortIdentityRegistryKey)||input.ownNamesUntrackedSortResults!==true||input.currentBoundProducerDiagnostics!==true||input.currentBoundEarlyProducerDiagnostics===true))throw new OperationError('INVALID_INPUT');
  if(input.sortNumberProfiles!==undefined&&(typeof input.sortNumberProfiles!=='boolean'||input.sortNumberProfiles&&input.sortComparison===undefined))throw new OperationError('INVALID_INPUT');
  if(input.messageComparison!==undefined&&(!input.currentReadInspector||!input.originalGeneratedSinkInspector||!Array.isArray(input.messageComparison?.keyBytes)||input.messageComparison.keyBytes.length!==32||input.messageComparison.keyBytes.some(value=>!Number.isInteger(value)||value<0||value>255)))throw new OperationError('INVALID_INPUT');
  if(input.nativeStackTarget!==undefined&&!['top','host','sourced','sourceless'].includes(input.nativeStackTarget))throw new OperationError('INVALID_INPUT');
  if(input.nativeStackObservation!==undefined&&(typeof input.nativeStackObservation!=='boolean'||(input.nativeStackObservation&&[input.originalOutputInspector,input.originalGeneratedSinkInspector,input.originalGeneratedReadInspector,input.originalOpcodeInspector,input.navigationInspector,input.retainedFrameInspector,input.exceptionDiagnostics,input.readDiagnostics,input.currentOutputDiagnostics,input.enableEventGetterDiagnostics,input.functionToStringObservation,input.diagnostics].some(Boolean))))throw new OperationError('INVALID_INPUT');
  if(input.currentPayloadDiagnostics!==undefined&&(typeof input.currentPayloadDiagnostics!=='boolean'||input.currentPayloadDiagnostics&&!input.currentOutputDiagnostics))throw new OperationError('INVALID_INPUT');
  if(input.currentSourceCoverageDiagnostics!==undefined&&(typeof input.currentSourceCoverageDiagnostics!=='boolean'||input.currentSourceCoverageDiagnostics&&(!input.currentOutputDiagnostics||input.currentPayloadDiagnostics)))throw new OperationError('INVALID_INPUT');
  if(input.currentBoundProducerDiagnostics!==undefined&&(typeof input.currentBoundProducerDiagnostics!=='boolean'||input.currentBoundProducerDiagnostics&&!input.currentBoundOriginDiagnostics))throw new OperationError('INVALID_INPUT');
  if(input.currentBoundEarlyProducerDiagnostics!==undefined&&(typeof input.currentBoundEarlyProducerDiagnostics!=='boolean'||input.currentBoundEarlyProducerDiagnostics&&!input.currentBoundProducerDiagnostics))throw new OperationError('INVALID_INPUT');
  if(input.currentBoundOriginDiagnostics!==undefined&&(typeof input.currentBoundOriginDiagnostics!=='boolean'||input.currentBoundOriginDiagnostics&&!input.currentBoundPayloadDiagnostics))throw new OperationError('INVALID_INPUT');
  if(input.currentBoundPayloadDiagnostics!==undefined&&(typeof input.currentBoundPayloadDiagnostics!=='boolean'||input.currentBoundPayloadDiagnostics&&(!input.currentOutputDiagnostics||input.currentPayloadDiagnostics||input.currentSourceCoverageDiagnostics)))throw new OperationError('INVALID_INPUT');
  if(input.currentOutputDiagnostics!==undefined&&(typeof input.currentOutputDiagnostics!=='boolean'||(input.currentOutputDiagnostics&&[input.originalOutputInspector,input.originalGeneratedSinkInspector,input.originalGeneratedReadInspector,input.originalOpcodeInspector,input.navigationInspector,input.retainedFrameInspector,input.exceptionDiagnostics,input.readDiagnostics].some(Boolean))))throw new OperationError('INVALID_INPUT');
  if(input.finalBufferAblationMode!==undefined&&(!['self','omit'].includes(input.finalBufferAblationMode)||input.currentOutputDiagnostics!==true||[input.currentPayloadDiagnostics,input.currentSourceCoverageDiagnostics,input.currentBoundPayloadDiagnostics,input.currentBoundOriginDiagnostics,input.currentBoundProducerDiagnostics,input.currentBoundEarlyProducerDiagnostics].some(Boolean)))throw new OperationError('INVALID_INPUT');
  if(input.numericVectorMode!==undefined&&(!['capture','self','replace'].includes(input.numericVectorMode)||input.currentOutputDiagnostics!==true||input.finalBufferAblationMode!==undefined||[input.currentPayloadDiagnostics,input.currentSourceCoverageDiagnostics,input.currentBoundPayloadDiagnostics,input.currentBoundOriginDiagnostics,input.currentBoundProducerDiagnostics,input.currentBoundEarlyProducerDiagnostics].some(Boolean)))throw new OperationError('INVALID_INPUT');
  if(input.observeInitPublicEntries!==undefined&&(typeof input.observeInitPublicEntries!=='boolean'||input.observeInitPublicEntries&&input.numericVectorMode===undefined))throw new OperationError('INVALID_INPUT');
  if(input.observeCipherWitness!==undefined&&(typeof input.observeCipherWitness!=='boolean'||input.observeCipherWitness&&input.numericVectorMode!=='capture'))throw new OperationError('INVALID_INPUT');
  if(input.observeScalarCandidates!==undefined&&(typeof input.observeScalarCandidates!=='boolean'||input.observeScalarCandidates&&!input.observeCipherWitness))throw new OperationError('INVALID_INPUT');
  if (input.interpreterSourceUrl !== undefined) {
    if (typeof input.interpreterSourceUrl !== 'string' || input.interpreterSourceUrl.length > 4096 || /[\r\n\0]/.test(input.interpreterSourceUrl)) throw new OperationError('INVALID_INPUT');
    let sourceUrl;
    try { sourceUrl = new URL(input.interpreterSourceUrl); } catch { throw new OperationError('INVALID_INPUT'); }
    if (sourceUrl.protocol !== 'https:' || !['www.google.com', 'www.gstatic.com'].includes(sourceUrl.hostname) || sourceUrl.username || sourceUrl.password || !sourceUrl.pathname.startsWith('/js/')) throw new OperationError('INVALID_INPUT');
  }
  if (input.currentReadInspector !== undefined && (typeof input.currentReadInspector !== 'boolean' || (input.currentReadInspector && !input.originalGeneratedSinkInspector))) throw new OperationError('INVALID_INPUT');
  if (input.originalGeneratedReadDurationMs !== undefined && (!Number.isInteger(input.originalGeneratedReadDurationMs)
      || input.originalGeneratedReadDurationMs < 30000 || input.originalGeneratedReadDurationMs > 120000
      || input.originalGeneratedSinkInspector !== true || input.currentReadInspector === true)) throw new OperationError('INVALID_INPUT');
  if (input.keyCoverageDiagnostics !== undefined && (typeof input.keyCoverageDiagnostics !== 'boolean' || (input.keyCoverageDiagnostics && !input.currentReadInspector))) throw new OperationError('INVALID_INPUT');
  if (input.unmatchedSinkCoverage !== undefined && (typeof input.unmatchedSinkCoverage !== 'boolean' || (input.unmatchedSinkCoverage && !input.currentReadInspector))) throw new OperationError('INVALID_INPUT');
  if (input.unmatchedSinkValueTypes !== undefined && (typeof input.unmatchedSinkValueTypes !== 'boolean' || (input.unmatchedSinkValueTypes && !input.unmatchedSinkCoverage))) throw new OperationError('INVALID_INPUT');
  if(input.unknownKeyComparison!==undefined&&(!input.keyCoverageDiagnostics||!input.currentReadInspector||!Array.isArray(input.unknownKeyComparison?.keyBytes)||input.unknownKeyComparison.keyBytes.length!==32||input.unknownKeyComparison.keyBytes.some(value=>!Number.isInteger(value)||value<0||value>255)))throw new OperationError('INVALID_INPUT');
  if(input.numericKeyComparison!==undefined&&(input.unknownKeyComparison!==undefined||!input.keyCoverageDiagnostics||!input.currentReadInspector||!Array.isArray(input.numericKeyComparison?.keyBytes)||input.numericKeyComparison.keyBytes.length!==32||input.numericKeyComparison.keyBytes.some(value=>!Number.isInteger(value)||value<0||value>255)))throw new OperationError('INVALID_INPUT');
  if (input.observeResolvedToString !== undefined && (typeof input.observeResolvedToString !== 'boolean' || (input.observeResolvedToString && !input.currentReadInspector))) throw new OperationError('INVALID_INPUT');
  if (input.runtimeNavigatorCompatibility !== undefined && (typeof input.runtimeNavigatorCompatibility !== 'boolean' || (input.runtimeNavigatorCompatibility && !input.runtimeWebCompatibility))) throw new OperationError('INVALID_INPUT');
  if (input.anchorClickObservation !== undefined && typeof input.anchorClickObservation !== 'boolean') throw new OperationError('INVALID_INPUT');
  if (input.runtimeWebIdlCallableControl !== undefined && (typeof input.runtimeWebIdlCallableControl !== 'boolean' || (input.runtimeWebIdlCallableControl && !input.runtimeWebIdlRealmCompatibility))) throw new OperationError('INVALID_INPUT');
  if (input.nativePluginGetters !== undefined && (typeof input.nativePluginGetters !== 'boolean' || (input.nativePluginGetters && !input.runtimeWebIdlRealmCompatibility))) throw new OperationError('INVALID_INPUT');
  if (input.runtimeAbstractWebGlBindings !== undefined && (typeof input.runtimeAbstractWebGlBindings !== 'boolean'
      || input.runtimeAbstractWebGlBindings && (!input.nativePluginGetters || !input.runtimeWebIdlRealmCompatibility))) throw new OperationError('INVALID_INPUT');
  if (input.runtimeAbstractInterfaceBindings !== undefined && (typeof input.runtimeAbstractInterfaceBindings !== 'boolean'
      || input.runtimeAbstractInterfaceBindings && (!input.nativePluginGetters || !input.runtimeWebIdlRealmCompatibility || input.runtimeAbstractWebGlBindings))) throw new OperationError('INVALID_INPUT');
  if (input.nativePluginBrandValidation !== undefined && (typeof input.nativePluginBrandValidation !== 'boolean' || (input.nativePluginBrandValidation && !input.nativePluginGetters))) throw new OperationError('INVALID_INPUT');
  if(input.nativeWebdriverGetter!==undefined&&(typeof input.nativeWebdriverGetter!=='boolean'||(input.nativeWebdriverGetter&&!input.nativePluginGetters)))throw new OperationError('INVALID_INPUT');
  if(input.nativeMediaBinding!==undefined&&(typeof input.nativeMediaBinding!=='boolean'||(input.nativeMediaBinding&&!input.nativePluginGetters)))throw new OperationError('INVALID_INPUT');
  if (input.runtimePermissionsBinding !== undefined && (typeof input.runtimePermissionsBinding !== 'boolean' || (input.runtimePermissionsBinding && !input.runtimeWebCompatibility))) throw new OperationError('INVALID_INPUT');
  if (input.runtimeAnchorHrefTranslate !== undefined && (typeof input.runtimeAnchorHrefTranslate !== 'boolean' || (input.runtimeAnchorHrefTranslate && !input.runtimeWebIdlRealmCompatibility))) throw new OperationError('INVALID_INPUT');
  if (input.runtimeMouseMediaCompatibility !== undefined && (typeof input.runtimeMouseMediaCompatibility !== 'boolean' || (input.runtimeMouseMediaCompatibility && !input.runtimeWebCompatibility))) throw new OperationError('INVALID_INPUT');
  if (input.runtimeChromeCsi !== undefined && (typeof input.runtimeChromeCsi !== 'boolean' || (input.runtimeChromeCsi && !input.runtimeWebCompatibility))) throw new OperationError('INVALID_INPUT');
  if (input.runtimeCssProperties !== undefined && (typeof input.runtimeCssProperties !== 'boolean' || (input.runtimeCssProperties && !input.runtimeWebCompatibility))) throw new OperationError('INVALID_INPUT');
  if (input.ownPropertyNamesObservation !== undefined && (typeof input.ownPropertyNamesObservation !== 'boolean' || (input.ownPropertyNamesObservation && !input.runtimeChildWebCompatibility))) throw new OperationError('INVALID_INPUT');
  if (input.ownNamesInterfaceIdentities !== undefined && (typeof input.ownNamesInterfaceIdentities !== 'boolean' || (input.ownNamesInterfaceIdentities && !input.ownPropertyNamesObservation))) throw new OperationError('INVALID_INPUT');
  if (input.ownNamesArrayConsumers !== undefined && (typeof input.ownNamesArrayConsumers !== 'boolean' || (input.ownNamesArrayConsumers && !input.ownPropertyNamesObservation))) throw new OperationError('INVALID_INPUT');
  if (input.ownNamesCrossRealmConsumers !== undefined && (typeof input.ownNamesCrossRealmConsumers !== 'boolean' || (input.ownNamesCrossRealmConsumers && !input.ownNamesArrayConsumers))) throw new OperationError('INVALID_INPUT');
  if (input.ownNamesUntrackedSortResults !== undefined && (typeof input.ownNamesUntrackedSortResults !== 'boolean' || (input.ownNamesUntrackedSortResults && !input.ownNamesCrossRealmConsumers))) throw new OperationError('INVALID_INPUT');
  if(input.rafSortScope!==undefined&&(!['sourced','top'].includes(input.rafSortScope)||input.rafSortScope==='top'&&!input.rafSortAttribution))throw new OperationError('INVALID_INPUT');
  if(input.rafSortAttribution!==undefined&&(typeof input.rafSortAttribution!=='boolean'||input.rafSortAttribution&&input.sortComparison===undefined))throw new OperationError('INVALID_INPUT');
  if (input.runtimeWebIdlRealmCompatibility !== undefined && (typeof input.runtimeWebIdlRealmCompatibility !== 'boolean' || (input.runtimeWebIdlRealmCompatibility && !input.runtimeWebCompatibility))) throw new OperationError('INVALID_INPUT');
  if (input.originalOutputInspector !== undefined && (typeof input.originalOutputInspector !== 'boolean' || (input.originalOutputInspector && [
    'originalGeneratedSinkInspector', 'originalGeneratedReadInspector', 'originalOpcodeInspector', 'retainedFrameInspector',
    'exceptionDiagnostics', 'enableEventGetterDiagnostics', 'navigationInspector', 'navigationDiagnostics', 'readDiagnostics',
  ].some(key => input[key])))) throw new OperationError('INVALID_INPUT');
  if (input.runtimeWebCompatibility !== undefined && typeof input.runtimeWebCompatibility !== 'boolean') throw new OperationError('INVALID_INPUT');
  if (input.runtimeNetworkCompatibility !== undefined && (typeof input.runtimeNetworkCompatibility !== 'boolean' || (input.runtimeNetworkCompatibility && !input.runtimeWebCompatibility))) throw new OperationError('INVALID_INPUT');
  if (input.runtimeChildWebCompatibility !== undefined && (typeof input.runtimeChildWebCompatibility !== 'boolean' || (input.runtimeChildWebCompatibility && !input.runtimeWebCompatibility))) throw new OperationError('INVALID_INPUT');
  if (input.runtimeDetachedFrameCompatibility !== undefined && typeof input.runtimeDetachedFrameCompatibility !== 'boolean') throw new OperationError('INVALID_INPUT');
  if (input.activationStateControl !== undefined && (typeof input.activationStateControl !== 'boolean' || (input.activationStateControl && !input.runtimeWebCompatibility))) throw new OperationError('INVALID_INPUT');
  if (input.activationTimingControl !== undefined && (typeof input.activationTimingControl !== 'boolean' || (input.activationTimingControl && !input.activationStateControl))) throw new OperationError('INVALID_INPUT');
  if (input.virtualFocusControl !== undefined && (typeof input.virtualFocusControl !== 'boolean' || (input.virtualFocusControl && !input.runtimeWebCompatibility))) throw new OperationError('INVALID_INPUT');
  if (input.originalGeneratedSinkInspector !== undefined && (typeof input.originalGeneratedSinkInspector !== 'boolean' || (input.originalGeneratedSinkInspector && (input.originalGeneratedReadInspector || input.originalOpcodeInspector || input.retainedFrameInspector || input.exceptionDiagnostics || input.enableEventGetterDiagnostics || input.navigationInspector || input.navigationDiagnostics || input.readDiagnostics)))) throw new OperationError('INVALID_INPUT');
  if (input.originalGeneratedReadInspector !== undefined && (typeof input.originalGeneratedReadInspector !== 'boolean' || (input.originalGeneratedReadInspector && (input.originalOpcodeInspector || input.retainedFrameInspector || input.exceptionDiagnostics || input.enableEventGetterDiagnostics || input.navigationInspector || input.navigationDiagnostics || input.readDiagnostics)))) throw new OperationError('INVALID_INPUT');
  if (input.enablePointerDiagnostics !== undefined && typeof input.enablePointerDiagnostics !== 'boolean') throw new OperationError('INVALID_INPUT');
  if (input.eventClockCompatibility !== undefined && typeof input.eventClockCompatibility !== 'boolean') throw new OperationError('INVALID_INPUT');
  if (input.navigationDiagnostics !== undefined && typeof input.navigationDiagnostics !== 'boolean') throw new OperationError('INVALID_INPUT');
  if (input.originalOpcodeInspector !== undefined && (typeof input.originalOpcodeInspector !== 'boolean' || (input.originalOpcodeInspector && (input.retainedFrameInspector || input.exceptionDiagnostics || input.enableEventGetterDiagnostics || input.navigationInspector || input.navigationDiagnostics || input.readDiagnostics)))) throw new OperationError('INVALID_INPUT');
  if (input.retainedFrameInspector !== undefined && (typeof input.retainedFrameInspector !== 'boolean' || (input.retainedFrameInspector && (input.exceptionDiagnostics || input.enableEventGetterDiagnostics || input.navigationInspector || input.navigationDiagnostics || input.readDiagnostics)))) throw new OperationError('INVALID_INPUT');
  if (input.navigationInspector !== undefined && (typeof input.navigationInspector !== 'boolean' || (input.navigationInspector && (input.exceptionDiagnostics || input.enableEventGetterDiagnostics || input.navigationDiagnostics || input.readDiagnostics)))) throw new OperationError('INVALID_INPUT');
  if (input.enablePlatformEventDiagnostics !== undefined && (typeof input.enablePlatformEventDiagnostics !== 'boolean' || (input.enablePlatformEventDiagnostics && !input.enablePointerDiagnostics))) throw new OperationError('INVALID_INPUT');
  if (input.enableEventGetterDiagnostics !== undefined && (typeof input.enableEventGetterDiagnostics !== 'boolean' || (input.enableEventGetterDiagnostics && (!input.enablePointerDiagnostics || input.exceptionDiagnostics || input.readDiagnostics)))) throw new OperationError('INVALID_INPUT');
  for (const name of ['program', 'globalName', 'interpreter']) {
    if (typeof input[name] !== 'string' || !input[name] || input[name].length > 4 * 1024 * 1024) throw new OperationError('INVALID_INPUT');
  }
  if (input.globalName.length > 256) throw new OperationError('INVALID_INPUT');
  if (input.pageGlobals !== undefined && (!input.pageGlobals || typeof input.pageGlobals !== 'object'
    || Array.isArray(input.pageGlobals) || Object.keys(input.pageGlobals).some(key => key !== 'WIZ_global_data')
    || !input.pageGlobals.WIZ_global_data || typeof input.pageGlobals.WIZ_global_data !== 'object'
    || Array.isArray(input.pageGlobals.WIZ_global_data))) throw new OperationError('INVALID_INPUT');
  for (const [name, limit] of [['pageHTML', 4 * 1024 * 1024], ['frameHTML', 1024 * 1024], ['experiments', 1024 * 1024], ['userAgent', 1024]]) {
    if (input[name] !== undefined && (typeof input[name] !== 'string' || input[name].length > limit)) throw new OperationError('INVALID_INPUT');
  }
  const pageUrl = new URL(input.pageUrl || 'https://synthid.com/image-detection');
  if (input.referrer !== undefined && typeof input.referrer !== 'string') throw new OperationError('INVALID_INPUT');
  let referrer;
  try { referrer = input.referrer === '' ? undefined : new URL(input.referrer ?? 'https://synthid.com/'); }
  catch { throw new OperationError('INVALID_INPUT'); }
  if (pageUrl.origin !== 'https://synthid.com' || pageUrl.username || pageUrl.password
      || (referrer && (referrer.origin !== 'https://synthid.com' || referrer.username || referrer.password))) throw new OperationError('INVALID_INPUT');
  if (input.frameUrl !== undefined) {
    const frame = new URL(input.frameUrl);
    if (frame.protocol !== 'https:' || !['synthid.com', 'www.google.com', 'www.gstatic.com'].includes(frame.hostname) || frame.username || frame.password || typeof input.frameHTML !== 'string') throw new OperationError('INVALID_INPUT');
  }
  return { pageUrl: pageUrl.href, referrer: referrer?.href ?? '' };
}
async function initialize(input, timeoutMs) {
  if (phase !== 'empty') throw new OperationError('ALREADY_INITIALIZED');
  if (input?.runtimeWindowStateCompatibility !== undefined && (typeof input.runtimeWindowStateCompatibility !== 'boolean' || (input.runtimeWindowStateCompatibility && !input.runtimeWebCompatibility))) throw new OperationError('INVALID_INPUT');
  const urls = validateInput(input);
  finalBufferAblationMode = input.finalBufferAblationMode;
  numericVectorMode = input.numericVectorMode; observeCipherWitness = input.observeCipherWitness === true;
  const sortIdentityRegistryKey = input.sortIdentityRegistryKey;
  platformFailureDiagnostics = createNodePlatformFailureDiagnostics(urls.pageUrl);
  collectPropertyReads = input.readDiagnostics === true;
  enablePointerDiagnostics = input.enablePointerDiagnostics === true;
  enableEventGetterDiagnostics = input.enableEventGetterDiagnostics === true;
  enablePlatformEventDiagnostics = input.enablePlatformEventDiagnostics === true;
  phase = 'environment';
  if(input.nativeTimerResolution===true)nativeTimerResolutionControl=(await import('./runtime-native-timer-resolution.mjs')).installRuntimeNativeTimerResolution();
  if (input.clockPrecision100us === true) clockPrecisionControl = (await import('./runtime-clock-precision-control.mjs')).installRuntimeClockPrecisionControl({chromiumClamper:input.chromiumTimeClamper===true});
  if (input.eventClockCompatibility === true) {
    eventClockCompatibility = installEventClockCompatibility({ clockPrecision100us: input.clockPrecision100us === true });
    diagnostics.eventClockCompatibility = true;
  }
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => { diagnostics.domErrors++; platformFailureDiagnostics.noteJsdomError(error); });
  if (input.diagnostics === true) probe = createRuntimeDiagnostics(virtualConsole);
  class SuppliedResources extends ResourceLoader {
    constructor() { super(input.userAgent ? { userAgent: input.userAgent } : {}); }
    fetch(url, options) {
      eventListenerProbe?.noteFrame(options?.element);
      if (url === input.frameUrl && typeof input.frameHTML === 'string') {
        navigationProbe?.noteHelperFrame(options?.element);
        navigationInspector?.noteHelperFrame(options?.element);
        retainedFrameInspector?.noteHelperFrame(options?.element);
        diagnostics.suppliedFrameRequests++;
        probe?.noteResource(options?.element, 'supplied');
        return Promise.resolve(Buffer.from(input.frameHTML, 'utf8'));
      }
      diagnostics.refusedResources++;
      platformFailureDiagnostics.noteRefusedResource(url, options);
      probe?.noteResource(options?.element, 'blocked');
      return null;
    }
  }
  let cookieJar;
  if (input.cookieJar !== undefined) {
    // JSDOM uses the same tough-cookie serialization as the parent HTTP jar.
    // Cookie values are never placed in diagnostics or written to disk.
    cookieJar = CookieJar.deserializeSync(input.cookieJar);
    diagnostics.cookieJarProvided = true;
  } else { cookieJar = new CookieJar(); diagnostics.cookieJarProvided = false; }
  const pageHTML = input.pageHTML ?? '<!doctype html><html><head></head><body></body></html>';
  diagnostics.pageHTMLProvided = input.pageHTML !== undefined;
  diagnostics.pageHTMLBytes = Buffer.byteLength(pageHTML);
  const chromeCsiModule = input.runtimeChromeCsi === true ? await import('./runtime-chrome-csi.mjs') : undefined;
  dom = new JSDOM(pageHTML, {
    url: urls.pageUrl, ...(urls.referrer === '' ? {} : { referrer: urls.referrer }), runScripts: 'outside-only', pretendToBeVisual: true,
    virtualConsole, resources: new SuppliedResources(), cookieJar,
    beforeParse(window) {
      enableScriptingParsingForOutsideOnly(window);
      if(chromeCsiModule) {
        runtimeChromeCsi = chromeCsiModule.installRuntimeChromeCsi(window,{children:input.runtimeChildWebCompatibility===true});
        diagnostics.runtimeChromeCsi = true;
      }
    },
  });
  diagnostics.documentReferrerEmpty = dom.window.document.referrer === '';
  diagnostics.scriptingEnabledParsing = true;
  if (input.navigationDiagnostics === true) navigationProbe = createNodeNavigationDiagnostics(dom.window, { virtualConsole });
  if (input.navigationInspector === true) navigationInspector = await (await import('./node-navigation-inspector.mjs')).createNodeNavigationInspector(dom.window, { virtualConsole });
  if (input.retainedFrameInspector === true) retainedFrameInspector = await (await import('./node-retained-frame-inspector.mjs')).createNodeRetainedFrameInspector(dom.window);
  if (enablePointerDiagnostics) eventListenerProbe = createEventListenerDiagnostics(dom.window);
  probe?.observeWindow(dom.window, 'top');
  diagnostics.userAgentMatches = typeof input.userAgent === 'string' && dom.window.navigator.userAgent === input.userAgent;
  context = dom.getInternalVMContext();
  if(input.webidlBrandErrors===true){
    webidlBrandErrorAdapter=await import('./webidl-brand-errors-preload.mjs');
    if(webidlBrandErrorAdapter.webidlBrandErrorSnapshot().changedMessages===0)throw new OperationError('BRAND_ERROR_PRELOAD_MISSING');
  }
  if(input.runtimeDetachedFrameCompatibility===true && !input.clockPrecision100us) {
    runtimeDetachedFrameCompatibility=(await import('./runtime-detached-frame-compat.mjs')).installRuntimeDetachedFrameCompat(dom.window);
    diagnostics.runtimeDetachedFrameCompatibility=true;
  }
  if (input.runtimeWebCompatibility === true) {
    const navigationTiming = input.performanceEntries?.find(entry => entry?.entryType === 'navigation');
    const networkSample = input.runtimeNetworkCompatibility === true && navigationTiming
      ? Object.fromEntries(['requestStart', 'responseStart', 'responseEnd', 'encodedBodySize', 'decodedBodySize']
        .filter(key => navigationTiming[key] !== undefined).map(key => [key, navigationTiming[key]])) : undefined;
    if (input.runtimeNetworkCompatibility === true && !(networkSample?.encodedBodySize > 0)) throw new OperationError('NETWORK_SAMPLE_UNAVAILABLE');
    const compatibilityOptions = {
      physicalMemoryBytes: totalmem(), platform: platform() === 'win32' ? 'Win32'
        : platform() === 'darwin' ? 'MacIntel' : platform() === 'linux' ? (arch() === 'arm64' ? 'Linux aarch64' : 'Linux x86_64') : undefined, virtualScreen: true,
      performanceTimeOriginEpochMs: input.performanceTimeOriginEpochMs, performanceEntries: input.performanceEntries,
      deviceMemoryMaxGiB: 32,
      virtualMouse: input.runtimeMouseMediaCompatibility === true,
      clockPrecision100us: input.clockPrecision100us === true,
      userActivationWebIdlCompatibility: input.userActivationWebIdlCompatibility === true,
      networkSample,
    };
    const compatibilityModule = await import('./runtime-web-compat.mjs');
    runtimeWebCompatibility = compatibilityModule.installRuntimeWebCompat(dom.window, compatibilityOptions);
    if (input.userActivationWebIdlCompatibility === true) createActivationStateDiagnostic = compatibilityModule.createRuntimeUserActivationDiagnostic;
    if (input.runtimeChildWebCompatibility === true) {
      runtimeChildWebCompatibility = (await import('./runtime-child-web-compat.mjs')).installRuntimeChildWebCompat(compatibilityOptions);
      diagnostics.runtimeChildWebCompatibility = true;
    }
    diagnostics.runtimeWebCompatibility = true;
    diagnostics.userActivationWebIdlCompatibility = input.userActivationWebIdlCompatibility === true;
    if (networkSample) diagnostics.runtimeNetworkCompatibility = 'http-sample-estimate';
    diagnostics.runtimeWebApisInstalled = Array.from(runtimeWebCompatibility.installed);
  }
  // The retained-frame owner must capture the child's clock-adjusted rAF.
  if(input.runtimeDetachedFrameCompatibility===true && input.clockPrecision100us) {
    runtimeDetachedFrameCompatibility=(await import('./runtime-detached-frame-compat.mjs')).installRuntimeDetachedFrameCompat(dom.window);
    diagnostics.runtimeDetachedFrameCompatibility=true;
  }
  if (input.runtimeNavigatorCompatibility === true) {
    runtimeNavigatorCompatibility = (await import('./runtime-navigator-compat.mjs')).installRuntimeNavigatorCompat(dom.window, { children: input.runtimeChildWebCompatibility === true });
    diagnostics.runtimeNavigatorCompatibility = true;
  }
  if (input.runtimeWindowStateCompatibility === true) {
    runtimeWindowStateCompatibility = (await import('./runtime-window-state-compat.mjs')).installRuntimeWindowStateCompat(dom.window, { children: input.runtimeChildWebCompatibility === true });
    diagnostics.runtimeWindowStateCompatibility = true;
  }
  // Capture the ordinary JSDOM interface prototypes before later compatibility
  // layers replace constructor bindings with owned Proxy functions. Their
  // createWindow hooks wrap this one and are disposed first.
  if(input.runtimeCssProperties===true) {
    runtimeCssProperties=(await import('./runtime-css-properties-compat.mjs')).installRuntimeCssPropertiesCompat(dom.window,{children:input.runtimeChildWebCompatibility===true});
    diagnostics.runtimeCssProperties=true;
  }
  if (input.runtimeWebIdlRealmCompatibility === true) {
    runtimeWebIdlRealmCompatibility = (await import('./runtime-webidl-realm-compat.mjs')).installWebIdlRealmCompat(dom.window, { children: input.runtimeChildWebCompatibility === true });
    diagnostics.runtimeWebIdlRealmCompatibility = true;
  }
  if (input.activationStateControl === true) {
    // Diagnostic state simulation, not a trusted event. Retain receiver-brand
    // checks; the optional transient state uses a diagnostic five-second window.
    activationTransientMs = input.activationTimingControl ? 5000 : 0;
    if (createActivationStateDiagnostic) activationDiagnostic = createActivationStateDiagnostic(dom.window, activationTransientMs);
    else {
      activationDiagnosticSource = await readFile(new URL('./realm-activation-diagnostic.js', import.meta.url), 'utf8');
      activationDiagnostic = run(activationDiagnosticSource + '(' + activationTransientMs + ')');
    }
    restoreActivationState = () => activationDiagnostic.dispose();
    diagnostics.activationStateSimulation = true;
    diagnostics.activationTimingSimulation = input.activationTimingControl === true;
  }
  if (input.runtimeWebIdlCallableControl === true) {
    runtimeWebIdlCallableControl = (await import('./runtime-webidl-callable-control.mjs')).installWebIdlCallableControl(dom.window, { children: input.runtimeChildWebCompatibility === true });
    diagnostics.runtimeWebIdlCallableControl = true;
  }
  if (input.nativePluginGetters === true) {
    nativePluginGetters = await (await import('./native-plugin-getters-control.mjs')).installNativePluginGettersControl(dom.window, { children: input.runtimeChildWebCompatibility === true, nativeBrandValidation: input.nativePluginBrandValidation === true });
    diagnostics.nativePluginGetters = true;
  }
  if (input.runtimePermissionsBinding === true) {
    runtimePermissionsControl = (await import('./runtime-permissions-control.mjs')).installRuntimePermissionsControl(dom.window, { children: input.runtimeChildWebCompatibility === true });
    diagnostics.runtimePermissionsBinding = true;
  }
  if (input.runtimeAnchorHrefTranslate === true) {
    runtimeAnchorHrefTranslate = (await import('./runtime-anchor-href-translate.mjs')).installRuntimeAnchorHrefTranslate(dom.window, { children: input.runtimeChildWebCompatibility === true });
    diagnostics.runtimeAnchorHrefTranslate = true;
  }
  if(input.nativeWebdriverGetter===true)nativeWebdriverControl=(await import('./runtime-native-webdriver-control.mjs')).installRuntimeNativeWebdriverControl(dom.window,{children:input.runtimeChildWebCompatibility===true});
  if(input.nativeMediaBinding===true)nativeMediaControl=(await import('./runtime-native-media-control.mjs')).installRuntimeNativeMediaControl(dom.window,{children:input.runtimeChildWebCompatibility===true});
  if(input.nativeDisplayFrames===true)displayFrameControl=(await import('./runtime-display-frame-control.mjs')).installRuntimeDisplayFrameControl(dom.window,{clockPrecision100us:input.clockPrecision100us===true});
  if(input.rafCallableControl===true)rafCallableControl=(await import('./runtime-raf-callable-control.mjs')).installRuntimeRafCallableControl(dom.window);
  if(input.runtimeAbstractWebGlBindings===true) {
    runtimeAbstractWebGlBindingsChildren=input.runtimeChildWebCompatibility===true;
    runtimeAbstractWebGlBindings=await (await import('./runtime-abstract-webgl-bindings.mjs')).installRuntimeAbstractWebGlBindings(dom.window,{children:runtimeAbstractWebGlBindingsChildren});
    diagnostics.runtimeAbstractWebGlBindings=true;
  }
  if(input.runtimeAbstractInterfaceBindings===true) {
    runtimeAbstractInterfaceBindings=(await import('./runtime-abstract-interface-bindings.mjs')).installRuntimeAbstractInterfaceBindings(dom.window,{children:input.runtimeChildWebCompatibility===true});
    diagnostics.runtimeAbstractInterfaceBindings=true;
  }
  if (input.pageGlobals !== undefined) {
    if(input.virtualFocusControl === true) {
      const focusSource = await readFile(new URL('./realm-focus-diagnostic.js',import.meta.url),'utf8');
      diagnostics.virtualFocusControl = JSON.parse(run('JSON.stringify('+focusSource+')'));
      if(!diagnostics.virtualFocusControl.after || !diagnostics.virtualFocusControl.attributeRestored) throw new OperationError('VIRTUAL_FOCUS_FAILED');
    }
    run('globalThis.WIZ_global_data = JSON.parse(' + JSON.stringify(JSON.stringify(input.pageGlobals.WIZ_global_data)) + ')');
    diagnostics.pageGlobalsProvided = true;
  }
  if (input.runtimePrivateBootstrapState !== true) run('globalThis.__input = ' + JSON.stringify({ program: input.program, globalName: input.globalName, experiments: input.experiments }));
  phase = 'interpreter';
  if(input.functionToStringObservation===true)functionToStringObservation=(await import('./runtime-function-tostring-observation.mjs')).installRuntimeFunctionToStringObservation(dom.window,{children:input.runtimeChildWebCompatibility===true,comparison:input.toStringComparison});
  if(input.ownPropertyNamesObservation===true)ownPropertyNamesObservation=(await import('./runtime-own-property-names-observation.mjs')).installRuntimeOwnPropertyNamesObservation(dom.window,{children:input.runtimeChildWebCompatibility===true,identifyInterfacePrototypes:input.ownNamesInterfaceIdentities===true,observeArrayConsumers:input.ownNamesArrayConsumers===true,crossRealmConsumers:input.ownNamesCrossRealmConsumers===true,observeUntrackedSortResults:input.ownNamesUntrackedSortResults===true,sortComparison:input.sortComparison,sortIdentityRegistryKey,observeNumberProfiles:input.sortNumberProfiles===true,observeRafIntervals:input.rafSortAttribution===true,rafScope:input.rafSortScope});
  if (input.anchorClickObservation === true) anchorClickObserver = (await import('./anchor-click-observer.mjs')).installAnchorClickObserver(dom.window);
  if (input.originalOutputInspector === true) originalOutputInspector = await (await import('./original-output-inspector.mjs')).createOriginalOutputInspector({ originalInterpreter: input.interpreter, maxDurationMs: 60000, maxHits: 2000 });
  if (input.currentOutputDiagnostics === true) {
    if (numericVectorMode !== undefined) {
      currentOutputInspector = await (await import(input.observeScalarCandidates === true ? './numeric-scalar-timeout-details-be.mjs' : './numeric-vector-intervention-y.mjs')).createNumericVectorInspector({ originalInterpreter: input.interpreter, mode: numericVectorMode, observeCipherWitness: input.observeCipherWitness === true, observeInitPublicEntries: input.observeInitPublicEntries === true, ...(input.observeScalarCandidates === true ? { maxDurationMs: 240000 } : {}) });
      currentOutputInspector.setPhase('init');
    } else if (finalBufferAblationMode !== undefined) {
      currentOutputInspector = await (await import('./final-buffer-ablation-x.mjs')).createFinalBufferAblationInspector({ originalInterpreter: input.interpreter, mode: finalBufferAblationMode });
      currentOutputInspector.setPhase('init');
    } else {
    const factory=input.currentBoundPayloadDiagnostics?(await import('./current-bound-payload-inspector.mjs')).createCurrentBoundPayloadInspector:input.currentSourceCoverageDiagnostics?(await import('./current-output-source-coverage.mjs')).createCurrentOutputSourceCoverage:input.currentPayloadDiagnostics?(await import('./current-payload-inspector.mjs')).createCurrentPayloadInspector:(await import('./current-output-inspector.mjs')).createCurrentOutputInspector;
    currentOutputInspector=await factory({ originalInterpreter: input.interpreter, ...(sortIdentityRegistryKey===undefined?{}:{sortIdentityRegistryKey}), maxDurationMs: input.currentBoundEarlyProducerDiagnostics?420000:input.currentBoundProducerDiagnostics?240000:90000, maxHits: input.currentBoundProducerDiagnostics?20000:4000, ...(input.currentBoundProducerDiagnostics?{maxProducerAttempts:input.currentBoundEarlyProducerDiagnostics?16000:10000,maxProducerKeys:input.currentBoundEarlyProducerDiagnostics?4096:1024}:{}), ...(input.currentBoundPayloadDiagnostics?{observeOrigins:input.currentBoundOriginDiagnostics===true,observeProducers:input.currentBoundProducerDiagnostics===true,...(input.currentBoundEarlyProducerDiagnostics?{observeEarlyProducers:true}:{})}:{}) });
    }
  }
  if (input.originalOpcodeInspector === true) originalOpcodeInspector = await (await import('./original-opcode-inspector.mjs')).createOriginalOpcodeInspector({ originalInterpreter: input.interpreter, maxHits: 4000 });
  if (input.originalGeneratedReadInspector === true) originalGeneratedReadInspector = await (await import('./original-generated-read-inspector.mjs')).createOriginalGeneratedReadInspector({ originalInterpreter: input.interpreter, maxHits: 4000 });
  if (input.originalGeneratedSinkInspector === true) originalGeneratedSinkInspector = await (await import(input.currentReadInspector ? './current-generated-sink-inspector.mjs' : './original-generated-sink-inspector.mjs')).createOriginalGeneratedSinkInspector({ originalInterpreter: input.interpreter, maxHits: 10000, maxDurationMs: input.currentReadInspector ? 90000 : (input.originalGeneratedReadDurationMs ?? 30000), observeResolvedToString: input.observeResolvedToString === true, messageComparison: input.messageComparison, keyCoverageDiagnostics: input.keyCoverageDiagnostics, unknownKeyComparison: input.unknownKeyComparison, numericKeyComparison: input.numericKeyComparison, unmatchedSinkCoverage: input.unmatchedSinkCoverage, unmatchedSinkValueTypes: input.unmatchedSinkValueTypes });
  if (enableEventGetterDiagnostics) eventGetterProbe = await (await import('./event-getter-diagnostics.mjs')).createEventGetterDiagnostics(dom.window, { originalInterpreter: input.interpreter, deferActivation: true, maxDurationMs: 30000 });
  if (input.exceptionDiagnostics === true) {
    exceptionProbe = await (await import('./runtime-exception-diagnostics.mjs')).createExceptionDiagnostics({ observeDynamicSources: true });
  }
  diagnostics.interpreterSourceUrlProvided = input.interpreterSourceUrl !== undefined;
  if(input.nativeStackObservation===true)nativeStackObservation=(await import('./runtime-native-stack-observation.mjs')).installRuntimeNativeStackObservation(dom.window,{targetKind:input.nativeStackTarget??'top'});
  new Script(input.interpreter, { filename: input.interpreterSourceUrl ?? 'google-botguard-interpreter.js' }).runInContext(context, { timeout: SYNC_TIMEOUT });
  phase = 'initialize';
  diagnostics.runtimePrivateBootstrapState = input.runtimePrivateBootstrapState === true;
  if (input.runtimePrivateBootstrapState === true) {
    const setup = await readFile(new URL('./realm-private-bootstrap.js', import.meta.url), 'utf8');
    const key = '__synthid_runtime_control_' + randomUUID().replaceAll('-', '');
    const binding = key + '_controller';
    // A realm lexical const preserves closure identity without a Window property.
    run('const ' + binding + ' = ' + setup + '(' + JSON.stringify(key) + ');');
    privateBootstrapBinding = binding;
    await bounded(runPrivateBootstrap('initialize', { program: input.program, globalName: input.globalName, experiments: input.experiments }), timeoutMs);
  } else {
    const setup = await readFile(new URL('./realm-init.js', import.meta.url), 'utf8');
    await bounded(run(setup), timeoutMs);
  }
  initializedAt = Date.now(); phase = 'ready';
  const state = inspect();
  observeScalarCandidates = input.observeScalarCandidates === true;
  return state;
}
async function snapshot(blobref, timeoutMs, unbound = false, snapshotFourthInputTrue = false, progress = () => {}) {
  progress('entered');
  if (phase !== 'ready') throw new OperationError('NOT_READY');
  if (typeof snapshotFourthInputTrue !== 'boolean') throw new OperationError('INVALID_INPUT');
  if ((finalBufferAblationMode !== undefined || numericVectorMode !== undefined) && (unbound || snapshotFourthInputTrue)) throw new OperationError('INVALID_INPUT');
  if (!unbound) {
  if (typeof blobref !== 'string' || !blobref.startsWith('/synthid-demo-drop-zone/ttl_1d/users/') || blobref.length > 2048 || /[\r\n\0]/.test(blobref)) throw new OperationError('INVALID_BLOBREF');
  }
  phase = 'snapshot';
  nativeStackObservation?.setPhase('snapshot');
  originalOutputInspector?.setPhase('snapshot');
  currentOutputInspector?.setPhase('snapshot');
  progress('phase-set');
  const binding = unbound ? 'undefined' : '{blobref:' + JSON.stringify(blobref) + '}';
  const fourthInputTrue = !unbound && snapshotFourthInputTrue;
  // EH invokes the retained callback as an unbound local from its ready Promise.
  // Calling it as a top-window method changes cross-realm receiver semantics.
  const pendingToken = privateBootstrapBinding ? runPrivateBootstrap('snapshot', { blobref, unbound, snapshotFourthInputTrue: fourthInputTrue }) : run('globalThis.__ready.then(() => new Promise(resolve => { const snapshot = globalThis.__snapshot; snapshot(resolve, [' + binding + ', undefined, undefined, ' + (fourthInputTrue ? 'true' : 'undefined') + ']); }))');
  progress('realm-returned');
  const token = await bounded(pendingToken, timeoutMs);
  progress('token-settled');
  diagnostics.snapshotFourthInputTrue = fourthInputTrue;
  let finalBufferVerified = true;
  if (finalBufferAblationMode !== undefined) {
    await bounded(currentOutputInspector.flush(), timeoutMs);
    const verified = await bounded(currentOutputInspector.verifyToken(token), timeoutMs);
    const verification = currentOutputInspector.snapshot();
    finalBufferVerified = verified === true && verification.failed === false && verification.appliedOnce === true
      && verification.sourceVerified === true && verification.tokenVerified === true && verification.commitmentVerified === true;
  }
  let numericVectorVerified = true;
  if (numericVectorMode !== undefined) {
    await bounded(currentOutputInspector.flush(), timeoutMs);
    progress('flush-complete');
    const verified = await bounded(currentOutputInspector.verifyToken(token), timeoutMs);
    const verification = currentOutputInspector.snapshot();
    numericVectorVerified = verified === true && verification.failed === false && verification.sourceVerified === true
      && verification.vectorComplete === true && verification.allSelectedAppendsCommitted === true
      && verification.targetOwnCryptoStatePreserved === true && verification.tokenVerified === true
      && (!numericVectorPacketInstalled || verification.vectorConsumed === true)
      && (!observeCipherWitness || verification.observeCipherWitness === true && verification.cipherWitnessComplete === true)
      && (numericVectorMode !== 'replace' || verification.transferUsed === true && verification.vectorConsumed === true);
  }
  progress('verification-complete');
  snapshotCount++; phase = 'ready';
  const state = inspect();
  progress('inspected');
  if (typeof token !== 'string' || token.length > 512 * 1024 || !/^![\x21-\x7e]+$/.test(token)) {
    return { ...state, success: false, code: 'INVALID_TOKEN', tokenType: typeof token, tokenLength: typeof token === 'string' ? token.length : 0, startsWithExclamation: typeof token === 'string' && token.startsWith('!'), frameLoadFailure: typeof token === 'string' && token.startsWith('FNL') };
  }
  if (!finalBufferVerified) return { ...state, success: false, code: 'FINAL_BUFFER_VERIFICATION_FAILED' };
  if (!numericVectorVerified) return { ...state, success: false, code: 'NUMERIC_VECTOR_VERIFICATION_FAILED' };
  return { ...state, bgToken: token };
}
async function dispatchPointerDiagnostics(timeoutMs) {
  if (phase !== 'ready') throw new OperationError('NOT_READY');
  if (!enablePointerDiagnostics) throw new OperationError('POINTER_DIAGNOSTICS_DISABLED');
  phase = 'pointerDiagnostics';
  nativeStackObservation?.setPhase('events');
  originalOutputInspector?.setPhase('events');
  currentOutputInspector?.setPhase('events');
  const deadline = Date.now() + timeoutMs;
  const remaining = () => {
    const milliseconds = deadline - Date.now();
    if (milliseconds <= 0) throw new OperationError('OPERATION_TIMEOUT');
    return milliseconds;
  };
  let installed = false, interval, getterProbe, platformControl;
  const eventListenersBefore = eventListenerProbe?.snapshot();
  try {
    if (enablePlatformEventDiagnostics) platformControl = (await import('./node-platform-event-diagnostic.mjs')).installPlatformEventDiagnostic(dom.window);
    if (enableEventGetterDiagnostics) { getterProbe = eventGetterProbe; await getterProbe.start(); }
    const setup = await bounded(readFile(new URL('./realm-pointer-diagnostic.js', import.meta.url), 'utf8'), remaining());
    run('if (Object.prototype.hasOwnProperty.call(globalThis, "__synthidPointerDiagnosticControl")) throw Error("POINTER_DIAGNOSTIC_COLLISION");' +
      'Object.defineProperty(globalThis, "__synthidPointerDiagnosticControl", { configurable: true, value: ' + setup + ' });');
    installed = true;
    for (let index = 0; index < 4; index++) {
      if (index) await bounded(new Promise(resolve => { interval = setTimeout(resolve, 120); }), remaining());
      remaining();
      run('globalThis.__synthidPointerDiagnosticControl.step(' + index + ')');
      remaining();
    }
    const encoded = run('JSON.stringify(globalThis.__synthidPointerDiagnosticControl.close())');
    if (typeof encoded !== 'string' || encoded.length > 4096) throw new OperationError('POINTER_DIAGNOSTIC_FAILURE');
    const raw = JSON.parse(encoded);
    const booleans = ['diagnosticOnly', 'synthetic', 'mouseEventConstructorAvailable', 'listenerInstalled', 'listenerRemoved'];
    const counters = ['requestedMoves', 'constructedEvents', 'constructedTrusted', 'constructedUntrusted', 'dispatchCalls',
      'dispatchedEvents', 'uncancelledDispatches', 'observedEvents', 'observedTrusted', 'observedUntrusted'];
    if (booleans.some(key => typeof raw[key] !== 'boolean') || counters.some(key => !Number.isInteger(raw[key]) || raw[key] < 0 || raw[key] > 4)) throw new OperationError('POINTER_DIAGNOSTIC_FAILURE');
    const pointerDiagnostics = Object.fromEntries([...booleans, ...counters].map(key => [key, raw[key]]));
    if (getterProbe) {
      await bounded(new Promise(resolve => { interval = setTimeout(resolve, 20); }), remaining());
      await getterProbe.dispose();
    }
    phase = 'ready';
    return { ...inspect(), eventListenersBefore, pointerDiagnostics, eventGetterDiagnostics: getterProbe?.snapshot(), platformEventSimulation: Boolean(platformControl) };
  } finally {
    platformControl?.dispose();
    await getterProbe?.dispose().catch(() => {});
    clearTimeout(interval);
    if (installed && context) {
      try { run('try { globalThis.__synthidPointerDiagnosticControl.close(); } finally { delete globalThis.__synthidPointerDiagnosticControl; }'); } catch {}
    }
  }
}
async function handle(request) {
  if (!request || request.version !== VERSION || !Number.isSafeInteger(request.id) || request.id < 1 || !['init', 'snapshot', 'renewalSnapshot', 'pointerDiagnostics', 'activateDiagnostics', 'inspect', 'takeComparison', 'takePayloads', 'takeVector', 'setVector', 'takeSortComparison', 'takeMessageComparison', 'takeKeyComparison', 'dispose'].includes(request.op)) {
    if (request?.op === 'setVector') clearNumericVectorPacket(request.packet);
    throw new OperationError('INVALID_PROTOCOL');
  }
  let result;
  if (request.op === 'init') result = await initialize(request.input, timeoutFor(request, 20000));
  if (request.op === 'snapshot') result = await snapshot(request.blobref, timeoutFor(request, 15000), false, request.snapshotFourthInputTrue,
    createSnapshotProgressEmitter(line => process.stdout.write(line), request.id, observeScalarCandidates));
  if (request.op === 'renewalSnapshot') result = await snapshot(undefined, timeoutFor(request, 15000), true);
  if (request.op === 'pointerDiagnostics') result = await dispatchPointerDiagnostics(timeoutFor(request, 5000));
  if (request.op === 'activateDiagnostics') {
    result = activateDiagnostics(request.sameOriginDescendants === undefined ? false : request.sameOriginDescendants);
  }
  if (request.op === 'inspect') result = inspect();
  if (request.op === 'takeComparison') {
    if(phase!=='ready'||!functionToStringObservation?.takeComparison)throw new OperationError('NOT_READY');
    result=functionToStringObservation.takeComparison();
  }
  if (request.op === 'takePayloads') {
    if(phase!=='ready'||!currentOutputInspector?.takePayloads)throw new OperationError('NOT_READY');
    result=await currentOutputInspector.takePayloads();
  }
  if (request.op === 'takeVector') {
    if (request.initial!==undefined&&typeof request.initial!=='boolean'||phase !== 'ready' || numericVectorMode !== 'capture' || !currentOutputInspector?.takeVector) throw new OperationError('NOT_READY');
    let packet;
    try {
      packet = await bounded(currentOutputInspector.takeVector(request.initial===true), timeoutFor(request, 5000));
      result = copyNumericVectorPacket(packet);
      if (!clearNumericVectorPacket(packet)) throw new OperationError('VECTOR_TRANSFER_FAILED');
    } catch (error) {
      clearNumericVectorPacket(result); result = undefined;
      throw error;
    } finally { clearNumericVectorPacket(packet); packet = undefined; }
  }
  if (request.op === 'setVector') {
    try {
      if ([3,4,5,6].includes(request.packet?.schemaVersion) || phase !== 'ready' || !['self','replace'].includes(numericVectorMode) || !currentOutputInspector?.setVector) throw new OperationError('NOT_READY');
      result = await bounded(currentOutputInspector.setVector(request.packet), timeoutFor(request, 5000));
      if (result !== true) throw new OperationError('VECTOR_TRANSFER_FAILED');
      numericVectorPacketInstalled = true;
    } finally { clearNumericVectorPacket(request.packet); request.packet = undefined; }
  }
  if (request.op === 'takeSortComparison') {
    if(phase!=='ready'||!ownPropertyNamesObservation?.takeSortComparison)throw new OperationError('NOT_READY');
    result=ownPropertyNamesObservation.takeSortComparison();
  }
  if (request.op === 'takeMessageComparison') {
    if(phase!=='ready'||!originalGeneratedSinkInspector?.takeMessageComparison)throw new OperationError('NOT_READY');
    result=await originalGeneratedSinkInspector.takeMessageComparison();
  }
  if (request.op === 'takeKeyComparison') {
    if(phase!=='ready'||!originalGeneratedSinkInspector?.takeKeyComparison)throw new OperationError('NOT_READY');
    result=await originalGeneratedSinkInspector.takeKeyComparison();
  }
  if (request.op === 'dispose') { stopping = true; result = await shutdown(timeoutFor(request, 2000)); }
  if (request.op === 'takeVector') {
    try { await send({ id: request.id, ok: true, result }); }
    finally { clearNumericVectorPacket(result); result = undefined; }
  }
  else if(request.op==='takePayloads')await sendPrivatePayload(send,{id:request.id,ok:true,result});
  else await send({ id: request.id, ok: true, result });
  if (stopping) process.exit(0);
}
let queue = Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (stopping) return;
  inputBuffer += chunk;
  if (Buffer.byteLength(inputBuffer) > MAX_INPUT_BYTES) { stopping = true; closeDom(); process.exit(1); }
  let end;
  while ((end = inputBuffer.indexOf('\n')) !== -1) {
    const line = inputBuffer.slice(0, end); inputBuffer = inputBuffer.slice(end + 1);
    queue = queue.then(async () => {
      if (stopping) return;
      let request;
      try { request = JSON.parse(line); await handle(request); }
      catch (error) {
        const failedPhase = phase;
        const fatal = !(error instanceof OperationError) || !['ALREADY_INITIALIZED', 'NOT_READY', 'INVALID_INPUT', 'INVALID_BLOBREF', 'POINTER_DIAGNOSTICS_DISABLED'].includes(error.code);
        if (fatal) { stopping = true; closeDom(); }
        await send({ id: Number.isSafeInteger(request?.id) ? request.id : 0, ok: false, error: { code: error instanceof OperationError ? error.code : 'INTERPRETER_FAILURE', phase: failedPhase, errorType: ['Error', 'TypeError', 'RangeError', 'SyntaxError'].includes(error?.name) ? error.name : 'unknown' } });
        if (fatal) process.exit(1);
      }
    });
  }
});
process.stdin.on('end', () => { queue.finally(async () => { if (!stopping) { stopping = true; await shutdown(500); process.exit(0); } }); });
process.stdin.on('error', () => { stopping = true; closeDom(); process.exit(1); });
