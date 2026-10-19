import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { createManaRuntime, installManaHTTP, redactText } from './mana-runtime.mjs';
import { createManaTestTransport } from './mana-test-browser.mjs';
import { createManaTestWebView } from './mana-test-webview.mjs';
import { testNativeContract, createContractTransport, cloudflareEvidence, NativeDependencyBlocked } from './native-contracts.mjs';
import { sourceContracts } from './native-contract-sources.mjs';
import { failedSources } from './test-sources.mjs';
import { readSelection } from './changed-sources.mjs';

rmSync('bundles/live-test-results.json', { force: true });
if (process.argv.length > 2) throw new Error('Use LIVE_TEST_SELECTION, not unvalidated CLI source arguments');
const names = readSelection().selectedSources, report = {};
const testTransport = createManaTestTransport(), testWebViews = createManaTestWebView(), hosts = [];
const manifest = JSON.parse(readFileSync('dist/sources.json', 'utf8'));
try {
  for (const name of names) {
    const tests = [], notApplicable = [], started = performance.now();
    const config = sourceContracts[name];
    const transport = createContractTransport(testTransport.fetch, { documentLimit: config?.documentLimit ?? 12, imageLimit: config?.imageLimit ?? 3 });
    async function check(label, fn) {
      const start = performance.now(), requestStart = transport.requests?.length ?? 0;
      try { await fn(); tests.push({ name: label, status: 'pass', duration: performance.now() - start }); console.log(`PASS ${name}: ${label}`); return 'pass'; }
      catch (error) {
        const message = redactText(error.stack ?? String(error));
        const evidence = cloudflareEvidence(error, transport.requests ?? [], requestStart);
        const blockedBy = error instanceof NativeDependencyBlocked ? error.blockedBy : undefined;
        const status = blockedBy ? 'blocked' : evidence ? 'cloudflared' : 'fail';
        tests.push({ name: label, status, duration: performance.now() - start, error: message,
          ...(evidence ? { evidence } : {}), ...(blockedBy ? { blockedBy } : {}) });
        console.error(`${status.toUpperCase()} ${name}: ${label}\n${message}`);
        return status;
      }
    }
    let suiteError;
    try {
      const entries = manifest.sources.filter(entry => entry.id === name); assert.equal(entries.length, 1, 'Source needs one built manifest entry');
      const context = vm.createContext(createManaRuntime({ fetchImpl: transport.fetch }));
      vm.runInContext(readFileSync(`dist/sources/${name}.mana`, 'utf8'), context, { timeout: 10_000 });
      const prelude = Object.getOwnPropertyDescriptor(context, '__manaSerializedFunctionPrelude')?.value;
      assert(typeof prelude === 'string' && prelude.length > 0, 'Built source lacks native serialized function helpers');
      const host = installManaHTTP(context); hosts.push(host);
      const source = host.wrapSource(testWebViews.wrapSource(new context.Target(), { serializedFunctionPrelude: prelude }));
      await testNativeContract({ name, source, manifestEntry: entries[0], check, notApplicable, transport,
        captureCoverImage: testWebViews.captureCoverImage });
    } catch (error) {
      suiteError = `Source suite aborted before completion; remaining checks were not run.\n${redactText(error.stack ?? String(error))}`;
      console.error(`FAIL ${name}: ${suiteError}`);
    } finally {
      const requests = transport.stats();
      console.log(`REQUESTS ${name}: ${JSON.stringify(requests)}`);
      report[name] = { tests, notApplicable, requests, ...(config?.budgetReason ? { budgetReason: config.budgetReason } : {}),
        summary: { total: tests.length, passed: tests.filter(test => test.status === 'pass').length, failed: tests.filter(test => test.status === 'fail').length, cloudflared: tests.filter(test => test.status === 'cloudflared').length, blocked: tests.filter(test => test.status === 'blocked').length, duration: performance.now() - started },
        ...(suiteError ? { error: suiteError } : {}) };
    }
  }
} finally {
  try { await Promise.all([testTransport.close(), testWebViews.close(), ...hosts.map(host => host.close())]); }
  catch (error) { console.error(redactText(error.message)); process.exitCode = 1; }
}
mkdirSync('bundles', { recursive: true });
writeFileSync('bundles/live-test-results.json', `${JSON.stringify(report, null, 2)}\n`);
if (failedSources(report, names).length) process.exitCode = 1;
