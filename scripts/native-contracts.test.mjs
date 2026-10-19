// Infrastructure only. No provider fixtures and no extension behavior is mocked.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createContractTransport, verifyNativeImageBody } from './native-contracts.mjs';

test('native request budget counts failures and stops before an excess transport', async () => {
  let calls = 0;
  const transport = createContractTransport(async () => { calls++; throw new Error('provider failure'); }, { documentLimit: 2 });
  await assert.rejects(transport.fetch('https://example.invalid/one'), /provider failure/);
  await assert.rejects(transport.fetch('https://example.invalid/two'), /provider failure/);
  await assert.rejects(transport.fetch('https://example.invalid/three'), /budget exceeded/);
  assert.equal(calls, 2); assert.equal(transport.stats().documents, 2); assert.equal(transport.stats().blocked, 1);
});

test('native image budget is separate and repeated requests are never cached away', async () => {
  let calls = 0;
  const transport = createContractTransport(async () => { calls++; return new Response('bytes'); }, { documentLimit: 1, imageLimit: 2 });
  const url = 'https://example.invalid/image'; transport.imageURLs.add(url);
  await transport.fetch(url); await transport.fetch(url);
  await assert.rejects(transport.fetch(url), /budget exceeded/);
  await transport.fetch('https://example.invalid/document');
  assert.equal(calls, 3); assert.equal(transport.stats().images, 2); assert.equal(transport.stats().documents, 1);
  assert.equal(transport.captures.length, 1);
});

test('native capture preserves the very response the SDK consumes without another request', async () => {
  let calls = 0;
  const transport = createContractTransport(async () => { calls++; return new Response('{"live":true}', { headers: { 'content-type': 'application/json' } }); });
  const response = await transport.fetch('https://example.invalid/document');
  assert.equal(await response.text(), transport.captures[0].text); assert.equal(calls, 1);
});

test('browser cover resolution counts against the same image budget, including failed attempts', async () => {
  const cover = 'https://example.invalid/cover', page = 'https://example.invalid/page';
  let native = 0, browser = 0;
  const transport = createContractTransport(async () => {
    native++;
    if (native === 1) throw new Error('test-only native challenge');
    return new Response('test-only image bytes');
  }, { imageLimit: 4 });
  transport.imageURLs.add(cover); transport.imageURLs.add(page);
  await assert.rejects(transport.fetch(cover), /native challenge/);
  const capture = async () => { browser++; return new Response('captured test bytes'); };
  await transport.captureImage(cover, capture);
  await transport.fetch(page); await transport.fetch(page);
  await assert.rejects(transport.captureImage(cover, capture), /budget exceeded/);
  await assert.rejects(transport.captureImage('https://example.invalid/unrequested', capture), /native image identity/);
  assert.equal(native, 3); assert.equal(browser, 1);
  assert.equal(transport.stats().images, 4); assert.equal(transport.stats().blocked, 1);
  assert.equal(transport.requests[1].transport, 'browser-cover-after-cloudflare');
  assert.equal(transport.requests[1].status, 200);

  const failed = createContractTransport(async () => new Response('unused'), { imageLimit: 1 });
  failed.imageURLs.add(cover);
  await assert.rejects(failed.captureImage(cover, async () => { throw new Error('capture failed'); }), /capture failed/);
  await assert.rejects(failed.captureImage(cover, capture), /budget exceeded/);
  assert.equal(failed.stats().images, 1);
});

test('native capture stops streaming at the host body cap and cancels oversized responses', async () => {
  let pulls = 0, cancellations = 0;
  const transport = createContractTransport(async () => new Response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancellations++; },
  })));
  await assert.rejects(transport.fetch('https://example.invalid/oversized'), /capture size budget/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancellations, 1);
  assert(pulls <= 20, 'Capture kept reading an unbounded body after the cap');
  assert.equal(transport.captures.length, 0);
  assert.equal(transport.stats().documents, 1);

  const concurrent = createContractTransport(async () => {
    let chunks = 0;
    return new Response(new ReadableStream({
      pull(controller) { if (chunks++ === 16) controller.close(); else controller.enqueue(new Uint8Array(1024 * 1024)); },
    }));
  });
  const outcomes = await Promise.allSettled(Array.from({ length: 5 }, (_, index) => concurrent.fetch(`https://example.invalid/concurrent/${index}`)));
  assert(outcomes.some(outcome => outcome.status === 'rejected' && /capture size budget/.test(outcome.reason.message)), 'Concurrent responses exceeded the aggregate capture cap');
  for (const outcome of outcomes) if (outcome.status === 'fulfilled') void outcome.value.body.cancel();
  assert(concurrent.captures.reduce((total, capture) => total + capture.text.length, 0) <= 64 * 1024 * 1024);

  const tiny = createContractTransport(async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(1)); },
  })));
  await assert.rejects(tiny.fetch('https://example.invalid/too-many-chunks'), /capture read limit/);
});


test('Genz page MIME compatibility remains structurally validated and narrowly scoped', () => {
  const webp = Buffer.from('UklGRjQAAABXRUJQVlA4ICgAAACQAQCdASoCAAMAAUAmJZACdLoAA5gA/vSIh/VcnYnxw/ubHOLZDAAA', 'base64');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGPUCKhgYGBgYmBgQFAAEdQA9rHw9mwAAAAASUVORK5CYII=', 'base64');
  const input = { sourceId: 'GenzToons', origin: 'page', url: 'https://cdn.meowing.org/uploads/test.webp', mime: 'text/plain', bytes: webp };
  assert.deepEqual(verifyNativeImageBody(input), { width: 2, height: 3, format: 'WEBP' });
  for (const patch of [
    { sourceId: 'OtherSource' }, { origin: 'cover' }, { mime: 'application/octet-stream' }, { mime: 'text/html' }, { mime: undefined }, { bytes: png },
    { url: 'https://example.invalid/uploads/test.webp' }, { url: 'http://cdn.meowing.org/uploads/test.webp' },
    { url: 'https://user@cdn.meowing.org/uploads/test.webp' }, { url: 'https://cdn.meowing.org/uploads/test.webp?q=1' },
    { url: 'https://cdn.meowing.org/uploads/test.webp#fragment' }, { url: 'https://cdn.meowing.org/uploads/../test.webp' },
    { url: 'https://cdn.meowing.org/uploads/folder/test.webp' }, { url: 'https://cdn.meowing.org/uploads/test%2ewebp' },
    { url: 'https://cdn.meowing.org/uploads/test.webp\n' }, { url: 'https://cdn.meowing.org/uploads/' + 'a'.repeat(101) },
    { bytes: Buffer.from('<html>access denied</html>') }, { bytes: Buffer.from('{"error":"denied"}') },
    { bytes: webp.subarray(0, webp.length - 1) }, { bytes: Buffer.concat([webp, Buffer.from('trailing')]) }
  ]) assert.throws(() => verifyNativeImageBody({ ...input, ...patch }));
  const badChunk = Buffer.from(webp); badChunk.writeUInt32LE(webp.length, 16);
  assert.throws(() => verifyNativeImageBody({ ...input, bytes: badChunk }));
  // Existing sources retain exactly their MIME acceptance, with the same byte verifier.
  for (const sourceId of ['Hijala', 'Kagane', 'MangaStash', 'MangaSushi', 'MangaTaro', 'ManhwaNex', 'Marumaru', 'QiScans', 'VortexScans']) {
    assert.equal(verifyNativeImageBody({ ...input, sourceId, mime: 'image/webp' }).format, 'WEBP');
    assert.throws(() => verifyNativeImageBody({ ...input, sourceId }));
    const cover = { ...input, sourceId, origin: 'cover', mime: 'application/octet-stream' };
    if (['Marumaru', 'VortexScans'].includes(sourceId)) assert.equal(verifyNativeImageBody(cover).format, 'WEBP');
    else assert.throws(() => verifyNativeImageBody(cover));
  }
});

test('Cloudflare classification requires exact current fatal SDK response evidence', async () => {
  const { cloudflareEvidence } = await import('./native-contracts.mjs');
  const url = 'https://example.invalid/private?token=not-recorded';
  const error = { name: 'CloudflareError', resolutionURL: url };
  const challenged = { url, responseURL: url, cloudflareChallenge: true, status: 403 };
  const expected = { kind: 'cloudflare-challenge', header: 'cf-mitigated', value: 'challenge' };
  assert.deepEqual(cloudflareEvidence(error, [challenged]), expected);
  assert.equal(cloudflareEvidence(new Error('ordinary assertion'), [challenged]), undefined);
  assert.equal(cloudflareEvidence(error, [challenged], 1), undefined);
  assert.equal(cloudflareEvidence(error, [{ ...challenged, responseURL: 'https://example.invalid/other' }]), undefined);
  assert.equal(cloudflareEvidence(error, [challenged, { ...challenged, status: 200, cloudflareChallenge: false }]), undefined);
  assert.equal(cloudflareEvidence({ ...error, resolutionURL: 'https://example.invalid/other' }, [challenged]), undefined);
  assert.ok(!JSON.stringify(expected).includes('token'));
});

test('native transport retains only exact challenge boolean, not benign Cloudflare headers', async () => {
  for (const [headers, expected] of [[{ 'CF-Mitigated': 'challenge' }, true], [{ 'cf-ray': 'edge' }, false], [{ 'cf-mitigated': 'guardrails' }, false], [{}, false]]) {
    const transport = createContractTransport(async () => new Response('blocked', { status: 403, headers }));
    const response = await transport.fetch('https://example.invalid/native');
    assert.equal(response.status, 403);
    assert.equal(transport.requests[0].cloudflareChallenge, expected);
    assert.equal(transport.requests[0].headers, undefined);
  }
});
