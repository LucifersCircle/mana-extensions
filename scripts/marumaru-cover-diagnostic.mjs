// Temporary diagnostic only, not full-suite validation. Do not merge this driver.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createManaRuntime } from './mana-runtime.mjs';
import { createManaTestWebView } from './mana-test-webview.mjs';
import { imageFailureDiagnostic } from './image-failure-diagnostic.mjs';

const EXPECTED_URL = 'https://peer.storagewebtoon.store/manhwa/17155/ldf6e26x93.xyz';
const EXPECTED_REFERER = 'https://marumaru105.com/';

export async function inspectNativeCover(request, fetchImpl = globalThis.fetch, emit = console.log) {
  // Stop before I/O if the real source contract differs from the failed CI request.
  assert(request && typeof request === 'object');
  assert.deepEqual(Object.keys(request).sort(), ['headers', 'url']);
  assert.equal(request.url, EXPECTED_URL);
  assert(request.headers && typeof request.headers === 'object');
  assert.deepEqual(Object.keys(request.headers), ['Referer']);
  assert.equal(request.headers.Referer, EXPECTED_REFERER);
  const response = await fetchImpl(request.url, { headers: request.headers, signal: AbortSignal.timeout(30_000) });
  const diagnostic = response.ok ? { contentType: response.headers.get('content-type')?.startsWith('image/') ? 'image' : 'other', sameURL: response.url === request.url }
    : await imageFailureDiagnostic(response, request.url);
  emit(`NATIVE_COVER_DIAGNOSTIC ${JSON.stringify({ status: response.status, ...diagnostic })}`);
  // Preserve the production live suite's real native-image requirements.
  assert(response.ok, 'Native cover HTTP failure');
  assert(response.headers.get('content-type')?.startsWith('image/'), 'Response is not an image');
  const reader = response.body.getReader();
  try { const { value } = await reader.read(); assert(value?.length > 0, 'Image has no bytes'); }
  finally { await reader.cancel(); }
}

async function main() {
  const host = createManaTestWebView();
  let stage = 'built-source';
  try {
    const manifest = JSON.parse(readFileSync('dist/sources.json', 'utf8'));
    assert.equal(manifest.sources.find(item => item.id === 'Marumaru')?.version, '0.0.1-alpha.3');
    const context = vm.createContext(createManaRuntime({ webViewPage: host.WebViewPage,
      fetchImpl: async () => { throw new Error('Unexpected source HTTP request'); }, logger: () => {} }));
    vm.runInContext(readFileSync('dist/sources/Marumaru.mana', 'utf8'), context, { timeout: 10_000 });
    const source = host.wrapSource(new context.Target());
    assert.equal(source.info.id, 'Marumaru'); assert.equal(source.info.version, '0.0.1-alpha.3');
    stage = 'rendered-source';
    const detail = await source.getContent('17155', { allowedContentRatings: [0, 1, 2, 3] });
    assert.equal(detail.cover, EXPECTED_URL);
    stage = 'issued-image-contract';
    const request = await source.willRequestImage(detail.cover);
    stage = 'native-cover';
    await inspectNativeCover(request);
    console.log('DIAGNOSTIC_RESULT {"outcome":"one-request-passed-not-full-suite"}');
  } catch {
    // Never echo an exception containing a browser response, URL query or credentials.
    console.log(`DIAGNOSTIC_RESULT ${JSON.stringify({ stage, outcome: 'failed-not-full-suite' })}`);
    process.exitCode = 1;
  } finally {
    try { await host.close(); }
    catch { console.log('DIAGNOSTIC_RESULT {"stage":"cleanup","outcome":"failed-not-full-suite"}'); process.exitCode = 1; }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
