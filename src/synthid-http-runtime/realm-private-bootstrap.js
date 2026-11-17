(function createPrivateBootstrapController(key) {
  'use strict';
  const descriptor = Object.getOwnPropertyDescriptor;
  if (typeof key !== 'string' || !/^__synthid_runtime_control_[a-f0-9]{32}$/.test(key) || descriptor(globalThis, key)) throw new Error('PRIVATE_BOOTSTRAP_KEY_UNAVAILABLE');
  const state = { ready: false, closed: false, snapshot: undefined, shutdown: undefined, metrics: { errors: [] } };
  const consumedShutdowns = new WeakSet();
  let readyPromise, shutdownWork = Promise.resolve(), shutdownInvoked = false, shutdownCompleted = false;
  const ownsProperty = () => { const current = descriptor(globalThis, key); return !!current && Object.prototype.hasOwnProperty.call(current, 'value') && current.value === state; };
  const consumeShutdown = callback => {
    if (typeof callback !== 'function' || consumedShutdowns.has(callback)) return undefined;
    consumedShutdowns.add(callback);
    try { return Promise.resolve(callback()).then(() => true, () => false); }
    catch { return Promise.resolve(false); }
  };
  const seal = () => {
    if (state.closed) return;
    state.closed = true;
    const shutdown = state.shutdown;
    state.snapshot = undefined; state.shutdown = undefined;
    if (ownsProperty()) { try { delete globalThis[key]; } catch {} }
    const operation = consumeShutdown(shutdown);
    if (operation) {
      shutdownInvoked = true;
      shutdownWork = operation.then(completed => { shutdownCompleted = completed; });
    }
  };
  const requireActive = () => {
    if (state.closed) throw new Error('PRIVATE_BOOTSTRAP_CLOSED');
    if (!ownsProperty()) { seal(); throw new Error('PRIVATE_BOOTSTRAP_STATE_LOST'); }
  };
  const shutdownStatus = () => JSON.stringify({ shutdownInvoked, shutdownCompleted });
  Object.defineProperty(globalThis, key, { configurable: true, enumerable: false, writable: false, value: state });
  return {
    initialize(input) {
      requireActive();
      if (readyPromise) throw new Error('PRIVATE_BOOTSTRAP_ALREADY_INITIALIZED');
      const vm = globalThis[input.globalName];
      if (!vm || typeof vm.a !== 'function') throw new Error('interpreter unavailable');
      const experiments = input.experiments ? JSON.parse(input.experiments) : [];
      if (!Array.isArray(experiments)) throw new Error('experiment state');
      const entries = experiments[5] || [];
      if (!Array.isArray(entries) || entries.some(item => !Array.isArray(item))) throw new Error('experiment entries');
      const int32 = value => {
        if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return 0;
        const number = Number(value);
        return Number.isFinite(number) ? number | 0 : 0;
      };
      const first = entries.filter(item => int32(item[1]) <= 53).map(item => int32(item[0]));
      const second = entries.filter(item => int32(item[1]) > 53).map(item => int32(item[0]));
      const values = first.concat(second);
      const kinds = first.map(() => 1).concat(second.map(() => 2));
      state.metrics.experimentCount = values.length;
      state.metrics.stateField5 = typeof experiments[4] === 'string';
      readyPromise = new Promise((resolve, reject) => {
        const init = vm.a;
        init(input.program, (snapshot, shutdown) => {
          Promise.resolve().then(() => {
            if (state.closed) { consumeShutdown(shutdown); return; }
            if (typeof snapshot !== 'function') { consumeShutdown(shutdown); reject(new Error('snapshot unavailable')); return; }
            if (!ownsProperty()) { seal(); consumeShutdown(shutdown); reject(new Error('PRIVATE_BOOTSTRAP_STATE_LOST')); return; }
            state.snapshot = snapshot; state.shutdown = shutdown; state.ready = true;
            resolve(true);
          });
        }, true, undefined, () => {}, [values, kinds], typeof experiments[4] === 'string' ? experiments[4] : '', false, [
          () => {}, value => { if (state.metrics.errors.length < 20 && typeof value === 'number') state.metrics.errors.push(value); },
          () => {}, () => {},
        ], undefined);
      });
      return readyPromise;
    },
    snapshot({ blobref, unbound, snapshotFourthInputTrue = false }) {
      requireActive();
      if (typeof snapshotFourthInputTrue !== 'boolean') throw new Error('PRIVATE_BOOTSTRAP_INVALID_INPUT');
      if (!readyPromise) throw new Error('PRIVATE_BOOTSTRAP_NOT_READY');
      return readyPromise.then(() => {
        requireActive();
        const snapshot = state.snapshot;
        return new Promise(resolve => snapshot(resolve, [unbound ? undefined : { blobref }, undefined, undefined, !unbound && snapshotFourthInputTrue ? true : undefined]));
      });
    },
    metrics() {
      requireActive();
      return JSON.stringify({ experimentCount: state.metrics.experimentCount, stateField5: state.metrics.stateField5, errors: state.metrics.errors.filter(Number.isSafeInteger).slice(0, 20) });
    },
    async shutdown() {
      seal();
      await shutdownWork;
      return shutdownStatus();
    },
    shutdownStatus,
    seal,
  };
})
