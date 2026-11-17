import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, isAbsolute } from 'node:path';
import { copyNumericVectorPacket, clearNumericVectorPacket } from './numeric-vector-intervention-y.mjs';
import { createSnapshotProgressTracker } from './snapshot-progress-bd.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const VERSION = 1;
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const TIMEOUTS = { init: 20000, snapshot: 15000, renewalSnapshot: 15000, pointerDiagnostics: 5000, activateDiagnostics: 2000, inspect: 2000, takeComparison: 2000, takePayloads: 5000, takeVector: 5000, setVector: 5000, takeSortComparison: 2000, takeMessageComparison: 2000, takeKeyComparison: 2000, dispose: 2000 };
const boundedTimeout = (value, operation) => Number.isInteger(value) && value >= 10 && value <= (operation === 'init' ? 240000 : 120000);

export class LifecycleError extends Error {
  constructor(code, phase, errorType) {
    super('SynthID interpreter lifecycle failed: ' + code);
    this.name = 'LifecycleError'; this.code = code; this.phase = phase; this.errorType = errorType;
  }
}

/** Browser-free interpreter instance. initialize before upload; snapshot after
 * upload finalizes. All supplied code, cookies, programs, and returned tokens
 * remain in memory. This class never logs those values or persists them. */
export class SynthIdLifecycleClient {
  #child; #pending = new Map(); #buffer = ''; #nextId = 1; #closed = false;
  #closing = false; #queue = Promise.resolve(); #timeouts; #lifetimeTimer;
  #closePromise; #resolveClose; #disposePromise; #signal; #abortListener;
  #scalarSnapshotProgressEnabled = false; #snapshotProgress = createSnapshotProgressTracker();
  #telemetry = { spawned: false, responses: 0, stderrBytes: 0, timedOut: false, disposed: false, exited: false };

  constructor({ timeouts = {}, maxLifetimeMs = 5 * 60 * 1000, signal, exceptionDiagnostics = false, webidlBrandErrors = false, nativePluginGetters = false, runtimeAbstractWebGlBindings = false, runtimeAbstractInterfaceBindings = false, nativeTimerResolution = false, nativeDisplayFrames = false, workerExecutable = process.execPath, diagnosticRandomSeed } = {}) {
    if(typeof workerExecutable !== 'string' || !isAbsolute(workerExecutable) || /[\r\n\0]/.test(workerExecutable))throw new LifecycleError('INVALID_OPTIONS');
    if(diagnosticRandomSeed !== undefined && (!Number.isInteger(diagnosticRandomSeed) || diagnosticRandomSeed < 1 || diagnosticRandomSeed > 2147483647))throw new LifecycleError('INVALID_OPTIONS');
    if(typeof nativeDisplayFrames!=='boolean')throw new LifecycleError('INVALID_OPTIONS');
    if(typeof nativeTimerResolution!=='boolean')throw new LifecycleError('INVALID_OPTIONS');
    if(typeof nativePluginGetters!=='boolean')throw new LifecycleError('INVALID_OPTIONS');
    if(typeof runtimeAbstractWebGlBindings!=='boolean'||runtimeAbstractWebGlBindings&&!nativePluginGetters)throw new LifecycleError('INVALID_OPTIONS');
    if(typeof runtimeAbstractInterfaceBindings!=='boolean'||runtimeAbstractInterfaceBindings&&!nativePluginGetters)throw new LifecycleError('INVALID_OPTIONS');
    if(typeof webidlBrandErrors!=='boolean')throw new LifecycleError('INVALID_OPTIONS');
    this.#timeouts = { ...TIMEOUTS, renewalSnapshot: timeouts.snapshot ?? TIMEOUTS.snapshot, ...timeouts };
    if (Object.entries(this.#timeouts).some(([operation, value]) => !boundedTimeout(value, operation)) || !Number.isInteger(maxLifetimeMs) || maxLifetimeMs < 100 || maxLifetimeMs > 13 * 60 * 60 * 1000) throw new LifecycleError('INVALID_OPTIONS');
    if (signal?.aborted) throw new LifecycleError('ABORTED');
    this.#closePromise = new Promise(resolve => { this.#resolveClose = resolve; });
    const allowedPaths = ['lifecycle-worker.mjs', 'realm-init.js', 'realm-pointer-diagnostic.js', 'runtime-diagnostics.mjs', 'runtime-read-diagnostics.mjs', 'runtime-exception-diagnostics.mjs', 'event-listener-diagnostics.mjs', 'event-getter-diagnostics.mjs', 'node-navigation-diagnostics.mjs', 'node-navigation-inspector.mjs', 'node-retained-frame-inspector.mjs', 'node-platform-event-diagnostic.mjs', 'jsdom-event-clock-compat.mjs', 'scripting-parser.mjs', 'package.json', 'node_modules'];
    allowedPaths.push('original-opcode-inspector.mjs', 'original-generated-read-inspector.mjs', 'original-generated-sink-inspector.mjs', 'runtime-web-compat.mjs', 'runtime-child-web-compat.mjs');
    allowedPaths.push('original-output-inspector.mjs', 'realm-private-bootstrap.js');
    allowedPaths.push('current-output-inspector.mjs','current-payload-inspector.mjs','payload-private-send.mjs','current-output-source-coverage.mjs','current-bound-payload-inspector.mjs');
    allowedPaths.push('final-buffer-ablation-x.mjs', 'token-envelope-inspector.mjs');
    allowedPaths.push('numeric-vector-intervention-y.mjs');
    allowedPaths.push('numeric-scalar-intervention-aw.mjs', 'scalar-candidate-registry-av.mjs');
    allowedPaths.push('numeric-scalar-observation-bb.mjs', 'protocol-failure-context-bb.mjs');
    allowedPaths.push('numeric-scalar-late-context-bc.mjs');
    allowedPaths.push('snapshot-progress-bd.mjs');
    allowedPaths.push('numeric-scalar-timeout-details-be.mjs', 'protocol-timeout-details-be.mjs');
    allowedPaths.push('runtime-function-tostring-observation.mjs','function-tostring-observation.mjs');
    allowedPaths.push('completed-tostring-comparison.mjs');
    allowedPaths.push('completed-sort-number-profile.mjs','completed-sort-identity-registry.mjs');
    allowedPaths.push('completed-message-comparison.mjs');
    allowedPaths.push('runtime-clock-precision-control.mjs','runtime-raf-callable-control.mjs');
    allowedPaths.push('runtime-permissions-control.mjs','runtime-permissions-binding.mjs');
    allowedPaths.push('runtime-anchor-href-translate.mjs');
    allowedPaths.push('runtime-chrome-csi.mjs');
    allowedPaths.push('runtime-native-stack-observation.mjs');
    allowedPaths.push('runtime-native-webdriver-control.mjs');
    allowedPaths.push('node-platform-failure-diagnostics.mjs');
    allowedPaths.push('runtime-css-properties-compat.mjs','chromium-css-property-catalog.mjs');
    allowedPaths.push('runtime-native-media-control.mjs');
    allowedPaths.push('anchor-click-observer.mjs');
    allowedPaths.push('runtime-navigator-compat.mjs');
    allowedPaths.push('runtime-window-state-compat.mjs');
    allowedPaths.push('realm-activation-diagnostic.js');
    allowedPaths.push('realm-focus-diagnostic.js');
    allowedPaths.push('runtime-detached-frame-compat.mjs');
    allowedPaths.push('webidl-brand-errors-preload.mjs');
    allowedPaths.push('current-generated-sink-inspector.mjs', 'static-standard-property-catalog.mjs');
    allowedPaths.push('current-read-primitive-values.mjs');
    allowedPaths.push('current-read-key-coverage.mjs');
    allowedPaths.push('completed-numeric-key-comparison.mjs');
    allowedPaths.push('runtime-own-property-names-observation.mjs','own-property-names-observation.mjs');
    allowedPaths.push('own-property-names-cross-realm.mjs');
    allowedPaths.push('own-property-names-sort-results.mjs','raf-sort-interval-attribution.mjs');
    allowedPaths.push('unmatched-sink-coverage.mjs');
    allowedPaths.push('native-function-public-names.mjs');
    allowedPaths.push('direct-public-access-manifest.mjs');
    allowedPaths.push('known-runtime-marker-names.mjs');
    allowedPaths.push('tostring-callsite-inspection.mjs');
    allowedPaths.push('runtime-webidl-realm-compat.mjs', 'webidl-realm-catalog.mjs');
    allowedPaths.push('runtime-webidl-callable-control.mjs', 'webidl-callable-source-catalog.mjs');
    if(nativeDisplayFrames)allowedPaths.push('runtime-display-frame-control.mjs','native-display-frames');
    if(nativeTimerResolution)allowedPaths.push('runtime-native-timer-resolution.mjs','native-timer-resolution');
    if(nativePluginGetters)allowedPaths.push('native-plugin-getters-control.mjs','native-webidl-bridge');
    if(runtimeAbstractWebGlBindings)allowedPaths.push('runtime-abstract-webgl-bindings.mjs','abstract-webgl-native-spec.json');
    if(runtimeAbstractInterfaceBindings)allowedPaths.push('runtime-abstract-interface-bindings.mjs','abstract-interface-native-spec.json');
    if(nativePluginGetters&&workerExecutable!==process.execPath)allowedPaths.push('engine-canary/native-webidl-bridge','engine-canary/package.json');
    // Production layout: permit both the local dependency link and its resolved tree.
    allowedPaths.push('../../node_modules', resolve(dirname(createRequire(import.meta.url).resolve('jsdom/package.json')), '..'));
    this.#telemetry.nativeAddonPermission = nativePluginGetters || nativeTimerResolution || nativeDisplayFrames;
    this.#telemetry.runtimeAbstractWebGlBindingsPermission = runtimeAbstractWebGlBindings;
    this.#telemetry.alternateEngine = workerExecutable !== process.execPath;
    if(diagnosticRandomSeed !== undefined)this.#telemetry.deterministicV8RandomDiagnostic = true;
    this.#child = spawn(workerExecutable, [
      ...(diagnosticRandomSeed !== undefined ? ['--random-seed=' + diagnosticRandomSeed] : []),
      '--permission', ...((nativePluginGetters || nativeTimerResolution || nativeDisplayFrames) ? ['--allow-addons'] : ['--no-addons']), '--no-global-search-paths', '--max-old-space-size=256',
      ...(webidlBrandErrors ? ['--import', pathToFileURL(resolve(DIRECTORY,'webidl-brand-errors-preload.mjs')).href] : []),
      ...(exceptionDiagnostics ? ['--allow-inspector'] : []),
      ...allowedPaths.map(path => '--allow-fs-read=' + resolve(DIRECTORY, path)),
      resolve(DIRECTORY, 'lifecycle-worker.mjs'),
    ], {
      cwd: DIRECTORY, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR },
    });
    this.#child.once('spawn', () => { this.#telemetry.spawned = true; });
    this.#child.stdout.setEncoding('utf8');
    this.#child.stdout.on('data', chunk => this.#read(chunk));
    this.#child.stderr.on('data', chunk => { this.#telemetry.stderrBytes += chunk.length; });
    this.#child.stdin.on('error', () => this.#fail(new LifecycleError('PIPE_FAILURE')));
    this.#child.once('error', () => this.#fail(new LifecycleError('SPAWN_FAILURE')));
    this.#child.once('close', (exitCode, signalName) => {
      this.#closed = true; clearTimeout(this.#lifetimeTimer);
      this.#telemetry.exited = true; this.#telemetry.exitCode = exitCode;
      this.#telemetry.signal = signalName;
      if (this.#signal && this.#abortListener) this.#signal.removeEventListener('abort', this.#abortListener);
      this.#rejectPending(new LifecycleError('WORKER_EXITED'));
      this.#resolveClose();
    });
    this.#lifetimeTimer = setTimeout(() => {
      this.#telemetry.timedOut = true;
      this.#fail(new LifecycleError('LIFETIME_TIMEOUT'));
    }, maxLifetimeMs);
    this.#signal = signal;
    if (signal) {
      this.#abortListener = () => this.#fail(new LifecycleError('ABORTED'));
      signal.addEventListener('abort', this.#abortListener, { once: true });
      if (signal.aborted) this.#abortListener();
    }
  }

  get telemetry() { return { ...this.#telemetry, snapshotProgress: this.#snapshotProgress.snapshot() }; }
  #rejectPending(error) {
    for (const { reject, timer } of this.#pending.values()) { clearTimeout(timer); reject(error); }
    this.#pending.clear();
  }
  #fail(error) {
    this.#closing = true;
    this.#rejectPending(error);
    if (!this.#closed) this.#child.kill();
  }
  #read(chunk) {
    this.#buffer += chunk;
    if (Buffer.byteLength(this.#buffer) > MAX_RESPONSE_BYTES) return this.#fail(new LifecycleError('OVERSIZE_RESPONSE'));
    let end;
    while ((end = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, end); this.#buffer = this.#buffer.slice(end + 1);
      let response;
      try { response = JSON.parse(line); } catch { return this.#fail(new LifecycleError('INVALID_RESPONSE')); }
      if (response && Object.hasOwn(response, 'kind')) {
        if (!this.#pending.has(response.id) || !this.#snapshotProgress.accept(response)) return this.#fail(new LifecycleError('INVALID_RESPONSE'));
        continue;
      }
      const pending = this.#pending.get(response?.id);
      if (response?.version !== VERSION || !pending || typeof response.ok !== 'boolean') return this.#fail(new LifecycleError('INVALID_RESPONSE'));
      this.#snapshotProgress.complete(response.id);
      clearTimeout(pending.timer); this.#pending.delete(response.id); this.#telemetry.responses++;
      if (response.ok) {
        if (typeof pending.scalarSnapshotProgressEnabled === 'boolean') this.#scalarSnapshotProgressEnabled = pending.scalarSnapshotProgressEnabled;
        pending.resolve(response.result);
      }
      else {
        const code = /^[A-Z_]{1,50}$/.test(response.error?.code || '') ? response.error.code : 'WORKER_ERROR';
        const phase = ['empty', 'environment', 'interpreter', 'initialize', 'ready', 'snapshot', 'pointerDiagnostics', 'disposed'].includes(response.error?.phase) ? response.error.phase : undefined;
        const errorType = ['Error', 'TypeError', 'RangeError', 'SyntaxError', 'unknown'].includes(response.error?.errorType) ? response.error.errorType : undefined;
        if (code === 'OPERATION_TIMEOUT') this.#telemetry.timedOut = true;
        pending.reject(new LifecycleError(code, phase, errorType));
      }
    }
  }
  #request(op, values = {}) {
    if (this.#closed || (this.#closing && op !== 'dispose')) return Promise.reject(new LifecycleError('CLOSED'));
    const id = this.#nextId++;
    const timeoutMs = this.#timeouts[op];
    let line, scalarSnapshotProgressEnabled;
    try {
      line = JSON.stringify({ version: VERSION, id, op, timeoutMs, ...values }) + '\n';
      // Read the flag actually sent to the worker without evaluating host input
      // getters a second time or retaining any private initialization values.
      if (op === 'init') scalarSnapshotProgressEnabled = JSON.parse(line).input?.observeScalarCandidates === true;
    }
    catch { return Promise.reject(new LifecycleError('INVALID_INPUT')); }
    if (Buffer.byteLength(line) > MAX_INPUT_BYTES) return Promise.reject(new LifecycleError('OVERSIZE_INPUT'));
    return new Promise((resolve, reject) => {
      if (op === 'snapshot' && this.#scalarSnapshotProgressEnabled) this.#snapshotProgress.start(id);
      // The VM's synchronous execution is independently bounded at 5 seconds.
      // Add that allowance so asynchronous deadlines retain their real meaning.
      const timer = setTimeout(() => {
        this.#telemetry.timedOut = true;
        this.#snapshotProgress.timeout(id);
        this.#fail(new LifecycleError('WORKER_TIMEOUT', op));
      }, timeoutMs + 6500);
      this.#pending.set(id, { resolve, reject, timer, scalarSnapshotProgressEnabled });
      this.#child.stdin.write(line, error => { if (error) this.#fail(new LifecycleError('PIPE_FAILURE')); });
    });
  }
  #serial(op, values) {
    const operation = this.#queue.then(() => this.#request(op, values));
    this.#queue = operation.catch(() => {});
    return operation;
  }
  initialize(input) { return this.#serial('init', { input }); }
  snapshot(blobref, options = {}) {
    let snapshotFourthInputTrue;
    try {
      if (!options || typeof options !== 'object' || Array.isArray(options)
          || ![Object.prototype, null].includes(Object.getPrototypeOf(options))
          || Reflect.ownKeys(options).some(key => key !== 'snapshotFourthInputTrue' && key !== 'signal')) throw 0;
      const option = Object.getOwnPropertyDescriptor(options, 'snapshotFourthInputTrue');
      if (option && (!Object.hasOwn(option, 'value') || option.value !== undefined && typeof option.value !== 'boolean')) throw 0;
      // The existing lifecycle caller supplies signal; preserve its inert value.
      const signal = Object.getOwnPropertyDescriptor(options, 'signal');
      if (signal && !Object.hasOwn(signal, 'value')) throw 0;
      snapshotFourthInputTrue = option?.value === true;
    } catch { return Promise.reject(new LifecycleError('INVALID_OPTIONS')); }
    return this.#serial('snapshot', { blobref, snapshotFourthInputTrue });
  }
  // Official SH renews with old EH.snapshot({}), producing an unbound snapshot.
  snapshotForRenewal() { return this.#serial('renewalSnapshot'); }
  // Explicit synthetic-input experiment; initialize must opt into the gate.
  dispatchPointerDiagnostics() { return this.#serial('pointerDiagnostics'); }
  // Rearm only the opt-in activation simulation; no claim of trusted input.
  activateDiagnostics(options = {}) {
    let sameOriginDescendants;
    try {
      if (!options || typeof options !== 'object' || Array.isArray(options)
          || ![Object.prototype, null].includes(Object.getPrototypeOf(options))
          || Reflect.ownKeys(options).some(key => key !== 'sameOriginDescendants')) throw 0;
      const option = Object.getOwnPropertyDescriptor(options, 'sameOriginDescendants');
      if (option && (!Object.hasOwn(option, 'value') || option.value !== undefined && typeof option.value !== 'boolean')) throw 0;
      sameOriginDescendants = option?.value === true;
    } catch { return Promise.reject(new LifecycleError('INVALID_OPTIONS')); }
    return this.#serial('activateDiagnostics', { sameOriginDescendants });
  }
  inspect() { return this.#serial('inspect'); }
  // Private, one-shot diagnostic transport. Never include in normal reports.
  takeComparison() { return this.#serial('takeComparison'); }
  takePayloads() { return this.#serial('takePayloads'); }
  takeVector(initial=false) {
    if(typeof initial!=='boolean')return Promise.reject(new LifecycleError('INVALID_VECTOR_PACKET'));
    return this.#serial('takeVector',{initial}).then(packet => {
      let copy;
      try {
        copy = copyNumericVectorPacket(packet);
        if (!clearNumericVectorPacket(packet)) throw 0;
        return copy;
      } catch {
        clearNumericVectorPacket(copy); clearNumericVectorPacket(packet);
        throw new LifecycleError('INVALID_VECTOR_PACKET');
      }
    });
  }
  setVector(packet) {
    let copy;
    try {
      copy = copyNumericVectorPacket(packet);
      if ([3,4,5,6].includes(copy.schemaVersion)) throw 0;
      if (!clearNumericVectorPacket(packet)) throw 0;
    } catch {
      clearNumericVectorPacket(copy); clearNumericVectorPacket(packet);
      return Promise.reject(new LifecycleError('INVALID_VECTOR_PACKET'));
    }
    return this.#serial('setVector', { packet: copy }).then(result => {
      if (result !== true) throw new LifecycleError('VECTOR_TRANSFER_FAILED');
      return true;
    }).finally(() => { clearNumericVectorPacket(copy); copy = undefined; });
  }
  takeSortComparison() { return this.#serial('takeSortComparison'); }
  takeMessageComparison() { return this.#serial('takeMessageComparison'); }
  takeKeyComparison() { return this.#serial('takeKeyComparison'); }
  async dispose() {
    if (this.#disposePromise) return this.#disposePromise;
    this.#disposePromise = (async () => {
      let result = { success: true, phase: 'disposed', shutdownInvoked: false, shutdownCompleted: false };
      if (!this.#closed && !this.#closing) {
        this.#closing = true;
        try { result = await this.#request('dispose'); } catch {}
      }
      this.#telemetry.disposed = true;
      if (!this.#closed) {
        this.#child.stdin.end();
        let timer;
        await Promise.race([this.#closePromise, new Promise(resolve => {
          timer = setTimeout(() => { this.#child.kill(); resolve(); }, 1000);
        })]);
        clearTimeout(timer);
      }
      // kill() is asynchronous; bound final cleanup without leaving host timers.
      if (!this.#closed) {
        let timer;
        await Promise.race([this.#closePromise, new Promise(resolve => { timer = setTimeout(resolve, 1000); })]);
        clearTimeout(timer);
      }
      clearTimeout(this.#lifetimeTimer);
      return result;
    })();
    return this.#disposePromise;
  }
}

export const createLifecycleClient = options => new SynthIdLifecycleClient(options);
