import test from 'node:test';
import assert from 'node:assert/strict';
import { assertGourmetTarget, createGourmetTestTransport } from './additive-gourmet-transport.mjs';
const url = 'https://gourmetsupremacy.com/?s=&post_type=wp-manga&m_orderby=latest';
const challenge = () => new Response('<html>cf-chl challenge</html>', { status: 403, headers: { 'content-type': 'text/html', server: 'cloudflare', 'cf-mitigated': 'challenge' } });
function fixture(first = challenge, assisted = {}) {
  const calls = [], diagnostics = [];
  const fetchImpl = async (input, init) => {
    calls.push({ input, init });
    if (input === url || input.includes('/wp-content/')) return first();
    const payload = JSON.parse(init.body);
    if (payload.cmd) return Response.json({ status: 'ok' });
    if (payload.operation === 'warm') return Response.json({ ready: true, traffic: { warmups: 1, assistedRequests: 0 } });
    return Response.json({ url, status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html>actual fetched bytes</html>').toString('base64'), encoding: 'base64', traffic: { warmups: 1, assistedRequests: 1, subresourcesUncounted: true }, ...assisted });
  };
  return { calls, transport: createGourmetTestTransport({ fetchImpl, diagnostics, solverURL: 'http://127.0.0.1:8191' }) };
}
test('Gourmet browser allowlist excludes credentials, account routes and ambiguous queries', () => {
  assert.doesNotThrow(() => assertGourmetTarget(url));
  assert.doesNotThrow(() => assertGourmetTarget('https://gourmetsupremacy.com/project/title/chapter-1/'));
  for (const bad of [url + '&s=other', url + '&account=1', url.replace('latest', 'unknown'), 'https://gourmetsupremacy.com/wp-admin/', 'https://user@gourmetsupremacy.com/project/title/', 'https://gourmetsupremacy.com/project/title/?x=1']) assert.throws(() => assertGourmetTarget(bad));
  for (const init of [{ method: 'POST' }, { headers: { cookie: 'secret' } }, { headers: { authorization: 'secret' } }, { headers: { referer: 'https://example.com/' } }]) assert.throws(() => assertGourmetTarget(url, init));
});
test('positive complete challenge gets one anonymous assist and preserves actual response', async () => {
  const { calls, transport } = fixture();
  const response = await transport.fetch(url);
  assert.equal(response.url, url); assert.equal(response.status, 200); assert.equal(await response.text(), '<html>actual fetched bytes</html>');
  assert.equal(calls.length, 4); assert.equal(calls[0].input, url);
  assert.equal(transport.traffic.nativeAttempts, 1); assert.equal(transport.traffic.warmupAttempts, 1); assert.equal(transport.traffic.assistedAttempts, 1); assert.equal(transport.traffic.subresourcesUncounted, true);
  await transport.close(); assert.equal(JSON.parse(calls.at(-1).init.body).cmd, 'sessions.destroy');
});
test('ordinary errors and native image bytes never get browser assist', async () => {
  for (const first of [() => new Response('forbidden', { status: 403 }), () => new Response('unavailable', { status: 503 })]) {
    const { calls, transport } = fixture(first); assert.equal((await transport.fetch(url)).status >= 400, true); assert.equal(calls.length, 1);
  }
  const { calls, transport } = fixture(challenge); assert.equal((await transport.fetch('https://gourmetsupremacy.com/wp-content/uploads/cover.jpg')).status, 403); assert.equal(calls.length, 1);
});
test('denial, incomplete challenge, helper failures and repeated challenge latch stop', async () => {
  for (const first of [() => new Response('cf-chl your ip has been blocked', { status: 403, headers: { 'content-type': 'text/html', server: 'cloudflare', 'cf-mitigated': 'challenge' } }), () => new Response('cf-chl' + 'x'.repeat(9000), { status: 403, headers: { 'content-type': 'text/html', server: 'cloudflare', 'cf-mitigated': 'challenge' } })]) {
    const { calls, transport } = fixture(first); await assert.rejects(transport.fetch(url)); await assert.rejects(transport.fetch(url)); assert.equal(calls.length, 1);
  }
  for (const result of [{ error: 'stopped', code: 'captcha' }, { error: 'stopped', code: 'security' }, { url: 'https://example.com/' }, { status: 403, headers: { 'content-type': 'text/html', 'cf-mitigated': 'challenge' }, body: Buffer.from('cf-chl').toString('base64') }]) {
    const { calls, transport } = fixture(challenge, result); await assert.rejects(transport.fetch(url)); const count = calls.length; await assert.rejects(transport.fetch(url)); assert.equal(calls.length, count); await transport.close();
  }
});
test('abort during warm-up never dispatches a browser fetch and latches stop', async () => {
  const controller = new AbortController(), calls = [];
  const transport = createGourmetTestTransport({ diagnostics: [], solverURL: 'http://127.0.0.1:8191', fetchImpl: async (input, init) => {
    calls.push(input === url ? 'native' : JSON.parse(init.body).operation ?? JSON.parse(init.body).cmd);
    if (input === url) return challenge();
    if (JSON.parse(init.body).operation === 'warm') { controller.abort(); return Response.json({ ready: true, traffic: { warmups: 1, assistedRequests: 0 } }); }
    return Response.json({ status: 'ok' });
  } });
  await assert.rejects(transport.fetch(url, { signal: controller.signal }));
  await assert.rejects(transport.fetch(url));
  assert.deepEqual(calls, ['native', 'sessions.create', 'warm']);
  assert.equal(transport.traffic.assistedAttempts, 0);
  await transport.close(); assert.equal(calls.at(-1), 'sessions.destroy');
});
test('failed warm-up does not dispatch a fetch or retry its navigation', async () => {
  const calls = [];
  const transport = createGourmetTestTransport({ diagnostics: [], solverURL: 'http://127.0.0.1:8191', fetchImpl: async (input, init) => {
    if (input === url) return challenge();
    const payload = JSON.parse(init.body); calls.push(payload.operation ?? payload.cmd);
    return Response.json(payload.operation === 'warm' ? { error: 'failed' } : { status: 'ok' });
  } });
  await assert.rejects(transport.fetch(url)); await assert.rejects(transport.fetch(url));
  assert.deepEqual(calls, ['sessions.create', 'warm']); assert.equal(transport.traffic.warmupAttempts, 1); assert.equal(transport.traffic.assistedAttempts, 0); await transport.close();
});
test('already aborted calls never dispatch native requests', async () => {
  const { calls, transport } = fixture();
  await assert.rejects(transport.fetch(url, { signal: AbortSignal.abort() }));
  assert.equal(calls.length, 0);
});
test('complete helper denial reason is retained without arbitrary text', async () => {
  for (const code of ['denial', 'captcha', 'challenge', 'http-error', 'secret raw error']) {
    const { transport } = fixture(challenge, { stopCode: code });
    await assert.rejects(transport.fetch(url));
    assert.equal(transport.traffic.helperOutcomes.at(-1).outcome, code === 'secret raw error' ? 'invalid-stop-code' : code);
    await transport.close();
  }
});
