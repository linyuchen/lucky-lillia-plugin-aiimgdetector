// Private, active diagnostic. Serialize this entire function into the target realm.
// SHA-256 follows FIPS 180-4 section 6.2; HMAC follows RFC 2104 section 2.
// Only already-returned primitive strings enter observe. Nothing invokes toString.
export function createCompletedToStringComparison(options) {
  const get = Object.getOwnPropertyDescriptor, own = Object.hasOwn;
  const isInteger = Number.isInteger, isArray = Array.isArray;
  const apply = Reflect.apply, charCodeAt = String.prototype.charCodeAt;
  const Bytes = Uint8Array, Words = Uint32Array, minimum = Math.min;
  const data = descriptor => !!descriptor && own(descriptor, 'value');
  const field = options && (typeof options === 'object' || typeof options === 'function') ? get(options, 'keyBytes') : undefined;
  const input = data(field) ? field.value : undefined;
  if (!isArray(input) || get(input, 'length')?.value !== 32) throw Error('INVALID_COMPARISON_KEY');
  const key = new Bytes(32), ipad = new Bytes(64), opad = new Bytes(64);
  const clear = array => { if (array) for (let index = 0; index < array.length; index++) array[index] = 0; };
  try {
    for (let index = 0; index < 32; index++) {
      const descriptor = get(input, index), value = data(descriptor) ? descriptor.value : undefined;
      if (!isInteger(value) || value < 0 || value > 255) throw Error('INVALID_COMPARISON_KEY');
      key[index] = value;
    }
    for (let index = 0; index < 64; index++) {
      const value = index < 32 ? key[index] : 0;
      ipad[index] = value ^ 0x36; opad[index] = value ^ 0x5c;
    }
  } catch (error) { clear(key); clear(ipad); clear(opad); throw error; }
  const constants = new Words([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ]);
  const rotate = (value, bits) => (value >>> bits) | (value << (32 - bits));
  const sha256 = bytes => {
    let padded, schedule, state, digest;
    let success = false;
    try {
      // Inputs are bounded below 2^29 bytes, so the high bit-length word is zero.
      padded = new Bytes((bytes.length + 9 + 63) & ~63);
      for (let index = 0; index < bytes.length; index++) padded[index] = bytes[index];
      padded[bytes.length] = 0x80;
      const bits = bytes.length * 8;
      for (let index = 0; index < 4; index++) padded[padded.length - 1 - index] = bits >>> (index * 8);
      schedule = new Words(64);
      state = new Words([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
      for (let offset = 0; offset < padded.length; offset += 64) {
        for (let index = 0; index < 16; index++) {
          const start = offset + index * 4;
          schedule[index] = (padded[start] << 24) | (padded[start + 1] << 16) | (padded[start + 2] << 8) | padded[start + 3];
        }
        for (let index = 16; index < 64; index++) {
          const x = schedule[index - 15], y = schedule[index - 2];
          const s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
          const s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
          schedule[index] = schedule[index - 16] + s0 + schedule[index - 7] + s1;
        }
        let a = state[0], b = state[1], c = state[2], d = state[3], e = state[4], f = state[5], g = state[6], h = state[7];
        for (let index = 0; index < 64; index++) {
          const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
          const choice = (e & f) ^ (~e & g);
          const first = (h + s1 + choice + constants[index] + schedule[index]) | 0;
          const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
          const majority = (a & b) ^ (a & c) ^ (b & c);
          const second = (s0 + majority) | 0;
          h = g; g = f; f = e; e = (d + first) | 0; d = c; c = b; b = a; a = (first + second) | 0;
        }
        state[0] += a; state[1] += b; state[2] += c; state[3] += d;
        state[4] += e; state[5] += f; state[6] += g; state[7] += h;
      }
      digest = new Bytes(32);
      for (let index = 0; index < 32; index++) digest[index] = state[index >>> 2] >>> (24 - (index & 3) * 8);
      success = true; return digest;
    } finally { clear(padded); clear(schedule); clear(state); if (!success) clear(digest); }
  };
  // This public ASCII separator plus a LE length disambiguates the exact code units.
  const domain = 'synthid.completed-function-tostring/hmac-sha256-utf16le-v1\0';
  const hex = '0123456789abcdef';
  const mac = value => {
    let inner, innerDigest, outer, digest;
    try {
      inner = new Bytes(64 + domain.length + 4 + value.length * 2);
      for (let index = 0; index < 64; index++) inner[index] = ipad[index];
      let offset = 64;
      for (let index = 0; index < domain.length; index++) inner[offset++] = apply(charCodeAt, domain, [index]);
      for (let index = 0; index < 4; index++) inner[offset++] = value.length >>> (index * 8);
      for (let index = 0; index < value.length; index++) {
        const unit = apply(charCodeAt, value, [index]);
        inner[offset++] = unit & 255; inner[offset++] = unit >>> 8;
      }
      innerDigest = sha256(inner);
      outer = new Bytes(96);
      for (let index = 0; index < 64; index++) outer[index] = opad[index];
      for (let index = 0; index < 32; index++) outer[index + 64] = innerDigest[index];
      digest = sha256(outer);
      let result = '';
      for (let index = 0; index < 32; index++) result += hex[digest[index] >>> 4] + hex[digest[index] & 15];
      return result;
    } finally { clear(inner); clear(innerDigest); clear(outer); clear(digest); }
  };
  const stats = { schemaVersion: 1, diagnosticOnly: true,
    maxRecords: 128, maxStringCodeUnits: 65536, maxTotalCodeUnits: 1048576,
    observedCalls: 0, comparedRecords: 0, omittedCalls: 0, invalidInputs: 0, hashingFailures: 0, totalCodeUnits: 0,
    recordLimitReached: false, stringLimitReached: false, totalLimitReached: false, drained: false, disposed: false };
  const increment = key => { stats[key] = minimum(1000000, stats[key] + 1); };
  let records = [], previousIndex = -1;
  const snapshotCounts = () => ({ ...stats, complete: !stats.disposed && stats.omittedCalls === 0 && stats.invalidInputs === 0 && stats.hashingFailures === 0 });
  const observe = (value, callIndex) => {
    if (stats.drained || stats.disposed) return;
    increment('observedCalls');
    if (records.length >= stats.maxRecords) { stats.recordLimitReached = true; increment('omittedCalls'); return; }
    if (typeof value !== 'string' || !isInteger(callIndex) || callIndex < 0 || callIndex >= 128 || callIndex <= previousIndex) {
      increment('invalidInputs'); increment('omittedCalls'); return;
    }
    previousIndex = callIndex;
    if (value.length > stats.maxStringCodeUnits) { stats.stringLimitReached = true; increment('omittedCalls'); return; }
    if (value.length > stats.maxTotalCodeUnits - stats.totalCodeUnits) { stats.totalLimitReached = true; increment('omittedCalls'); return; }
    try {
      const digest = mac(value);
      records[records.length] = { callIndex, mac: digest };
      increment('comparedRecords'); stats.totalCodeUnits += value.length;
    } catch { increment('hashingFailures'); increment('omittedCalls'); }
  };
  const destroyKey = () => { clear(key); clear(ipad); clear(opad); };
  const takeComparison = () => {
    if (stats.drained) return { records: [], counts: snapshotCounts(), complete: false, alreadyDrained: true };
    stats.drained = true; destroyKey();
    const packet = { records, counts: snapshotCounts(), complete: snapshotCounts().complete, alreadyDrained: false };
    records = []; return packet;
  };
  const dispose = () => { stats.disposed = true; destroyKey(); records = []; };
  return { observe, snapshotCounts, takeComparison, dispose };
}
