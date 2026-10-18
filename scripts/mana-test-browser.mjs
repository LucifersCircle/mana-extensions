// Test-only Chromium transport. Nothing under src/ imports this file.
// Opt in explicitly; ordinary local requests retain the native Cloudflare failure.
import { randomUUID } from 'node:crypto';
import { assertPublicKaganeRequest } from './mana-runtime.mjs';
import { createCloudflareAssistance } from './cloudflare-assistance.mjs';

export function createManaTestTransport({ solverURL = process.env.FLARESOLVERR_URL, fetchImpl = globalThis.fetch } = {}) {
  const assistance = createCloudflareAssistance({ solverURL, fetchImpl });
  if (!solverURL) return assistance;
  const solver = new URL(solverURL);
  if (solver.protocol !== 'http:' || solver.hostname !== '127.0.0.1' || solver.username || solver.password
      || solver.pathname !== '/' || solver.search || solver.hash) {
    throw new Error('The live-test browser must use a loopback HTTP FlareSolverr URL');
  }
  const session = randomUUID();
  let warmup, stopped, created = false, closed = false, queue = Promise.resolve();
  const serial = (operation) => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
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
  async function warm() {
    warmup ??= (async () => {
      await command('/v1', { cmd: 'sessions.create', session });
      created = true;
      await command('/browser/warm', { session });
    })();
    return warmup;
  }
  return {
    async fetch(input, init = {}) {
      const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      // CDN and actual reader image-byte checks never go through a helper.
      if (target.hostname !== 'kagane.org') return assistance.fetch(input, init);
      const method = init.method ?? (input instanceof Request ? input.method : 'GET');
      const body = init.body ?? null;
      assertPublicKaganeRequest({ url: target.href, method, body });
      const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
      const allowed = new Set(['accept', 'content-type', 'origin', 'referer', 'user-agent', 'x-integrity-token']);
      for (const key of headers.keys()) {
        if (!allowed.has(key) || (key === 'x-integrity-token' && (method !== 'POST' || !/^\/api\/v2\/books\/[A-Za-z0-9-]+$/.test(target.pathname)))) {
          throw new Error('Live-test browser rejects account credentials and unsupported headers');
        }
      }
      if (closed) throw new Error('Live-test browser session is closed');
      return serial(async () => {
        if (stopped) throw stopped;
        init.signal?.throwIfAborted();
        await warm();
        init.signal?.throwIfAborted();
        const data = await command('/browser/request', {
          session, url: target.href, method, headers: Object.fromEntries(headers), body,
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
    stats: assistance.stats,
    async close() {
      closed = true;
      try {
        await serial(async () => {
          if (created) await command('/v1', { cmd: 'sessions.destroy', session });
        });
      } finally { await assistance.close(); }
    },
  };
}
