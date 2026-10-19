import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createManaRuntime, installManaHTTP } from './mana-runtime.mjs';
import { fetchTestImage, authorizeTestImage, resolvedBrowserImageProof, withSourceTransport } from './mana-test-images.mjs';
import { assertCoverImageURL, createManaTestWebView, safeWebViewDiagnostic } from './mana-test-webview.mjs';

const url = 'https://images.example.invalid/public-cover';
const cover = 'https://peer.storagewebtoon.store/manhwa/17155/issued-cover.webp';
function response(body, status = 200, headers = { 'content-type': 'image/png' }, target = url) {
  const value = new Response(body, { status, headers });
  Object.defineProperty(value, 'url', { value: target }); return value;
}
function coverResponse(status = 200, headers = { 'content-type': 'image/webp' }, body = new Uint8Array([0, 255, 128, 2])) {
  return response(body, status, headers, cover);
}
const challenge = () => coverResponse(403, { 'content-type': 'text/html', 'cf-mitigated': 'challenge' }, 'challenge');
function sourceFixture({ fetchImpl = async () => coverResponse(), onAuthorization = () => {}, onResponse = value => value,
  id = 'Marumaru', referer = 'https://marumaru105.com/' } = {}) {
  const context = vm.createContext(createManaRuntime({ fetchImpl, logger: () => {} }));
  const host = installManaHTTP(context);
  Object.assign(context, { onAuthorization, onResponse, sourceID: id, referer });
  const source = host.wrapSource(vm.runInContext(`({
    info: { id: sourceID },
    transport(image) {
      return new ManaHTTP.HttpClient().addHeader('Referer', referer)
        .addRequestInterceptor((request, ctx) => Promise.resolve(onAuthorization(request, ctx)).then(() => request))
        .addResponseInterceptor((value, ctx) => onResponse(value, ctx));
    },
    getCoverTransport(request) { return this.transport(request); },
    getPageTransport(request) { return this.transport(request); }
  })`, context));
  return { source, host, context };
}

test('official image dispatch preserves exact native bytes and distinct cover/page origins', async () => {
  const bytes = Buffer.from([0, 255, 128, 1, 2, 3]), origins = [];
  const { source, host } = sourceFixture({ fetchImpl: async () => response(bytes), onAuthorization: (_request, ctx) => origins.push(ctx.origin),
    onResponse: async value => { assert.equal(await value.base64(), bytes.toString('base64')); return value; } });
  for (const origin of ['cover', 'page']) {
    const result = await fetchTestImage(source, url, { origin });
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes); assert.equal(result.url, url); assert.equal(result.requestedImageURL, url);
    assert.deepEqual(host.stats(), { operations: 0, bodies: 0, transfers: 0 });
  }
  assert.deepEqual(origins, [1, 2]);
});

test('async authorization probes stop at image Fetch and do not skip denial', async () => {
  let requests = 0, authorizations = 0;
  const { source } = sourceFixture({ fetchImpl: async () => { requests++; return coverResponse(); }, onAuthorization: async request => {
    await Promise.resolve(); authorizations++; if (request.url.includes('denied')) throw new Error('Issuing policy denied');
    request.url = cover;
  } });
  const request = await authorizeTestImage(source, url, { origin: 'cover' });
  assert.equal(request.url, cover); assert.equal(request.headers.referer, 'https://marumaru105.com/');
  await assert.rejects(authorizeTestImage(source, url + '/denied', { origin: 'page' }), /denied/);
  assert.equal(authorizations, 2); assert.equal(requests, 0);
});

test('image protocols and required origin are validated before any I/O', async () => {
  let requests = 0, captures = 0;
  const { source } = sourceFixture({ fetchImpl: async () => { requests++; return coverResponse(); } });
  for (const target of ['data:image/png;base64,AAAA', 'file:///private/image', 'javascript:alert(1)', 'not a URL']) {
    await assert.rejects(fetchTestImage(source, target, { origin: 'cover', captureCoverImage: async () => { captures++; } }));
  }
  await assert.rejects(fetchTestImage(source, cover), /explicit cover or page origin/);
  assert.equal(requests, 0); assert.equal(captures, 0);
});

test('real SDK Cloudflare detection precedes response interceptors; exact positive evidence permits one capture and reauthorization', async () => {
  let authorizations = 0, transforms = 0, requests = 0, captures = 0;
  const phases = [], bytes = new Uint8Array([0, 255, 128, 2]);
  const { source } = sourceFixture({ fetchImpl: async () => { requests++; return challenge(); },
    onAuthorization: () => authorizations++, onResponse: value => { transforms++; return value; } });
  const result = await fetchTestImage(source, cover, { origin: 'cover',
    captureCoverImage: async target => { captures++; assert.equal(target, cover); return coverResponse(); }, log: phase => phases.push(phase) });
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
  assert.equal(requests, 1); assert.equal(captures, 1); assert.equal(authorizations, 2); assert.equal(transforms, 1);
  assert.deepEqual(phases, ['native', 'browser-context-after-cloudflare-error']);
});

test('generic denial, foreign source, page origin, redirect or absent positive header never activates capture', async () => {
  let captures = 0;
  const captureCoverImage = async () => { captures++; return coverResponse(); };
  for (const [fixture, origin, pattern] of [
    [{ fetchImpl: async () => coverResponse(403) }, 'cover', { name: 'HttpStatusError' }],
    [{ fetchImpl: async () => challenge(), id: 'Other' }, 'cover', { name: 'CloudflareError' }],
    [{ fetchImpl: async () => challenge() }, 'page', { name: 'CloudflareError' }],
    [{ fetchImpl: async () => response('challenge', 403, { 'cf-mitigated': 'challenge' }) }, 'cover', { name: 'CloudflareError' }],
    [{ fetchImpl: async () => coverResponse(503, { server: 'cloudflare' }, 'cf-chl') }, 'cover', { name: 'CloudflareError' }],
  ]) {
    const { source } = sourceFixture(fixture);
    await assert.rejects(fetchTestImage(source, cover, { origin, captureCoverImage }), pattern);
  }
  assert.equal(captures, 0);
});

test('synthetic status, body, URL and header responses cannot masquerade as native image passes', async () => {
  for (const onResponse of [value => { value.status = 201; return value; }, value => value.withBody('fake bytes'),
    value => { value.url += '?changed'; return value; }, value => { value.headers.set('content-type', 'image/fake'); return value; },
    value => { value.request.url += '?changed'; return value; }, value => { value.request.headers.set('referer', 'https://other.invalid/'); return value; }]) {
    const { source, host } = sourceFixture({ onResponse });
    await assert.rejects(fetchTestImage(source, cover, { origin: 'cover' }), /rewriting is unsupported|request changed/, String(onResponse));
    assert.deepEqual(host.stats(), { operations: 0, bodies: 0, transfers: 0 });
  }
});

test('revoked authorization, late response revocation and changed capture identity cannot produce an image pass', async () => {
  let revoked = false, captures = 0;
  const { source } = sourceFixture({ fetchImpl: async () => challenge(), onAuthorization: () => { if (revoked) throw new Error('Issuing policy revoked'); } });
  await assert.rejects(fetchTestImage(source, cover, { origin: 'cover', captureCoverImage: async () => { captures++; revoked = true; return coverResponse(); } }), /revoked/);
  assert.equal(captures, 1);
  const second = sourceFixture({ fetchImpl: async () => challenge() });
  await assert.rejects(fetchTestImage(second.source, cover, { origin: 'cover', captureCoverImage: async () => response('different') }), /identity changed/);
  const third = sourceFixture({ onResponse: () => { throw new Error('Response policy revoked'); } });
  await assert.rejects(fetchTestImage(third.source, cover, { origin: 'cover' }), /revoked/);
});

test('scoped fixture transports do not leak into later real image requests', async () => {
  let native = 0, fixture = 0;
  const { source } = sourceFixture({ fetchImpl: async () => { native++; return coverResponse(); } });
  await withSourceTransport(source, async () => { fixture++; return coverResponse(); }, () => fetchTestImage(source, cover, { origin: 'cover' }));
  await fetchTestImage(source, cover, { origin: 'cover' });
  assert.equal(fixture, 1); assert.equal(native, 1);
});

function helperFixture(result = {}) {
  const calls = [];
  const fetchImpl = async (target, config) => {
    const payload = JSON.parse(config.body), path = new URL(target).pathname; calls.push({ path, ...payload });
    return Response.json(path === '/v1' ? { status: 'ok' } : {
      url: cover, status: 200, decoded: true, contentType: 'image/webp', body: Buffer.from([0, 255, 128, 2]).toString('base64'), encoding: 'base64', ...result,
    });
  };
  return { calls, host: createManaTestWebView({ solverURL: 'http://127.0.0.1:8191', fetchImpl }) };
}

test('image failures expose only approved capture stage/reason enums and close without retries', async () => {
  assert.deepEqual(safeWebViewDiagnostic({ phase: 'secret-phase', stage: 'secret-stage', reason: 'secret-token' }),
    { phase: 'unknown', stage: 'unknown', reason: 'unknown', cdpMimeCategory: 'unknown', contentTypeCategory: 'unknown' });
  for (const stage of ['setup', 'validation', 'session-acquisition', 'initial-safety', 'network-enable',
    'initial-log', 'navigation', 'page-safety', 'observation', 'hero', 'body-read', 'final-verification', 'body-validation']) {
    const { host, calls } = helperFixture({ error: 'SECRET BODY', code: 'operation', phase: 'image-capture',
      stage, reason: 'image-response-http-status', cdpMimeCategory: 'octet-stream', contentTypeCategory: 'SECRET-header' });
    await assert.rejects(host.captureCoverImage(cover), error => {
      assert(!error.message.includes('SECRET'));
      assert(error.message.includes(`image-capture: image-response-http-status; stage: ${stage}`));
      assert.equal(error.liveTestDiagnostic.cdpMimeCategory, 'octet-stream');
      assert.equal(error.liveTestDiagnostic.contentTypeCategory, 'unknown');
      return true;
    });
    assert.deepEqual(calls.map(call => call.cmd ?? call.path), ['sessions.create', '/webview/image-response', 'sessions.destroy']);
    await host.close();
  }
});

test('browser capture bridge accepts only exact public cover responses and always destroys its session', async () => {
  const { calls, host } = helperFixture();
  const result = await host.captureCoverImage(cover);
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), new Uint8Array([0, 255, 128, 2]));
  assert.equal(result.url, cover);
  assert.deepEqual(calls.map(call => call.cmd ?? call.path), ['sessions.create', '/webview/image-response', 'sessions.destroy']);
  assert.equal(new Set(calls.map(call => call.session)).size, 1); await host.close();
  for (const malformed of [{ url: cover + '?changed' }, { status: 403 }, { decoded: false }, { contentType: 'text/html' }, { body: '!!!!' }, { body: '' }, { headers: { 'set-cookie': 'secret' } }]) {
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


test('only decoded exact browser captures carry octet-stream proof after full source reauthorization', async () => {
  const body = 'iVBORw0KGgoAAAANSUhEUgAAAAMAAAAECAIAAADETxJQAAAAF0lEQVR4nGO0yWtiYGBgYGBgYoABbCwALQoBNAc+s50AAAAASUVORK5CYII=';
  const { host } = helperFixture({ contentType: 'application/octet-stream', body });
  const fixture = sourceFixture({ fetchImpl: async () => challenge() });
  const result = await fetchTestImage(fixture.source, cover, { origin: 'cover', captureCoverImage: host.captureCoverImage });
  assert.equal(result.headers.get('content-type'), 'application/octet-stream');
  assert.deepEqual(resolvedBrowserImageProof(result), { url: cover, contentType: 'application/octet-stream', format: 'PNG', width: 3, height: 4 });
  assert.equal(Buffer.from(await result.arrayBuffer()).toString('base64'), body); await host.close();
  const nativeFixture = sourceFixture({ fetchImpl: async () => coverResponse(200, { 'content-type': 'application/octet-stream' }, Buffer.from(body, 'base64')) });
  const native = await fetchTestImage(nativeFixture.source, cover, { origin: 'cover' });
  assert.equal(resolvedBrowserImageProof(native), undefined);
  const forged = await fetchTestImage(fixture.source, cover, { origin: 'cover', captureCoverImage: async () => coverResponse(200, { 'content-type': 'application/octet-stream' }, Buffer.from(body, 'base64')) });
  assert.equal(resolvedBrowserImageProof(forged), undefined);
  for (const change of [{ body: Buffer.from('<html>denied</html>').toString('base64') }, { body: Buffer.from(body, 'base64').subarray(0, -2).toString('base64') }, { decoded: false }, { contentType: 'binary/octet-stream' }]) {
    const { host } = helperFixture({ contentType: 'application/octet-stream', body, ...change });
    await assert.rejects(host.captureCoverImage(cover)); await host.close();
  }
});
