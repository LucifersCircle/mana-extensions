import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import vm from 'node:vm';
import { createManaRuntime, installManaHTTP } from './mana-runtime.mjs';
import { decryptGCMMessage } from './mana-test-crypto.mjs';
function sample() {
    const key = Buffer.alloc(32, 7), iv = Buffer.alloc(12, 4), aad = Buffer.from('native-host-contract');
    const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad);
    const plaintext = Buffer.from('native GCM bridge contract');
    const data = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    return { key, iv, aad, plaintext, data };
}
test('official SDK GCM uses the native bridge without crypto.subtle and authenticates bytes', async () => {
    const input = sample();
    const context = vm.createContext(createManaRuntime({ fetchImpl: async () => { throw new Error('No network expected'); }, logger: () => {} }));
    const host = installManaHTTP(context);
    Object.assign(context, { keyBytes: [...input.key], ivBytes: [...input.iv], aadBytes: [...input.aad], inputBytes: [...input.data] });
    const decrypt = () => host.runOperation(() => vm.runInContext('ManaHTTP.Crypto.decrypt(ManaHTTP.Cipher.aesGcm({ key: new Uint8Array(keyBytes), iv: new Uint8Array(ivBytes), additionalData: new Uint8Array(aadBytes) }), new Uint8Array(inputBytes))', context));
    assert.equal(context.crypto, undefined);
    assert.deepEqual(Buffer.from(await decrypt()), input.plaintext);
    context.inputBytes[context.inputBytes.length - 1] ^= 1;
    await assert.rejects(decrypt(), { name: 'OperationError' });
    context.inputBytes = [...input.data]; context.aadBytes[0] ^= 1;
    await assert.rejects(decrypt(), { name: 'OperationError' });
    assert.deepEqual(host.stats(), { operations: 0, bodies: 0, transfers: 0 });
    await host.close();
});
test('GCM bridge rejects malformed, unbounded, unsupported and body-transform messages', () => {
    const { key, iv, data } = sample();
    const message = { operation: 9, spec: JSON.stringify({ algorithm: 2, key: key.toString('base64'), iv: iv.toString('base64') }), value: data.toString('base64') };
    for (const bad of [{ ...message, bodyID: 'unowned' }, { ...message, operation: 10 }, { ...message, bytes: data },
        { ...message, value: '$invalid' }, { ...message, spec: '{' }, { ...message, spec: JSON.stringify({ algorithm: 1 }) },
        { ...message, value: '' }, { ...message, spec: 'x'.repeat(8193) }]) assert.throws(() => decryptGCMMessage(bad));
});
