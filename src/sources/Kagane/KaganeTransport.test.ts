/* SPDX-License-Identifier: GPL-3.0-or-later */
import { BridgeOperation,
    CloudflareError,
    HttpBridge,
    HttpClient,
    HttpMethod,
    HttpResponse,
    imageDispatch,
    ImageRequest,
    RequestOrigin } from '@mana-app/types'
import { Target } from './index'
import { KaganeApi } from './KaganeApi'
import { Challenge,
    ManifestPage } from './KaganeModels'

const globals = globalThis as unknown as Record<string, unknown>
const domain = 'https://kagane.org'
const chapter = 'test-chapter'
const series = 'test-series'
const manifest = (token = 'test-only-token'): Challenge => ({ access_token: token, cache_url: 'https://kstatic.to', manifest: { pages: [{ page_id: 'page-one', page_no: 0, ext: 'webp' }] } })

type TestSource = {
    api: KaganeApi
    readerSessions: Map<string, { challenge: Challenge, expiry: number }>
    readerImages: Map<string, { seriesId: string, chapterId: string, page: ManifestPage, settingsKey: string }>
}

// Use the published SDK dispatcher, with only its native bridge replaced. These
// are no-network transport tests, not synthetic claims about live image bytes.
describe('Kagane SDK HTTP and image transport', () => {
    let priorBridge: unknown, priorStore: unknown
    let stored: Map<string, unknown>, sent: Record<string, unknown>[]
    let onFetch: (() => Promise<void> | void) | undefined
    let response: { status: number, headers: Record<string, string>, text: string }

    beforeEach(() => {
        priorBridge = globals.__manaHTTPBridge
        priorStore = globals.ObjectStore
        stored = new Map()
        sent = []
        onFetch = undefined
        response = { status: 200, headers: { 'content-type': 'image/webp' }, text: 'test-only-body' }
        globals.ObjectStore = { get: async (key: string) => stored.get(key), set: async (key: string, value: unknown) => { stored.set(key, value) } }
        const bridge: HttpBridge = {
            now: () => Date.now(),
            send: async (message) => {
                if (message.operation === BridgeOperation.Release || message.operation === BridgeOperation.Cancel) return {}
                if (message.operation !== BridgeOperation.Fetch) throw new Error('Unexpected test bridge operation')
                sent.push(message)
                await onFetch?.()
                return { ...response, bodyID: `fixture-${sent.length}`, sessionID: 'test', url: message.url }
            }
        }
        globals.__manaHTTPBridge = bridge
    })

    afterEach(() => {
        globals.__manaHTTPBridge = priorBridge
        globals.ObjectStore = priorStore
        jest.restoreAllMocks()
    })

    const dispatch = async (client: HttpClient, image: ImageRequest): Promise<HttpResponse> => {
        const result = await client[imageDispatch](image)
        await result.text()
        result.releaseNative()
        return result
    }
    const reader = async (): Promise<{ source: Target, internals: TestSource, url: string }> => {
        const source = new Target(), internals = source as unknown as TestSource
        jest.spyOn(internals.api, 'series').mockResolvedValue({ series_id: series, title: 'Test', age_rating: 'Safe', is_pornographic: false })
        jest.spyOn(internals.api, 'books').mockResolvedValue([{ book_id: chapter, series_id: series, title: 'One', page_count: 1 }])
        jest.spyOn(internals.api, 'challenge').mockResolvedValue(manifest())
        const data = await source.getChapterData(series, chapter)
        const url = data.pages?.[0]?.url
        if (!url) throw new Error('Missing test page')
        return { source, internals, url }
    }

    test('factories are synchronous and actual Cover dispatch preserves headers', async () => {
        const source = new Target(), request = { url: `${domain}/api/v2/image/cover`, origin: RequestOrigin.Cover as const }
        const transport = source.getCoverTransport(request)
        expect(transport).toBeInstanceOf(HttpClient)
        expect(sent).toHaveLength(0)
        await dispatch(transport, request)
        expect(sent).toHaveLength(1)
        expect(sent[0]).toMatchObject({ url: request.url, method: HttpMethod.Get, origin: RequestOrigin.Cover })
        expect(new Headers(sent[0]?.headers as Record<string, string>).get('referer')).toBe(`${domain}/`)
        expect(new Headers(sent[0]?.headers as Record<string, string>).get('origin')).toBe(domain)
    })

    test('reader context, trusted hosts and independent origins fail closed before image I/O', async () => {
        const { source, url } = await reader()
        for (const [value, origin, coverFactory] of [
            [url, RequestOrigin.Cover, true], [`${domain}/api/v2/image/cover`, RequestOrigin.Page, false],
            [url.replace('kstatic.to', 'untrusted.test'), RequestOrigin.Page, false],
            [url.replace('page-one', 'unissued'), RequestOrigin.Page, false],
            [url, RequestOrigin.Page, true]
        ] as const) {
            const request = { url: value, origin }
            await expect((async () => {
                const transport = coverFactory ? source.getCoverTransport(request) : source.getPageTransport(request)
                await dispatch(transport, request)
            })()).rejects.toThrow(/image|settings|reopen|origin/i)
        }
        expect(sent).toHaveLength(0)
        const request = { url, origin: RequestOrigin.Page as const }
        await dispatch(source.getPageTransport(request), request)
        expect(sent).toHaveLength(1)
        expect(sent[0]?.origin).toBe(RequestOrigin.Page)
    })

    test('an issued page is reauthorized at dispatch, not when its transport is created', async () => {
        const { source, url } = await reader(), request = { url, origin: RequestOrigin.Page as const }
        const transport = source.getPageTransport(request)
        stored.set('Kagane.contentRatings', [])
        await expect(dispatch(transport, request)).rejects.toThrow(/settings|reopen|excluded/)
        expect(sent).toHaveLength(0)
    })

    test('settings revocation during an async grant check prevents outgoing image I/O', async () => {
        const { source, internals, url } = await reader(), request = { url, origin: RequestOrigin.Page as const }
        let arrive: () => void = () => undefined, release: () => void = () => undefined
        const arrived = new Promise<void>((resolve) => { arrive = resolve })
        const gate = new Promise<void>((resolve) => { release = resolve })
        jest.spyOn(internals.api, 'series').mockImplementation(async () => {
            arrive()
            await gate
            return { series_id: series, title: 'Test', age_rating: 'Safe', is_pornographic: false }
        })
        const pending = dispatch(source.getPageTransport(request), request)
        const rejected = expect(pending).rejects.toThrow(/settings changed/)
        await arrived
        stored.set('Kagane.contentRatings', [])
        release()
        await rejected
        expect(sent).toHaveLength(0)
    })

    test('clients are reused per source and origin without response-time metadata re-fetch', async () => {
        const { source, internals, url } = await reader(), request = { url, origin: RequestOrigin.Page as const }
        const pageClient = source.getPageTransport(request)
        const cover = { url: `${domain}/api/v2/image/cover`, origin: RequestOrigin.Cover as const }
        expect(source.getPageTransport(request)).toBe(pageClient)
        expect(source.getCoverTransport(cover)).toBe(source.getCoverTransport({ ...cover, url: `${domain}/api/v2/image/other` }))
        expect(source.getCoverTransport(cover)).not.toBe(pageClient)
        expect(new Target().getPageTransport(request)).not.toBe(pageClient)
        const before = jest.mocked(internals.api.series).mock.calls.length
        await dispatch(pageClient, request)
        expect(jest.mocked(internals.api.series).mock.calls.length - before).toBe(1)
        await expect(dispatch(pageClient, { ...cover })).rejects.toThrow(/origin/)
        expect(sent).toHaveLength(1)
    })

    test('expired provider tokens renew the URL but retain exact page identity', async () => {
        const { source, internals, url } = await reader(), request = { url, origin: RequestOrigin.Page as const }
        const session = internals.readerSessions.get(`${series}:${chapter}`)
        if (!session) throw new Error('Missing test session')
        session.expiry = 0
        jest.spyOn(internals.api, 'challenge').mockResolvedValue(manifest('renewed-test-token'))
        await dispatch(source.getPageTransport(request), request)
        const renewed = new URL(String(sent[0]?.url))
        expect(renewed.pathname).toBe(new URL(url).pathname)
        expect(renewed.searchParams.get('token')).toBe('renewed-test-token')
        const updated = internals.readerSessions.get(`${series}:${chapter}`)
        if (!updated) throw new Error('Missing renewed session')
        updated.expiry = 0
        const changed = manifest('another-test-token')
        if (changed.manifest?.pages?.[0]) changed.manifest.pages[0].page_no = 1
        jest.spyOn(internals.api, 'challenge').mockResolvedValue(changed)
        await expect(dispatch(source.getPageTransport(request), request)).rejects.toThrow(/pages changed/)
        expect(sent).toHaveLength(1)
    })

    test('renewal cannot substitute a page, another chapter or an unavailable provider response', async () => {
        const { source, internals, url } = await reader(), request = { url, origin: RequestOrigin.Page as const }
        const session = internals.readerSessions.get(`${series}:${chapter}`)
        if (!session) throw new Error('Missing test session')
        session.expiry = 0
        const changed = manifest('changed-test-token')
        if (changed.manifest?.pages?.[0]) changed.manifest.pages[0].page_id = 'another-page'
        jest.spyOn(internals.api, 'challenge').mockResolvedValue(changed)
        await expect(dispatch(source.getPageTransport(request), request)).rejects.toThrow(/pages changed/)
        const otherChapter = { ...request, url: url.replace(`/page/${chapter}/`, '/page/another-chapter/') }
        await expect(dispatch(source.getPageTransport(otherChapter), otherChapter)).rejects.toThrow(/settings|reopen/)
        const renewed = internals.readerSessions.get(`${series}:${chapter}`)
        if (!renewed) throw new Error('Missing changed session')
        renewed.expiry = 0
        jest.spyOn(internals.api, 'challenge').mockRejectedValue(new Error('Kagane requires account access'))
        await expect(dispatch(source.getPageTransport(request), request)).rejects.toThrow(/account access/)
        expect(sent).toHaveLength(0)
    })

    test('typed JSON reaches the bridge unchanged and general HTTP rejects error statuses', async () => {
        const api = new KaganeApi()
        response = { status: 200, headers: { 'content-type': 'application/json' }, text: '{"content":[],"last":true}' }
        const body = { title: 'café', current_books: { min: 1, max: 20 } }
        await expect(api.search(body, 1, 50, '')).resolves.toEqual({ content: [], last: true })
        expect(sent[0]).toMatchObject({ method: HttpMethod.Post, body: JSON.stringify(body), url: `${domain}/api/v2/search/series?page=0&size=50` })
        response = { status: 500, headers: { 'content-type': 'application/json' }, text: '{"secret":"must-not-leak"}' }
        await expect(api.series('broken')).rejects.toThrow('Kagane request failed (HTTP 500)')
    })

    test('SDK early Cloudflare errors clear the cached public bootstrap token', async () => {
        const api = new KaganeApi(), internals = api as unknown as { token: string, expiry: number }
        internals.token = 'test-only-token'
        internals.expiry = Date.now() + 10000
        response = { status: 403, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' }, text: 'Just a moment' }
        await expect(api.series('challenged')).rejects.toBeInstanceOf(CloudflareError)
        expect(internals.token).toBe('')
        expect(internals.expiry).toBe(0)
    })
})
