// Temporary focused evidence only. Never treat this driver as the full release gate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createManaRuntime } from './mana-runtime.mjs';
import { createManaTestWebView, safeWebViewDiagnostic } from './mana-test-webview.mjs';
import { fetchTestImage } from './mana-test-images.mjs';

const url = 'https://peer.storagewebtoon.store/manhwa/17155/ldf6e26x93.xyz';
const host = createManaTestWebView();
let stage = 'built-source', nativeCalls = 0, captures = 0;
try {
  const manifest = JSON.parse(readFileSync('dist/sources.json', 'utf8'));
  assert.equal(manifest.sources.find(item => item.id === 'Marumaru')?.version, '0.0.1-alpha.4');
  const context = vm.createContext(createManaRuntime({ webViewPage: host.WebViewPage,
    fetchImpl: async () => { throw new Error('Unexpected source HTTP request'); }, logger: () => {} }));
  vm.runInContext(readFileSync('dist/sources/Marumaru.mana', 'utf8'), context, { timeout: 10_000 });
  const source = host.wrapSource(new context.Target());
  assert.equal(source.info.id, 'Marumaru'); assert.equal(source.info.version, '0.0.1-alpha.4');
  stage = 'rendered-source';
  const detail = await source.getContent('17155', { allowedContentRatings: [0, 1, 2, 3] });
  assert.equal(detail.title, '라멘 아카네코'); assert.equal(detail.cover, url);
  stage = 'issued-cover';
  const response = await fetchTestImage(source, detail.cover, {
    fetchImpl: async (target, init) => {
      assert.equal(++nativeCalls, 1); assert.equal(target, url);
      assert.deepEqual(Object.keys(init.headers), ['Referer']);
      assert.equal(init.headers.Referer, 'https://marumaru105.com/');
      return fetch(target, init);
    },
    captureCoverImage: async target => {
      assert.equal(++captures, 1); assert.equal(target, url); stage = 'browser-context';
      return host.captureCoverImage(target);
    },
    log: (transport, status) => console.log(`COVER_TRANSPORT ${JSON.stringify({ transport, status })}`),
  });
  assert(response.ok); assert.equal(response.url, url);
  assert(response.headers.get('content-type')?.startsWith('image/'));
  const reader = response.body.getReader();
  try { const { value } = await reader.read(); assert(value?.length > 0); }
  finally { void reader.cancel().catch(() => {}); }
  console.log(`DIAGNOSTIC_RESULT ${JSON.stringify({ outcome: 'cover-bytes-passed-not-full-suite', nativeCalls, captures })}`);
} catch (error) {
  // Match only the host's fixed enum diagnostic envelope, never arbitrary errors.
  const match = /^Live-test WebView operation failed \(([a-z-]+): ([a-z-]+)(?:; stage: ([a-z-]+))?\); no upstream details are logged$/.exec(error?.message ?? '');
  if (match) console.log(`CAPTURE_DIAGNOSTIC ${JSON.stringify(safeWebViewDiagnostic({ phase: match[1], reason: match[2], stage: match[3] }))}`);
  console.log(`DIAGNOSTIC_RESULT ${JSON.stringify({ stage, outcome: 'failed-not-full-suite', nativeCalls, captures })}`);
  process.exitCode = 1;
} finally {
  try { await host.close(); }
  catch { console.log('DIAGNOSTIC_RESULT {"stage":"cleanup","outcome":"failed-not-full-suite"}'); process.exitCode = 1; }
}
