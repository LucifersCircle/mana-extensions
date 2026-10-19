import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { projectRepositoryListing, writeRepositoryListing } from './repository-listing.mjs';

const owner = { name: 'Lucifers Circle', github: 'https://github.com/LucifersCircle', website: 'https://pirate.vodka' };
const entry = (id, overrides = {}) => ({
  id, version: '1.0.0', rating: 1, supportedLanguages: ['en_US'], badges: ['Manga', 'Manhwa'],
  developers: [owner, { name: 'Upstream author', github: 'https://github.com/upstream' }],
  description: 'Attribution stays here.', hash: 'unchanged', intents: 123, ...overrides,
});
const stripDisplay = manifest => ({ ...manifest, sources: manifest.sources.map(({ badges, developers, ...rest }) => rest) });

test('listing leaves the native rating badge to Mana and adds only language/maintainer display', () => {
  const manifest = { repositoryName: 'Example', sources: [
    entry('English'), entry('Korean', { supportedLanguages: ['ko_KR'] }),
    entry('Spanish', { rating: 0, supportedLanguages: ['es_ES', 'es_419'] }),
    entry('Multi', { rating: 2, supportedLanguages: ['en_US', 'es_ES'] }),
    entry('Kagane', { supportedLanguages: undefined }),
  ] };
  const original = structuredClone(manifest);
  const projected = projectRepositoryListing(manifest, manifest.sources.map(source => source.id));
  assert.deepEqual(projected.sources.map(source => source.badges), [
    ['English'], ['Korean'], ['Spanish'], ['Multi'], ['Multi'],
  ]);
  assert.deepEqual(projected.sources.map(source => source.rating), [1, 1, 0, 2, 1]);
  assert(projected.sources.every(source => source.badges.length === 1));
  assert(projected.sources.every(source => source.developers.length === 1 && source.developers[0] === owner));
  assert.deepEqual(manifest, original);
  assert.deepEqual(stripDisplay(projected), stripDisplay(original));
  assert.deepEqual(projectRepositoryListing(projected, manifest.sources.map(source => source.id)), projected);
});

test('unknown metadata, wrong owners and incomplete or duplicated inventories fail closed', () => {
  for (const source of [
    entry('Example', { rating: undefined }), entry('Example', { rating: 99 }),
    entry('Example', { supportedLanguages: [] }), entry('Example', { supportedLanguages: ['zz'] }),
    entry('Example', { supportedLanguages: ['English'] }),
    entry('Example', { developers: [{ ...owner, name: 'LucifersCircle' }] }),
    entry('Example', { developers: [{ ...owner, github: 'https://github.com/other' }] }),
    entry('Example', { developers: [owner, owner] }), entry('Example', { developers: undefined }),
  ]) assert.throws(() => projectRepositoryListing({ sources: [source] }, ['Example']));
  for (const sources of [[], [entry('Example'), entry('Example')], [entry('Other')]])
    assert.throws(() => projectRepositoryListing({ sources }, ['Example']));
});

test('disk projection only rewrites sources.json and preserves exact compiled bytes', () => {
  const output = mkdtempSync(join(tmpdir(), 'mana-listing-'));
  try {
    mkdirSync(join(output, 'sources'));
    const bytes = Buffer.from([0, 1, 255, 10]);
    writeFileSync(join(output, 'sources/NewSource.mana'), bytes);
    writeFileSync(join(output, 'sources.json'), JSON.stringify({ sources: [entry('NewSource')] }));
    const projected = writeRepositoryListing(output, ['NewSource']);
    assert.deepEqual(readFileSync(join(output, 'sources/NewSource.mana')), bytes);
    assert.deepEqual(JSON.parse(readFileSync(join(output, 'sources.json'), 'utf8')), projected);
    writeFileSync(join(output, 'sources/Unexpected.mana'), 'extra');
    assert.throws(() => writeRepositoryListing(output, ['NewSource']), /Bundle inventory/);
  } finally { rmSync(output, { recursive: true, force: true }); }
});

test('publish and PR workflows validate projected metadata after native bundle checks', () => {
  for (const file of ['main.yml', 'live-tests.yaml']) {
    const workflow = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
    assert.match(workflow, /npm run build -- --output dist\n          npm run verify:bundles\n          node scripts\/repository-listing.mjs dist/);
  }
});
