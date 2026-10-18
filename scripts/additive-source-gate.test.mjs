import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { registryWithoutAdditions, verifyDependencies, verifyManifestEntry, verifyNoticeAddition } from './additive-source-gate.mjs';
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

const noticeIndex = 'licenses/bundled-dependencies/INDEX.json';
const noticeHashes = 'licenses/SHA256SUMS.json';
const cryptoNotices = 'licenses/bundled-dependencies/crypto-es@2.1.0';
const serialize = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const digest = value => createHash('sha256').update(value).digest('hex');
const fixture = () => {
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url));
  const lock = JSON.parse(read('package-lock.json'));
  const entry = JSON.parse(read(noticeIndex)).find(item => item.name === 'crypto-es');
  const oldEntry = { name: 'existing', version: '1.0.0', packagePath: 'node_modules/existing' };
  const before = { 'licenses/existing-LICENSE': Buffer.from('Keep exact existing notice bytes.\r\n'), [noticeIndex]: serialize([oldEntry]) };
  before[noticeHashes] = serialize({ 'bundled-dependencies/INDEX.json': digest(before[noticeIndex]), 'existing-LICENSE': digest(before['licenses/existing-LICENSE']) });
  const after = Object.fromEntries(Object.entries(before).map(([path, bytes]) => [path, Buffer.from(bytes)]));
  after[noticeIndex] = serialize([oldEntry, entry]);
  const hashes = { ...JSON.parse(before[noticeHashes]), 'bundled-dependencies/INDEX.json': digest(after[noticeIndex]) };
  for (const path of ['licenses/crypto-es-LICENSE', `${cryptoNotices}/LICENSE`, `${cryptoNotices}/package-metadata.json`]) {
    after[path] = read(path); hashes[path.slice('licenses/'.length)] = digest(after[path]);
  }
  after[noticeHashes] = serialize(Object.fromEntries(Object.keys(hashes).sort().map(path => [path, hashes[path]])));
  return { before, after, lock, additions: ['GourmetScans'] };
};
const verify = value => verifyNoticeAddition(value.before, value.after, value.lock, value.additions);
const changeJson = (value, path, mutate) => {
  const object = JSON.parse(value.after[path]); mutate(object); value.after[path] = serialize(object);
};

test('accepts only the exact locked crypto-es notice addition and preserves existing bytes', () => verify(fixture()));
for (const path of ['licenses/existing-LICENSE', 'licenses/crypto-es-LICENSE', `${cryptoNotices}/LICENSE`, `${cryptoNotices}/package-metadata.json`]) {
  test(`rejects mutated notice bytes: ${path}`, () => {
    const value = fixture(); value.after[path] = Buffer.concat([value.after[path], Buffer.from('changed')]);
    assert.throws(() => verify(value), /notice.*(changed|differs)/i);
  });
}
for (const [name, mutate] of [
  ['missing locked notice', value => { delete value.after[`${cryptoNotices}/LICENSE`]; }],
  ['unrelated added notice', value => { value.after['licenses/unrelated-LICENSE'] = Buffer.from('extra'); }],
  ['executable package filename', value => { value.after[`${cryptoNotices}/package.json`] = value.after[`${cryptoNotices}/package-metadata.json`]; }],
  ['removed existing notice', value => { delete value.after['licenses/existing-LICENSE']; }],
]) test(`rejects ${name}`, () => {
  const value = fixture(); mutate(value); assert.throws(() => verify(value), /Unrelated or missing notice files/);
});
for (const [name, mutate] of [
  ['stale inventory', value => { value.after[noticeIndex] = value.before[noticeIndex]; }],
  ['mutated existing inventory', value => changeJson(value, noticeIndex, entries => { entries[0].version = '2.0.0'; })],
  ['unrelated inventory entry', value => changeJson(value, noticeIndex, entries => entries.push({ name: 'unrelated' }))],
  ['duplicate crypto inventory', value => changeJson(value, noticeIndex, entries => entries.push(entries[1]))],
  ['stale package provenance', value => changeJson(value, noticeIndex, entries => { entries[1].integrity = 'stale'; })],
  ['stale notice inventory hash', value => changeJson(value, noticeHashes, hashes => { hashes['bundled-dependencies/INDEX.json'] = 'stale'; })],
  ['mutated existing notice hash', value => changeJson(value, noticeHashes, hashes => { hashes['existing-LICENSE'] = 'changed'; })],
  ['unrelated notice hash', value => changeJson(value, noticeHashes, hashes => { hashes['extra-LICENSE'] = 'extra'; })],
  ['missing crypto notice hash', value => changeJson(value, noticeHashes, hashes => { delete hashes['crypto-es-LICENSE']; })],
]) test(`rejects ${name}`, () => {
  const value = fixture(); mutate(value); assert.throws(() => verify(value), /Notice (inventory|hashes)/);
});
test('notice addition rejects unapproved sources and stale locked dependency', () => {
  const other = fixture(); other.additions = ['GenzToons']; assert.throws(() => verify(other), /approved Gourmet/);
  const stale = fixture(); stale.lock.packages['node_modules/crypto-es'].version = '2.0.0'; assert.throws(() => verify(stale), /audited locked crypto-es/);
  const duplicate = fixture(); duplicate.before[`${cryptoNotices}/LICENSE`] = duplicate.after[`${cryptoNotices}/LICENSE`];
  assert.throws(() => verify(duplicate), /Notice already exists/);
});
