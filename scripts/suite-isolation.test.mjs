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
        'changed-sources.mjs', 'source-dependencies.mjs', 'mana-runtime.mjs', 'mana-test-webview.mjs', 'mana-test-images.mjs']) {
        mkdirSync(join(dir, 'scripts'), { recursive: true });
        copyFileSync(join(scripts, file), join(dir, 'scripts', file));
      }
      symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(dir, 'node_modules'));
      put('scripts/mana-test-browser.mjs', `export function createManaTestTransport() {
        return { fetch() { throw new Error('Unexpected network access'); }, close: async () => {} };
      }`);
      for (const name of names) {
        put(`src/sources/${name}/index.ts`, '');
        put(`dist/sources/${name}.mana`, `globalThis.Target = class {
          info = { id: ${JSON.stringify(name)}, version: 'test', website: 'https://example.invalid' };
          async search() { throw new Error('Invalid Mana content-rating policy'); }
          async getContent() { throw new Error('Invalid Mana content-rating policy'); }
          async getSectionsForPage() { throw new Error('Invalid Mana content-rating policy'); }
          async resolvePageSection() { throw new Error('Invalid Mana content-rating policy'); }
        };`);
        if (name === 'VortexScans') continue;
        const body = name === aborted ? `${partial ? `
          await check('executed pass', () => {});
          await check('executed failure', () => { throw new Error('checked failure'); });` : ''}
          throw new TypeError('uncaught suite failure');
          await check('unrun after abort', () => {});` : `await check('completed source contract', () => {});`;
        put(`scripts/${name.toLowerCase()}-live-tests.mjs`, `export async function test${name}({ check }) { ${body} }
          ${name === 'MangaSushi' ? 'export function coverDimensions() { throw new Error("No image requests in infrastructure test"); }' : ''}`);
      }
      put('scripts/vortexscans-live-tests.mjs', `
        export function getVortexContentWithSynopsis() { throw new Error('No provider content in infrastructure test'); }
        export async function testVortexSynopsis({ check }) { await check('later synopsis contract', () => {}); }
        export async function testVortexRatings({ check }) { await check('later ratings contract', () => {}); }
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
        { name: 'Built Mana bundle and source metadata', status: 'pass' },
        { name: 'Malformed native rating contexts fail closed before provider I/O', status: 'pass' },
        ...(partial ? [{ name: 'executed pass', status: 'pass' }, { name: 'executed failure', status: 'fail' }] : []),
      ]);
      assert.equal(report[aborted].summary.total, partial ? 4 : 2);
      assert.equal(report[aborted].summary.passed, partial ? 3 : 2);
      assert.equal(report[aborted].summary.failed, partial ? 1 : 0);
      assert.equal(report.Hijala.summary.passed, 3, 'earlier completed source must survive');
      assert.equal(report.VortexScans.error, undefined, 'later source must reach its own completion');
      assert.equal(report.VortexScans.tests.at(-1).name, 'later ratings contract');
      assert.equal(report.VortexScans.summary.total, 19);
      assert.equal(report.VortexScans.summary.failed, 15);
      assert.deepEqual(failedSources(report, names), [aborted, 'VortexScans']);
      assert.equal(invoke('test-status.mjs', 'capture').status, 1);
      const snapshot = json('bundles/live-status/snapshot.json');
      assert.equal(snapshot.sources[aborted].status, 'error');
      assert.equal(snapshot.sources[aborted].total, partial ? 4 : 2);
      assert.equal(snapshot.sources[aborted].failed, partial ? 1 : 0);
      assert.equal(snapshot.sources.Hijala.status, 'pass');
      assert.equal(snapshot.sources.VortexScans.status, 'fail');
      assert.deepEqual(snapshot.sourceCounts, { available: names.length, selected: names.length,
        completed: names.length - 1, passed: names.length * 3 + (partial ? 1 : 0), failed: partial ? 16 : 15, total: names.length * 3 + (partial ? 17 : 15) });
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
