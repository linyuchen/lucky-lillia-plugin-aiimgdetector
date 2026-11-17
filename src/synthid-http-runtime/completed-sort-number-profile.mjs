// Serialize this entire factory into the diagnostic realm. It consumes only an
// already-completed canonical encoding, never the original array or comparator.
export function createCompletedSortNumberProfile() {
  const apply = Reflect.apply, get = Object.getOwnPropertyDescriptor, define = Object.defineProperty;
  const integer = Number.isInteger, finite = Number.isFinite, absolute = Math.abs;
  const charCodeAt = String.prototype.charCodeAt, freeze = Object.freeze;
  const Bytes = Uint8Array, BufferType = ArrayBuffer, View = DataView;
  const getFloat64 = get(View.prototype, 'getFloat64')?.value;
  const setUint8 = get(View.prototype, 'setUint8')?.value;
  const setFloat64 = get(View.prototype, 'setFloat64')?.value;
  if (typeof getFloat64 !== 'function' || typeof setUint8 !== 'function' || typeof setFloat64 !== 'function') {
    throw Error('SORT_NUMBER_PROFILE_UNAVAILABLE');
  }
  let scratch;
  try { scratch = new View(new BufferType(8)); }
  catch { throw Error('SORT_NUMBER_PROFILE_UNAVAILABLE'); }
  const domain = 'completed-sort-array\u0001', records = [];
  const stats = { schemaVersion: 1, diagnosticOnly: true, scope: 'completed-canonical-sort-number-profiles',
    timingNeutral: false, targetArrayRead: false, originalComparatorInvoked: false, primitiveInputsOnly: true,
    rawValuesRecorded: false, hashesRecorded: false, numericGeneratorProven: false,
    maximumRecords: 32, maximumEncodedCodeUnits: 65536, maximumElements: 8192,
    observedCalls: 0, recordedCalls: 0, failedCalls: 0, omittedCalls: 0, disposedCalls: 0,
    recordLimitReached: false, inputLimitReached: false, elementLimitReached: false, countLimitReached: false,
    disposed: false, lastFailure: 'none' };
  const increment = key => {
    if (stats[key] >= 1000000) stats.countLimitReached = true;
    else stats[key]++;
  };
  const append = (array, value) => define(array, array.length, { value, writable: true, enumerable: true, configurable: true });
  const clearScratch = () => { if (scratch) apply(setFloat64, scratch, [0, 0, false]); };
  const omit = (reason, failed = true) => {
    increment('omittedCalls'); if (failed) increment('failedCalls'); stats.lastFailure = reason;
    if (reason === 'record-limit') stats.recordLimitReached = true;
    if (reason === 'input-limit') stats.inputLimitReached = true;
    if (reason === 'element-limit') stats.elementLimitReached = true;
  };
  const snapshot = () => {
    const copied = [];
    for (let index = 0; index < records.length; index++) {
      const row = records[index];
      append(copied, { ...row, absoluteMagnitudeBuckets: { ...row.absoluteMagnitudeBuckets } });
    }
    return { ...stats, complete: !stats.disposed && !stats.failedCalls && !stats.omittedCalls && !stats.countLimitReached,
      records: copied };
  };
  const observe = (encodedString, completionOrdinal) => {
    increment('observedCalls');
    let seen, previous, failure = 'encoding-failed';
    const reject = reason => { failure = reason; throw Error('INVALID_SORT_NUMBER_PROFILE_ENCODING'); };
    try {
      if (stats.disposed) { increment('disposedCalls'); omit('disposed', false); return; }
      if (stats.observedCalls > 32) { omit('record-limit', false); return; }
      if (typeof encodedString !== 'string' || !integer(completionOrdinal) || completionOrdinal < 0 || completionOrdinal > 31
          || completionOrdinal !== stats.observedCalls - 1) { omit('invalid-input'); return; }
      if (encodedString.length > 65536) { omit('input-limit'); return; }
      let offset = 0;
      const code = () => {
        if (offset >= encodedString.length) reject('malformed-framing');
        return apply(charCodeAt, encodedString, [offset++]);
      };
      const byte = () => { const value = code(); if (value > 255) reject('malformed-framing'); return value; };
      const uint32 = () => { let value = 0; for (let index = 0; index < 4; index++) value = value * 256 + byte(); return value; };
      for (let index = 0; index < domain.length; index++) {
        if (code() !== apply(charCodeAt, domain, [index])) reject('malformed-framing');
      }
      const originalCallIndex = uint32(), length = uint32();
      if (length > 8192) reject('element-limit');
      const row = { completionOrdinal: stats.observedCalls - 1, originalCallIndex, length, stringCount: 0, numberCount: 0,
        finite: 0, integer: 0, fractional: 0, negative: 0, positiveZero: 0, negativeZero: 0,
        nan: 0, positiveInfinity: 0, negativeInfinity: 0,
        absoluteMagnitudeBuckets: { zero: 0, '(0,1)': 0, '[1,16)': 0, '[16,256)': 0, '[256,65536)': 0,
          '[65536,2^32)': 0, '>=2^32': 0, nonfinite: 0 },
        allNumbers: true, isPermutationOfZeroBasedIndices: true, numericNondecreasing: true };
      seen = new Bytes(length);
      let hasPrevious = false;
      for (let index = 0; index < length; index++) {
        const tag = code();
        if (tag === 115) {
          const units = uint32();
          if (units > encodedString.length - offset) reject('malformed-framing');
          offset += units; row.stringCount++; row.allNumbers = false; row.isPermutationOfZeroBasedIndices = false;
          continue;
        }
        if (tag !== 110) reject('malformed-framing');
        let value, first, second, tail = 0;
        try {
          for (let position = 0; position < 8; position++) {
            const part = byte();
            if (position === 0) first = part; else if (position === 1) second = part; else tail |= part;
            apply(setUint8, scratch, [position, part]);
          }
          value = apply(getFloat64, scratch, [0, false]);
          if (value !== value && (first !== 127 || second !== 248 || tail !== 0)) reject('noncanonical-nan');
          row.numberCount++;
          const isFinite = finite(value), isInteger = integer(value), negativeZero = value === 0 && (first & 128) !== 0;
          if (value < 0) row.negative++;
          if (isFinite) {
            row.finite++; if (isInteger) row.integer++; else row.fractional++;
            if (value === 0) { row.absoluteMagnitudeBuckets.zero++; if (negativeZero) row.negativeZero++; else row.positiveZero++; }
            else {
              const magnitude = absolute(value);
              const bucket = magnitude < 1 ? '(0,1)' : magnitude < 16 ? '[1,16)' : magnitude < 256 ? '[16,256)'
                : magnitude < 65536 ? '[256,65536)' : magnitude < 4294967296 ? '[65536,2^32)' : '>=2^32';
              row.absoluteMagnitudeBuckets[bucket]++;
            }
            if (hasPrevious && value < previous) row.numericNondecreasing = false;
            previous = value; hasPrevious = true;
          } else {
            row.absoluteMagnitudeBuckets.nonfinite++;
            if (value !== value) row.nan++; else if (value < 0) row.negativeInfinity++; else row.positiveInfinity++;
          }
          if (!isInteger || value < 0 || value >= length || negativeZero) row.isPermutationOfZeroBasedIndices = false;
          else if (seen[value]) row.isPermutationOfZeroBasedIndices = false;
          else seen[value] = 1;
        } finally { value = undefined; clearScratch(); }
      }
      if (offset !== encodedString.length) reject('malformed-framing');
      if (!row.allNumbers || row.finite !== row.numberCount) row.numericNondecreasing = null;
      append(records, row); increment('recordedCalls');
    } catch { omit(failure); }
    finally {
      encodedString = undefined; previous = undefined; seen = undefined;
      try { clearScratch(); } catch { stats.lastFailure = 'scratch-clear-failed'; increment('failedCalls'); }
    }
  };
  const dispose = () => {
    if (!stats.disposed) {
      stats.disposed = true;
      try { clearScratch(); } catch { stats.lastFailure = 'scratch-clear-failed'; increment('failedCalls'); }
      scratch = undefined;
    }
    return snapshot();
  };
  // Empty arrays are all-numeric, a permutation of the empty index set, and nondecreasing.
  return freeze({ observe, snapshot, dispose });
}
