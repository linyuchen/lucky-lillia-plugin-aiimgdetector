// Self-contained: serialize this factory into one selected diagnostic realm.
// Samples remain private; exact equality does not establish a data producer.
export function installRafSortIntervalAttribution(realm) {
  const apply = Reflect.apply, get = Object.getOwnPropertyDescriptor, define = Object.defineProperty;
  const prototype = Object.getPrototypeOf, same = Object.is, integer = Number.isInteger;
  const charCodeAt = String.prototype.charCodeAt, freeze = Object.freeze;
  const MapType = Map, ProxyType = Proxy, WeakMapType = WeakMap;
  const mapGet = Map.prototype.get, mapSet = Map.prototype.set, mapDelete = Map.prototype.delete, mapClear = Map.prototype.clear;
  const weakGet = WeakMap.prototype.get, weakSet = WeakMap.prototype.set;
  const View = DataView, BufferType = ArrayBuffer;
  const getFloat64 = get(View.prototype, 'getFloat64').value, setUint8 = get(View.prototype, 'setUint8').value;
  const setFloat64 = get(View.prototype, 'setFloat64').value;
  const sources = ['callbackTimestampAdjacent', 'callbackFirstNowAdjacent', 'callbackLastNowAdjacent', 'allInCallbackNowAdjacent', 'allPerformanceNowAdjacent'];
  const domain = 'completed-sort-array', negativeZeroKey = {};
  const callbacks = [], nowValues = [], allNowValues = [], sortRecords = [], installations = [];
  let scratch = new View(new BufferType(8)), callbackCache = new WeakMapType(), activeCallback;
  let lastComparison = { records: [], matchedRecords: 0, candidateWindows: 0, comparisonSteps: 0, availableSamples: {} };
  const stats = { schemaVersion: 1, diagnosticOnly: true, scope: 'selected-realm-raf-sort-exact-interval-multisets',
    matchingScope: 'samples-observed-through-snapshot', samplesBeforeSortProven: false,
    timingNeutral: false, callableIdentityChanged: true, originalDelegationsRepeated: false,
    additionalClockReads: 0, originalComparatorInvoked: false, targetArrayRead: false,
    rawValuesRecorded: false, privateRawSamplesRetained: true, hashesRecorded: false,
    producerIdentityProven: false, rpcCausalityProven: false, crossRealmCallsCovered: false,
    maximumCallbacks: 1024, maximumCallbackWrappers: 1024, maximumNowCompletions: 8192, maximumAllNowCompletions: 8192, maximumSortRecords: 32,
    maximumEncodedCodeUnits: 65536, maximumTotalEncodedCodeUnits: 1048576,
    maximumArrayElements: 8192, maximumRetainedNumericElements: 65536, maximumComparisonStepsPerSnapshot: 1000000,
    installationComplete: false, setupFailures: 0, installedDescriptors: 0,
    requestCalls: 0, requestReturned: 0, requestThrew: 0, nonCallableRequests: 0,
    callbackCalls: 0, callbackReturned: 0, callbackThrew: 0, callbacksInflight: 0, callbacksRecorded: 0, callbackWrappersCreated: 0,
    performanceNowCalls: 0, performanceNowReturned: 0, performanceNowThrew: 0, allNowCompletionsRecorded: 0, allNowLimitReached: false,
    inCallbackNowCalls: 0, inCallbackNowReturned: 0, inCallbackNowThrew: 0, nowCompletionsRecorded: 0,
    observedSortCalls: 0, recordedSortCalls: 0, numericSortRecords: 0, ignoredSortRecords: 0,
    failedSortCalls: 0, omittedSortCalls: 0, disposedObserveCalls: 0,
    totalEncodedCodeUnits: 0, retainedNumericElements: 0, observationFailures: 0,
    callbackLimitReached: false, nowLimitReached: false, recordLimitReached: false,
    encodingLimitReached: false, elementLimitReached: false, numericLimitReached: false,
    comparisonLimitReached: false, countLimitReached: false, lastFailure: 'none',
    disposed: false, rawSamplesCleared: false, restoredDescriptors: 0, restoreConflicts: 0, restoreFailures: 0 };
  const increment = key => { if (stats[key] >= 1000000) stats.countLimitReached = true; else stats[key]++; };
  const append = (array, value) => define(array, array.length, { value, writable: true, enumerable: true, configurable: true });
  const clearArray = array => { for (let i = 0; i < array.length; i++) array[i] = undefined; array.length = 0; };
  const failed = reason => { increment('observationFailures'); stats.lastFailure = reason; };
  const observeSafely = fn => { try { fn(); } catch { failed('observation-failed'); } };
  const keyOf = value => same(value, -0) ? negativeZeroKey : value;
  const clearScratch = () => { if (scratch) apply(setFloat64, scratch, [0, 0, false]); };
  const descriptorEqual = (left, right) => !!left && !!right &&
    ['value', 'get', 'set', 'writable', 'enumerable', 'configurable'].every(key =>
      Object.hasOwn(left, key) === Object.hasOwn(right, key) && same(left[key], right[key]));
  const dataOwner = (object, name) => {
    for (let depth = 0; object && depth < 16; depth++, object = prototype(object)) {
      const descriptor = get(object, name);
      if (descriptor) {
        if (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function'
            || (!descriptor.configurable && !descriptor.writable)) throw Error('UNSUPPORTED_DATA_METHOD');
        return { object, name, previous: descriptor };
      }
    }
    throw Error('UNSUPPORTED_DATA_METHOD');
  };
  const restore = () => {
    for (let i = installations.length - 1; i >= 0; i--) {
      const item = installations[i];
      if (item.restored || item.conflicted) continue;
      try {
        const current = get(item.object, item.name);
        if (descriptorEqual(current, item.previous)) { item.restored = true; continue; }
        if (!descriptorEqual(current, item.installed)) { item.conflicted = true; increment('restoreConflicts'); continue; }
        define(item.object, item.name, item.previous); item.restored = true; increment('restoredDescriptors');
      } catch { increment('restoreFailures'); }
    }
  };
  const proxyCallback = callback => {
    const cached = apply(weakGet, callbackCache, [callback]);
    if (cached) return cached;
    if (stats.callbackWrappersCreated >= stats.maximumCallbackWrappers) { stats.callbackLimitReached = true; return callback; }
    const wrapped = new ProxyType(callback, { apply(target, receiver, args) {
      if (stats.disposed || !stats.installationComplete) return apply(target, receiver, args);
      const previous = activeCallback;
      const context = { record: undefined, previous };
      increment('callbackCalls'); increment('callbacksInflight');
      observeSafely(() => {
        if (callbacks.length >= stats.maximumCallbacks) { stats.callbackLimitReached = true; return; }
        const record = { stamp: undefined, first: undefined, last: undefined, finished: false };
        if (typeof args[0] === 'number') record.stamp = args[0]; else failed('invalid-callback-timestamp');
        append(callbacks, record); context.record = record; increment('callbacksRecorded');
      });
      activeCallback = context;
      try {
        const result = apply(target, receiver, args);
        if (!stats.disposed) increment('callbackReturned');
        return result;
      } catch (error) {
        if (!stats.disposed) increment('callbackThrew');
        throw error;
      } finally {
        if (!stats.disposed) {
          activeCallback = previous; stats.callbacksInflight--;
          if (context.record) context.record.finished = true;
        }
        context.record = undefined; context.previous = undefined;
      }
    } });
    apply(weakSet, callbackCache, [callback, wrapped]);
    increment('callbackWrappersCreated');
    return wrapped;
  };
  try {
    if ((typeof realm !== 'object' && typeof realm !== 'function') || realm === null) throw Error('INVALID_REALM');
    const raf = dataOwner(realm, 'requestAnimationFrame');
    const performanceObject = Reflect.get(realm, 'performance');
    const now = dataOwner(performanceObject, 'now');
    raf.installed = { ...raf.previous, value: new ProxyType(raf.previous.value, { apply(target, receiver, args) {
      if (stats.disposed || !stats.installationComplete) return apply(target, receiver, args);
      increment('requestCalls');
      let forwarded = args;
      if (typeof args[0] === 'function') observeSafely(() => {
        const copied = []; for (let i = 0; i < args.length; i++) append(copied, args[i]);
        copied[0] = proxyCallback(args[0]); forwarded = copied;
      }); else increment('nonCallableRequests');
      try { const result = apply(target, receiver, forwarded); increment('requestReturned'); return result; }
      catch (error) { increment('requestThrew'); throw error; }
    } }) };
    now.installed = { ...now.previous, value: new ProxyType(now.previous.value, { apply(target, receiver, args) {
      if (stats.disposed || !stats.installationComplete) return apply(target, receiver, args);
      increment('performanceNowCalls');
      const context = activeCallback;
      if (context) increment('inCallbackNowCalls');
      let result;
      try { result = apply(target, receiver, args); }
      catch (error) { increment('performanceNowThrew'); if (context) increment('inCallbackNowThrew'); throw error; }
      if (!stats.disposed) {
        increment('performanceNowReturned');
        observeSafely(() => {
          if(allNowValues.length>=stats.maximumAllNowCompletions){stats.allNowLimitReached=true;return;}
          if(typeof result!=='number'){append(allNowValues,undefined);failed('invalid-now-result');return;}
          append(allNowValues,result);increment('allNowCompletionsRecorded');
        });
        if (context) {
          increment('inCallbackNowReturned');
          observeSafely(() => {
            if (!context.record || nowValues.length >= stats.maximumNowCompletions) { stats.nowLimitReached = true; return; }
            if (typeof result !== 'number') { append(nowValues, undefined); return; } // Counted by the all-completions observer.
            append(nowValues, result); increment('nowCompletionsRecorded');
            if (context.record.first === undefined) context.record.first = result;
            context.record.last = result;
          });
        }
      }
      return result;
    } }) };
    for (const item of [raf, now]) { append(installations, item); define(item.object, item.name, item.installed); increment('installedDescriptors'); }
    stats.installationComplete = true;
  } catch { increment('setupFailures'); stats.lastFailure = 'installation-failed'; restore(); }
  realm = undefined;
  const observe = (encodedString, completionOrdinal) => {
    increment('observedSortCalls');
    let values = [], retained = false, reason = 'invalid-encoding';
    const reject = failure => { reason = failure; throw Error('INVALID_INTERVAL_ENCODING'); };
    try {
      if (stats.disposed) { increment('disposedObserveCalls'); reject('disposed'); }
      if (stats.observedSortCalls > stats.maximumSortRecords) { stats.recordLimitReached = true; reject('record-limit'); }
      if (typeof encodedString !== 'string' || !integer(completionOrdinal) || completionOrdinal < 0
          || completionOrdinal !== stats.observedSortCalls - 1) reject('invalid-input');
      if (encodedString.length > stats.maximumEncodedCodeUnits
          || stats.totalEncodedCodeUnits + encodedString.length > stats.maximumTotalEncodedCodeUnits) {
        stats.encodingLimitReached = true; reject('encoding-limit');
      }
      stats.totalEncodedCodeUnits += encodedString.length;
      let offset = 0;
      const code = () => { if (offset >= encodedString.length) reject('malformed-framing'); return apply(charCodeAt, encodedString, [offset++]); };
      const byte = () => { const value = code(); if (value > 255) reject('malformed-framing'); return value; };
      const uint32 = () => { let value = 0; for (let i = 0; i < 4; i++) value = value * 256 + byte(); return value; };
      for (let i = 0; i < domain.length; i++) if (code() !== apply(charCodeAt, domain, [i])) reject('malformed-framing');
      const originalCallIndex = uint32(), arrayLength = uint32();
      if (arrayLength > stats.maximumArrayElements) { stats.elementLimitReached = true; reject('element-limit'); }
      const row = { completionOrdinal, originalCallIndex, arrayLength, stringCount: 0, numberCount: 0,
        numericEligible: false, observedDuringCallback: !!activeCallback, callbacksAtSort: stats.callbackCalls, nowCompletionsAtSort: stats.nowCompletionsRecorded };
      for (let i = 0; i < arrayLength; i++) {
        const tag = code();
        if (tag === 115) { const length = uint32(); if (length > encodedString.length - offset) reject('malformed-framing'); offset += length; row.stringCount++; continue; }
        if (tag !== 110) reject('malformed-framing');
        let value, first, second, tail = 0;
        try {
          for (let n = 0; n < 8; n++) { const part = byte(); if (n === 0) first = part; else if (n === 1) second = part; else tail |= part; apply(setUint8, scratch, [n, part]); }
          value = apply(getFloat64, scratch, [0, false]);
          if (value !== value && (first !== 127 || second !== 248 || tail !== 0)) reject('noncanonical-nan');
          append(values, value); row.numberCount++;
        } finally { value = undefined; clearScratch(); }
      }
      if (offset !== encodedString.length) reject('malformed-framing');
      row.numericEligible = arrayLength > 0 && row.numberCount === arrayLength;
      if (row.numericEligible) {
        if (stats.retainedNumericElements + values.length > stats.maximumRetainedNumericElements) { stats.numericLimitReached = true; reject('numeric-limit'); }
        stats.retainedNumericElements += values.length; increment('numericSortRecords');
      } else { clearArray(values); increment('ignoredSortRecords'); }
      append(sortRecords, { row, values }); retained = true; increment('recordedSortCalls');
    } catch { increment('failedSortCalls'); increment('omittedSortCalls'); stats.lastFailure = reason; }
    finally {
      encodedString = undefined; if (!retained) clearArray(values); values = undefined;
      try { clearScratch(); } catch { failed('scratch-clear-failed'); }
    }
  };
  const compare = () => {
    const samples = {}, availableSamples = {}, output = [];
    let steps = 0, totalCandidates = 0, matchedRecords = 0;
    const spend = () => { if (++steps > stats.maximumComparisonStepsPerSnapshot) { stats.comparisonLimitReached = true; throw Error('COMPARISON_LIMIT'); } };
    try {
      for (const source of sources) { samples[source] = []; availableSamples[source] = 0; }
      for (let i = 1; i < callbacks.length; i++) {
        const before = callbacks[i - 1], after = callbacks[i];
        for (let j = 0; j < 3; j++) {
          const member = j === 0 ? 'stamp' : j === 1 ? 'first' : 'last';
          const usable = (j === 0 || before.finished && after.finished) && before[member] !== undefined && after[member] !== undefined;
          append(samples[sources[j]], usable ? after[member] - before[member] : undefined);
          if (usable) availableSamples[sources[j]]++;
        }
      }
      for (let i = 1; i < nowValues.length; i++) {
        const usable = nowValues[i - 1] !== undefined && nowValues[i] !== undefined;
        append(samples[sources[3]], usable ? nowValues[i] - nowValues[i - 1] : undefined);
        if (usable) availableSamples[sources[3]]++;
      }
      for (let i = 1; i < allNowValues.length; i++) {
        const usable = allNowValues[i - 1] !== undefined && allNowValues[i] !== undefined;
        append(samples[sources[4]], usable ? allNowValues[i] - allNowValues[i - 1] : undefined);
        if (usable) availableSamples[sources[4]]++;
      }
      for (const record of sortRecords) {
        const result = { ...record.row, matched: false, sources: {} }, targetCounts = new MapType();
        try {
          if (record.row.numericEligible) for (const value of record.values) { spend(); const key = keyOf(value); apply(mapSet, targetCounts, [key, (apply(mapGet, targetCounts, [key]) || 0) + 1]); }
          for (const source of sources) {
            const counts = new MapType(), ring = [], length = record.values.length;
            const found = { candidateWindows: 0, matchedWindows: 0, matched: false };
            let filled = 0, cursor = 0, equalElements = 0;
            try {
              if (record.row.numericEligible) for (const value of samples[source]) {
                spend();
                if (value === undefined) { apply(mapClear, counts, []); clearArray(ring); filled = 0; cursor = 0; equalElements = 0; continue; }
                if (filled === length) {
                  const oldKey = ring[cursor], count = apply(mapGet, counts, [oldKey]);
                  if (count <= (apply(mapGet, targetCounts, [oldKey]) || 0)) equalElements--;
                  if (count === 1) apply(mapDelete, counts, [oldKey]); else apply(mapSet, counts, [oldKey, count - 1]);
                } else filled++;
                const key = keyOf(value), count = apply(mapGet, counts, [key]) || 0;
                if (count < (apply(mapGet, targetCounts, [key]) || 0)) equalElements++;
                apply(mapSet, counts, [key, count + 1]);
                define(ring, cursor, { value: key, writable: true, enumerable: true, configurable: true }); cursor = (cursor + 1) % length;
                if (filled === length) { found.candidateWindows++; totalCandidates++; if (equalElements === length) { found.matchedWindows++; found.matched = true; result.matched = true; } }
              }
            } finally { apply(mapClear, counts, []); clearArray(ring); }
            result.sources[source] = found;
          }
        } finally { apply(mapClear, targetCounts, []); }
        if (result.matched) matchedRecords++; append(output, result);
      }
      lastComparison = { records: output, matchedRecords, candidateWindows: totalCandidates, comparisonSteps: steps, availableSamples };
    } finally { for (const source of sources) if (samples[source]) clearArray(samples[source]); }
  };
  const snapshot = () => {
    if (!stats.disposed) observeSafely(compare);
    const records = [];
    for (const row of lastComparison.records) {
      const copied = { ...row, sources: {} }; for (const source of sources) copied.sources[source] = { ...row.sources[source] }; append(records, copied);
    }
    const complete = stats.installationComplete && !stats.setupFailures && !stats.observationFailures && !stats.failedSortCalls
      && !stats.omittedSortCalls && !stats.callbacksInflight && !stats.callbackLimitReached && !stats.nowLimitReached && !stats.allNowLimitReached
      && !stats.recordLimitReached && !stats.encodingLimitReached && !stats.elementLimitReached && !stats.numericLimitReached
      && !stats.comparisonLimitReached && !stats.countLimitReached && !stats.restoreFailures && !stats.restoreConflicts;
    return { ...stats, privateRawSamplesRetained: !stats.rawSamplesCleared, complete,
      cleanupComplete: stats.disposed && stats.rawSamplesCleared && !stats.restoreFailures && !stats.restoreConflicts,
      availableSamples: { ...lastComparison.availableSamples }, matchedRecords: lastComparison.matchedRecords,
      candidateWindows: lastComparison.candidateWindows, comparisonSteps: lastComparison.comparisonSteps, records };
  };
  const dispose = () => {
    if (!stats.disposed) {
      observeSafely(compare); stats.disposed = true; restore();
      for (const record of callbacks) { record.stamp = undefined; record.first = undefined; record.last = undefined; }
      for (const record of sortRecords) clearArray(record.values);
      clearArray(callbacks); clearArray(nowValues); clearArray(allNowValues); clearArray(sortRecords); clearArray(installations); activeCallback = undefined; callbackCache = undefined;
      try { clearScratch(); } catch { failed('scratch-clear-failed'); }
      scratch = undefined; stats.rawSamplesCleared = true; stats.retainedNumericElements = 0;
    }
    return snapshot();
  };
  return freeze({ observe, snapshot, dispose });
}
