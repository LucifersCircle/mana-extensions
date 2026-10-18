/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex; Copyright © 2026 Lucifers Circle */
import { Body,
    CloudflareError,
    HttpClient } from '@mana-app/types'
export const DOMAIN = 'https://mangataro.org'

// The public manga-detail script and Inkdex's MangaTaro implementation use this
// timestamp/UTC-hour MD5 bootstrap. It is not an account credential or login.
// MD5's one-block variant suffices for this fixed, short ASCII bootstrap string.
export function chapterToken(now = Date.now()): { _t: string, _ts: string } {
    const timestamp = String(Math.floor(now / 1000))
    const input = timestamp + 'mng_ch_' + new Date(now).toISOString().slice(0, 13).replace(/[-T:]/g, '')
    const words = new Array<number>(16).fill(0)
    for (let i = 0; i < input.length; i++) words[i >> 2] = (words[i >> 2] ?? 0) | input.charCodeAt(i) << (i % 4 * 8)
    words[input.length >> 2] = (words[input.length >> 2] ?? 0) | 128 << (input.length % 4 * 8)
    words[14] = input.length * 8
    const initial = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]
    let [a, b, c, d] = initial as [number, number, number, number]
    const shifts = [[7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]]
    for (let i = 0; i < 64; i++) {
        const round = i >> 4
        const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c) : round === 2 ? b ^ c ^ d : c ^ (b | ~d)
        const g = round === 0 ? i : round === 1 ? (5 * i + 1) % 16 : round === 2 ? (3 * i + 5) % 16 : 7 * i % 16
        const sum = (a + f + Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) + (words[g] ?? 0)) | 0
        const shift = shifts[round]?.[i % 4] ?? 0
        const next = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0
        a = d; d = c; c = b; b = next
    }
    const hash = [a, b, c, d].map((word, i) => {
        const value = (word + (initial[i] ?? 0)) | 0
        return [0, 8, 16, 24].map(shift => ((value >>> shift) & 255).toString(16).padStart(2, '0')).join('')
    }).join('')
    return { _t: hash.slice(0, 16), _ts: timestamp }
}

export class MangaTaroApi {
    private readonly client = new HttpClient().setTimeoutMs(30000).setRetry(0).setRateLimit(3, 1000).addHeader('Referer', DOMAIN + '/')
    async text(path: string, body?: Record<string, string | number>): Promise<string> {
        if (!path.startsWith('/') || path.startsWith('//') || /[\\\r\n]/.test(path)) throw new Error('Invalid MangaTaro API path')
        const response = body ? await this.client.post(DOMAIN + path, Body.json(body)) : await this.client.get(DOMAIN + path)
        if (response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge') throw new CloudflareError(DOMAIN)
        if (new URL(response.url).origin !== DOMAIN) throw new Error('MangaTaro API response changed origin')
        if (response.status !== 200) throw new Error(`MangaTaro request failed (HTTP ${response.status}); access restrictions are not bypassed`)
        const value = await response.text()
        if (value.length > 6_000_000 || /cf-chl-|Just a moment\.\.\./i.test(value)) throw new Error('MangaTaro response is unavailable or access-challenged')
        return value
    }
    async json<T>(path: string, body?: Record<string, string | number>): Promise<T> { return JSON.parse(await this.text(path, body)) as T }
}
