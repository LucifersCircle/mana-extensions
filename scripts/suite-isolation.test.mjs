import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { allSelection } from './changed-sources.mjs';
import { discoverSources, failedSources, reportIssues } from './test-sources.mjs';

const names = discoverSources(), sha = 'a'.repeat(40);
const scripts = fileURLToPath(new URL('.', import.meta.url));

for (const [aborted, partial] of [['Kagane', false], ['ManhwaNex', true]]) {
  void test(`uncaught ${aborted} suite abort preserves executed checks, continues and fails closed`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'mana-suite-isolation-'));
    const put = (path, value) => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), value);
    };
    const json = (path) => JSON.parse(readFileSync(join(dir, path), 'utf8'));
    try {
      // Exercise the real dispatcher and reporter with no provider content or network access.
      for (const file of ['live-tests.mjs', 'test-status.mjs', 'test-sources.mjs',
        'changed-sources.mjs', 'source-dependencies.mjs', 'mana-runtime.mjs', 'mana-http-host.mjs', 'mana-test-webview.mjs', 'mana-test-images.mjs', 'mana-test-image-bytes.mjs', 'native-contract-sources.mjs']) {
        mkdirSync(join(dir, 'scripts'), { recursive: true });
        copyFileSync(join(scripts, file), join(dir, 'scripts', file));
      }
      symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(dir, 'node_modules'));
      put('scripts/mana-test-browser.mjs', `export function createManaTestTransport() {
        return { fetch() { throw new Error('Unexpected network access'); }, stats: () => ({ assistanceAttempts: 0 }), close: async () => {} };
      }`);
      for (const name of names) {
        put(`src/sources/${name}/index.ts`, '');
        put(`dist/sources/${name}.mana`, `globalThis.__manaSerializedFunctionPrelude = '/* infrastructure-only callback prelude */';
        globalThis.Target = class {
          info = { id: ${JSON.stringify(name)}, version: 'test', website: 'https://example.invalid' };
          async search() { throw new Error('Invalid Mana content-rating policy'); }
          async getContent() { throw new Error('Invalid Mana content-rating policy'); }
          async getSectionsForPage() { throw new Error('Invalid Mana content-rating policy'); }
          async resolvePageSection() { throw new Error('Invalid Mana content-rating policy'); }
        };`);
      }
      put('scripts/native-contracts.mjs', `
        export function createContractTransport() { return { stats: () => ({ documents: 0, images: 0 }) }; }
        export async function testNativeContract({ name, check, notApplicable }) {
          await check('Native initialization and advertised capabilities', () => {});
          notApplicable.push({ capability: 'optional control', reason: 'Not advertised' });
          if (name === ${JSON.stringify(aborted)}) {
            ${partial ? "await check('executed pass', () => {}); await check('executed failure', () => { throw new Error('checked failure'); });" : ''}
            throw new TypeError('uncaught suite failure');
          }
          await check('completed source contract', () => {});
        }
      `);
      put('dist/sources.json', JSON.stringify({ sources: names.map((id) => ({ id, version: 'test' })) }));
      const selection = allSelection(names, 'Infrastructure test', { testedSha: sha });
      put('bundles/live-status/selection.json', JSON.stringify(selection));
      put('bundles/live-test-results.json', JSON.stringify({ stale: true }));
      const env = { ...process.env, LIVE_TEST_SELECTION: join(dir, 'bundles/live-status/selection.json'),
        GITHUB_SHA: sha, TESTED_SHA: sha, TEST_OUTCOME: 'failure', GITHUB_STEP_SUMMARY: join(dir, 'summary.md') };
      const invoke = (file, ...args) => spawnSync(process.execPath, [join(dir, 'scripts', file), ...args],
        { cwd: dir, env, encoding: 'utf8', timeout: 10_000 });
      const run = invoke('live-tests.mjs');
      assert.equal(run.status, 1, run.stderr);
      assert.match(run.stderr, /Source suite aborted before completion; remaining checks were not run/);
      const report = json('bundles/live-test-results.json');
      assert.deepEqual(Object.keys(report), names);
      assert.match(report[aborted].error, /TypeError: uncaught suite failure/);
      assert.match(reportIssues(report, names)[aborted], /remaining checks were not run/);
      assert.deepEqual(report[aborted].tests.map(({ name, status }) => ({ name, status })), [
        { name: 'Native initialization and advertised capabilities', status: 'pass' },
        ...(partial ? [{ name: 'executed pass', status: 'pass' }, { name: 'executed failure', status: 'fail' }] : []),
      ]);
      assert.equal(report[aborted].summary.total, partial ? 3 : 1);
      assert.equal(report[aborted].summary.passed, partial ? 2 : 1);
      assert.equal(report[aborted].summary.failed, partial ? 1 : 0);
      assert.equal(report.Hijala.summary.passed, 2, 'earlier completed source must survive');
      assert.equal(report.VortexScans.error, undefined, 'later source must reach its own completion');
      assert.equal(report.VortexScans.tests.at(-1).name, 'completed source contract');
      assert.equal(report.VortexScans.summary.total, 2);
      assert.equal(report.VortexScans.summary.failed, 0);
      assert.deepEqual(failedSources(report, names), [aborted]);
      assert.equal(invoke('test-status.mjs', 'capture').status, 1);
      const snapshot = json('bundles/live-status/snapshot.json');
      assert.equal(snapshot.sources[aborted].status, 'error');
      assert.equal(snapshot.sources[aborted].total, partial ? 3 : 1);
      assert.equal(snapshot.sources[aborted].failed, partial ? 1 : 0);
      assert.equal(snapshot.sources.Hijala.status, 'pass');
      assert.equal(snapshot.sources.VortexScans.status, 'pass');
      assert.deepEqual(snapshot.sourceCounts, { available: names.length, selected: names.length,
        completed: names.length - 1, passed: (names.length - 1) * 2 + (partial ? 2 : 1), failed: partial ? 1 : 0, total: (names.length - 1) * 2 + (partial ? 3 : 1) });
      assert.match(readFileSync(join(dir, 'summary.md'), 'utf8'), /remaining checks were not run/);
      assert.ok(!snapshot.sources[aborted].tests.some(({ name }) => name === 'unrun after abort'));
      // A changed-source run remains non-publishable even when it reports its abort truthfully.
      const selected = [aborted, 'VortexScans'].sort();
      put('bundles/live-status/selection.json', JSON.stringify({ ...selection, mode: 'changed',
        eventName: 'pull_request', baseSha: 'b'.repeat(40), headSha: 'c'.repeat(40), mergeBase: 'd'.repeat(40),
        selectedSources: selected, selectedCount: selected.length,
        decisions: selected.map((source) => ({ status: 'M', path: `src/sources/${source}/index.ts`, scope: 'source', source })) }));
      put('bundles/live-test-results.json', JSON.stringify(Object.fromEntries(selected.map((name) => [name, report[name]]))));
      assert.equal(invoke('test-status.mjs', 'capture').status, 1);
      assert.equal(json('bundles/live-status/snapshot.json').sourceCounts.completed, 1);
      const readme = '<!-- LIVE_TEST_STATUS:START -->\nold\n<!-- LIVE_TEST_STATUS:END -->\n';
      put('README.md', readme);
      const publish = invoke('test-status.mjs', 'publish');
      assert.equal(publish.status, 1);
      assert.match(publish.stderr, /Partial or unverified live results cannot be published/);
      assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), readme);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
