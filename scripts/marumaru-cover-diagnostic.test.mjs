import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectNativeCover } from './marumaru-cover-diagnostic.mjs';
const url = 'https://peer.storagewebtoon.store/manhwa/17155/ldf6e26x93.xyz';
const headers = { Referer: 'https://marumaru105.com/' };

test('temporary driver rejects any changed native cover contract before I/O', async () => {
  let count = 0;
  const fetch = async () => { count++; throw new Error('Unexpected fetch'); };
  for (const request of [{ url }, { url: url + '?changed=1', headers }, { url, headers: { referer: headers.Referer } },
    { url, headers: { ...headers, Cookie: 'secret' } }, { url, headers, method: 'GET' },
    { url, headers: { Referer: headers.Referer + 'manhwa/17155' } }]) {
    await assert.rejects(inspectNativeCover(request, fetch));
  }
  assert.equal(count, 0);
});

test('temporary driver sends one unchanged request and keeps actual403 failure', async () => {
  let count = 0; const output = [];
  await assert.rejects(inspectNativeCover({ url, headers }, async (actualURL, init) => {
    count++; assert.equal(actualURL, url); assert.deepEqual(init.headers, headers);
    assert(init.signal instanceof AbortSignal);
    const response = new Response('AccessDenied private-response-detail', { status: 403, headers: { 'content-type': 'text/plain' } });
    Object.defineProperty(response, 'url', { value: url }); return response;
  }, value => output.push(value)), /Native cover HTTP failure/);
  assert.equal(count, 1); assert.equal(output.length, 1);
  assert.match(output[0], /access-denial-marker/); assert(!output[0].includes('private-response-detail'));
});

test('temporary driver keeps success content-type and nonempty-byte requirements', async () => {
  for (const [type, body, passes] of [['text/html', 'not-image', false], ['image/png', '', false], ['image/png', 'actual-test-bytes', true]]) {
    let count = 0;
    const result = inspectNativeCover({ url, headers }, async () => { count++; return new Response(body, { headers: { 'content-type': type } }); }, () => {});
    if (passes) await result; else await assert.rejects(result);
    assert.equal(count, 1);
  }
});
