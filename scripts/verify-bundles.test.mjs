import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { verifyBundles } from './verify-bundles.mjs';

test('bundle verification rejects omissions, duplicate identities, stale versions and missing transport intent bits', () => {
  const output = mkdtempSync(join(tmpdir(), 'mana-inventory-'));
  try {
    mkdirSync(join(output, 'sources'));
    const sourceRoot = join(output, 'input');
    mkdirSync(join(sourceRoot, 'Example'), { recursive: true });
    writeFileSync(join(sourceRoot, 'Example/index.ts'), "export class Target { info={ version: '1.0.0' }; }");
    const item = { id: 'Example', path: 'Example', version: '1.0.0', environment: 'source', intents: (1 << 25) | (1 << 26) };
    const bundle = `globalThis.__manaSerializedFunctionPrelude='helpers'; globalThis.Target=class {
      info={id:'Example',version:'1.0.0'}; getCoverTransport() {} getPageTransport() {} };`;
    writeFileSync(join(output, 'sources/Example.mana'), bundle);
    const verify = sources => { writeFileSync(join(output, 'sources.json'), JSON.stringify({ sources })); return verifyBundles({ output, sourceRoot, sources: ['Example'] }); };
    assert.equal(verify([item]).Example.sha256.length, 64);
    for (const entries of [[], [item, item], [{ ...item, id: 'Other' }], [{ ...item, version: '0.9.0' }],
      [{ ...item, intents: 1 << 25 }], [{ ...item, intents: item.intents | (1 << 2) }], [{ ...item, path: '../Example' }]]) assert.throws(() => verify(entries));
    writeFileSync(join(output, 'sources/Example.mana'), bundle.replace("version:'1.0.0'", "version:'0.9.0'"));
    assert.throws(() => verify([{ ...item, version: '0.9.0' }]), /current source/);
    writeFileSync(join(output, 'sources/Example.mana'), bundle + ';Target.prototype.willRequestImage=()=>{}');
    assert.throws(() => verify([item]), /Legacy image hook/);
    writeFileSync(join(output, 'sources/Example.mana'), '');
    assert.throws(() => verify([item]), /Empty source/);
  } finally { rmSync(output, { recursive: true, force: true }); }
});
