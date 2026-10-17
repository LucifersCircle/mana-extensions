// Temporary focused evidence only. This is NOT the seven-source release gate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createManaRuntime } from './mana-runtime.mjs';
import { createManaTestWebView, safeWebViewDiagnostic } from './mana-test-webview.mjs';
import { fetchTestImage, resolvedBrowserImageProof } from './mana-test-images.mjs';
import { verifyRasterImageBytes } from './mana-test-image-bytes.mjs';
import { testMarumaru } from './marumaru-live-tests.mjs';

let html, passed = 0, failed = 0;
const host = createManaTestWebView({ onDocument: result => {
  if (result.url === 'https://marumaru105.com/manhwa/17155') html = result.html;
} });
const diagnostic = error => {
  try {
    const value = Object.getOwnPropertyDescriptor(error ?? {}, 'liveTestDiagnostic')?.value;
    if (value) console.log(`CAPTURE_DIAGNOSTIC ${JSON.stringify(safeWebViewDiagnostic(value))}`);
  } catch { /* Never echo arbitrary error text, headers or HTML. */ }
};
const check = async (name, fn) => {
  try { await fn(); passed++; console.log(`DIAGNOSTIC_CHECK ${JSON.stringify({ name, outcome: 'pass' })}`); }
  catch (error) { failed++; diagnostic(error); console.log(`DIAGNOSTIC_CHECK ${JSON.stringify({ name, outcome: 'fail' })}`); }
};
try {
  const manifest = JSON.parse(readFileSync('dist/sources.json', 'utf8'));
  const context = vm.createContext(createManaRuntime({ webViewPage: host.WebViewPage,
    fetchImpl: async () => { throw new Error('Unexpected source HTTP request'); }, logger: () => {} }));
  vm.runInContext(readFileSync('dist/sources/Marumaru.mana', 'utf8'), context, { timeout: 10_000 });
  const source = host.wrapSource(new context.Target());
  await check('Built Mana bundle and source metadata', async () => {
    assert.equal(manifest.sources.find(item => item.id === 'Marumaru')?.version, '0.0.1-alpha.5');
    assert.equal(source.info.id, 'Marumaru'); assert.equal(source.info.version, '0.0.1-alpha.5');
  });
  await testMarumaru({ source, check, renderedDetail: () => html,
    searchResult: result => {
      assert(Array.isArray(result.results) && result.results.length);
      assert.equal(new Set(result.results.map(item => item.id)).size, result.results.length);
      for (const item of result.results) {
        assert(typeof item.id === 'string' && item.id.trim()); assert(typeof item.title === 'string' && item.title.trim());
        assert(['http:', 'https:'].includes(new URL(item.cover).protocol));
      }
      assert.equal(typeof result.isLastPage, 'boolean');
    },
    image: async (target, imageURL) => {
      const response = await fetchTestImage(target, imageURL, { fetchImpl: fetch, captureCoverImage: host.captureCoverImage,
        log: (transport, status) => console.log(`IMAGE_TRANSPORT ${JSON.stringify({ transport, status })}`) });
      assert(response.ok); assert.equal(response.url, response.requestedImageURL);
      const type = response.headers.get('content-type'), proof = resolvedBrowserImageProof(response);
      const binary = target.info.id === 'Marumaru' && proof?.url === response.requestedImageURL && type === 'application/octet-stream';
      assert(type?.startsWith('image/') || binary);
      if (binary) {
        const bytes = new Uint8Array(await response.arrayBuffer()), raster = verifyRasterImageBytes(bytes);
        assert.deepEqual(raster, { format: proof.format, width: proof.width, height: proof.height });
        console.log(`IMAGE_DECODED ${JSON.stringify({ ...raster, bytes: bytes.length, mime: 'application/octet-stream' })}`);
      } else {
        const reader = response.body.getReader();
        try { const { value } = await reader.read(); assert(value?.length > 0); }
        finally { void reader.cancel().catch(() => {}); }
      }
    },
  });
} catch (error) { failed++; diagnostic(error); console.log('DIAGNOSTIC_SETUP_FAILED'); }
finally {
  try { await host.close(); } catch { failed++; console.log('DIAGNOSTIC_CLEANUP_FAILED'); }
  console.log(`DIAGNOSTIC_RESULT ${JSON.stringify({ passed, failed, outcome: failed ? 'failed-not-full-suite' : 'passed-not-full-suite' })}`);
  if (failed) process.exitCode = 1;
}
