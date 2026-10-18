// Isolated test-host assist. Production source, image transport and shared helpers are unchanged.
import { randomUUID } from 'node:crypto';
import { diagnosticFetch } from './additive-source-http.mjs';
export function assertGourmetTarget(value, init = {}) {
  if (typeof value !== 'string' || /[\s\\]/.test(value)) throw new Error('Unsupported Gourmet browser URL');
  const url = new URL(value);
  if (url.origin !== 'https://gourmetsupremacy.com' || url.href !== value || url.username || url.password || url.hash || (init.method ?? 'GET') !== 'GET' || init.body != null) throw new Error('Unsupported Gourmet browser request');
  const headers = new Headers(init.headers);
  for (const key of headers.keys()) if (!['accept', 'referer', 'user-agent'].includes(key)) throw new Error('Gourmet browser rejects credentials and unsupported headers');
  if (headers.has('referer') && headers.get('referer') !== 'https://gourmetsupremacy.com/') throw new Error('Unsupported Gourmet referer');
  if (/^\/project\/[a-z0-9-]+\/(?:[a-z0-9-]+\/)?$/.test(url.pathname) && !url.search) return;
  if (!/^\/(?:page\/(?:[1-9][0-9]?|100)\/)?$/.test(url.pathname)) throw new Error('Unsupported Gourmet browser route');
  const entries = [...url.searchParams], params = Object.fromEntries(entries);
  if (Object.keys(params).length !== entries.length || !['s', 'post_type', 'm_orderby'].every(key => key in params) || Object.keys(params).some(key => !['s', 'post_type', 'm_orderby', 'genre[]'].includes(key)) || params.s.length > 500 || params.post_type !== 'wp-manga' || !['latest', 'new-manga', 'alphabet', 'views'].includes(params.m_orderby) || ('genre[]' in params && (!params['genre[]'] || params['genre[]'].length > 200))) throw new Error('Unsupported Gourmet browser query');
}
export function createGourmetTestTransport({ fetchImpl = fetch, solverURL, diagnostics, limit = 12 } = {}) {
  const native = diagnosticFetch(fetchImpl, diagnostics);
  const traffic = { nativeAttempts: 0, warmupAttempts: 0, assistedAttempts: 0, subresourcesUncounted: false, responseDiagnostics: [], helperOutcomes: [], mode: 'native-first; anonymous Chromium only after verified managed challenge' };
  if (!solverURL) return { fetch: (...args) => { traffic.nativeAttempts++; return native(...args); }, close: async () => {}, traffic };
  const solver = new URL(solverURL);
  if (solver.protocol !== 'http:' || solver.hostname !== '127.0.0.1' || solver.username || solver.password || solver.pathname !== '/' || solver.search || solver.hash) throw new Error('Gourmet helper must be loopback HTTP');
  const session = randomUUID(); let created = false, creationAttempted = false, stopped, closed = false;
  const stop = message => { stopped = new Error(message); throw stopped; };
  async function command(path, payload, signal) {
    let result, response;
    try {
      response = await fetchImpl(`${solver.origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: signal ?? AbortSignal.timeout(70_000) });
      result = await response.json();
    } catch { traffic.helperOutcomes.push({ operation: payload.operation ?? payload.cmd, outcome: 'uncertain' }); return stop('Gourmet browser request failed or was cancelled; outcome uncertain, no retry'); }
    if (!response.ok || result.error || (path === '/v1' && result.status !== 'ok')) {
      const code = ['captcha', 'security', 'denial', 'identity'].includes(result.code) ? result.code : 'failed';
      traffic.helperOutcomes.push({ operation: payload.operation ?? payload.cmd, outcome: code,
        stage: ['validation', 'session', 'warm-safety', 'warm-navigation', 'warm-poll', 'fetch-safety', 'fetch', 'response-inspection'].includes(result.stage) ? result.stage : 'unknown',
        reason: ['operation-error', 'challenge-timeout', 'readiness-timeout', 'deadline-expired', 'safety-stop'].includes(result.reason) ? result.reason : 'unknown',
        category: ['validation', 'python-type', 'python-name', 'webdriver-timeout', 'webdriver-script', 'webdriver', 'other'].includes(result.category) ? result.category : 'unknown',
      });
      return stop(`Gourmet browser stopped: ${code}; no retry`);
    }
    traffic.helperOutcomes.push({ operation: payload.operation ?? payload.cmd, outcome: 'completed' });
    return result;
  }
  let queue = Promise.resolve();
  const transport = {
    traffic,
    async fetch(input, init = {}) {
      if (stopped) throw stopped;
      if (closed) throw new Error('Gourmet browser session closed');
      if (init.signal?.aborted) return stop('Gourmet request cancelled before native dispatch');
      const deadline = Date.now() + 20_000;
      traffic.nativeAttempts++;
      let response;
      try { response = await native(input, init); } catch { return stop('Gourmet native transport failed or was cancelled; no retry'); }
      const observed = diagnostics.at(-1);
      if (observed.explicitDenialMarker) return stop('Explicit provider denial; Gourmet checks stopped');
      if (!observed.cloudflareHeader) return response;
      // Non-public/image requests never gain a helper route. Exact complete HTML
      // inspection is required, not the absence of denial text in a short prefix.
      if (observed.route === 'image' || observed.route === 'other') return response;
      try { assertGourmetTarget(input, init); } catch { return stop('Unsupported challenged Gourmet document; no assist'); }
      if (![403, 503].includes(response.status) || !observed.cloudflareServer || !observed.bodyCloudflareMarker || !observed.bodyComplete || observed.mime !== 'text/html') return stop('Managed challenge evidence incomplete; no browser assist');
      void response.body?.cancel().catch(() => {});
      if (traffic.assistedAttempts >= limit) return stop('Gourmet assisted document budget exhausted');
      if (init.signal?.aborted) return stop('Gourmet request cancelled before browser assist');
      if (Date.now() >= deadline) return stop('No native deadline remaining for browser assistance');
      if (!created) {
        creationAttempted = true;
        await command('/v1', { cmd: 'sessions.create', session }, init.signal);
        created = true;
      }
      const payload = { session, url: input, method: 'GET', headers: Object.fromEntries(new Headers(init.headers)), body: null, deadline };
      if (!traffic.warmupAttempts) {
        traffic.warmupAttempts++; traffic.subresourcesUncounted = true;
        const warm = await command('/additive/gourmet', { ...payload, operation: 'warm' }, init.signal);
        if (warm.ready !== true || warm.traffic?.warmups !== 1 || warm.traffic?.assistedRequests !== 0) return stop('Gourmet browser warm-up failed');
      }
      // Separate commands ensure cancellation during warm-up cannot initiate a
      // later browser fetch. Cleanup destroys the fresh anonymous session.
      if (init.signal?.aborted) return stop('Gourmet browser request cancelled before fetch');
      if (Date.now() >= deadline) return stop('Gourmet browser deadline expired before fetch');
      traffic.assistedAttempts++;
      const data = await command('/additive/gourmet', { ...payload, operation: 'fetch' }, init.signal);
      if (data.url !== input || !Number.isInteger(data.status) || data.status < 200 || data.status > 599 || data.encoding !== 'base64' || typeof data.body !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.body) || data.traffic?.warmups !== traffic.warmupAttempts || data.traffic?.assistedRequests !== traffic.assistedAttempts) return stop('Invalid Gourmet browser response or traffic accounting');
      const bytes = Buffer.from(data.body, 'base64');
      if (bytes.length > 5_000_000) return stop('Gourmet browser response too large');
      const assisted = new Response([204, 205, 304].includes(data.status) ? null : bytes, { status: data.status, headers: data.headers });
      Object.defineProperty(assisted, 'url', { value: data.url });
      await diagnosticFetch(async () => assisted, traffic.responseDiagnostics)(input, init);
      const final = traffic.responseDiagnostics.at(-1);
      if (data.stopCode) traffic.helperOutcomes.push({ operation: 'fetch-response', outcome: ['denial', 'captcha', 'challenge', 'http-error'].includes(data.stopCode) ? data.stopCode : 'invalid-stop-code' });
      if (data.stopCode || data.status !== 200 || final.explicitDenialMarker || final.cloudflareHeader || final.bodyCloudflareMarker) return stop('Gourmet browser still challenged or denied; checks stopped');
      return assisted;
    },
    async close() {
      closed = true;
      await queue;
      // Destruction is cleanup, not retry. Keep a failed outcome honest.
      if (creationAttempted) {
        try { await command('/v1', { cmd: 'sessions.destroy', session }); }
        catch { traffic.cleanupFailed = true; }
      }
    },
  };
  return { ...transport, fetch(...args) {
    const operation = queue.then(() => transport.fetch(...args));
    queue = operation.catch(() => {});
    return operation;
  } };
}
