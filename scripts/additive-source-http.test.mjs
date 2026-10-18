import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticFetch } from './additive-source-http.mjs';
test('diagnostics preserve exact response, request and body without retries', async () => {
  let calls = 0; const records = [], response = new Response('hello', { status: 200, headers: { 'content-type': 'text/html', 'set-cookie': 'private=secret' } });
  const init = { headers: { authorization: 'never logged' } };
  const got = await diagnosticFetch(async (url, options) => { calls++; assert.equal(url, 'https://gourmetsupremacy.com/?s=private-query'); assert.equal(options, init); return response; }, records)('https://gourmetsupremacy.com/?s=private-query', init);
  assert.equal(got, response); assert.equal(await got.text(), 'hello'); assert.equal(calls, 1);
  assert(!JSON.stringify(records).includes('private')); assert(!JSON.stringify(records).includes('secret'));
});
test('positive Cloudflare markers distinguish ordinary denial without altering either response', async () => {
  for (const [body, headers, expected] of [
    ['challenge', { 'cf-mitigated': 'challenge' }, [true, false, false]],
    ['<script src="/cdn-cgi/challenge-platform/x"></script>', { server: 'cloudflare' }, [false, true, false]],
    ['Request forbidden by administrative rules', {}, [false, false, true]],
    ['ordinary forbidden', {}, [false, false, false]],
  ]) {
    const records = [], response = new Response(body, { status: 403, headers: { 'content-type': 'text/html', ...headers } });
    const got = await diagnosticFetch(async () => response, records)('https://gourmetsupremacy.com/project/example/');
    assert.equal(got, response); assert.equal(await got.text(), body);
    assert.deepEqual([records[0].cloudflareHeader, records[0].bodyCloudflareMarker, records[0].explicitDenialMarker], expected);
  }
});
test('body classification is bounded to 8192 bytes and emits no raw values', async () => {
  const records = [], body = 'x'.repeat(8192) + 'request forbidden by administrative rules';
  const response = new Response(body, { status: 403, headers: { 'content-type': 'text/html', 'x-sensitive': 'secret' } });
  const got = await diagnosticFetch(async () => response, records)('https://gourmetsupremacy.com/project/private/');
  assert.equal(records[0].inspectedBytes, 8192); assert.equal(records[0].explicitDenialMarker, false);
  assert.equal(await got.text(), body); assert(!JSON.stringify(records).includes('private')); assert(!JSON.stringify(records).includes('secret'));
});
test('network errors remain errors and are not retried or copied into diagnostics', async () => {
  const records = [], error = new Error('secret message'); let calls = 0;
  await assert.rejects(diagnosticFetch(async () => { calls++; throw error; }, records)('https://gourmetsupremacy.com/'), value => value === error);
  assert.equal(calls, 1); assert(!JSON.stringify(records).includes('secret')); assert.equal(records[0].status, null);
});
