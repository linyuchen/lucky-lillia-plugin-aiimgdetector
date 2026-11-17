// Research-only reference for parameter-parity.mjs. No captured state or I/O.
const ORIGIN = 'https://synthid.com';
const STAGES = ['start', 'upload, finalize', 'detect', 'challenge'];
const CLIENT_HINT_HEADERS = new Set([
  'sec-ch-ua', 'sec-ch-ua-arch', 'sec-ch-ua-bitness', 'sec-ch-ua-form-factors',
  'sec-ch-ua-full-version', 'sec-ch-ua-full-version-list', 'sec-ch-ua-mobile',
  'sec-ch-ua-model', 'sec-ch-ua-platform', 'sec-ch-ua-platform-version', 'sec-ch-ua-wow64',
]);

function invalidInput() {
  return new TypeError('Invalid independent request reference input');
}

function publicHeaderValue(value, limit) {
  if (typeof value !== 'string' || !value.length || value.length > limit
    || value.trim() !== value || /[^\x20-\x7e]/.test(value)) throw invalidInput();
  return value;
}

/**
 * Accept an explicitly chosen userAgent and optional public clientHints.
 * clientHints maps sec-ch-ua* header names to their serialized HTTP values;
 * preserve quoting, brand order, and ?0/?1 booleans supplied by the caller.
 * No browser/version defaults or hints inferred from the user agent.
 *
 * Body/content-type, upload metadata, auth, cookies, query fields and XSRF
 * remain owned by the current request/session builders. This reference is
 * a header policy, not a record of an observed request or transport protocol.
 */
export function createIndependentRequestReference({ userAgent, clientHints = {} } = {}) {
  const identity = publicHeaderValue(userAgent, 1024);
  if (!clientHints || typeof clientHints !== 'object' || Array.isArray(clientHints)) throw invalidInput();
  const hints = {};
  for (const [rawName, value] of Object.entries(clientHints)) {
    const name = rawName.toLowerCase();
    if (!CLIENT_HINT_HEADERS.has(name) || Object.hasOwn(hints, name)) throw invalidInput();
    hints[name] = publicHeaderValue(value, 4096);
    if (['sec-ch-ua-mobile', 'sec-ch-ua-wow64'].includes(name) && !['?0', '?1'].includes(value)) throw invalidInput();
  }
  const common = {
    origin: ORIGIN, referer: ORIGIN + '/', 'user-agent': identity,
    'accept-language': 'en-US,en;q=0.9', ...hints,
  };
  const stages = Object.fromEntries(STAGES.map(stage => [stage, { headers: { ...common } }]));
  Object.assign(stages.detect.headers, {
    accept: '*/*', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty',
  });
  return { stages, userAgent: identity };
}
