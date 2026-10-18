// Same-response diagnostics only. No retries, body persistence or alternate transport.
const challengeMarkers = ['cf-chl', 'cf-turnstile', 'cdn-cgi/challenge-platform', 'challenges.cloudflare.com'];
const denialMarkers = ['request forbidden by administrative rules', 'your ip has been blocked', 'access from your ip address has been denied'];
const mimeTypes = new Set(['text/html', 'text/plain', 'application/json', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/octet-stream']);
function routeKind(input) {
  try {
    const url = new URL(String(input));
    if (url.origin === 'https://gourmetsupremacy.com') {
      if (url.pathname.startsWith('/wp-content/uploads/')) return 'image';
      if (/^\/project\/[^/]+\/[^/]+\/$/.test(url.pathname)) return 'reader';
      if (/^\/project\/[^/]+\/$/.test(url.pathname)) return 'detail';
      if (url.pathname === '/' || /^\/page\/\d+\/$/.test(url.pathname)) return 'catalog/search';
    }
    if (url.origin === 'https://genztoons.org') {
      if (/^\/series\/?$/.test(url.pathname)) return 'catalog/search';
      if (url.pathname.startsWith('/series/')) return 'detail';
      if (url.pathname.startsWith('/chapter/')) return 'reader';
    }
    return 'other';
  } catch { return 'invalid'; }
}
async function failureMarkers(response) {
  const flags = { bodyCloudflareMarker: false, explicitDenialMarker: false, inspectedBytes: 0, bodyInspection: 'not-needed', bodyComplete: false };
  if (![403, 503].includes(response.status) || !/^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? '')) return flags;
  let reader;
  try {
    reader = response.clone().body?.getReader();
    if (!reader) return { ...flags, bodyInspection: 'no-body' };
    const parts = []; let reads = 0;
    while (flags.inspectedBytes < 8192 && reads++ < 64) {
      const { value, done } = await reader.read(); if (done) { flags.bodyComplete = true; break; }
      const part = value.subarray(0, 8192 - flags.inspectedBytes);
      parts.push(Buffer.from(part)); flags.inspectedBytes += part.byteLength;
    }
    const text = Buffer.concat(parts).toString('utf8').toLowerCase();
    flags.bodyCloudflareMarker = challengeMarkers.some(marker => text.includes(marker));
    flags.explicitDenialMarker = denialMarkers.some(marker => text.includes(marker));
    flags.bodyInspection = 'bounded-prefix';
  } catch { flags.bodyInspection = 'unavailable'; }
  finally {
    // A tee-branch cancellation can await the SDK's branch: never await it here.
    if (reader) { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  return flags;
}
export function diagnosticFetch(fetchImpl, diagnostics) {
  return async (input, init = {}) => {
    const record = { attempt: diagnostics.length + 1, route: routeKind(input), method: ['GET', 'POST'].includes(String(init.method ?? 'GET').toUpperCase()) ? String(init.method ?? 'GET').toUpperCase() : 'other' };
    diagnostics.push(record);
    try {
      const response = await fetchImpl(input, init);
      const rawMime = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
      Object.assign(record, { status: response.status, mime: mimeTypes.has(rawMime) ? rawMime : rawMime ? 'other' : 'missing', cloudflareHeader: response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge', cloudflareServer: (response.headers.get('server') ?? '').toLowerCase().includes('cloudflare'), redirected: Boolean(response.redirected) }, await failureMarkers(response));
      console.log(`HTTP-DIAGNOSTIC ${JSON.stringify(record)}`);
      return response;
    } catch (error) {
      Object.assign(record, { status: null, outcome: 'transport-error' });
      console.log(`HTTP-DIAGNOSTIC ${JSON.stringify(record)}`); throw error;
    }
  };
}
