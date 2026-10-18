// Explicitly approved new-source boundary, separate from ordinary path selection.
// A rejected approved addition stops before network tests; it never falls back to all.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { discoverSources } from './test-sources.mjs';
import { isolatedSourceLayout } from './source-dependencies.mjs';
const approved = ['GourmetScans', 'GenzToons'];
const infrastructure = ['.github/workflows/live-tests.yaml', 'scripts/additive-source-gate.mjs', 'scripts/additive-source-gate.test.mjs', 'scripts/additive-source-live.mjs'];
const digest = value => createHash('sha256').update(value).digest('hex');
const git = args => execFileSync('git', args, { maxBuffer: 32 * 1024 * 1024 });
const text = (sha, path) => git(['show', `${sha}:${path}`]).toString();
const inventory = sha => git(['ls-tree', '-r', '--name-only', sha, 'src/sources']).toString().split('\n').map(p => p.match(/^src\/sources\/([^/]+)\/index\.ts$/)?.[1]).filter(Boolean).sort();

export function registryWithoutAdditions(code, additions) {
  const file = ts.createSourceFile('contracts.mjs', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(file.parseDiagnostics.length, 0);
  let found = 0;
  const transformed = ts.transform(file, [context => root => ts.visitNode(root, function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'sourceContracts') {
      found++; assert(ts.isObjectLiteralExpression(node.initializer));
      const removed = node.initializer.properties.filter(property => additions.includes(property.name?.getText(file)));
      assert.deepEqual(removed.map(property => property.name?.getText(file)).sort(), [...additions].sort(), 'Duplicate/missing added contract');
      for (const property of removed) {
        assert(ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer), 'Added contract must be an inert object');
        const inert = value => {
          if (ts.isMethodDeclaration(value)) { assert(!ts.isComputedPropertyName(value.name)); return; }
          if (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) return;
          if (ts.isPropertyAssignment(value)) { assert(!ts.isComputedPropertyName(value.name)); inert(value.initializer); return; }
          if (ts.isObjectLiteralExpression(value)) { value.properties.forEach(inert); return; }
          if (ts.isArrayLiteralExpression(value)) { value.elements.forEach(inert); return; }
          if (ts.isSpreadElement(value)) { assert(ts.isIdentifier(value.expression) && ['methods', 'controls'].includes(value.expression.text)); return; }
          if (ts.isStringLiteral(value) || ts.isNumericLiteral(value) || [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(value.kind)) return;
          assert(ts.isIdentifier(value) && ['methods', 'controls'].includes(value.text), 'Side effect or unknown contract initializer');
        }; inert(property.initializer);
      }
      const properties = node.initializer.properties.filter(property => !additions.includes(property.name?.getText(file)));
      assert.equal(node.initializer.properties.length - properties.length, additions.length, 'Every added contract must exist exactly once');
      return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type, ts.factory.updateObjectLiteralExpression(node.initializer, properties));
    }
    return ts.visitEachChild(node, visit, context);
  })]);
  assert.equal(found, 1);
  let normalized = ts.createPrinter({ removeComments: false }).printFile(transformed.transformed[0]);
  transformed.dispose();
  // Only this exact, side-effect-free built-in import is needed by Gourmet's oracle.
  if (additions.includes('GourmetScans')) normalized = normalized.replace(/^import \{ createHash, createDecipheriv \} from ['"]node:crypto['"];\r?\n/m, '');
  return normalized;
}
export function verifyDependencies(beforePackage, afterPackage, beforeLock, afterLock, additions) {
  const p = structuredClone(afterPackage), l = structuredClone(afterLock);
  if (additions.includes('GourmetScans') && !beforePackage.dependencies?.['crypto-es']) {
    assert.equal(p.dependencies['crypto-es'], '2.1.0'); delete p.dependencies['crypto-es'];
    const entry = l.packages['node_modules/crypto-es'];
    assert.deepEqual(entry, { version: '2.1.0', resolved: 'https://registry.npmjs.org/crypto-es/-/crypto-es-2.1.0.tgz', integrity: 'sha512-C5Dbuv4QTPGuloy5c5Vv/FZHtmK+lobLAypFfuRaBbwCsk3qbCWWESCH3MUcBsrgXloRNMrzwUAiPg4U6+IaKA==', license: 'MIT' });
    assert.equal(l.packages[''].dependencies['crypto-es'], '2.1.0'); delete l.packages[''].dependencies['crypto-es']; delete l.packages['node_modules/crypto-es'];
    assert.deepEqual(l.dependencies['crypto-es'], { version: entry.version, resolved: entry.resolved, integrity: entry.integrity }); delete l.dependencies['crypto-es'];
  }
  assert.deepEqual(p, beforePackage, 'Existing package configuration changed');
  assert.deepEqual(l, beforeLock, 'Existing dependency resolution changed');
}
export function verifyManifestEntry(before, after) {
  const { hash: oldHash, ...oldEntry } = before;
  const { hash: newHash, ...newEntry } = after;
  assert.equal(typeof oldHash, 'string'); assert.equal(typeof newHash, 'string');
  assert.deepEqual(newEntry, oldEntry, 'Existing built manifest metadata changed');
}
export function proveAddition({ baseSha, headSha, testedSha }) {
  for (const sha of [baseSha, headSha, testedSha]) assert(/^[a-f0-9]{40}$/.test(sha), 'Missing immutable commit');
  assert.equal(git(['rev-parse', 'HEAD']).toString().trim(), testedSha);
  assert.equal(git(['diff', '--name-only', testedSha]).toString(), '', 'Tracked checkout changed after checkout');
  assert.equal(git(['diff', '--cached', '--name-only', testedSha]).toString(), '', 'Index differs from tested commit');
  assert.equal(git(['ls-files', '--others', '--exclude-standard']).toString(), '', 'Untracked inputs lack immutable ownership');
  git(['merge-base', '--is-ancestor', headSha, testedSha]);
  git(['merge-base', '--is-ancestor', baseSha, testedSha]);
  const before = inventory(baseSha), current = discoverSources(), head = inventory(headSha);
  assert.deepEqual(head, current, 'Head/tested inventories differ');
  const additions = current.filter(name => !before.includes(name));
  if (!additions.some(name => approved.includes(name))) return null;
  assert(additions.length && additions.every(name => approved.includes(name)), 'Unapproved simultaneous source addition');
  assert(before.every(name => current.includes(name)), 'Existing source removed');
  assert(isolatedSourceLayout(current), 'Cross-source or uncertain dependency');
  const bootstrap = !git(['ls-tree', '--name-only', baseSha, 'scripts/additive-source-gate.mjs']).toString().trim();
  const paths = [...new Set([headSha, testedSha].flatMap(sha => git(['diff', '--name-only', baseSha, sha]).toString().trim().split('\n')))];
  for (const path of paths) {
    const owned = additions.some(name => path.startsWith(`src/sources/${name}/`) || path.startsWith(`src/tests/${name}/`) || path === `assets/${name}.png`);
    assert(owned || (bootstrap && infrastructure.includes(path)) || ['THIRD_PARTY_NOTICES.md', 'licenses/crypto-es-LICENSE', 'licenses/genz-paperback-MIT', 'package.json', 'package-lock.json', 'scripts/native-contract-sources.mjs'].includes(path), `Unproven shared change: ${path}`);
  }
  for (const path of ['licenses/crypto-es-LICENSE', 'licenses/genz-paperback-MIT']) {
    if (git(['ls-tree', '--name-only', baseSha, path]).toString().trim()) assert.equal(readFileSync(path, 'utf8'), text(baseSha, path), 'Existing license changed');
  }
  verifyDependencies(JSON.parse(text(baseSha, 'package.json')), JSON.parse(readFileSync('package.json')), JSON.parse(text(baseSha, 'package-lock.json')), JSON.parse(readFileSync('package-lock.json')), additions);
  assert.equal(registryWithoutAdditions(readFileSync('scripts/native-contract-sources.mjs', 'utf8'), additions), registryWithoutAdditions(text(baseSha, 'scripts/native-contract-sources.mjs'), []), 'Existing contract/helper changed');
  assert(readFileSync('THIRD_PARTY_NOTICES.md', 'utf8').startsWith(text(baseSha, 'THIRD_PARTY_NOTICES.md')), 'Existing attribution changed');
  if (additions.includes('GourmetScans')) assert.equal(readFileSync('licenses/crypto-es-LICENSE', 'utf8'), readFileSync('node_modules/crypto-es/LICENSE', 'utf8'), 'Dependency license differs');
  const temporary = mkdtempSync(join(tmpdir(), 'mana-additive-'));
  const hashes = {};
  try {
    const archive = join(temporary, 'base.tar'); writeFileSync(archive, git(['archive', baseSha]));
    const baseline = join(temporary, 'base'); mkdirSync(baseline);
    execFileSync('tar', ['-xf', archive, '-C', baseline]);
    // Real copies preserve the build's module paths; symlinks change emitted bytes.
    cpSync('node_modules', join(baseline, 'node_modules'), { recursive: true });
    execFileSync(process.execPath, [join(baseline, 'node_modules/@mana-app/dev/bin/mana-dev.js'), 'build', '--output', 'dist'], { cwd: baseline, stdio: 'pipe' });
    const priorManifest = JSON.parse(readFileSync(join(baseline, 'dist/sources.json'))), manifest = JSON.parse(readFileSync('dist/sources.json'));
    for (const name of before) {
      const a = readFileSync(join(baseline, `dist/sources/${name}.mana`)), b = readFileSync(`dist/sources/${name}.mana`);
      assert(a.equals(b), `Existing built bundle changed: ${name}`); hashes[name] = digest(b);
      const iconPaths = git(['ls-tree', '-r', '--name-only', baseSha, 'assets']).toString().trim().split('\n').filter(path => path.startsWith(`assets/${name}.`));
      for (const icon of iconPaths) assert(git(['show', `${baseSha}:${icon}`]).equals(readFileSync(icon)), `Existing icon changed: ${name}`);
      // Builder hash metadata is environment-dependent; actual artifact SHA256 equality above is authoritative.
      verifyManifestEntry(priorManifest.sources.find(x => x.id === name), manifest.sources.find(x => x.id === name));
    }
  } finally { rmSync(temporary, { recursive: true, force: true }); }
  return { manifestSha256: digest(readFileSync('dist/sources.json')), schemaVersion: 1, scope: 'approved-new-source-only', baseSha, headSha, testedSha, discoveredSources: current, selectedSources: additions, notSelectedSources: before, existingBundleSha256: hashes, selectedBundleSha256: Object.fromEntries(additions.map(name => [name, digest(readFileSync(`dist/sources/${name}.mana`))])) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let proof = null;
  rmSync('bundles/live-status/additive-proof.json', { force: true });
  rmSync('bundles/live-status/additive-results.json', { force: true });
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH));
    proof = proveAddition({ baseSha: event.pull_request.base.sha, headSha: event.pull_request.head.sha, testedSha: process.env.GITHUB_SHA });
  }
  mkdirSync('bundles/live-status', { recursive: true });
  if (proof) writeFileSync('bundles/live-status/additive-proof.json', JSON.stringify(proof, null, 2));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `active=${Boolean(proof)}\n`);
  console.log(proof ? `Approved addition: ${proof.selectedSources.join(', ')}. NOT SELECTED: ${proof.notSelectedSources.join(', ')}` : 'Normal source selection applies');
}
