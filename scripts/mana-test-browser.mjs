// Test-only Chromium transport. Nothing under src/ imports this file.
// Opt in explicitly; ordinary local requests retain the native Cloudflare failure.
import { randomUUID } from 'node:crypto';
import { assertPublicKaganeRequest, assertPublicMarumaruRequest } from './mana-runtime.mjs';

export function createManaTestTransport({ solverURL = process.env.FLARESOLVERR_URL, fetchImpl = globalThis.fetch } = {}) {
  if (!solverURL) return { fetch: fetchImpl, close: async () => {} };
  const solver = new URL(solverURL);
  if (solver.protocol !== 'http:' || solver.hostname !== '127.0.0.1' || solver.username || solver.password
      || solver.pathname !== '/' || solver.search || solver.hash) {
    throw new Error('The live-test browser must use a loopback HTTP FlareSolverr URL');
  }
  const sites = new Map();
  let stopped, closed = false;
  const serial = (site, operation) => {
    const result = site.queue.then(operation);
    site.queue = result.catch(() => {});
    return result;
  };
  async function command(path, payload, signal) {
    let response, result;
    try {
      response = await fetchImpl(`${solver.origin}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload), signal: signal ?? AbortSignal.timeout(75_000),
      });
      result = await response.json();
    } catch {
      throw new Error('Live-test Chromium transport failed; no response bodies or credentials are logged');
    }
    if (!result || typeof result !== 'object') throw new Error('Live-test Chromium returned an invalid helper response');
    if (!response.ok || result.error || (path === '/v1' && result.status !== 'ok')) {
      // Never echo helper error text: upstream errors can contain cookies or tokens.
      if (result.code === 'captcha') stopped = new Error('Explicit CAPTCHA requires user approval; live checks stopped');
      if (result.code === 'security') stopped = new Error('Browser security warning; live checks stopped');
      if (stopped) throw stopped;
      throw new Error('Live-test Chromium request failed or managed challenge did not finish');
    }
    return result;
  }
  async function warm(site) {
    site.warmup ??= (async () => {
      await command('/v1', { cmd: 'sessions.create', session: site.session });
      site.created = true;
      const result = await command('/browser/warm', { session: site.session, site: site.host });
      if (result.ready !== true) throw new Error('Live-test Chromium did not confirm source readiness');
    })();
    return site.warmup;
  }
  return {
    async fetch(input, init = {}) {
      const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      // CDN and actual reader image-byte checks never go through a helper.
      if (!['kagane.org', 'marumaru105.com'].includes(target.hostname)) return fetchImpl(input, init);
      const method = init.method ?? (input instanceof Request ? input.method : 'GET');
      const body = init.body ?? null;
      const marumaru = target.hostname === 'marumaru105.com';
      (marumaru ? assertPublicMarumaruRequest : assertPublicKaganeRequest)({
        url: typeof input === 'string' ? input : target.href, method, body,
      });
      const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
      const allowed = new Set(['accept', 'content-type', 'origin', 'referer', 'user-agent', marumaru ? 'x-site' : 'x-integrity-token']);
      for (const key of headers.keys()) {
        if (!allowed.has(key) || (key === 'x-integrity-token' && (method !== 'POST' || !/^\/api\/v2\/books\/[A-Za-z0-9-]+$/.test(target.pathname)))) {
          throw new Error('Live-test browser rejects account credentials and unsupported headers');
        }
      }
      if (marumaru && headers.get('x-site') !== 'marumaru') throw new Error('Live-test browser requires the Marumaru site header');
      if (closed) throw new Error('Live-test browser session is closed');
      if (!sites.has(target.hostname)) sites.set(target.hostname, { host: target.hostname, session: randomUUID(), queue: Promise.resolve(), created: false });
      const site = sites.get(target.hostname);
      return serial(site, async () => {
        if (stopped) throw stopped;
        init.signal?.throwIfAborted();
        await warm(site);
        init.signal?.throwIfAborted();
        const data = await command('/browser/request', {
          session: site.session, url: target.href, method, headers: Object.fromEntries(headers), body,
        }, init.signal);
        if (data.url !== target.href || !Number.isInteger(data.status) || data.status < 200 || data.status > 599 || typeof data.body !== 'string' || data.encoding !== 'base64'
            || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.body)) {
          throw new Error('Live-test browser returned an invalid HTTP response');
        }
        // Do not turn a remaining API challenge into a pass or synthetic JSON.
        // The unchanged native source receives the real status/headers/body.
        const response = new Response([204, 205, 304].includes(data.status) ? null : Buffer.from(data.body, 'base64'), {
          status: data.status, headers: data.headers,
        });
        Object.defineProperty(response, 'url', { value: data.url });
        return response;
      });
    },
    async close() {
      closed = true;
      await Promise.all(Array.from(sites.values(), site => serial(site, async () => {
        if (site.created) await command('/v1', { cmd: 'sessions.destroy', session: site.session });
      })));
    },
  };
}
