/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Chapter traversal adapted from LucifersCircle/pirate.vodka-extensions (Inkdex). */
import { NetworkClientBuilder,
    NetworkResponse } from '@mana-app/types'
import { API,
    Book,
    Challenge,
    Detail,
    DOMAIN,
    Genre,
    ManifestPage,
    SearchResponse,
    TagEntry,
    UploadSource,
    validId } from './KaganeModels'

type CacheEntry = { at: number, value: unknown }
const TAXONOMY_TTL = 24 * 60 * 60 * 1000
// Public raw lists carry no selected-rating or reader-session state. Sharing them
// avoids fetching thousands of tags again for every preference edit or instance.
const publicTaxonomy = new Map<string, CacheEntry>()
const publicTaxonomyRequests = new Map<string, Promise<unknown>>()

export class KaganeApi {
    private readonly client = new NetworkClientBuilder().setRateLimit(3, 1).setTimeout(30_000)
        .setStatusValidator(() => true)
        .addHeader('Accept', 'application/json').addHeader('Content-Type', 'application/json')
        .addHeader('Origin', DOMAIN).addHeader('Referer', `${DOMAIN}/`).build()
    private readonly cache = new Map<string, CacheEntry>()
    private readonly inflight = new Map<string, Promise<unknown>>()
    private generation = 0
    private token = ''
    private expiry = 0
    private integrityRequest?: Promise<string>

    invalidate(): void {
        this.generation += 1
        this.cache.clear()
        this.inflight.clear()
        this.token = ''
        this.expiry = 0
        this.integrityRequest = undefined
    }

    private cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
        const generation = this.generation
        const cacheKey = `${generation}:${key}`
        const entry = this.cache.get(cacheKey)
        if (entry && Date.now() - entry.at < ttl) return Promise.resolve(entry.value as T)
        const running = this.inflight.get(cacheKey)
        if (running) return running as Promise<T>
        const request = load().then((value) => {
            if (generation !== this.generation) throw new Error('Kagane settings changed; refresh to continue')
            if (ttl > 0) {
                if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value as string)
                this.cache.set(cacheKey, { at: Date.now(), value })
            }
            return value
        }).finally(() => {
            if (this.inflight.get(cacheKey) === request) this.inflight.delete(cacheKey)
        })
        this.inflight.set(cacheKey, request)
        return request
    }

    private taxonomy<T>(key: string, load: () => Promise<T>): Promise<T> {
        const entry = publicTaxonomy.get(key)
        if (entry && Date.now() - entry.at < TAXONOMY_TTL) return Promise.resolve(entry.value as T)
        const running = publicTaxonomyRequests.get(key)
        if (running) return running as Promise<T>
        const request = load().then((value) => {
            publicTaxonomy.set(key, { at: Date.now(), value })
            return value
        }).finally(() => {
            if (publicTaxonomyRequests.get(key) === request) publicTaxonomyRequests.delete(key)
        })
        publicTaxonomyRequests.set(key, request)
        return request
    }

    private async response(url: string, body?: Record<string, unknown>, headers?: Record<string, string>): Promise<NetworkResponse> {
        const response = await this.client.request({ url, method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body }), headers })
        const type = String(Object.entries(response.headers ?? {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? '')
        const mitigated = Object.entries(response.headers ?? {}).some(([key, value]) => key.toLowerCase() === 'cf-mitigated' && value === 'challenge')
        if (mitigated || ((response.status === 403 || response.status === 503) && !type.includes('application/json') && /cf-chl-|_cf_chl_opt|Just a moment|cf-browser-verification/i.test(response.data))) {
            this.token = ''
            this.expiry = 0
            throw new CloudflareError(`${DOMAIN}/`)
        }
        return response
    }

    private parse<T>(response: NetworkResponse): T {
        // Never include token-bearing URLs or remote response bodies in errors.
        if (response.status < 200 || response.status >= 300) throw new Error(`Kagane request failed (HTTP ${response.status})`)
        try { return JSON.parse(response.data) as T } catch { throw new Error('Kagane returned invalid JSON') }
    }

    private async json<T>(path: string, body?: Record<string, unknown>): Promise<T> {
        return this.parse<T>(await this.response(`${API}${path}`, body))
    }

    search(body: Record<string, unknown>, page: number, size: number, sort: string, exactMatch = false): Promise<SearchResponse> {
        const path = `/search/series?page=${page - 1}&size=${size}${sort ? `&sort=${encodeURIComponent(sort)}` : ''}${exactMatch ? '&exact_match=true' : ''}`
        return this.cached(`search:${path}:${JSON.stringify(body)}`, 30_000, async () => {
            const result = await this.json<SearchResponse>(path, body)
            if (!result || !Array.isArray(result.content) || typeof result.last !== 'boolean') throw new Error('Kagane search pagination is invalid')
            return result
        })
    }

    series(id: string): Promise<Detail> {
        return this.cached(`series:${validId(id)}`, 120_000, async () => {
            const result = await this.json<Detail>(`/series/${id}`)
            if (!result || typeof result.title !== 'string' || !result.title.trim() || (result.series_id !== undefined && result.series_id !== id)) throw new Error('Kagane returned invalid series details')
            return result
        })
    }

    genres(): Promise<Genre[]> {
        return this.taxonomy('genres', async () => {
            const items = await this.json<Genre[]>('/genres/list')
            if (!Array.isArray(items) || !items.length || items.some((item) => !item || typeof item.id !== 'string' || typeof item.genre_name !== 'string')) throw new Error('Kagane genres are unavailable')
            return items
        })
    }

    tags(): Promise<TagEntry[]> {
        return this.taxonomy('tags', async () => {
            const items = await this.json<TagEntry[]>('/tags/list')
            if (!Array.isArray(items) || !items.length || items.some((item) => !item || typeof item.id !== 'string' || !item.id.trim() || typeof item.tag_name !== 'string' || !item.tag_name.trim())) throw new Error('Kagane tags are unavailable')
            return items
        })
    }

    sources(): Promise<UploadSource[]> {
        return this.taxonomy('sources', async () => {
            const result = await this.json<{ sources: UploadSource[] }>('/sources/list', { source_types: null })
            if (!Array.isArray(result?.sources) || !result.sources.length || result.sources.some((item) => !item || typeof item.source_id !== 'string' || typeof item.title !== 'string' || typeof item.source_type !== 'string')) throw new Error('Kagane upload sources are unavailable')
            return result.sources
        })
    }

    books(seriesId: string): Promise<Book[]> {
        return this.cached(`books:${validId(seriesId)}`, 120_000, async () => {
            const base = `/series/${seriesId}/books`
            const index = await this.json<{ fields: string[], books: unknown[][], count: number }>(`${base}/index`)
            const column = Array.isArray(index?.fields) ? index.fields.indexOf('book_id') : -1
            if (column < 0 || !Array.isArray(index.books) || !Number.isSafeInteger(index.count) || index.count < 0 || index.books.length !== index.count) throw new Error('Kagane chapter index is invalid')
            const expected = new Set<string>()
            for (const row of index.books) {
                const id = Array.isArray(row) ? row[column] : undefined
                if (typeof id !== 'string' || !id.trim() || expected.has(id)) throw new Error('Kagane chapter index has invalid or duplicate IDs')
                validId(id)
                expected.add(id)
            }
            const books: Book[] = []
            const seen = new Set<string>()
            const cursors = new Set<string>()
            let before: string | undefined
            for (let count = 0; count <= expected.size; count += 1) {
                const page = await this.json<{ items: Book[], next_cursor: string | null }>(`${base}?limit=200${before ? `&before=${encodeURIComponent(before)}` : ''}`)
                if (!page || !Array.isArray(page.items)) throw new Error('Kagane chapter page is missing items')
                for (const book of page.items) {
                    if (!book || typeof book.book_id !== 'string' || !expected.has(book.book_id) || seen.has(book.book_id) || (book.series_id != null && book.series_id !== seriesId) || typeof book.title !== 'string') throw new Error('Kagane chapter page does not match its series index; retry')
                    seen.add(book.book_id)
                    books.push(book)
                }
                if (page.next_cursor === null) {
                    if (seen.size !== expected.size) throw new Error('Kagane chapter list is incomplete; retry')
                    return books
                }
                const next = page.next_cursor
                if (typeof next !== 'string' || !next.trim() || cursors.has(next) || !page.items.length || seen.size === expected.size) throw new Error('Kagane chapter pagination did not advance')
                cursors.add(next)
                before = next
            }
            throw new Error('Kagane chapter pagination exceeded its index')
        })
    }

    private integrity(force = false): Promise<string> {
        if (!force && this.token && Date.now() + 5000 < this.expiry) return Promise.resolve(this.token)
        if (this.integrityRequest) return this.integrityRequest
        const generation = this.generation
        const request = (async () => {
            const warmup = await this.response(`${DOMAIN}/`)
            if (warmup.status >= 400) throw new Error(`Kagane session bootstrap failed (HTTP ${warmup.status})`)
            const result = this.parse<{ token: string, exp: number }>(await this.response(`${DOMAIN}/api/integrity`, {}))
            if (!result || typeof result.token !== 'string' || !result.token || !Number.isFinite(result.exp) || result.exp * 1000 <= Date.now()) throw new Error('Kagane returned an invalid reader bootstrap')
            if (generation !== this.generation) throw new Error('Kagane settings changed; refresh to continue')
            this.token = result.token
            this.expiry = result.exp * 1000
            return this.token
        })().finally(() => { if (this.integrityRequest === request) this.integrityRequest = undefined })
        this.integrityRequest = request
        return request
    }

    async challenge(chapterId: string, dataSaver: boolean): Promise<Challenge> {
        validId(chapterId)
        return this.cached(`reader:${chapterId}:${dataSaver}`, 0, async () => {
            for (const force of [false, true]) {
                const token = await this.integrity(force)
                const response = await this.response(`${API}/books/${chapterId}?is_datasaver=${dataSaver}`, {}, { 'x-integrity-token': token })
                if ([401, 403, 507].includes(response.status) && !force) {
                    // Refresh only the public session bootstrap, never a login or paid entitlement.
                    if (/login|sign.?in|subscription|premium|purchase|payment|paid|permission/i.test(response.data)) break
                    this.token = ''
                    this.expiry = 0
                    continue
                }
                const result = this.parse<Challenge>(response)
                const pages = result?.manifest?.pages
                if (!result || typeof result.access_token !== 'string' || !result.access_token || !Array.isArray(pages) || !pages.length) throw new Error('Kagane reader manifest is missing pages')
                const ids = new Set<string>()
                const positions = new Set<number>()
                for (const page of pages) {
                    if (!page || !Number.isInteger(page.page_no) || page.page_no < 0 || typeof page.page_id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(page.page_id) || (page.ext != null && !/^[a-z0-9]+$/i.test(page.ext)) || ids.has(page.page_id) || positions.has(page.page_no)) throw new Error('Kagane reader manifest contains invalid pages')
                    ids.add(page.page_id)
                    positions.add(page.page_no)
                }
                const ordered = [...positions].sort((left, right) => left - right)
                if ((ordered[0] !== 0 && ordered[0] !== 1) || ordered.some((position, index) => position !== (ordered[0] ?? 0) + index)) throw new Error('Kagane reader manifest page order is incomplete')
                this.cacheOrigin(result.cache_url)
                return result
            }
            throw new Error('Kagane requires account access or rejected the reader token; open the chapter on the website')
        })
    }

    private cacheOrigin(value?: string | null): string {
        const url = new URL(value || DOMAIN)
        // kstatic.to is the exact CDN published by Kagane's own reader challenge.
        // Do not trust arbitrary cache_url hosts or all domains under that CDN.
        if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || (url.hostname !== 'kstatic.to' && url.hostname !== 'kagane.org' && !url.hostname.endsWith('.kagane.org'))) throw new Error('Kagane returned an untrusted image server')
        return url.origin
    }

    pageURL(challenge: Challenge, chapterId: string, page: ManifestPage, dataSaver: boolean): string {
        return `${this.cacheOrigin(challenge.cache_url)}/api/v2/books/page/${validId(chapterId)}/${encodeURIComponent(page.page_id)}.${page.ext || 'jxl'}?token=${encodeURIComponent(challenge.access_token)}&is_datasaver=${dataSaver}`
    }
}
