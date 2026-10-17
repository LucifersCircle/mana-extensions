// The upstream builder may report success after dropping failed source metadata.
// Independently require the complete inventory and both new image transports.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { discoverSources } from './test-sources.mjs';

function sourceVersion(id, root) {
  const path = join(root, id, 'index.ts');
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const targets = file.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === 'Target');
  assert.equal(targets.length, 1, 'Source must declare one Target class');
  const info = targets[0].members.filter(node => ts.isPropertyDeclaration(node) && node.name.getText(file) === 'info');
  assert.equal(info.length, 1, 'Source must declare one info property');
  assert(info[0].initializer && ts.isObjectLiteralExpression(info[0].initializer), 'Source metadata must be a literal');
  const versions = info[0].initializer.properties.filter(node => ts.isPropertyAssignment(node) && node.name.getText(file) === 'version');
  assert.equal(versions.length, 1, 'Source must declare one version');
  assert(ts.isStringLiteral(versions[0].initializer), 'Source version must be a string literal');
  return versions[0].initializer.text;
}

export function verifyBundles({ output = 'dist', sourceRoot = 'src/sources', sources = discoverSources(sourceRoot) } = {}) {
  const manifest = JSON.parse(readFileSync(join(output, 'sources.json'), 'utf8'));
  assert(Array.isArray(manifest.sources), 'Missing source manifest');
  const ids = manifest.sources.map(entry => entry.id).sort();
  assert.deepEqual(ids, [...sources].sort(), 'Built manifest must contain every source exactly once');
  const files = readdirSync(join(output, 'sources')).filter(file => file.endsWith('.mana')).sort();
  assert.deepEqual(files, sources.map(name => `${name}.mana`).sort(), 'Built source artifact inventory differs');
  const digests = {};
  for (const entry of manifest.sources) {
    assert.equal(entry.version, sourceVersion(entry.id, sourceRoot), 'Built version differs from current source');
    assert.equal(entry.path, entry.id, 'Unexpected bundle path');
    assert.equal(entry.environment, 'source', 'Unexpected bundle environment');
    assert(Number.isSafeInteger(entry.intents) && entry.intents >= 0, 'Invalid source intents');
    assert((entry.intents & (1 << 25)) && (entry.intents & (1 << 26)), 'Both image transport intents are required');
    assert.equal(entry.intents & (1 << 2), 0, 'Legacy image intent must be absent');
    const code = readFileSync(join(output, 'sources', `${entry.id}.mana`), 'utf8');
    assert(code.length > 0, 'Empty source artifact');
    const forbidden = () => { throw new Error('Network or asynchronous work during metadata verification'); };
    const context = vm.createContext({
      console: { log() {}, warn() {}, error() {} }, setTimeout: forbidden,
      __manaHTTPBridge: { metadataOnly: true, requiresOperation: true, now: () => 0, send: forbidden },
    });
    vm.runInContext(code, context, { timeout: 10_000 });
    assert.equal(typeof context.Target, 'function', 'Bundle lacks Target');
    const target = new context.Target();
    assert.equal(target.info.id, entry.id, 'Bundle ID differs from manifest');
    assert.equal(target.info.version, entry.version, 'Bundle version differs from manifest');
    assert.equal(typeof target.getCoverTransport, 'function', 'Bundle lacks cover transport');
    assert.equal(typeof target.getPageTransport, 'function', 'Bundle lacks page transport');
    assert.equal(target.willRequestImage, undefined, 'Legacy image hook remains');
    assert(typeof context.__manaSerializedFunctionPrelude === 'string' && context.__manaSerializedFunctionPrelude.length > 0,
      'Bundle lacks serialized function helpers');
    digests[entry.id] = { version: entry.version, sha256: createHash('sha256').update(code).digest('hex') };
  }
  return digests;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length > 3) throw new Error('Expected at most one bundle output directory');
  const verified = verifyBundles({ output: process.argv[2] ?? 'dist' });
  console.log(`Verified ${Object.keys(verified).length} complete SDK bundles, transport intents and metadata.`);
  console.log(JSON.stringify(verified));
}
