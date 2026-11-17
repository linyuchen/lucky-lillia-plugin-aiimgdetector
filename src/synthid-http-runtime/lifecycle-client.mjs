import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const VERSION = 1;
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const TIMEOUTS = { init: 20000, snapshot: 15000, pointerDiagnostics: 5000, inspect: 2000, dispose: 2000 };
const boundedTimeout = (value, operation) => Number.isInteger(value) && value >= 10 && value <= (operation === 'init' ? 240000 : 120000);

export class LifecycleError extends Error {
  constructor(code, phase, errorType) {
    super('SynthID interpreter lifecycle failed: ' + code);
    this.name = 'LifecycleError'; this.code = code; this.phase = phase; this.errorType = errorType;
  }
}

/** All supplied programs, cookies and per-image tokens remain on private pipes. */
export class SynthIdLifecycleClient {
  #child; #pending = new Map(); #buffer = ''; #nextId = 1; #closed = false;
  #closing = false; #queue = Promise.resolve(); #timeouts; #lifetimeTimer;
  #closePromise; #resolveClose; #disposePromise; #signal; #abortListener;
  #telemetry = { spawned: false, responses: 0, stderrBytes: 0, timedOut: false, disposed: false, exited: false };

  constructor({ timeouts = {}, maxLifetimeMs = 5 * 60 * 1000, signal, webidlBrandErrors = false } = {}) {
    if (typeof webidlBrandErrors !== 'boolean') throw new LifecycleError('INVALID_OPTIONS');
    this.#timeouts = { ...TIMEOUTS, ...timeouts };
    if (Object.entries(this.#timeouts).some(([operation, value]) => !boundedTimeout(value, operation)) || !Number.isInteger(maxLifetimeMs) || maxLifetimeMs < 100 || maxLifetimeMs > 13 * 60 * 60 * 1000) throw new LifecycleError('INVALID_OPTIONS');
    if (signal?.aborted) throw new LifecycleError('ABORTED');
    this.#closePromise = new Promise(resolve => { this.#resolveClose = resolve; });
    const allowedPaths = [DIRECTORY, resolve(DIRECTORY, '../../node_modules'),
      resolve(dirname(createRequire(import.meta.url).resolve('jsdom/package.json')), '..')];
    this.#telemetry.nativeAddonPermission = false;
    this.#child = spawn(process.execPath, [
      '--permission', '--no-addons', '--no-global-search-paths', '--max-old-space-size=256',
      ...(webidlBrandErrors ? ['--import', pathToFileURL(resolve(DIRECTORY, 'webidl-brand-errors-preload.mjs')).href] : []),
      ...allowedPaths.map(path => '--allow-fs-read=' + path),
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

  get telemetry() { return { ...this.#telemetry }; }
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
      const pending = this.#pending.get(response?.id);
      if (response?.version !== VERSION || !pending || typeof response.ok !== 'boolean') return this.#fail(new LifecycleError('INVALID_RESPONSE'));
      clearTimeout(pending.timer); this.#pending.delete(response.id); this.#telemetry.responses++;
      if (response.ok) {
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
    if (this.#signal?.aborted && op !== 'dispose') return Promise.reject(new LifecycleError('ABORTED'));
    if (this.#closed || (this.#closing && op !== 'dispose')) return Promise.reject(new LifecycleError('CLOSED'));
    const id = this.#nextId++;
    const timeoutMs = this.#timeouts[op];
    let line;
    try {
      line = JSON.stringify({ version: VERSION, id, op, timeoutMs, ...values }) + '\n';
    }
    catch { return Promise.reject(new LifecycleError('INVALID_INPUT')); }
    if (Buffer.byteLength(line) > MAX_INPUT_BYTES) return Promise.reject(new LifecycleError('OVERSIZE_INPUT'));
    return new Promise((resolve, reject) => {
      // The VM's synchronous execution is independently bounded at 5 seconds.
      // Add that allowance so asynchronous deadlines retain their real meaning.
      const timer = setTimeout(() => {
        this.#telemetry.timedOut = true;
        this.#fail(new LifecycleError('WORKER_TIMEOUT', op));
      }, timeoutMs + 6500);
      this.#pending.set(id, { resolve, reject, timer });
      this.#child.stdin.write(line, error => { if (error) this.#fail(new LifecycleError('PIPE_FAILURE')); });
    });
  }
  #serial(op, values) {
    const operation = this.#queue.then(() => this.#request(op, values));
    this.#queue = operation.catch(() => {});
    return operation;
  }
  initialize(input) { return this.#serial('init', { input }); }
  snapshot(blobref) { return this.#serial('snapshot', { blobref }); }
  dispatchPointerDiagnostics() { return this.#serial('pointerDiagnostics'); }
  inspect() { return this.#serial('inspect'); }
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
