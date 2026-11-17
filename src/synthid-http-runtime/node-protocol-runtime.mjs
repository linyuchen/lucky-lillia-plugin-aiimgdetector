import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createChallengeLifecycle } from './challenge-lifecycle.mjs';
import { createLifecycleClient } from './lifecycle-client.mjs';
import { parseOfficialChallenge, normalizeOfficialExperimentState } from './complete-protocol.mjs';

const ORIGIN = 'https://synthid.com';
const CREATE_URL = 'https://waa-pa.clients6.google.com/$rpc/google.internal.waa.v1.Waa/Create';
const API_KEY = 'AIzaSyBGb5fGAyC-pRcRU6MUHb__b_vKha71HRE';
const LIMITS = { challenge: 4 * 1024 * 1024, interpreter: 4 * 1024 * 1024, frame: 1024 * 1024 };
const ENVIRONMENT_KEYS = ['pageHTML', 'pageGlobals', 'cookieJar', 'pageUrl', 'referrer'];
const PHASES = new Set(['empty', 'environment', 'interpreter', 'initialize', 'ready', 'snapshot', 'disposed']);
const counter = value => Number.isSafeInteger(value) && value >= 0;
const abortError = () => new NodeProtocolRuntimeError('ABORTED');
const throwIfAborted = signal => { if (signal?.aborted) throw abortError(); };

export class NodeProtocolRuntimeError extends Error {
  constructor(code) { super('SynthID Node protocol failed: ' + code); this.name = 'NodeProtocolRuntimeError'; this.code = code; }
}

function withAbort(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function readBody(response, limit, signal) {
  if (!response || typeof response.ok !== 'boolean' || response.redirected === true) throw new NodeProtocolRuntimeError('INVALID_RESPONSE');
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new NodeProtocolRuntimeError('HTTP_STATUS');
  }
  const declared = response.headers?.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > limit) {
    void response.body?.cancel().catch(() => {});
    throw new NodeProtocolRuntimeError('RESPONSE_TOO_LARGE');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    for (;;) {
      throwIfAborted(signal);
      const { value, done } = await withAbort(reader.read(), signal);
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new NodeProtocolRuntimeError('RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length));
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error instanceof NodeProtocolRuntimeError ? error : new NodeProtocolRuntimeError('RESPONSE_READ_FAILED');
  } finally { try { reader.releaseLock(); } catch {} }
}

function interpreterUrl(challenge) {
  const value = challenge.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
  if (typeof value !== 'string' || !value) throw new NodeProtocolRuntimeError('INTERPRETER_RESOURCE_MISSING');
  let url; try { url = new URL(value, ORIGIN); } catch { throw new NodeProtocolRuntimeError('INTERPRETER_URL_INVALID'); }
  if (url.protocol !== 'https:' || !['www.google.com', 'www.gstatic.com'].includes(url.hostname) ||
      url.username || url.password || !url.pathname.startsWith('/js/')) throw new NodeProtocolRuntimeError('INTERPRETER_URL_INVALID');
  return url.href;
}

/** Exact live-driver extraction: the program suffix after the last // is base64. */
export function readProtocolFrameUrl(program) {
  if (typeof program !== 'string') throw new NodeProtocolRuntimeError('FRAME_PROGRAM_INVALID');
  const suffix = program.lastIndexOf('//');
  if (suffix < 0) return undefined;
  let url;
  try { url = new URL(Buffer.from(program.slice(suffix + 2), 'base64').toString('utf8'), ORIGIN); }
  catch { throw new NodeProtocolRuntimeError('FRAME_URL_INVALID'); }
  if (url.protocol !== 'https:' || !['synthid.com', 'www.google.com', 'www.gstatic.com'].includes(url.hostname) ||
      url.username || url.password) throw new NodeProtocolRuntimeError('FRAME_URL_INVALID');
  return url.href;
}

function safeWorkerResult(input) {
  const result = {};
  if (PHASES.has(input?.phase)) result.phase = input.phase;
  for (const name of ['snapshotCount', 'aliveMs']) if (counter(input?.[name])) result[name] = input[name];
  const diagnostics = {};
  for (const name of ['domErrors', 'suppliedFrameRequests', 'refusedResources', 'pageHTMLBytes']) {
    if (counter(input?.diagnostics?.[name])) diagnostics[name] = input.diagnostics[name];
  }
  for (const name of ['userAgentMatches', 'cookieJarProvided', 'pageHTMLProvided', 'scriptingEnabledParsing', 'pageGlobalsProvided']) {
    if (typeof input?.diagnostics?.[name] === 'boolean') diagnostics[name] = input.diagnostics[name];
  }
  if (Object.keys(diagnostics).length) result.diagnostics = diagnostics;
  const metrics = {};
  if (counter(input?.metrics?.experimentCount)) metrics.experimentCount = input.metrics.experimentCount;
  if (typeof input?.metrics?.stateField5 === 'boolean') metrics.stateField5 = input.metrics.stateField5;
  if (Array.isArray(input?.metrics?.errors)) metrics.errors = input.metrics.errors.filter(Number.isSafeInteger).slice(0, 20);
  if (Object.keys(metrics).length) result.metrics = metrics;
  for (const name of ['shutdownInvoked', 'shutdownCompleted']) if (typeof input?.[name] === 'boolean') result[name] = input[name];
  return result;
}

async function disposePartial(client, timeoutMs) {
  if (typeof client?.dispose !== 'function') return;
  let timer;
  try {
    await Promise.race([Promise.resolve().then(() => client.dispose()), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new NodeProtocolRuntimeError('PARTIAL_CLEANUP_TIMEOUT')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

/** Browser-free adapter. All HTTP calls and current page/cookie state are injected.
 * clientFactory is injectable for offline fixtures; default execution is Node only. */
export function createNodeProtocolRuntime({ request, environment = async () => ({}), userAgent,
  signal, autoRenew = false, lifecycleOptions = {}, clientOptions = {}, diagnostics = false,
  clientFactory = createLifecycleClient, partialCleanupTimeoutMs = 5000 } = {}) {
  if ([request, environment, clientFactory].some(value => typeof value !== 'function') ||
      typeof userAgent !== 'string' || !userAgent || userAgent.length > 1024 || /[^\x20-\x7e]/.test(userAgent) ||
      !Number.isInteger(partialCleanupTimeoutMs) || partialCleanupTimeoutMs < 1 || partialCleanupTimeoutMs > 30_000) {
    throw new NodeProtocolRuntimeError('INVALID_OPTIONS');
  }
  const baseHeaders = { Origin: ORIGIN, Referer: ORIGIN + '/', 'User-Agent': userAgent };
  const snapshotContext = new AsyncLocalStorage();
  const counts = { challengeRequests: 0, interpreterRequests: 0, frameRequests: 0,
    parsedChallenges: 0, createdWorkers: 0, initializedWorkers: 0, disposedWorkers: 0,
    partialCleanupFailures: 0, environmentsRead: 0 };
  const sources = new Map();
  let latestInitialization = {}, latestDisposal = {};
  const send = async (url, init, stage) => {
    throwIfAborted(init.signal);
    counts[stage + 'Requests']++;
    try {
      const pending = Promise.resolve().then(() => {
        throwIfAborted(init.signal);
        return request(url, { ...init, redirect: 'error' }, stage);
      });
      // If an injected HTTP client ignores abort and resolves late, release its body.
      void pending.then(response => {
        if (init.signal?.aborted) void response?.body?.cancel().catch(() => {});
      }, () => {}).catch(() => {});
      const response = await withAbort(pending, init.signal);
      return await readBody(response, LIMITS[stage], init.signal);
    } catch (error) {
      throw error instanceof NodeProtocolRuntimeError ? error : new NodeProtocolRuntimeError('REQUEST_FAILED');
    }
  };
  const lifecycle = createChallengeLifecycle({
    ...lifecycleOptions, autoRenew, signal,
    async fetchChallenge(requestArray, { signal: operationSignal }) {
      const text = await send(CREATE_URL, { method: 'POST', signal: operationSignal,
        headers: { ...baseHeaders, 'Content-Type': 'application/json+protobuf',
          'X-Goog-Api-Key': API_KEY, 'X-User-Agent': 'grpc-web-javascript/0.1' },
        body: JSON.stringify(requestArray),
      }, 'challenge');
      let challenge;
      try { challenge = parseOfficialChallenge(JSON.parse(text)); }
      catch { throw new NodeProtocolRuntimeError('CHALLENGE_INVALID'); }
      if (challenge.program.length > 4 * 1024 * 1024 || challenge.globalName.length > 256 ||
          (challenge.clientExperimentsStateBlob?.length || 0) > 1024 * 1024) throw new NodeProtocolRuntimeError('CHALLENGE_TOO_LARGE');
      counts.parsedChallenges++;
      return challenge;
    },
    async loadInterpreter(challenge, { signal: operationSignal }) {
      const providedUrl = challenge.interpreterUrl?.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
      // Official Vf prefers the supplied script URL when both representations exist.
      let source = providedUrl
        ? await send(interpreterUrl(challenge), { headers: baseHeaders, signal: operationSignal }, 'interpreter')
        : challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
      if (!source) throw new NodeProtocolRuntimeError('INTERPRETER_RESOURCE_MISSING');
      if (typeof source !== 'string' || !source || Buffer.byteLength(source) > LIMITS.interpreter) throw new NodeProtocolRuntimeError('INTERPRETER_TOO_LARGE');
      const sha256 = createHash('sha256').update(source).digest('hex');
      sources.set(sha256, { sha256, bytes: Buffer.byteLength(source) });
      while (sources.size > 16) sources.delete(sources.keys().next().value);
      return source;
    },
    async createInstance({ challenge, interpreter, signal: instanceSignal }) {
      let client;
      const workerAbort = new AbortController();
      const abortWorker = () => workerAbort.abort();
      instanceSignal.addEventListener('abort', abortWorker, { once: true });
      if (instanceSignal.aborted) abortWorker();
      try {
        throwIfAborted(instanceSignal);
        const frameUrl = readProtocolFrameUrl(challenge.program);
        const frameHTML = frameUrl ? await send(frameUrl, { headers: baseHeaders, signal: instanceSignal }, 'frame') : undefined;
        // Frame requests may update the HTTP cookie jar. Read the shared state afterward.
        counts.environmentsRead++;
        const supplied = await withAbort(environment({ signal: instanceSignal }), instanceSignal);
        if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) throw new NodeProtocolRuntimeError('ENVIRONMENT_INVALID');
        const state = Object.fromEntries(ENVIRONMENT_KEYS.filter(name => supplied[name] !== undefined).map(name => [name, supplied[name]]));
        const input = { ...state, program: challenge.program, globalName: challenge.globalName,
          rawExperiments: challenge.clientExperimentsStateBlob ?? '',
          experiments: normalizeOfficialExperimentState(challenge.clientExperimentsStateBlob),
          interpreter, frameUrl, frameHTML, userAgent, diagnostics: diagnostics === true };
        let inputBytes;
        try { inputBytes = Buffer.byteLength(JSON.stringify(input)); }
        catch { throw new NodeProtocolRuntimeError('ENVIRONMENT_INVALID'); }
        if (inputBytes > 15 * 1024 * 1024) throw new NodeProtocolRuntimeError('WORKER_INPUT_TOO_LARGE');
        throwIfAborted(instanceSignal);
        client = await clientFactory({ ...clientOptions,
          timeouts: { init: 25_000, snapshot: 15_000, ...clientOptions.timeouts },
          maxLifetimeMs: clientOptions.maxLifetimeMs ?? (autoRenew ? 13 * 60 * 60 * 1000 : 180_000),
          signal: workerAbort.signal });
        counts.createdWorkers++;
        if (!client || ['initialize', 'snapshot', 'snapshotForRenewal', 'dispose'].some(name => typeof client[name] !== 'function')) throw new NodeProtocolRuntimeError('CLIENT_INVALID');
        throwIfAborted(instanceSignal);
        const initialized = await client.initialize(input);
        if (initialized?.success !== true) throw new NodeProtocolRuntimeError('CLIENT_INITIALIZATION_FAILED');
        throwIfAborted(instanceSignal);
        counts.initializedWorkers++;
        latestInitialization = safeWorkerResult(initialized);
        let disposed = false;
        return {
          async snapshot(blobref) {
            const result = await client.snapshot(blobref);
            if (result?.success !== true || typeof result.bgToken !== 'string' || !/^![\x21-\x7e]+$/.test(result.bgToken)) throw new NodeProtocolRuntimeError('SNAPSHOT_INVALID');
            const context = snapshotContext.getStore();
            if (context) context.result = safeWorkerResult(result);
            return result;
          },
          snapshotForRenewal: () => client.snapshotForRenewal(),
          async dispose() {
            if (disposed) return;
            disposed = true;
            try { latestDisposal = safeWorkerResult(await client.dispose()); }
            finally {
              counts.disposedWorkers++;
              instanceSignal.removeEventListener('abort', abortWorker);
              workerAbort.abort();
            }
          },
        };
      } catch (error) {
        workerAbort.abort();
        instanceSignal.removeEventListener('abort', abortWorker);
        try { await disposePartial(client, partialCleanupTimeoutMs); if (client) counts.disposedWorkers++; }
        catch { counts.partialCleanupFailures++; }
        throw error instanceof NodeProtocolRuntimeError ? error : new NodeProtocolRuntimeError('INSTANCE_PREPARATION_FAILED');
      }
    },
  });
  const telemetry = () => ({ mode: 'node-protocol-cycle', ...counts,
    officialInterpreters: [...sources.values()].map(value => ({ ...value })), protocol: lifecycle.telemetry });
  return {
    async initialize(options) { await lifecycle.initialize(options); return { ...latestInitialization, success: true, protocol: lifecycle.telemetry }; },
    async snapshot(blobref, options) {
      const context = {};
      return snapshotContext.run(context, async () => {
        const bgToken = await lifecycle.snapshot(blobref, options);
        return { ...context.result, success: true, bgToken, protocol: lifecycle.telemetry };
      });
    },
    async renew(options) { await lifecycle.renew(options); return { ...latestInitialization, success: true, protocol: lifecycle.telemetry }; },
    async dispose() { await lifecycle.dispose(); return { ...latestDisposal, success: true, phase: 'disposed', protocol: lifecycle.telemetry }; },
    get telemetry() { return telemetry(); },
  };
}
