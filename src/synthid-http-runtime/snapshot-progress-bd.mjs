// Host-only diagnostics for the existing private lifecycle stdout pipe.
// Public client telemetry: snapshotProgress = { disposition, stage, messages }.
// disposition is none | active | completed | worker-timeout. 'completed' means
// an ordinary response arrived, including an ordinary error response.
// stage is none or one of SNAPSHOT_PROGRESS_STAGES; messages is 0..7.
// Only received stages are evidence. A missing stage can reflect pipe delay.
// Request IDs are private correlation state and never enter the public record.
// Author handoff: all four assigned BD files are ready for root review/testing.
// No fixture, child process, interpreter import or live operation was executed.
// The selftest uses actual extracted runtime code and authored fakes, including
// pinned BC comparisons; it does not claim real-pipe delivery during a stall.
import { types } from 'node:util';

export const SNAPSHOT_PROGRESS_STAGES = Object.freeze([
  'entered', 'phase-set', 'realm-returned', 'token-settled',
  'flush-complete', 'verification-complete', 'inspected',
]);
const validId = value => Number.isSafeInteger(value) && value > 0;
const fixedEnvelope = value => {
  try {
    if (!value || typeof value !== 'object' || types.isProxy(value) || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 4 || !['version', 'id', 'kind', 'stage'].every(key => keys.includes(key))) return null;
    const fields = Object.getOwnPropertyDescriptors(value);
    if (keys.some(key => !Object.hasOwn(fields[key], 'value'))) return null;
    const version = fields.version.value, id = fields.id.value;
    const kind = fields.kind.value, stage = fields.stage.value;
    if (version !== 1 || !validId(id) || kind !== 'snapshot-progress'
        || !SNAPSHOT_PROGRESS_STAGES.includes(stage)) return null;
    return { id, stage };
  } catch { return null; }
};

export function createSnapshotProgressTracker() {
  let activeId, stage = 'none', messages = 0, disposition = 'none', captured;
  return Object.freeze({
    start(id) {
      if (!validId(id) || captured || activeId !== undefined) return false;
      activeId = id; stage = 'none'; messages = 0; disposition = 'active';
      return true;
    },
    accept(envelope) {
      const fields = fixedEnvelope(envelope);
      if (!fields || captured || activeId === undefined || fields.id !== activeId
          || SNAPSHOT_PROGRESS_STAGES.indexOf(fields.stage) <= SNAPSHOT_PROGRESS_STAGES.indexOf(stage)) return false;
      stage = fields.stage; messages++;
      return true;
    },
    complete(id) {
      if (activeId === undefined || activeId !== id || captured) return;
      activeId = undefined; disposition = 'completed';
    },
    timeout(id) {
      if (activeId === undefined || activeId !== id || captured) return;
      captured = { disposition: 'worker-timeout', stage, messages };
      activeId = undefined;
    },
    snapshot() {
      return captured ? { ...captured } : { disposition, stage, messages };
    },
  });
}

export function createSnapshotProgressEmitter(write, id, enabled) {
  let last = -1;
  return stage => {
    if (enabled !== true || !validId(id)) return;
    const next = SNAPSHOT_PROGRESS_STAGES.indexOf(stage);
    if (next <= last) return;
    last = next;
    // No await, timer, target call or callback settlement is added.
    try { write(JSON.stringify({ version: 1, id, kind: 'snapshot-progress', stage }) + '\n'); } catch {}
  };
}
