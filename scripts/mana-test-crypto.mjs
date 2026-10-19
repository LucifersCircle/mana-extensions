// Test-only implementation of the SDK's native GCM byte-decryption bridge.
// Sources use @mana-app/types Crypto.decrypt; no source imports this Node adapter.
import { createDecipheriv } from 'node:crypto';
const MAX_BYTES = 16 * 1024 * 1024;
function decode(value, maximum = MAX_BYTES) {
    if (typeof value !== 'string' || value.length > Math.ceil(maximum / 3) * 4
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('Invalid crypto bytes');
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length > maximum || bytes.toString('base64') !== value) throw new Error('Invalid crypto bytes');
    return bytes;
}
export function decryptGCMMessage(message) {
    // Deliberately do not advertise body transforms, key derivation or binary I/O.
    // Those need separate ownership/metadata tests before the host supports them.
    if (!message || Object.keys(message).some(key => !['operation', 'spec', 'value'].includes(key))
        || message.operation !== 9 || typeof message.spec !== 'string' || message.spec.length > 8192) throw new Error('Unsupported crypto bridge message');
    let spec;
    try { spec = JSON.parse(message.spec); } catch { throw new Error('Invalid crypto specification'); }
    if (!spec || typeof spec !== 'object' || Array.isArray(spec) || spec.algorithm !== 2
        || Object.keys(spec).some(key => !['algorithm', 'key', 'iv', 'additionalData'].includes(key))) throw new Error('Unsupported crypto specification');
    const key = decode(spec.key, 32), iv = decode(spec.iv, 1024), input = decode(message.value);
    if (![16, 24, 32].includes(key.length) || iv.length < 12 || input.length < 16) throw new Error('Invalid GCM parameters');
    const decipher = createDecipheriv(`aes-${key.length * 8}-gcm`, key, iv, { authTagLength: 16 });
    decipher.setAuthTag(input.subarray(-16));
    if (spec.additionalData !== undefined) decipher.setAAD(decode(spec.additionalData, 4096));
    try {
        const plain = Buffer.concat([decipher.update(input.subarray(0, -16)), decipher.final()]);
        return { value: plain.toString('base64') };
    } catch {
        const error = new Error('Authenticated decryption failed'); error.name = 'OperationError'; throw error;
    }
}
