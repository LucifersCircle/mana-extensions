/* SPDX-License-Identifier: GPL-3.0-only */
/* MangaHub protocol references: Elrulia/paperback-extension and Nicartjay/PaperbackExt.
 * Mana adaptation © 2026 Lucifers Circle. See THIRD_PARTY_NOTICES.md. */
import { Cipher,
    Crypto } from '@mana-app/types'

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
// Bounded, canonical base64/base64url without browser, Node or WebCrypto globals.
export function decodeBase64(value: unknown, maxBytes: number): Uint8Array {
    if (typeof value !== 'string' || !value || value.length > Math.ceil(maxBytes / 3) * 4 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value) || (/[+/]/.test(value) && /[-_]/.test(value))) throw new Error('Invalid MangaHub base64')
    const raw = value.replace(/=+$/, ''), padding = value.length - raw.length
    if (raw.length % 4 === 1 || (padding && (value.length % 4 !== 0 || padding !== (4 - raw.length % 4) % 4))) throw new Error('Invalid MangaHub base64 padding')
    const norm = raw.replace(/-/g, '+').replace(/_/g, '/'), size = Math.floor(norm.length * 6 / 8)
    if (!size || size > maxBytes) throw new Error('Invalid MangaHub decoded size')
    const out = new Uint8Array(size)
    let buffer = 0, bits = 0, offset = 0
    for (const char of norm) {
        buffer = (buffer << 6) | alphabet.indexOf(char); bits += 6
        if (bits >= 8) { bits -= 8; out[offset++] = (buffer >>> bits) & 255 }
        buffer &= (1 << bits) - 1
    }
    if (buffer !== 0) throw new Error('Noncanonical MangaHub base64')
    return out
}
export type Envelope = { keyId: string, iv: Uint8Array, tag: Uint8Array, ciphertext: Uint8Array }
export function envelope(value: string): Envelope {
    if (value.length > 1_400_000) throw new Error('Oversized MangaHub page envelope')
    const parts = value.split(':')
    if (parts.length !== 6 || parts[0] !== 'enc' || parts[1] !== 'v1' || !/^[A-Za-z0-9_-]{1,128}$/.test(parts[2] ?? '')) throw new Error('Unsupported MangaHub encrypted pages')
    const iv = decodeBase64(parts[3], 12), tag = decodeBase64(parts[4], 16), ciphertext = decodeBase64(parts[5], 1_000_000)
    if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid MangaHub GCM parameters')
    return { keyId: parts[2] as string, iv, tag, ciphertext }
}
export async function decryptPages(value: Envelope, payload: Record<string, unknown>): Promise<string> {
    // Nicartjay pinned template documents keys[keyId]; Elrulia uses tagged key/keyId.
    let encoded: unknown
    if (payload.keys && typeof payload.keys === 'object' && !Array.isArray(payload.keys) && Object.prototype.hasOwnProperty.call(payload.keys, value.keyId)) encoded = (payload.keys as Record<string, unknown>)[value.keyId]
    else if (payload.keyId === value.keyId) encoded = payload.key
    // Never assume an untagged singleton key belongs to the encrypted chapter.
    const key = decodeBase64(encoded, 32)
    if (key.length !== 32) throw new Error('MangaHub requires a matching AES-256 page key')
    if (payload.expiresAt !== undefined && (typeof payload.expiresAt !== 'number' || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now())) throw new Error('MangaHub page key is expired or unsupported')
    const joined = new Uint8Array(value.ciphertext.length + value.tag.length)
    joined.set(value.ciphertext); joined.set(value.tag, value.ciphertext.length)
    let bytes: Uint8Array
    try { bytes = await Crypto.decrypt(Cipher.aesGcm({ key, iv: value.iv }), joined) }
    catch { throw new Error('MangaHub authenticated decryption failed or native AES-GCM is unavailable; no fallback or retry') }
    if (!bytes.length || bytes.length > 1_000_000) throw new Error('Invalid MangaHub decrypted page length')
    // decodeURIComponent validates UTF-8, including overlong/invalid byte sequences.
    let escaped = ''
    for (const byte of bytes) escaped += '%' + byte.toString(16).padStart(2, '0')
    try { return decodeURIComponent(escaped) } catch { throw new Error('Invalid MangaHub page-list UTF-8') }
}
