import assert from 'node:assert/strict';
import test from 'node:test';
import { imageFailureDiagnostic } from './image-failure-diagnostic.mjs';

const url = 'https://images.example.invalid/cover';
const response = (body, headers = {}) => {
  const value = new Response(body, { status: 403, headers });
  Object.defineProperty(value, 'url', { value: url });
  return value;
};

test('image failure diagnostic emits only fixed markers, never body/header secrets', async () => {
  const secret = 'private-cookie-value';
  for (const [body, headers, marker] of [
    ['<title>Access Denied</title>' + secret, { 'set-cookie': secret, 'content-type': 'text/html; charset=utf-8' }, 'access-denial-marker'],
    ['<title>403 Forbidden</title>' + secret, {}, 'access-denial-marker'],
    ['<title>Just a moment</title>' + secret, {}, 'managed-challenge-marker'],
    [secret, { 'cf-mitigated': 'challenge' }, 'managed-challenge-marker'],
    ['<div class="hcaptcha">' + secret, {}, 'captcha-marker'],
    [secret, { 'content-type': 'secret/' + secret }, 'unclassified'],
  ]) {
    const result = await imageFailureDiagnostic(response(body, headers), url);
    assert.equal(result.marker, marker); assert.equal(result.scan, 'complete');
    assert.equal(result.sameURL, true);
    assert(!JSON.stringify(result).includes(secret));
    assert.deepEqual(Object.keys(result), ['contentType', 'sameURL', 'challengeHeader', 'marker', 'scan']);
  }
});

test('diagnostic bounds scanned bytes and cancels unread response data', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(16 * 1024) + 'Access Denied')); }, cancel() { cancelled = true; } });
  const result = await imageFailureDiagnostic(response(stream), url);
  assert.equal(result.scan, 'byte-limit'); assert.equal(result.marker, 'unclassified');
  assert.equal(cancelled, true);
});

test('diagnostic deadline bounds a stalled body and cancellation', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}); } });
  const started = performance.now(), result = await imageFailureDiagnostic(response(stream), url);
  assert.equal(result.scan, 'time-limit'); assert.equal(cancelled, true);
  assert(performance.now() - started < 3000);
});

test('diagnostic does not inspect successful image bytes or expose redirect targets', async () => {
  const success = new Response('image-data', { status: 200 });
  Object.defineProperty(success, 'url', { value: url + '?private=secret' });
  const result = await imageFailureDiagnostic(success, url);
  assert.equal(result.sameURL, false); assert.equal(success.bodyUsed, false);
  assert.equal(await success.text(), 'image-data');
  assert(!JSON.stringify(result).includes('private'));
});


test('diagnostic read count bounds CPU and memory for rapidly resolving empty chunks', async () => {
  let cancelled = false;
  const reader = { read: async () => ({ done: false, value: new Uint8Array() }), cancel: async () => { cancelled = true; }, releaseLock() {} };
  const start = performance.now();
  const result = await imageFailureDiagnostic({ ok: false, url, headers: new Headers(), body: { getReader: () => reader } }, url);
  assert.equal(result.scan, 'read-limit'); assert.equal(cancelled, true);
  assert(performance.now() - start < 500);
});
