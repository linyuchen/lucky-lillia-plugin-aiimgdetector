import { JSDOM, VirtualConsole, ResourceLoader, CookieJar } from 'jsdom';
import { Script } from 'node:vm';
import { readFile } from 'node:fs/promises';
import { totalmem, platform, arch } from 'node:os';
import { enableScriptingParsingForOutsideOnly } from './scripting-parser.mjs';
import { createEventListenerDiagnostics } from './event-listener-diagnostics.mjs';
import { installEventClockCompatibility } from './jsdom-event-clock-compat.mjs';
import { createNodePlatformFailureDiagnostics } from './node-platform-failure-diagnostics.mjs';

// One isolated interpreter per image. The parent owns the HTTP connection,
// deadline and hard termination. No account credentials reach this process.
// Node filesystem permissions are not a network sandbox.
const VERSION = 1, MAX_INPUT_BYTES = 16 * 1024 * 1024, SYNC_TIMEOUT = 5000;
let dom, context, phase = 'empty', stopping = false, inputBuffer = '';
let initializedAt = 0, snapshotCount = 0, enablePointerDiagnostics = false;
let eventListenerProbe, eventClockCompatibility, clockPrecisionControl;
let runtimeWebCompatibility, runtimeNavigatorCompatibility, runtimeWindowStateCompatibility;
let runtimeChildWebCompatibility, runtimeDetachedFrameCompatibility, webidlBrandErrorAdapter;
let runtimeWebIdlRealmCompatibility, runtimeWebIdlCallableControl, javascriptBindings;
let runtimePermissionsControl, runtimeAnchorHrefTranslate, runtimeChromeCsi, runtimeCssProperties;
let platformFailureDiagnostics, restoreActivationState, activationDiagnostic;
let activationDiagnosticSource, activationTransientMs = 0, createActivationStateDiagnostic;
const diagnostics = { domErrors: 0, suppliedFrameRequests: 0, refusedResources: 0 };
class OperationError extends Error { constructor(code) { super(code); this.code = code; } }
const send = envelope => new Promise(resolve => process.stdout.write(JSON.stringify({ version: VERSION, ...envelope }) + '\n', resolve));
const bounded = async (promise, timeoutMs) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new OperationError('OPERATION_TIMEOUT')), timeoutMs); })]); }
  finally { clearTimeout(timer); }
};
const timeoutFor = (request, fallback) => Number.isInteger(request.timeoutMs) && request.timeoutMs >= 10 && request.timeoutMs <= 120000 ? request.timeoutMs : fallback;
const run = source => new Script(source, { filename: 'synthid-lifecycle-realm.js' }).runInContext(context, { timeout: SYNC_TIMEOUT });
const metrics = () => {
  if (!context) return { errors: [] };
  const encoded = run('JSON.stringify({experimentCount: __metrics.experimentCount, stateField5: __metrics.stateField5, errors: __metrics.errors.filter(Number.isSafeInteger).slice(0, 20)})');
  return typeof encoded === 'string' && encoded.length < 4096 ? JSON.parse(encoded) : { errors: [] };
};
const inspect = () => ({
  success: true, phase, snapshotCount, aliveMs: initializedAt ? Date.now() - initializedAt : 0,
  diagnostics: { ...diagnostics }, metrics: metrics(),
  javascriptBindings: javascriptBindings?.snapshot(), clockPrecisionControl: clockPrecisionControl?.snapshot(),
});
const closeDom = () => {
  // Restore factory hooks in reverse installation order, including retained frames.
  for (const control of [runtimeAnchorHrefTranslate, runtimePermissionsControl, javascriptBindings,
    runtimeWebIdlCallableControl, runtimeWebIdlRealmCompatibility, runtimeCssProperties,
    runtimeWindowStateCompatibility, runtimeNavigatorCompatibility]) try { control?.dispose(); } catch {}
  if (clockPrecisionControl) try { runtimeDetachedFrameCompatibility?.dispose(); } catch {}
  try { runtimeChildWebCompatibility?.dispose(); } catch {}
  try { restoreActivationState?.(); } catch {}
  try { runtimeWebCompatibility?.dispose(); } catch {}
  if (!clockPrecisionControl) try { runtimeDetachedFrameCompatibility?.dispose(); } catch {}
  try { eventListenerProbe?.dispose(); } catch {}
  try { runtimeChromeCsi?.dispose(); } catch {}
  try { dom?.window.close(); } catch {}
  try { eventClockCompatibility?.dispose(); } catch {}
  try { clockPrecisionControl?.dispose(); } catch {}
  dom = undefined; context = undefined;
};
async function shutdown(timeoutMs) {
  let shutdownInvoked = false, shutdownCompleted = false;
  if (context) try {
    shutdownInvoked = run('typeof globalThis.__shutdown === "function"');
    if (shutdownInvoked) {
      await bounded(Promise.resolve(run('(() => { const shutdown = globalThis.__shutdown; return shutdown(); })()')), timeoutMs);
      shutdownCompleted = true;
    }
  } catch {}
  closeDom(); phase = 'disposed';
  return { success: true, phase, snapshotCount, shutdownInvoked, shutdownCompleted,
    javascriptBindings: javascriptBindings?.snapshot(), clockPrecisionControl: clockPrecisionControl?.snapshot() };
}
function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OperationError('INVALID_INPUT');
  const booleans = ['clockPrecision100us', 'eventClockCompatibility', 'enablePointerDiagnostics',
    'runtimeWebCompatibility', 'runtimeNetworkCompatibility', 'runtimeChildWebCompatibility',
    'runtimeNavigatorCompatibility', 'runtimeWindowStateCompatibility', 'runtimeDetachedFrameCompatibility',
    'runtimeWebIdlRealmCompatibility', 'runtimeWebIdlCallableControl', 'runtimePermissionsBinding',
    'runtimeAnchorHrefTranslate', 'runtimeMouseMediaCompatibility', 'runtimeChromeCsi', 'runtimeCssProperties',
    'javascriptBindings', 'activationStateControl', 'activationTimingControl', 'virtualFocusControl',
    'webidlBrandErrors', 'userActivationWebIdlCompatibility'];
  for (const key of booleans) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new OperationError('INVALID_INPUT');
  // The production worker has no native or interpreter-instrumentation modes.
  const fields = new Set([...booleans, 'program', 'globalName', 'interpreter', 'interpreterSourceUrl',
    'pageUrl', 'pageHTML', 'frameUrl', 'frameHTML', 'experiments', 'rawExperiments', 'userAgent',
    'pageGlobals', 'referrer', 'cookieJar', 'performanceTimeOriginEpochMs', 'performanceEntries']);
  if (Object.keys(input).some(key => !fields.has(key))) throw new OperationError('INVALID_INPUT');
  if (input.clockPrecision100us && (!input.eventClockCompatibility || !input.runtimeWebCompatibility || !input.runtimeChildWebCompatibility)
    || (input.runtimeWebIdlCallableControl || input.javascriptBindings) && !input.runtimeWebIdlRealmCompatibility
    || input.activationTimingControl && !input.activationStateControl
    || ['runtimeChildWebCompatibility', 'runtimeNetworkCompatibility', 'runtimeWindowStateCompatibility',
      'activationStateControl', 'virtualFocusControl', 'userActivationWebIdlCompatibility'].some(key => input[key] && !input.runtimeWebCompatibility)) throw new OperationError('INVALID_INPUT');
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
    || referrer && (referrer.origin !== 'https://synthid.com' || referrer.username || referrer.password)) throw new OperationError('INVALID_INPUT');
  for (const name of ['frameUrl', 'interpreterSourceUrl']) if (input[name] !== undefined) {
    const url = new URL(input[name]);
    if (url.protocol !== 'https:' || !['synthid.com', 'www.google.com', 'www.gstatic.com'].includes(url.hostname)
      || url.port || url.username || url.password || (name === 'frameUrl' ? typeof input.frameHTML !== 'string'
        : url.hostname === 'synthid.com' || !url.pathname.startsWith('/js/'))) throw new OperationError('INVALID_INPUT');
  }
  return { pageUrl: pageUrl.href, referrer: referrer?.href ?? '' };
}
async function initialize(input, timeoutMs) {
  if (phase !== 'empty') throw new OperationError('ALREADY_INITIALIZED');
  const urls = validateInput(input);
  platformFailureDiagnostics = createNodePlatformFailureDiagnostics(urls.pageUrl);
  enablePointerDiagnostics = input.enablePointerDiagnostics === true;
  phase = 'environment';
  if (input.clockPrecision100us === true) clockPrecisionControl = (await import('./runtime-clock-precision-control.mjs')).installRuntimeClockPrecisionControl();
  if (input.eventClockCompatibility === true) {
    eventClockCompatibility = installEventClockCompatibility({ clockPrecision100us: input.clockPrecision100us === true });
    diagnostics.eventClockCompatibility = true;
  }
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => { diagnostics.domErrors++; platformFailureDiagnostics.noteJsdomError(error); });
  class SuppliedResources extends ResourceLoader {
    constructor() { super(input.userAgent ? { userAgent: input.userAgent } : {}); }
    fetch(url, options) {
      eventListenerProbe?.noteFrame(options?.element);
      if (url === input.frameUrl && typeof input.frameHTML === 'string') {
        diagnostics.suppliedFrameRequests++;
        return Promise.resolve(Buffer.from(input.frameHTML, 'utf8'));
      }
      diagnostics.refusedResources++;
      platformFailureDiagnostics.noteRefusedResource(url, options);
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

  if (enablePointerDiagnostics) eventListenerProbe = createEventListenerDiagnostics(dom.window);
  context = dom.getInternalVMContext();
  if (input.webidlBrandErrors === true) {
    webidlBrandErrorAdapter = await import('./webidl-brand-errors-preload.mjs');
    if (webidlBrandErrorAdapter.webidlBrandErrorSnapshot().changedMessages === 0) throw new OperationError('BRAND_ERROR_PRELOAD_MISSING');
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
  if(input.javascriptBindings===true){javascriptBindings=(await import('./runtime-javascript-bindings.mjs')).installJavascriptBindings(dom.window,{children:input.runtimeChildWebCompatibility===true});diagnostics.javascriptBindings=true;}
  if (input.runtimePermissionsBinding === true) {
    runtimePermissionsControl = (await import('./runtime-permissions-control.mjs')).installRuntimePermissionsControl(dom.window, { children: input.runtimeChildWebCompatibility === true });
    diagnostics.runtimePermissionsBinding = true;
  }
  if (input.runtimeAnchorHrefTranslate === true) {
    runtimeAnchorHrefTranslate = (await import('./runtime-anchor-href-translate.mjs')).installRuntimeAnchorHrefTranslate(dom.window, { children: input.runtimeChildWebCompatibility === true });
    diagnostics.runtimeAnchorHrefTranslate = true;
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
  new Script(input.interpreter, { filename: input.interpreterSourceUrl ?? 'google-botguard-interpreter.js' }).runInContext(context, { timeout: SYNC_TIMEOUT });
  phase = 'initialize';
  const setup = await readFile(new URL('./realm-init.js', import.meta.url), 'utf8');
  await bounded(run(setup), timeoutMs);
  initializedAt = Date.now(); phase = 'ready';
  return inspect();
}
async function snapshot(blobref, timeoutMs) {
  if (phase !== 'ready') throw new OperationError('NOT_READY');
  if (typeof blobref !== 'string' || !blobref.startsWith('/synthid-demo-drop-zone/ttl_1d/users/') || blobref.length > 2048 || /[\r\n\0]/.test(blobref)) throw new OperationError('INVALID_BLOBREF');
  phase = 'snapshot';
  // Preserve unbound callback invocation and the official four-element input.
  const pendingToken = run('globalThis.__ready.then(() => new Promise(resolve => { const snapshot = globalThis.__snapshot; snapshot(resolve, [{blobref:' + JSON.stringify(blobref) + '}, undefined, undefined, undefined]); }))');
  const token = await bounded(pendingToken, timeoutMs);
  snapshotCount++; phase = 'ready';
  if (typeof token !== 'string' || token.length > 512 * 1024 || !/^![\x21-\x7e]+$/.test(token)) return { ...inspect(), success: false, code: 'INVALID_TOKEN' };
  return { ...inspect(), bgToken: token };
}
async function dispatchPointerDiagnostics(timeoutMs) {
  if (phase !== 'ready') throw new OperationError('NOT_READY');
  if (!enablePointerDiagnostics) throw new OperationError('POINTER_DIAGNOSTICS_DISABLED');
  phase = 'pointerDiagnostics';
  const deadline = Date.now() + timeoutMs;
  const remaining = () => {
    const milliseconds = deadline - Date.now();
    if (milliseconds <= 0) throw new OperationError('OPERATION_TIMEOUT');
    return milliseconds;
  };
  let installed = false, interval;
  const eventListenersBefore = eventListenerProbe?.snapshot();
  try {
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
    phase = 'ready';
    return { ...inspect(), eventListenersBefore, pointerDiagnostics };
  } finally {
    clearTimeout(interval);
    if (installed && context) {
      try { run('try { globalThis.__synthidPointerDiagnosticControl.close(); } finally { delete globalThis.__synthidPointerDiagnosticControl; }'); } catch {}
    }
  }
}
async function handle(request) {
  if (!request || request.version !== VERSION || !Number.isSafeInteger(request.id) || request.id < 1
    || !['init', 'snapshot', 'pointerDiagnostics', 'inspect', 'dispose'].includes(request.op)) throw new OperationError('INVALID_PROTOCOL');
  let result;
  if (request.op === 'init') result = await initialize(request.input, timeoutFor(request, 20000));
  if (request.op === 'snapshot') result = await snapshot(request.blobref, timeoutFor(request, 15000));
  if (request.op === 'pointerDiagnostics') result = await dispatchPointerDiagnostics(timeoutFor(request, 5000));
  if (request.op === 'inspect') result = inspect();
  if (request.op === 'dispose') { stopping = true; result = await shutdown(timeoutFor(request, 2000)); }
  await send({ id: request.id, ok: true, result });
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
