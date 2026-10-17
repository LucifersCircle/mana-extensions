import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchTestImage, interceptImageResponse } from './mana-test-images.mjs';
import { assertCoverImageURL, createManaTestWebView } from './mana-test-webview.mjs';

const url = 'https://images.example.invalid/public-cover';
function response(body, status = 200, headers = { 'content-type': 'image/png' }) {
  const value = new Response(body, { status, headers });
  Object.defineProperty(value, 'url', { value: url });
  return value;
}

test('image callbacks without response transformers retain the original streaming response', async () => {
  const raw = response('actual bytes');
  assert.equal(await interceptImageResponse(raw, { url }), raw);
  assert.equal(raw.bodyUsed, false);
});

test('actual image response transformers run before HTTP validation and retain exact binary bytes', async () => {
  const bytes = Buffer.from([0, 255, 128, 1, 2, 3]);
  const request = { url, responseEncoding: 'base64', transformResponse: async value => {
    assert.equal(value.request, request); assert.equal(value.data, bytes.toString('base64'));
    assert.equal(value.headers['content-type'], 'image/png'); return value;
  } };
  const result = await interceptImageResponse(response(bytes), request);
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes); assert.equal(result.url, url);
  const cfError = new Error('Challenge required'); cfError.name = 'CloudflareError';
  const challenged = { url, transformResponse: value => {
    assert.equal(value.status, 403); assert.equal(value.data, 'actual challenge HTML'); throw cfError;
  } };
  await assert.rejects(interceptImageResponse(response('actual challenge HTML', 403), challenged), error => error === cfError);
});

test('ordinary denied responses remain failures and synthetic status/body/header changes are rejected', async () => {
  const raw = await interceptImageResponse(response('Forbidden', 403), { url, transformResponse: value => value });
  assert.equal(raw.status, 403); assert.equal(raw.ok, false);
  for (const transform of [value => ({ ...value, status: 200 }), value => ({ ...value, data: 'fake bytes' }),
    value => ({ ...value, headers: { 'content-type': 'image/png' } }), value => ({ ...value, request: { url } })]) {
    await assert.rejects(interceptImageResponse(response('Forbidden', 403, { 'content-type': 'text/html' }),
      { url, transformResponse: transform }), /rewriting is unsupported/);
  }
});

test('intercepted image bodies are bounded, and invalid transformer/encoding is explicit', async () => {
  await assert.rejects(interceptImageResponse(response('x'), { url, transformResponse: 1 }), /Invalid image/);
  await assert.rejects(interceptImageResponse(response('x'), { url, transformResponse: value => value, responseEncoding: 'binary' }), /encoding/);
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } });
  await assert.rejects(interceptImageResponse(response(body), { url, transformResponse: value => value }), /byte limit/);
  assert.equal(cancelled, true);
});

const cover = 'https://peer.storagewebtoon.store/manhwa/17155/issued-cover.webp';
function coverResponse(status = 200, headers = { 'content-type': 'image/webp' }, body = new Uint8Array([0, 255, 128, 2])) {
  const value = new Response(body, { status, headers }); Object.defineProperty(value, 'url', { value: cover }); return value;
}
function sourceFixture({ mutate = () => {}, onAuthorization = () => {}, onTransform = () => {} } = {}) {
  return { info: { id: 'Marumaru' }, async willRequestImage(target) {
    onAuthorization();
    return { url: target, headers: { Referer: 'https://marumaru105.com/' }, transformResponse: value => {
      onTransform(); mutate(value.request);
      if (value.headers['cf-mitigated'] === 'challenge') {
        const error = new Error('Managed challenge'); error.name = 'CloudflareError'; error.resolutionURL = target; throw error;
      }
      return value;
    } };
  } };
}
const challenge = () => coverResponse(403, { 'content-type': 'text/html', 'cf-mitigated': 'challenge' }, 'challenge');

test('image URL protocols are validated before any network or browser I/O', async () => {
  let requests = 0, captures = 0;
  for (const target of ['data:image/png;base64,AAAA', 'file:///private/image', 'javascript:alert(1)', 'not a URL']) {
    await assert.rejects(fetchTestImage({ async willRequestImage() { return { url: target }; } }, target, {
      fetchImpl: async () => { requests++; return coverResponse(); }, captureCoverImage: async () => { captures++; return coverResponse(); },
    }));
  }
  assert.equal(requests, 0); assert.equal(captures, 0);
});

test('direct image responses retain the requested URL for the existing source-specific byte guards', async () => {
  const requested = 'https://kagane.org/api/v2/image/test';
  const raw = response('actual bytes');
  const result = await fetchTestImage({ async willRequestImage() { return { url: requested }; } }, requested,
    { fetchImpl: async () => raw });
  assert.equal(result, raw); assert.equal(result.requestedImageURL, requested);
  assert.equal(result.url, url);
});

test('only an exact positive source CloudflareError enables one explicitly browser-context capture and reauthorization', async () => {
  let authorizations = 0, transforms = 0, requests = 0, captures = 0;
  const phases = [], bytes = new Uint8Array([0, 255, 128, 2]);
  const source = sourceFixture({ onAuthorization: () => authorizations++, onTransform: () => transforms++ });
  const result = await fetchTestImage(source, cover, {
    fetchImpl: async (target, config) => { requests++; assert.equal(target, cover); assert.deepEqual(config.headers, { Referer: 'https://marumaru105.com/' }); return challenge(); },
    captureCoverImage: async target => { captures++; assert.equal(target, cover); return coverResponse(); },
    log: phase => phases.push(phase),
  });
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
  assert.equal(requests, 1); assert.equal(captures, 1); assert.equal(authorizations, 2); assert.equal(transforms, 2);
  assert.deepEqual(phases, ['native', 'browser-context-after-cloudflare-error']);
});

test('ordinary denial, changed response identity, foreign source and in-place request mutation cannot activate a browser capture', async () => {
  let captures = 0;
  const captureCoverImage = async () => { captures++; return coverResponse(); };
  const ordinary = await fetchTestImage(sourceFixture(), cover, { fetchImpl: async () => coverResponse(403), captureCoverImage });
  assert.equal(ordinary.ok, false);
  const foreign = sourceFixture(); foreign.info.id = 'Other';
  await assert.rejects(fetchTestImage(foreign, cover, { fetchImpl: async () => challenge(), captureCoverImage }), /contract/);
  const redirect = new Response('challenge', { status: 403, headers: { 'cf-mitigated': 'challenge' } });
  Object.defineProperty(redirect, 'url', { value: 'https://other.example.invalid/' });
  await assert.rejects(fetchTestImage(sourceFixture(), cover, { fetchImpl: async () => redirect, captureCoverImage }), { name: 'CloudflareError' });
  for (const mutate of [request => { request.url = cover + '?changed'; }, request => { request.headers.Referer = 'https://other.example.invalid/'; }]) {
    await assert.rejects(fetchTestImage(sourceFixture({ mutate }), cover, { fetchImpl: async () => challenge(), captureCoverImage }), /request changed/);
  }
  assert.equal(captures, 0);
});

test('revoked source authorization or changed captured image never becomes a successful image result', async () => {
  let revoked = false, captures = 0;
  const source = sourceFixture({ onAuthorization: () => { if (revoked) throw new Error('Issuing policy revoked'); } });
  await assert.rejects(fetchTestImage(source, cover, { fetchImpl: async () => challenge(),
    captureCoverImage: async () => { captures++; revoked = true; return coverResponse(); } }), /revoked/);
  assert.equal(captures, 1);
  await assert.rejects(fetchTestImage(sourceFixture(), cover, { fetchImpl: async () => challenge(),
    captureCoverImage: async () => response('different image') }), /identity changed/);
});

function helperFixture(result = {}) {
  const calls = [];
  const fetchImpl = async (target, config) => {
    const payload = JSON.parse(config.body), path = new URL(target).pathname; calls.push({ path, ...payload });
    return Response.json(path === '/v1' ? { status: 'ok' } : {
      url: cover, status: 200, contentType: 'image/webp', body: Buffer.from([0, 255, 128, 2]).toString('base64'), encoding: 'base64', ...result,
    });
  };
  return { calls, host: createManaTestWebView({ solverURL: 'http://127.0.0.1:8191', fetchImpl }) };
}

test('browser capture bridge accepts only exact public cover responses and always destroys its session', async () => {
  const { calls, host } = helperFixture();
  const result = await host.captureCoverImage(cover);
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), new Uint8Array([0, 255, 128, 2]));
  assert.equal(result.url, cover);
  assert.deepEqual(calls.map(call => call.cmd ?? call.path), ['sessions.create', '/webview/image-response', 'sessions.destroy']);
  assert.equal(new Set(calls.map(call => call.session)).size, 1); await host.close();
  for (const malformed of [{ url: cover + '?changed' }, { status: 403 }, { contentType: 'text/html' }, { body: '!!!!' }, { body: '' }, { headers: { 'set-cookie': 'secret' } }]) {
    const test = helperFixture(malformed); await assert.rejects(test.host.captureCoverImage(cover));
    assert.equal(test.calls.at(-1).cmd, 'sessions.destroy'); await test.host.close();
  }
  for (const bad of [cover + '?x=1', cover + '#x', cover.replace('https:', 'http:'), cover.replace('store/', 'store.evil/'),
    cover.replace('/manhwa/', '/api/media/episode/'), cover.replace('issued-cover.webp', '..')]) assert.throws(() => assertCoverImageURL(bad));
});

test('browser image security gates are sticky and never expose helper errors or start another session', async () => {
  const { calls, host } = helperFixture({ error: 'private-cookie-secret', code: 'security', reason: 'tls-navigation-error' });
  await assert.rejects(host.captureCoverImage(cover), /security warning \(tls-navigation-error\)/);
  const count = calls.length; await assert.rejects(host.captureCoverImage(cover), /security warning/);
  assert.equal(calls.length, count); assert.equal(calls.at(-1).cmd, 'sessions.destroy'); await host.close();
});

test('closing during image session creation waits for and destroys late creation without capture', async () => {
  const calls = []; let release;
  const host = createManaTestWebView({ solverURL: 'http://127.0.0.1:8191', fetchImpl: async (target, config) => {
    const payload = JSON.parse(config.body); calls.push(payload.cmd ?? new URL(target).pathname);
    if (payload.cmd === 'sessions.create') await new Promise(resolve => { release = resolve; });
    return Response.json({ status: 'ok' });
  } });
  const capture = assert.rejects(host.captureCoverImage(cover), /host is closed/);
  const closing = assert.rejects(host.close(), /host is closed/);
  release(); await capture; await closing;
  assert.deepEqual(calls, ['sessions.create', 'sessions.destroy']);
});

test('helper response byte limit cancels oversized streams without exposing their content', async () => {
  let cancelled = false;
  const host = createManaTestWebView({ solverURL: 'http://127.0.0.1:8191', fetchImpl: async (target, config) => {
    const payload = JSON.parse(config.body);
    if (payload.cmd === 'sessions.destroy') return Response.json({ status: 'ok' });
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 2048)); }, cancel() { cancelled = true; } }));
  } });
  await assert.rejects(host.captureCoverImage(cover), /helper failed/);
  assert.equal(cancelled, true); await host.close();
});
