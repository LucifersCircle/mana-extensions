/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Lucifers Circle */
import { CloudflareError,
    HttpClient,
    RequestOrigin } from '@mana-app/types'
import { DOMAIN,
    id,
    parseListing,
    parseWork,
    parseDetail,
    parseReader,
    readerURL,
    type APIDetail } from './MarumaruParser'

export function validateAPIURL(url: string): void {
    if (typeof url !== 'string' || /\s/.test(url)) throw new Error('Unsupported Marumaru API request')
    if (!/^https:\/\/marumaru105\.com\/api\/works\/[1-9]\d*$/.test(url)
        && !/^https:\/\/marumaru105\.com\/api\/works\?mediaType=MANHWA&page=(?:0|[1-9]\d*)&size=49$/.test(url)
        && !/^https:\/\/marumaru105\.com\/api\/search\?q=(?:[A-Za-z0-9_.!~*'()-]|%[0-9A-F]{2})+&page=(?:0|[1-9]\d*)&media=MANHWA&sort=LATEST$/.test(url)
        && !/^https:\/\/api\.storagewebtoon\.store\/api\/v1\/reader\/A2\/(?:works|episodes)\/[1-9]\d*$/.test(url))
        throw new Error('Unsupported Marumaru API request')
}
export class MarumaruAPI {
    private readonly catalog = this.client(DOMAIN).addHeader('X-Site', 'marumaru')
    private readonly reader = this.client('https://api.storagewebtoon.store')
    private client(origin: string): HttpClient {
        // Mana 0.1 owns native request identity. Unlike Paperback it exposes no
        // default-UA getter: leave the host's User-Agent intact, never impersonate it.
        return new HttpClient().setTimeoutMs(30000).setRateLimit(3, 1000).addHeader('Accept', 'application/json')
            .addHeader('Referer', DOMAIN + '/')
            .addRequestInterceptor((request, context) => {
                validateAPIURL(request.url)
                if (context.origin !== RequestOrigin.General || !request.url.startsWith(origin + '/')) throw new Error('Marumaru API origin mismatch')
                return request
            })
    }
    async json(url: string): Promise<unknown> {
        validateAPIURL(url)
        const client = url.startsWith(DOMAIN + '/') ? this.catalog : this.reader
        const response = await client.get(url)
        try {
            if (response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge') throw new CloudflareError(url)
            if (response.status !== 200) throw new Error(`Marumaru API request failed (HTTP ${response.status})`)
            if (response.url !== url || response.request.url !== url
                || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new Error('Marumaru returned an invalid API response')
            const body = await response.text()
            if (body.length > 4_000_000) throw new Error('Marumaru API response exceeds supported size')
            return JSON.parse(body) as unknown
        } finally { response.releaseNative() }
    }
}
export type JSONTransport = (url: string) => Promise<unknown>
/** Only ordinary advertised public JSON APIs. No WebView, cookies, or per-card requests. */
export class MarumaruService {
    private readonly cache = new Map<string, { at: number; detail: APIDetail }>()
    private readonly pending = new Map<string, Promise<APIDetail>>()
    private generation = 0
    constructor(private readonly fetchJSON: JSONTransport) {}
    clear(): void { this.generation++; this.cache.clear(); this.pending.clear() }
    async catalog(page = 1) {
        if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new Error('Invalid Marumaru catalog page')
        return parseListing(await this.fetchJSON(`${DOMAIN}/api/works?mediaType=MANHWA&page=${page - 1}&size=49`), page - 1, false)
    }
    async search(query: string, page = 1) {
        if (typeof query !== 'string' || !query.trim() || query.length > 300 || !Number.isSafeInteger(page) || page < 1 || page > 10000)
            throw new Error('Invalid Marumaru search')
        return parseListing(await this.fetchJSON(`${DOMAIN}/api/search?q=${encodeURIComponent(query.trim())}&page=${page - 1}&media=MANHWA&sort=LATEST`), page - 1, true)
    }
    detail(work: string, refresh = false): Promise<APIDetail> {
        id(work)
        // A refreshed chapter list must re-evaluate ready flags, including rows
        // previously hidden as unavailable. Readers can reuse the validated cache.
        if (refresh) this.cache.delete(work)
        const cached = this.cache.get(work)
        if (cached && Date.now() - cached.at < 60000) return Promise.resolve(cached.detail)
        const running = this.pending.get(work)
        if (running) return running
        const generation = this.generation
        const request = (async () => {
            const metadata = parseWork(await this.fetchJSON(`${DOMAIN}/api/works/${work}`), work)
            const detail = parseDetail(metadata, await this.fetchJSON(metadata.episodesUrl))
            if (generation !== this.generation) throw new Error('Marumaru content policy changed; refresh to continue')
            this.cache.set(work, { at: Date.now(), detail })
            while (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value as string)
            return detail
        })().finally(() => { if (this.pending.get(work) === request) this.pending.delete(work) })
        this.pending.set(work, request)
        return request
    }
    async reader(work: string, episode: string): Promise<string[]> {
        id(work); id(episode)
        const detail = await this.detail(work), selected = detail.chapters.find(chapter => chapter.id === episode)
        if (!selected) throw new Error('Marumaru selected chapter is absent from title inventory')
        return parseReader(await this.fetchJSON(readerURL(detail.episodesUrl, work, episode)), work, selected)
    }
}
