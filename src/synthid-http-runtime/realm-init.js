globalThis.__metrics = { errors: [] };
globalThis.__ready = new Promise((resolve, reject) => {
  const input = globalThis.__input;
  const vm = globalThis[input.globalName];
  if (!vm || typeof vm.a !== 'function') throw new Error('interpreter unavailable');
  const state = input.experiments ? JSON.parse(input.experiments) : [];
  if (!Array.isArray(state)) throw new Error('experiment state');
  const entries = state[5] || [];
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
  __metrics.experimentCount = values.length;
  __metrics.stateField5 = typeof state[4] === 'string';
  const init = vm.a;
  init(input.program, (snapshot, shutdown) => {
    if (typeof snapshot !== 'function') { reject(new Error('snapshot unavailable')); return; }
    Promise.resolve().then(() => {
      globalThis.__snapshot = snapshot;
      globalThis.__shutdown = shutdown;
      resolve(true);
    });
  }, true, undefined, () => {}, [values, kinds], typeof state[4] === 'string' ? state[4] : '', false, [
    () => {}, value => { if (__metrics.errors.length < 20 && typeof value === 'number') __metrics.errors.push(value); },
    () => {}, () => {},
  ], undefined);
});
__ready;
