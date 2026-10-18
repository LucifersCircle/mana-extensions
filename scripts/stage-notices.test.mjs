import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { stageNotices } from './stage-notices.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFileSync(join(root, path));
const json = path => JSON.parse(read(path));
const hashes = json('licenses/SHA256SUMS.json');

test('retained notice files match pinned SHA-256 content', () => {
  const actual = readdirSync(join(root, 'licenses'), { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath ?? entry.path, entry.name).slice(join(root, 'licenses').length + 1))
    .filter(path => path !== 'SHA256SUMS.json').sort();
  assert.deepEqual(actual, Object.keys(hashes).sort());
  for (const [path, hash] of Object.entries(hashes)) {
    assert.equal(createHash('sha256').update(read(`licenses/${path}`)).digest('hex'), hash, path);
  }
});

test('all locked application dependencies have exact provenance and full notices', () => {
  const lock = json('package-lock.json');
  const entries = json('licenses/bundled-dependencies/INDEX.json');
  const byPath = new Map(entries.map(entry => [entry.packagePath, entry]));
  const visited = new Set();
  const visit = path => {
    if (visited.has(path)) return;
    visited.add(path);
    const pkg = lock.packages[path];
    const notice = byPath.get(path);
    assert(notice, `Missing notices for ${path}`);
    for (const key of ['version', 'resolved', 'integrity']) assert.equal(notice[key], pkg[key], `${path}: ${key}`);
    const folder = `licenses/bundled-dependencies/${notice.name.replace('/', '__')}@${notice.version}`;
    const metadata = json(`${folder}/package-metadata.json`);
    assert.equal(metadata.name, notice.name);
    assert.equal(metadata.version, notice.version);
    assert.equal(metadata.license, notice.license);
    assert(notice.notices.length || notice.upstreamNotice, `Missing full license for ${path}`);
    for (const [name, hash] of Object.entries(notice.sha256)) {
      assert.equal(createHash('sha256').update(read(`${folder}/${name}`)).digest('hex'), hash);
    }
    for (const name of notice.notices) assert(name in notice.sha256);
    if (notice.upstreamNotice) assert(read(`licenses/bundled-dependencies/${notice.upstreamNotice}`).length > 500);
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      let parent = path;
      while (!lock.packages[`${parent}/node_modules/${name}`] && parent !== '.') parent = dirname(parent);
      const resolved = parent === '.' ? `node_modules/${name}` : `${parent}/node_modules/${name}`;
      assert(lock.packages[resolved], `Unresolved dependency ${name}`);
      visit(resolved);
    }
  };
  for (const name of Object.keys(lock.packages[''].dependencies)) visit(`node_modules/${name}`);
  assert.deepEqual([...visited].sort(), [...byPath.keys()].sort(), 'Notice inventory must match locked application closure');
});

test('publication staging is additive and preserves bundle and manifest bytes', () => {
  const output = mkdtempSync(join(tmpdir(), 'mana-notices-'));
  try {
    const sentinels = { 'sample.mana': Buffer.from([0, 255, 13, 10, 42]), 'sources.json': Buffer.from('{"sources":[]}\n') };
    for (const [name, bytes] of Object.entries(sentinels)) writeFileSync(join(output, name), bytes);
    stageNotices(output);
    stageNotices(output);
    for (const [name, bytes] of Object.entries(sentinels)) assert.deepEqual(readFileSync(join(output, name)), bytes);
    for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) assert.deepEqual(readFileSync(join(output, name)), read(name));
    for (const name of [...Object.keys(hashes), 'SHA256SUMS.json']) {
      assert.deepEqual(readFileSync(join(output, 'licenses', name)), read(`licenses/${name}`));
    }
  } finally { rmSync(output, { recursive: true, force: true }); }
});
