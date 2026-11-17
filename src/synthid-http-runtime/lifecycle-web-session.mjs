import { CookieJar } from 'tough-cookie';
import { readWebConfig } from './web-session.mjs';

const ORIGIN = 'https://synthid.com';

// Projection for this producer's explicitly unavailable connection details.
// Matches Fetch/Undici's absent-connection-info fallback at defaultStartTime;
// this is not a DNS/TCP measurement and says nothing about connection reuse.
export function collapseUnavailableConnectionTiming(entry) {
  if (!Number.isFinite(entry?.fetchStart) || entry.fetchStart < 0) throw Error('Invalid connection timing origin');
  const projected = { ...entry }, fields = [];
  for (const name of ['domainLookupStart', 'domainLookupEnd', 'connectStart', 'connectEnd']) {
    if (projected[name] === undefined) { projected[name] = entry.fetchStart; fields.push(name); }
    else if (!Number.isFinite(projected[name]) || projected[name] < 0) throw Error('Invalid supplied connection timing');
  }
  return { entry: projected, summary: { policy: 'unmeasured-collapsed-at-fetch-start', measured: false, projectedFields: fields } };
}

/** Mirrors h4's per-page base plus Sba counter in retained official source. */
export function createRequestIds(clock = () => new Date()) {
  let base = 0;
  let sequence = 0;
  return () => {
    if (!base) {
      const now = clock();
      base = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    }
    return String(1 + base + sequence++ * 100000);
  };
}

/** Public page globals stay in memory; no page script is evaluated here. */
export function readPageGlobals(html) {
  const assignment = /(?:window\.)?WIZ_global_data\s*=\s*\{/.exec(html);
  if (!assignment) throw new Error('Missing web config');
  const start = assignment.index + assignment[0].length - 1;
  let quoted = false, escaped = false, depth = 0;
  for (let index = start; index < html.length; index++) {
    const character = html[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === '{') depth++;
    else if (character === '}' && --depth === 0) {
      const data = JSON.parse(html.slice(start, index + 1));
      if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Invalid page config');
      return { WIZ_global_data: data };
    }
  }
  throw new Error('Incomplete web config');
}

export async function createLifecycleWebSession(http, userAgent, options = {}) {
  if (options.collapseConnectionTiming !== undefined && typeof options.collapseConnectionTiming !== 'boolean') throw Error('Invalid connection timing option');
  const cookies = new CookieJar();
  const request = async (url, init = {}) => {
    if (new URL(url).origin !== ORIGIN) throw new Error('Unexpected web session origin');
    const headers = new Headers(init.headers);
    headers.set('user-agent', userAgent);
    const cookie = await cookies.getCookieString(url);
    if (cookie) headers.set('cookie', cookie);
    else headers.delete('cookie');
    const response = await http.fetch(url, { ...init, headers, redirect: 'error' });
    for (const value of response.headers.getSetCookie()) await cookies.setCookie(value, url);
    return response;
  };
  const performanceTimeOriginEpochMs = Date.now();
  const navigationStarted = performance.now();
  const response = await request(ORIGIN + '/image-detection', { signal: AbortSignal.timeout(30000),
    ...(options.networkMeasurements === true ? { headers: { 'accept-encoding': 'identity' } } : {}),
  });
  const responseStart = performance.now() - navigationStarted;
  if (!response.ok) { await response.body?.cancel(); throw new Error('Page fetch failed'); }
  const pageBytes = Buffer.from(await response.arrayBuffer());
  const pageHTML = pageBytes.toString('utf8');
  const responseEnd = performance.now() - navigationStarted;
  if (pageHTML.length > 4 * 1024 * 1024) throw new Error('Oversize page');
  const config = readWebConfig(pageHTML);
  const pageGlobals = readPageGlobals(pageHTML);
  // These timings describe this Node HTTP document load, not a captured
  // browser navigation. URLs and timing entries remain private worker input.
  const performanceEntries = [{ name: ORIGIN + '/image-detection', entryType: 'navigation',
    startTime: 0, duration: responseEnd, fetchStart: 0, requestStart: 0,
    responseStart, responseEnd, decodedBodySize: pageBytes.length,
  }];
  let connectionTiming;
  if (options.collapseConnectionTiming === true) {
    const projection = collapseUnavailableConnectionTiming(performanceEntries[0]);
    performanceEntries[0] = projection.entry;
    connectionTiming = projection.summary;
  }
  const contentLength = response.headers.get('content-length');
  if (typeof contentLength === 'string' && /^\d{1,10}$/.test(contentLength) && Number(contentLength) > 0) {
    performanceEntries[0].encodedBodySize = Number(contentLength);
  } else if (!response.headers.has('content-encoding') || response.headers.get('content-encoding') === 'identity') {
    performanceEntries[0].encodedBodySize = pageBytes.length;
  }
  return {
    config, request, nextRequestId: createRequestIds(),
    environment: async () => ({ pageHTML, pageGlobals, cookieJar: await cookies.serialize(), performanceTimeOriginEpochMs, performanceEntries }),
    summary: {
      httpStatus: response.status,
      htmlBytes: Buffer.byteLength(pageHTML),
      cookieNames: (await cookies.getCookies(ORIGIN)).map(cookie => cookie.key),
      cookieSource: 'HTTP-only',
      fieldTypes: Object.fromEntries(Object.entries(config).map(([key, value]) => [key, typeof value])),
      sharedPageAndCookieState: true,
      identityEncodingRequested: options.networkMeasurements === true,
      connectionTiming,
    },
  };
}
