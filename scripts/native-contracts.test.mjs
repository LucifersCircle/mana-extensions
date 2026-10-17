// Infrastructure only. No provider fixtures and no extension behavior is mocked.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createContractTransport } from './native-contracts.mjs';

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
