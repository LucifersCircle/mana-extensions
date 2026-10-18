import assert from 'node:assert/strict';
import test from 'node:test';
import { registryWithoutAdditions, verifyDependencies, verifyManifestEntry } from './additive-source-gate.mjs';
const original = "const methods=['x']; const controls=['y']; export const sourceContracts = { Old: { sample: 'old' } };";
for (const name of ['GourmetScans', 'GenzToons']) test(`accepts inert ${name} addition and retains old contract`, () => {
  const code = original.replace('Old:', `${name}: { sample: 'new', methods: [...methods, ...controls], reader(state) { state.result = 1; } }, Old:`);
  assert.equal(registryWithoutAdditions(code, [name]), registryWithoutAdditions(original, []));
});
for (const body of ["sample: (() => 1)()", "documentLimit: (methods.length = 0, 9)", "[(() => 'x')()]() {}", "get x() { return 1; }", "sample: methods.length", "sample: ++methods.length", "sample: new Object()", "...methods"]) test(`rejects non-inert initializer ${body}`, () => {
  assert.throws(() => registryWithoutAdditions(original.replace('Old:', `GourmetScans: { ${body} }, Old:`), ['GourmetScans']));
});
test('rejects duplicate or missing added key', () => {
  assert.throws(() => registryWithoutAdditions(original.replace('Old:', 'GourmetScans: {}, GourmetScans: {}, Old:'), ['GourmetScans']));
  assert.throws(() => registryWithoutAdditions(original, ['GourmetScans']));
});
test('existing helper and contract edits remain distinguishable', () => {
  assert.notEqual(registryWithoutAdditions(original.replace("'old'", "'changed'"), []), registryWithoutAdditions(original, []));
  assert.notEqual(registryWithoutAdditions(original.replace("['x']", "['z']"), []), registryWithoutAdditions(original, []));
});
test('later Genz addition may not remove existing crypto import', () => {
  const imported = "import { createHash, createDecipheriv } from 'node:crypto';\n" + original;
  assert.notEqual(registryWithoutAdditions(original.replace('Old:', 'GenzToons: {}, Old:'), ['GenzToons']), registryWithoutAdditions(imported, []));
});
test('existing dependency/lock changes and extra dependencies reject', () => {
  const pkg = { dependencies: { old: '1' } }, lock = { packages: { '': { dependencies: { old: '1' } } }, dependencies: { old: { integrity: 'x' } } };
  verifyDependencies(pkg, structuredClone(pkg), lock, structuredClone(lock), ['GenzToons']);
  assert.throws(() => verifyDependencies(pkg, { dependencies: { old: '2' } }, lock, lock, ['GenzToons']));
  assert.throws(() => verifyDependencies(pkg, { dependencies: { old: '1', extra: '1' } }, lock, lock, ['GenzToons']));
  const changed = structuredClone(lock); changed.dependencies.old.integrity = 'y';
  assert.throws(() => verifyDependencies(pkg, pkg, lock, changed, ['GenzToons']));
});

test('manifest comparison permits only generated hash differences', () => {
  const before = { hash: 'a', version: '1', thumbnail: 'Old.png', intents: 3, developers: [{ name: 'Author' }] };
  verifyManifestEntry(before, { ...before, hash: 'b' });
  for (const [key, value] of Object.entries({ version: '2', thumbnail: 'Other.png', intents: 4, developers: [] })) {
    assert.throws(() => verifyManifestEntry(before, { ...before, [key]: value }));
  }
});
