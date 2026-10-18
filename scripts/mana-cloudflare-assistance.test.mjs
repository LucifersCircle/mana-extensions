// Infrastructure proof through the actual pinned native SDK and HTTP host.
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createManaRuntime, installManaHTTP } from './mana-runtime.mjs';
import { createManaTestTransport } from './mana-test-browser.mjs';

test('native SDK interceptors still authorize first and consume exact assisted bytes/status/headers', async () => {
  const target = 'https://marumaru105.com/api/works/17155', sent = [];
  const bytes = Buffer.from([255, 0, 128, 42]);
  const transport = createManaTestTransport({ solverURL: 'http://127.0.0.1:8191', fetchImpl: async (url, init) => {
    sent.push({ url, init });
    if (url === target) return new Response('<title>Just a moment...</title>', { status: 403, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' } });
    const payload = JSON.parse(init.body);
    if (String(url).endsWith('/v1')) {
      assert(['sessions.create', 'sessions.destroy'].includes(payload.cmd)); return Response.json({ status: 'ok' });
    }
    assert.equal(url, 'http://127.0.0.1:8191/browser/assist');
    assert.equal(payload.headers['x-site'], 'marumaru'); assert.equal(payload.headers.accept, 'application/json');
    assert.equal(payload.headers['user-agent'], undefined); assert.equal(payload.url, target);
    return Response.json({ url: target, status: 202, headers: { 'content-type': 'application/octet-stream', 'x-proof': 'actual' },
      encoding: 'base64', body: bytes.toString('base64'), byteLength: bytes.length, metrics: { navigationAttempts: 1, replayAttempts: 1 } });
  } });
  const context = vm.createContext(createManaRuntime({ fetchImpl: transport.fetch, logger: () => {} }));
  const host = installManaHTTP(context);
  try {
    const result = await host.runOperation(() => vm.runInContext(`
      new ManaHTTP.HttpClient().addRequestInterceptor(request => {
        request.headers.set('X-Site', 'marumaru'); request.headers.set('Accept', 'application/json');
        request.headers.set('User-Agent', 'native-sdk-test'); return request;
      }).addResponseInterceptor(response => {
        if (response.status !== 202 || response.headers.get('x-proof') !== 'actual') throw new Error('response changed');
        return response;
      }).get('${target}').then(async response => ({url: response.url, status: response.status, bytes: Array.from(await response.bytes())}))
    `, context));
    assert.equal(result.url, target); assert.equal(result.status, 202); assert.deepEqual(Array.from(result.bytes), [...bytes]);
    assert.equal(sent.filter(item => item.url === target).length, 1);
    assert.equal(sent[0].init.headers['user-agent'], 'native-sdk-test', 'Native request must retain source UA');
    assert.equal(transport.stats('Marumaru').successfulReplays, 1);
    const count = sent.length;
    await assert.rejects(host.runOperation(() => vm.runInContext(`new ManaHTTP.HttpClient().addRequestInterceptor(() => { throw new Error('source ownership denied'); }).get('${target}')`, context)), /source ownership denied/);
    assert.equal(sent.length, count, 'A denied native interceptor must not reach direct or assisted transport');
  } finally { await host.close(); await transport.close(); }
});
