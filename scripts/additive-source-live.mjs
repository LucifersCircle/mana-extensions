// Separate partial evidence: never a full-suite snapshot or README/history input.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { createManaRuntime, installManaHTTP, redactText } from './mana-runtime.mjs';
import { testNativeContract, createContractTransport } from './native-contracts.mjs';
import { sourceContracts } from './native-contract-sources.mjs';
import { discoverSources } from './test-sources.mjs';
import { diagnosticFetch } from './additive-source-http.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const proof = JSON.parse(readFileSync('bundles/live-status/additive-proof.json'));
assert.equal(proof.schemaVersion, 1);
assert.equal(process.env.GITHUB_EVENT_NAME, 'pull_request');
const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH));
assert.equal(proof.baseSha, event.pull_request.base.sha);
assert.equal(proof.headSha, event.pull_request.head.sha);
assert.equal(hash(readFileSync('dist/sources.json')), proof.manifestSha256);
assert.equal(proof.scope, 'approved-new-source-only');
assert.equal(proof.testedSha, process.env.GITHUB_SHA);
assert.equal(proof.testedSha, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());
assert.deepEqual(proof.discoveredSources, discoverSources());
assert(proof.selectedSources.length && proof.selectedSources.every(name => ['GourmetScans', 'GenzToons'].includes(name)));
assert.deepEqual([...proof.selectedSources, ...proof.notSelectedSources].sort(), proof.discoveredSources);
for (const name of proof.discoveredSources) assert.equal(hash(readFileSync(`dist/sources/${name}.mana`)), proof.selectedBundleSha256[name] ?? proof.existingBundleSha256[name], 'Built bundle changed after proof');
const manifest = JSON.parse(readFileSync('dist/sources.json'));
const results = { ...proof, completedAt: null, sources: {} };
let failed = false;
for (const name of proof.selectedSources) {
  const tests = [], notApplicable = [], httpDiagnostics = [], config = sourceContracts[name];
  assert(config, 'Missing native contract');
  const transport = createContractTransport(diagnosticFetch(fetch, httpDiagnostics), { documentLimit: config.documentLimit ?? 12, imageLimit: config.imageLimit ?? 3 });
  let host;
  const expectedChecks = [], expectedNotApplicable = [];
  // Discover labels from the unchanged native contract without invoking a single
  // capability callback. Any eager source/transport use fails closed here.
  const noIO = new Proxy({}, { get() { throw new Error('Capability discovery attempted eager source/transport use'); } });
  await testNativeContract({ name, source: noIO, manifestEntry: noIO, transport: noIO,
    notApplicable: expectedNotApplicable, async check(label) { expectedChecks.push(label); } });
  assert(expectedChecks.length > 0 && new Set(expectedChecks).size === expectedChecks.length);

  try {
    const context = vm.createContext(createManaRuntime({ fetchImpl: transport.fetch }));
    vm.runInContext(readFileSync(`dist/sources/${name}.mana`, 'utf8'), context, { timeout: 10000 });
    assert(context.__manaSerializedFunctionPrelude, 'Missing native serialization helpers');
    host = installManaHTTP(context);
    const entries = manifest.sources.filter(entry => entry.id === name); assert.equal(entries.length, 1);
    await testNativeContract({ name, source: host.wrapSource(new context.Target()), manifestEntry: entries[0], transport, notApplicable, async check(label, fn) {
      try { await fn(); tests.push({ name: label, status: 'pass' }); console.log(`PASS ${name}: ${label}`); }
      catch (error) { failed = true; const message = redactText(error.stack ?? String(error)); tests.push({ name: label, status: 'fail', error: message }); console.error(`FAIL ${name}: ${label}\n${message}`); }
    } });
    assert.deepEqual(tests.map(test => test.name), expectedChecks, 'Incomplete/duplicate native capability set');
    for (const entry of expectedNotApplicable) assert(notApplicable.some(actual => actual.capability === entry.capability && actual.reason === entry.reason), 'Missing native not-applicable disclosure');
    results.sources[name] = { tests, notApplicable, httpDiagnostics, requests: transport.stats() };
  } catch (error) {
    failed = true; results.sources[name] = { tests, notApplicable, httpDiagnostics, requests: transport.stats(), error: redactText(error.stack ?? String(error)), remainingChecks: 'not run' };
  } finally { if (host) await host.close(); }
}
results.completedAt = new Date().toISOString();
writeFileSync('bundles/live-status/additive-results.json', JSON.stringify(results, null, 2));
console.log(`NOT SELECTED (not passed): ${proof.notSelectedSources.join(', ')}`);
if (failed) process.exitCode = 1;
