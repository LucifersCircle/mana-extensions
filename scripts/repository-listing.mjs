// Repository display only. Never change SourceInfo, compiled sources, or attribution.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverSources } from './test-sources.mjs';

const OWNER_NAME = 'Lucifers Circle';
const OWNER_GITHUB = 'https://github.com/LucifersCircle';
// CatalogRating in @mana-app/types 0.1.0. Mixed is not an Adult classification.
const RATINGS = new Map([[0, 'Safe'], [1, 'Mixed'], [2, 'Adult']]);
const languageNames = new Intl.DisplayNames(['en'], { type: 'language', fallback: 'none' });

function languageBadge(entry) {
  // Kagane omits supportedLanguages but offers 20 language choices and an all
  // languages mode in KaganeModels.ts / KaganeSearch.ts. Do not change its runtime.
  if (entry.id === 'Kagane') return 'Multi';
  assert(Array.isArray(entry.supportedLanguages) && entry.supportedLanguages.length,
    `${entry.id}: missing language metadata`);
  const languages = entry.supportedLanguages.map(code => {
    assert(typeof code === 'string' && /^[a-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(code),
      `${entry.id}: invalid language code`);
    const language = code.split(/[-_]/)[0];
    const label = languageNames.of(language);
    assert(label, `${entry.id}: unknown language code`);
    return label;
  });
  return new Set(languages).size > 1 ? 'Multi' : languages[0];
}

export function projectRepositoryListing(manifest, sources = discoverSources()) {
  assert(Array.isArray(manifest?.sources), 'Missing source manifest');
  assert.deepEqual(manifest.sources.map(entry => entry.id).sort(), [...sources].sort(),
    'Repository listing must contain every source exactly once');
  return {
    ...manifest,
    sources: manifest.sources.map(entry => {
      assert(RATINGS.has(entry.rating), `${entry.id}: unknown catalog rating`);
      assert(Array.isArray(entry.developers), `${entry.id}: missing developer metadata`);
      const owners = entry.developers.filter(developer =>
        developer?.name === OWNER_NAME && developer.github === OWNER_GITHUB);
      assert.equal(owners.length, 1, `${entry.id}: expected one verified repository maintainer`);
      return { ...entry, badges: [RATINGS.get(entry.rating), languageBadge(entry)], developers: owners };
    }),
  };
}

function bundleHashes(output, sources) {
  const directory = join(output, 'sources');
  const files = readdirSync(directory).filter(file => file.endsWith('.mana')).sort();
  assert.deepEqual(files, sources.map(id => `${id}.mana`).sort(), 'Bundle inventory differs');
  return Object.fromEntries(files.map(file => [file,
    createHash('sha256').update(readFileSync(join(directory, file))).digest('hex')]));
}

export function writeRepositoryListing(output = 'dist', sources = discoverSources()) {
  const manifestPath = join(output, 'sources.json');
  const original = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const projected = projectRepositoryListing(original, sources);
  const before = bundleHashes(output, sources);
  writeFileSync(manifestPath, `${JSON.stringify(projected, null, 2)}\n`);
  assert.deepEqual(bundleHashes(output, sources), before, 'Repository projection changed source bundles');
  return projected;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert(process.argv.length <= 3, 'Expected at most one build output directory');
  const manifest = writeRepositoryListing(process.argv[2] ?? 'dist');
  console.log(`Projected ${manifest.sources.length} repository listings; compiled bundles are unchanged.`);
}
