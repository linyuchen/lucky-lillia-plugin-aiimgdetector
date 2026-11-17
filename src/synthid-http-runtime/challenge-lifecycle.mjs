// Node-only, account-independent orchestration of the public WH/SH/EH protocol.
// Dependencies own HTTP and isolated execution. No credentials, logging or browser.
const DEFAULT_KEY = 'UzdguikIn08nBCK5a0xw';
const DEFAULTS = Object.freeze({
  autoRenew: false, renewalIntervalMs: 43_200_000, maxAttempts: 10,
  initialRetryMs: 1000, renewalRetryMs: 60_000, maxRetryMs: 600_000, retryJitter: 0.25,
  challengeTimeoutMs: 30_000, interpreterTimeoutMs: 30_000, initializationTimeoutMs: 60_000,
  renewalSnapshotTimeoutMs: 10_000, snapshotTimeoutMs: 15_000,
  drainTimeoutMs: 30_000, disposeTimeoutMs: 2000, maxCachedInterpreters: 8,
});

export class ChallengeLifecycleError extends Error {
  constructor(code, phase) {
    super('SynthID challenge lifecycle failed: ' + code);
    this.name = 'ChallengeLifecycleError'; this.code = code; this.phase = phase;
  }
}
const failure = (code, phase) => new ChallengeLifecycleError(code, phase);
const abortSignal = (...signals) => AbortSignal.any(signals.filter(Boolean));
const checkAbort = (signal, phase) => { if (signal?.aborted) throw failure('ABORTED', phase); };
const asStringField = value => {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 1_048_576) throw failure('INVALID_FIELD', 'serialization');
  return value;
};

/** JH string setters omit null/undefined/default-empty values, preserving inner holes. */
export function createChallengeRequest(requestKey = DEFAULT_KEY, interpreterHash, previousSnapshot) {
  if (typeof requestKey !== 'string' || !requestKey || requestKey.length > 4096) throw failure('INVALID_KEY', 'serialization');
  const fields = [requestKey, asStringField(interpreterHash), asStringField(previousSnapshot)];
  while (fields.at(-1) === undefined) fields.pop();
  return fields.map(value => value ?? null);
}

/** Xe starts at the base with no jitter; nF prepares doubled, capped later waits. */
export function challengeRetryDelay(attempt, base, maximum, jitter, random = Math.random) {
  if (attempt === 2) return base;
  const value = Math.min(maximum, base * 2 ** (attempt - 2));
  const sample = Math.max(0, Math.min(1, Number(random()) || 0));
  return Math.max(0, Math.min(maximum, value + Math.round(jitter * (sample - 0.5) * 2 * value)));
}

/** Deadline bounds the caller; onSettled follows actual dependency completion.
 * This distinction keeps timed-out snapshots leased until they truly finish. */
function boundedCall(call, { signal, timeoutMs, phase, onSettled = () => {}, onLateValue = () => {} }) {
  const controller = new AbortController();
  let complete = false, resolveResult, rejectResult;
  const promise = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  void promise.catch(() => {});
  const finish = (error, value) => {
    if (complete) return;
    complete = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (error) rejectResult(error); else resolveResult(value);
  };
  const abort = () => { controller.abort(); finish(failure('ABORTED', phase)); };
  const timer = setTimeout(() => { controller.abort(); finish(failure('TIMEOUT', phase)); }, timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const actual = Promise.resolve().then(() => {
    checkAbort(controller.signal, phase);
    return call(controller.signal);
  });
  actual.then(value => {
    if (complete) return Promise.resolve(onLateValue(value)).catch(() => {});
    finish(undefined, value);
  }, error => {
    finish(error instanceof ChallengeLifecycleError ? error : failure('DEPENDENCY_FAILED', phase));
  }).finally(onSettled).catch(() => {});
  return promise;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    const finish = error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
    const abort = () => finish(failure('ABORTED', 'retry-wait'));
    const timer = setTimeout(() => finish(), ms);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function tokenFrom(result) {
  const token = typeof result === 'string' ? result : result?.success === true ? result.bgToken : undefined;
  if (typeof token !== 'string' || token.length > 1_048_576) throw failure('INVALID_SNAPSHOT', 'snapshot');
  return token;
}

export class SynthIdChallengeLifecycle {
  #dependencies; #options; #requestKey; #random; #lifetime = new AbortController();
  #active; #slots = new Set(); #cache = new Map(); #lastLoadedHash;
  #initializing; #renewing; #timer; #disposed = false; #disposePromise;
  #externalSignal; #externalAbort; #cleanups = new Set();
  #counts = { challenges: 0, interpreterLoads: 0, cacheHits: 0, initializedInstances: 0,
    publishedInstances: 0, retiredInstances: 0, disposedInstances: 0, forcedDisposals: 0,
    disposeFailures: 0, lateInstances: 0, snapshots: 0, snapshotFailures: 0,
    renewalSnapshots: 0, renewalSnapshotTimeouts: 0, renewalSnapshotFailures: 0,
    renewalCycles: 0, failedCycles: 0, retries: 0, timerRenewals: 0 };

  constructor({ fetchChallenge, loadInterpreter, createInstance, requestKey = DEFAULT_KEY,
    signal, random = Math.random, ...options } = {}) {
    if ([fetchChallenge, loadInterpreter, createInstance, random].some(value => typeof value !== 'function')) throw failure('INVALID_DEPENDENCIES', 'configuration');
    createChallengeRequest(requestKey);
    this.#options = { ...DEFAULTS, ...options };
    const integers = Object.entries(this.#options).filter(([name]) => !['autoRenew', 'retryJitter'].includes(name));
    if (integers.some(([, value]) => !Number.isSafeInteger(value) || value < 1 || value > 86_400_000) ||
        typeof this.#options.autoRenew !== 'boolean' || !Number.isFinite(this.#options.retryJitter) ||
        this.#options.retryJitter < 0 || this.#options.retryJitter > 1 ||
        this.#options.maxAttempts > 100 || this.#options.maxCachedInterpreters > 128) throw failure('INVALID_OPTIONS', 'configuration');
    this.#dependencies = { fetchChallenge, loadInterpreter, createInstance };
    this.#requestKey = requestKey; this.#random = random;
    this.#externalSignal = signal;
    if (signal) {
      this.#externalAbort = () => { void this.dispose(); };
      signal.addEventListener('abort', this.#externalAbort, { once: true });
      if (signal.aborted) this.#externalAbort();
    }
  }

  /** Fixed states and counters only; hashes, programs and tokens never appear here. */
  get telemetry() {
    return { ...this.#counts, ready: Boolean(this.#active), disposed: this.#disposed,
      cachedInterpreters: this.#cache.size, retainedInstances: this.#slots.size,
      inFlightSnapshots: [...this.#slots].reduce((count, slot) => count + slot.leases, 0) };
  }
  #assertOpen(signal) { if (this.#disposed) throw failure('DISPOSED', 'lifecycle'); checkAbort(signal, 'lifecycle'); }
  #schedule() {
    clearTimeout(this.#timer);
    if (!this.#options.autoRenew || this.#disposed) return;
    this.#timer = setTimeout(() => {
      if (this.#disposed) return;
      this.#counts.timerRenewals++;
      const next = this.#active ? this.renew() : this.initialize();
      void next.catch(() => {});
    }, this.#options.renewalIntervalMs);
    this.#timer.unref?.();
  }
  initialize({ signal } = {}) {
    try { this.#assertOpen(signal); } catch (error) { return Promise.reject(error); }
    if (this.#active) return Promise.resolve(this.telemetry);
    if (this.#initializing) return this.#initializing;
    this.#initializing = this.#cycle(undefined, abortSignal(this.#lifetime.signal, signal))
      .finally(() => { this.#initializing = undefined; this.#schedule(); });
    return this.#initializing;
  }
  renew({ signal } = {}) {
    try { this.#assertOpen(signal); } catch (error) { return Promise.reject(error); }
    if (!this.#active) return this.initialize({ signal });
    if (this.#renewing) return this.#renewing;
    clearTimeout(this.#timer); this.#counts.renewalCycles++;
    const previous = this.#active;
    this.#renewing = this.#cycle(previous, abortSignal(this.#lifetime.signal, signal))
      .finally(() => { this.#renewing = undefined; this.#schedule(); });
    return this.#renewing;
  }
  async snapshot(blobref, { signal } = {}) {
    this.#assertOpen(signal);
    if (typeof blobref !== 'string' || !blobref || blobref.length > 4096 || /[\x00-\x1f\x7f]/.test(blobref)) throw failure('INVALID_BLOBREF', 'snapshot');
    if (!this.#active) await this.initialize({ signal });
    this.#assertOpen(signal);
    // Capture the slot before yielding. A later renewal cannot switch this call.
    const slot = this.#active;
    this.#counts.snapshots++;
    try { return await this.#snapshotSlot(slot, blobref, false, abortSignal(this.#lifetime.signal, signal)); }
    catch (error) { this.#counts.snapshotFailures++; throw error; }
  }
  #snapshotSlot(slot, blobref, renewal, signal) {
    slot.leases++;
    return boundedCall(operationSignal => renewal
      ? slot.instance.snapshotForRenewal({ signal: operationSignal })
      : slot.instance.snapshot(blobref, { signal: operationSignal }), {
      signal, phase: renewal ? 'renewal-snapshot' : 'snapshot',
      timeoutMs: renewal ? this.#options.renewalSnapshotTimeoutMs : this.#options.snapshotTimeoutMs,
      onSettled: () => {
        slot.leases--;
        if (slot.retired && slot.leases === 0) this.#disposeSlot(slot);
      },
    }).then(tokenFrom);
  }
  async #interpreter(challenge, signal) {
    const hash = asStringField(challenge?.interpreterHash);
    if (hash && this.#cache.has(hash)) { this.#counts.cacheHits++; return this.#cache.get(hash); }
    this.#counts.interpreterLoads++;
    const code = await boundedCall(operationSignal => this.#dependencies.loadInterpreter(challenge, { signal: operationSignal }), {
      signal, phase: 'interpreter-load', timeoutMs: this.#options.interpreterTimeoutMs,
    });
    if (typeof code !== 'string' || !code || Buffer.byteLength(code) > 16 * 1024 * 1024) throw failure('INVALID_INTERPRETER', 'interpreter-load');
    if (hash) {
      this.#cache.set(hash, code); this.#lastLoadedHash = hash;
      while (this.#cache.size > this.#options.maxCachedInterpreters) this.#cache.delete(this.#cache.keys().next().value);
    }
    return code;
  }
  async #newSlot(challenge, interpreter, signal) {
    const controller = new AbortController();
    const instance = await boundedCall(operationSignal => {
      const abort = () => controller.abort();
      operationSignal.addEventListener('abort', abort, { once: true });
      if (operationSignal.aborted) abort();
      return Promise.resolve().then(() => this.#dependencies.createInstance({ challenge, interpreter, signal: controller.signal }))
        .finally(() => operationSignal.removeEventListener('abort', abort));
    }, {
      signal, phase: 'instance-initialize', timeoutMs: this.#options.initializationTimeoutMs,
      onLateValue: late => { this.#counts.lateInstances++; return this.#disposeLoose(late, controller); },
    });
    if (!instance || ['snapshot', 'snapshotForRenewal', 'dispose'].some(name => typeof instance[name] !== 'function')) {
      await this.#disposeLoose(instance, controller);
      throw failure('INVALID_INSTANCE', 'instance-initialize');
    }
    let resolveClosed;
    const slot = { instance, controller, leases: 0, retired: false, disposing: false,
      closed: new Promise(resolve => { resolveClosed = resolve; }), resolveClosed };
    this.#counts.initializedInstances++;
    this.#slots.add(slot);
    return slot;
  }
  async #cycle(previous, signal) {
    let renewalSnapshot;
    try {
      if (previous) {
        this.#counts.renewalSnapshots++;
        try { renewalSnapshot = await this.#snapshotSlot(previous, undefined, true, signal); }
        catch (error) {
          checkAbort(signal, 'renewal-snapshot');
          if (error.code === 'TIMEOUT') { renewalSnapshot = 'E:CTO'; this.#counts.renewalSnapshotTimeouts++; }
          else { renewalSnapshot = 'E:UCE'; this.#counts.renewalSnapshotFailures++; }
        }
      }
      for (let attempt = 1; attempt <= this.#options.maxAttempts; attempt++) {
        checkAbort(signal, 'challenge');
        if (attempt > 1) {
          this.#counts.retries++;
          const base = previous ? this.#options.renewalRetryMs : this.#options.initialRetryMs;
          await wait(challengeRetryDelay(attempt, base, this.#options.maxRetryMs, this.#options.retryJitter, this.#random), signal);
        }
        let candidate;
        try {
          const request = createChallengeRequest(this.#requestKey, this.#lastLoadedHash, renewalSnapshot);
          this.#counts.challenges++;
          const challenge = await boundedCall(operationSignal => this.#dependencies.fetchChallenge(request, { signal: operationSignal, attempt, renewal: Boolean(previous) }), {
            signal, phase: 'challenge', timeoutMs: this.#options.challengeTimeoutMs,
          });
          if (!challenge || typeof challenge !== 'object' || Array.isArray(challenge)) throw failure('INVALID_CHALLENGE', 'challenge');
          const interpreter = await this.#interpreter(challenge, signal);
          candidate = await this.#newSlot(challenge, interpreter, signal);
          checkAbort(signal, 'publish'); this.#assertOpen();
          const old = this.#active;
          this.#active = candidate; this.#counts.publishedInstances++;
          if (old) this.#retire(old);
          return this.telemetry;
        } catch (error) {
          if (candidate) this.#retire(candidate);
          checkAbort(signal, 'renewal');
          if (this.#disposed) throw failure('DISPOSED', 'lifecycle');
          if (attempt === this.#options.maxAttempts) throw error;
        }
      }
    } catch (error) {
      this.#counts.failedCycles++;
      throw error instanceof ChallengeLifecycleError ? error : failure('DEPENDENCY_FAILED', 'cycle');
    }
  }
  #trackCleanup(promise) {
    this.#cleanups.add(promise);
    void promise.finally(() => this.#cleanups.delete(promise)).catch(() => {});
    return promise;
  }
  #disposeLoose(instance, controller, force = false) {
    if (force) controller.abort();
    if (typeof instance?.dispose !== 'function') { controller.abort(); return Promise.resolve(); }
    return this.#trackCleanup(boundedCall(signal => instance.dispose({ signal }), {
      timeoutMs: this.#options.disposeTimeoutMs, phase: 'dispose',
    }).catch(() => { this.#counts.disposeFailures++; }).finally(() => controller.abort()));
  }
  #retire(slot) {
    if (slot.retired) return slot.closed;
    slot.retired = true; this.#counts.retiredInstances++;
    if (slot.leases === 0) this.#disposeSlot(slot);
    else slot.drainTimer = setTimeout(() => {
      this.#counts.forcedDisposals++;
      this.#disposeSlot(slot, true);
    }, this.#options.drainTimeoutMs);
    return slot.closed;
  }
  #disposeSlot(slot, force = false) {
    if (slot.disposing) return;
    slot.disposing = true; clearTimeout(slot.drainTimer);
    void this.#disposeLoose(slot.instance, slot.controller, force).finally(() => {
      this.#counts.disposedInstances++; this.#slots.delete(slot); slot.resolveClosed();
    });
  }
  dispose() {
    if (this.#disposePromise) return this.#disposePromise;
    this.#disposed = true; clearTimeout(this.#timer); this.#lifetime.abort();
    this.#externalSignal?.removeEventListener('abort', this.#externalAbort);
    this.#active = undefined; this.#cache.clear(); this.#lastLoadedHash = undefined;
    this.#disposePromise = (async () => {
      const retiring = [...this.#slots].map(slot => this.#retire(slot));
      await Promise.allSettled([this.#initializing, this.#renewing].filter(Boolean));
      await Promise.all([...retiring, ...[...this.#slots].map(slot => this.#retire(slot))]);
      await Promise.all([...this.#cleanups]);
      this.#cache.clear(); this.#lastLoadedHash = undefined;
      return this.telemetry;
    })();
    return this.#disposePromise;
  }
}

export const createChallengeLifecycle = options => new SynthIdChallengeLifecycle(options);
