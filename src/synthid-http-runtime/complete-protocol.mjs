// Public jspb representation only. No interpreter execution or network access.
// Source: readiness-public-0.js:130-135 ($c/Mc), 604-607 (EH/Zf), 104 (ia/ja).
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isPlainObject = value => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

export function readJspbField(message, field, marked = false) {
  if (!Array.isArray(message) || !Number.isSafeInteger(field) || field < 1) {
    throw new TypeError('Invalid jspb message or field');
  }
  const index = field + (marked ? 0 : -1);
  const lastIndex = message.length - 1;
  if (lastIndex < (marked ? 1 : 0)) return undefined;
  if (isPlainObject(message[lastIndex])) {
    // Mc moves numbered fields below the sparse pivot into dense slots first.
    // Reading the sparse value first reproduces that normalization without mutation.
    if (own(message[lastIndex], field)) return message[lastIndex][field];
    if (index >= lastIndex) return undefined;
  }
  return message[index];
}

function int32(value) {
  if (typeof value === 'string' && value) value = Number(value);
  else if (typeof value !== 'number') return 0;
  return Number.isFinite(value) ? value | 0 : 0;
}

export function parseOfficialExperimentState(serialized) {
  const state = typeof serialized === 'string' && serialized ? JSON.parse(serialized) : [];
  if (!Array.isArray(state)) throw new TypeError('Invalid experiment message');
  const field5 = readJspbField(state, 5);
  const entries = readJspbField(state, 6) ?? [];
  if (!Array.isArray(entries) || entries.some(entry => !Array.isArray(entry))) {
    throw new TypeError('Invalid experiment entries');
  }
  const ordinary = [], extended = [];
  for (const entry of entries) {
    const value = int32(readJspbField(entry, 1));
    (int32(readJspbField(entry, 2)) <= 53 ? ordinary : extended).push(value);
  }
  return { field5: typeof field5 === 'string' ? field5 : '',
    values: [...ordinary, ...extended],
    kinds: [...ordinary.map(() => 1), ...extended.map(() => 2)],
    inputShape: { trailingObject: isPlainObject(state.at(-1)),
      entryTrailingObjects: entries.filter(entry => isPlainObject(entry.at(-1))).length } };
}

// Adapts only the fields used by the existing realm-init to canonical dense form.
// Values are grouped equivalently to official ia/ja, without exposing them to logs.
export function normalizeOfficialExperimentState(serialized) {
  const parsed = parseOfficialExperimentState(serialized);
  return JSON.stringify([null, null, null, null, parsed.field5,
    parsed.values.map((value, index) => [value, parsed.kinds[index] === 1 ? 0 : 54])]);
}

export function parseOfficialChallenge(rawData) {
  if (!Array.isArray(rawData)) throw new TypeError('Invalid challenge response');
  const encoded = readJspbField(rawData, 2);
  let data;
  if (typeof encoded === 'string' && encoded) {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/').replace(/\./g, '=');
    const bytes = Uint8Array.from(atob(base64), character => (character.charCodeAt(0) + 97) & 255);
    if (bytes.length) data = JSON.parse(new TextDecoder().decode(bytes));
  }
  data ??= readJspbField(rawData, 1);
  if (!Array.isArray(data) || data[0] !== 'bfkj') throw new TypeError('Invalid challenge message');
  const get = field => readJspbField(data, field, true);
  const script = get(1), resource = get(2);
  // SafeScriptProto uses field 6; TrustedResourceUrlProto uses field 4.
  // Source: readiness-public-0.js:171-172, Uf (Qf(a,6)) and Sf (Qf(a,4)).
  const scriptValue = Array.isArray(script) ? readJspbField(script, 6) : undefined;
  const resourceValue = Array.isArray(resource) ? readJspbField(resource, 4) : undefined;
  const program = get(4), globalName = get(5);
  if (typeof program !== 'string' || !program || typeof globalName !== 'string' || !globalName) {
    throw new TypeError('Incomplete challenge message');
  }
  const experiments = get(7);
  if (experiments != null && typeof experiments !== 'string') throw new TypeError('Invalid experiment blob');
  const output = { messageId: data[0], program, globalName, interpreterHash: get(3),
    clientExperimentsStateBlob: experiments,
    shape: { responseTrailingObject: isPlainObject(rawData.at(-1)), challengeTrailingObject: isPlainObject(data.at(-1)),
      scriptTrailingObject: Array.isArray(script) && isPlainObject(script.at(-1)),
      urlTrailingObject: Array.isArray(resource) && isPlainObject(resource.at(-1)) } };
  if (typeof scriptValue === 'string' && scriptValue) output.interpreterJavascript = { privateDoNotAccessOrElseSafeScriptWrappedValue: scriptValue };
  if (typeof resourceValue === 'string' && resourceValue) output.interpreterUrl = { privateDoNotAccessOrElseTrustedResourceUrlWrappedValue: resourceValue };
  return output;
}
