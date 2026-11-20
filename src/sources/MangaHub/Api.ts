/* SPDX-License-Identifier: GPL-3.0-only */
/* Mana adaptation © 2026 Lucifers Circle. Protocol attribution: THIRD_PARTY_NOTICES.md. */
import { Body,
    CloudflareError,
    HttpClient,
    HttpMethod,
    HttpResponse,
    RequestOrigin,
    RateLimit,
    RateLimiter,
    OutcomeKind } from '@mana-app/types'
import { DOMAIN,
    imageURL,
    record,
    unrestricted } from './Parser'
export const GRAPHQL = 'https://api.mghcdn.com/graphql'
const CRYPTO = DOMAIN + '/api/chapter-crypto'
export class Api {
    private stopped?: Error
    private bootstrap?: Promise<void>
    private token = ''
    private cookieExpiresAt = Infinity
    private queue: Promise<unknown> = Promise.resolve()
    // One stable native identity. No cookie mutation, synthetic session history,
    // user-agent rotation, endpoint fallbacks, credential refresh or automatic retry.
    private readonly client = new HttpClient().setTimeoutMs(30000).setRetry(0).setRateLimiter(this.limiter(2)).addHeader('Referer', DOMAIN + '/').addRequestInterceptor(request => {
        this.assertOpen()
        if ((request.url === GRAPHQL && request.method === HttpMethod.Post && request.body !== undefined)
            || ([DOMAIN + '/', CRYPTO].includes(request.url) && request.method === HttpMethod.Get && request.body === undefined)) return request
        throw new Error('Unsupported MangaHub request')
    })
    private limiter(requests: number, issued?: (url: string) => void): RateLimiter {
        const limiter = RateLimit.spaced({ requests, intervalMs: 1000 })
        return {
            tryAcquire: context => { this.assertOpen(); issued?.(context.request.url); return limiter.tryAcquire(context) },
            onComplete: (context, outcome) => {
                limiter.onComplete?.(context, outcome)
                // SDK detects Cloudflare before response interceptors. Observe the outcome
                // here so even an image challenge is a sticky session stop.
                if (!this.stopped && outcome.kind === OutcomeKind.Response) {
                    if (outcome.headers.get('cf-mitigated')?.toLowerCase() === 'challenge') this.stopped = new CloudflareError(context.request.url)
                    else if (outcome.status !== 200) this.stopped = new Error(`MangaHub stopped (HTTP ${outcome.status}); no retry or access bypass`)
                }
            }
        }
    }
    assertOpen(): void { if (this.stopped) throw this.stopped }
    stop(error: unknown): never {
        if (!this.stopped) this.stopped = error instanceof Error ? error : new Error('MangaHub session stopped')
        throw this.stopped
    }
    private check(response: HttpResponse, body = ''): void {
        this.assertOpen()
        if (response.url !== response.request.url) this.stop(new Error('MangaHub redirected unexpectedly; session stopped'))
        if (response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge' || /cf-chl|cdn-cgi\/challenge-platform|challenges\.cloudflare\.com|<title>\s*Just a moment/i.test(body.slice(0, 16000))) this.stop(new CloudflareError(response.request.url))
        if (response.status !== 200) this.stop(new Error(`MangaHub stopped (HTTP ${response.status}); access and quota restrictions are not bypassed`))
    }
    private async response(url: string, query?: string): Promise<{ body: string, cookie: string }> {
        this.assertOpen()
        let response: HttpResponse | undefined
        try {
            const headers: Record<string, string> = { Accept: url === DOMAIN + '/' ? 'text/html' : 'application/json' }
            if (this.token && Date.now() >= this.cookieExpiresAt) throw new Error('MangaHub session cookie expired; no automatic refresh')
            if (this.token && url === GRAPHQL) headers['x-mhub-access'] = this.token
            if (this.token && url === CRYPTO) headers.Cookie = 'mhub_access=' + this.token
            if (url === GRAPHQL) headers.Origin = DOMAIN
            response = query === undefined ? await this.client.get(url, { headers }) : await this.client.post(url, Body.json({ query }), { headers })
            this.check(response)
            const length = response.headers.get('content-length')
            if (length && (!/^\d+$/.test(length) || Number(length) > 5_000_000)) throw new Error('Oversized MangaHub response')
            const body = await response.text()
            this.check(response, body)
            if (body.length > 5_000_000) throw new Error('Oversized MangaHub response')
            const type = response.headers.get('content-type') ?? ''
            if (!(url === DOMAIN + '/' ? /^text\/html(?:;|$)/i : /^application\/(?:json|graphql-response\+json)(?:;|$)/i).test(type)) throw new Error('Unsupported MangaHub response type')
            return { body, cookie: response.headers.get('set-cookie') ?? '' }
        } catch (error) { return this.stop(error) } finally { response?.releaseNative() }
    }
    private async initialize(): Promise<void> {
        if (!this.bootstrap) this.bootstrap = (async () => {
            const { cookie, body } = await this.response(DOMAIN + '/')
            if (/<form[^>]+(?:login|signin)|<title>[^<]*(?:access denied|rate limit|sign in|log in)|quota exceeded/i.test(body)) throw new Error('MangaHub homepage requires access; session stopped')
            if (cookie.length > 16384) throw new Error('Oversized MangaHub cookie header')
            const matches = cookie.split(/,(?=\s*[A-Za-z0-9_-]+=)|[\r\n]+/).map(value => value.trim()).filter(value => value.startsWith('mhub_access='))
            const segments = (matches[0] ?? '').split(';'), token = (segments[0] ?? '').slice('mhub_access='.length)
            if (matches.length !== 1 || !/^[A-Za-z0-9._~%+/=-]{1,4096}$/.test(token)) throw new Error('MangaHub did not issue a usable access token on the ordinary homepage; this ODT session cannot continue')
            const attributes = new Map<string, string>()
            for (const attribute of segments.slice(1)) {
                const [key, ...rest] = attribute.trim().split('='), name = (key ?? '').toLowerCase()
                if (!name || attributes.has(name)) throw new Error('Ambiguous MangaHub session cookie')
                attributes.set(name, rest.join('=').trim())
            }
            const domain = attributes.get('domain')?.toLowerCase(), path = attributes.get('path') ?? '/'
            if ((domain !== undefined && !['mangahub.io', '.mangahub.io'].includes(domain)) || !path.startsWith('/') || !(path === '/' || '/api/chapter-crypto' === path || '/api/chapter-crypto'.startsWith(path.endsWith('/') ? path : path + '/'))) throw new Error('MangaHub session cookie is not scoped to its crypto endpoint')
            if (attributes.has('expires')) {
                const expires = Date.parse(attributes.get('expires') as string)
                if (!Number.isFinite(expires) || expires <= Date.now()) throw new Error('MangaHub issued an invalid or expired cookie')
                this.cookieExpiresAt = expires
            }
            if (attributes.has('max-age')) {
                const age = attributes.get('max-age') as string
                if (!/^\d{1,9}$/.test(age) || Number(age) <= 0) throw new Error('MangaHub issued an expired cookie')
                this.cookieExpiresAt = Date.now() + Number(age) * 1000
            }
            this.token = token
        })().catch(error => this.stop(error))
        await this.bootstrap
    }
    private json(body: string): Record<string, unknown> {
        try { return record(JSON.parse(body)) } catch { throw new Error('Invalid MangaHub JSON response; no response content retained') }
    }
    private serial<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.queue.then(async () => { this.assertOpen(); return operation() })
        this.queue = next.catch(() => undefined)
        return next
    }
    async graphql(query: string): Promise<Record<string, unknown>> {
        return this.serial(async () => {
            try {
                if (query.length > 4000) throw new Error('Oversized MangaHub query')
                await this.initialize()
                const payload = this.json((await this.response(GRAPHQL, query)).body)
                if (payload.errors !== undefined && (!Array.isArray(payload.errors) || payload.errors.length > 0)) throw new Error('MangaHub API reported an error; session stopped without token refresh or retry')
                unrestricted(payload)
                return record(payload.data)
            } catch (error) { return this.stop(error) }
        })
    }
    async key(): Promise<Record<string, unknown>> {
        return this.serial(async () => {
            try {
                await this.initialize()
                const payload = this.json((await this.response(CRYPTO)).body)
                unrestricted(payload)
                if (payload.errors !== undefined || payload.error !== undefined) throw new Error('MangaHub key endpoint reported an error')
                return payload
            } catch (error) { return this.stop(error) }
        })
    }
    imageClient(origin: RequestOrigin.Cover | RequestOrigin.Page, issued: (url: string) => void): HttpClient {
        return new HttpClient().setTimeoutMs(30000).setRetry(0).setRateLimiter(this.limiter(3, issued)).addHeader('Referer', DOMAIN + '/').addRequestInterceptor((request, context) => {
            this.assertOpen()
            if (context.origin !== origin || request.method !== HttpMethod.Get || request.body !== undefined) throw new Error('Invalid MangaHub image request')
            imageURL(request.url, origin === RequestOrigin.Cover); issued(request.url)
            return request
        }).addResponseInterceptor(response => {
            this.check(response); issued(response.request.url)
            if (!/^image\/(?:jpeg|png|webp|gif|avif)(?:;|$)/i.test(response.headers.get('content-type') ?? '')) this.stop(new Error('MangaHub image response was not a supported image'))
            return response
        })
    }
}
