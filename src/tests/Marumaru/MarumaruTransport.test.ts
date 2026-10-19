/* SPDX-License-Identifier: GPL-3.0-or-later */
import { BridgeOperation,
    CloudflareError,
    ContentRating,
    HttpBridge,
    HttpClient,
    HttpHeaders,
    HttpBodyKind,
    imageDispatch,
    ImageRequest,
    RequestOrigin,
    HttpMethod } from '@mana-app/types'
import { MarumaruAPI,
    MarumaruService,
    validateAPIURL } from '../../sources/Marumaru/MarumaruService'
import { Target } from '../../sources/Marumaru/index'
import * as metadata from '../../sources/Marumaru/MarumaruPolicy'
import { enter,
    accessPolicy,
    beginAccess,
    grant,
    checkTitle,
    observe,
    revoke } from '../../sources/Marumaru/MarumaruPolicy'

const globals = globalThis as unknown as Record<string, unknown>
const cover = 'https://peer.storagewebtoon.store/manhwa/123/cover.webp'
const page = 'https://peer.storagewebtoon.store/api/media/episode/456/1.webp'

describe('Marumaru SDK image transport', () => {
    let priorBridge: unknown, priorStore: unknown
    let sent: Record<string, unknown>[]
    let respond: (message: Record<string, unknown>) => Promise<{ status: number, headers: Record<string, string>, text: string, url?: string }>

    beforeEach(async () => {
        priorBridge = globals.__manaHTTPBridge
        priorStore = globals.ObjectStore
        const values = new Map<string, unknown>()
        globals.ObjectStore = { get: async (key: string) => values.get(key), set: async (key: string, value: unknown) => { values.set(key, value) } }
        sent = []
        respond = async () => ({ status: 200, headers: { 'content-type': 'image/webp' }, text: 'transport-test-only' })
        const bridge: HttpBridge = {
            now: () => Date.now(),
            send: async message => {
                if (message.operation === BridgeOperation.Release || message.operation === BridgeOperation.Cancel) return {}
                if (message.operation !== BridgeOperation.Fetch) throw new Error('Unexpected test bridge operation')
                sent.push(message)
                return { bodyID: `fixture-${sent.length}`, sessionID: 'test', url: message.url, ...await respond(message) }
            }
        }
        globals.__manaHTTPBridge = bridge
        const policy = await enter()
        await observe('123', false, policy)
        await grant('123', policy)
    })

    afterEach(() => {
        globals.__manaHTTPBridge = priorBridge
        globals.ObjectStore = priorStore
        jest.restoreAllMocks()
    })

    async function dispatch(client: HttpClient, request: ImageRequest) {
        const response = await client[imageDispatch](request)
        response.releaseNative()
        return response
    }

    test('fresh and repeated public images preserve separate origins and headers without ObjectStore', async () => {
        const unexpected = async () => { throw new Error('Public image transport must not use ObjectStore') }
        const store = { get: jest.fn(unexpected), set: jest.fn(unexpected), remove: jest.fn(unexpected), boolean: jest.fn(unexpected) }
        globals.ObjectStore = store
        const timeouts = jest.spyOn(HttpClient.prototype, 'setTimeoutMs'), source = new Target()
        for (const [url, origin] of [[cover, RequestOrigin.Cover], [page, RequestOrigin.Page]] as const) {
            const request = { url, origin }
            const client = origin === RequestOrigin.Cover ? source.getCoverTransport(request) : source.getPageTransport(request)
            expect(client).toBeInstanceOf(HttpClient)
            const before = sent.length
            await dispatch(client, request)
            expect(sent).toHaveLength(before + 1)
            expect(sent[before]).toMatchObject({ url, origin, method: HttpMethod.Get })
            expect(sent[before]?.timeoutMs).toBeGreaterThan(0)
            expect(sent[before]?.timeoutMs).toBeLessThanOrEqual(30000)
            expect(sent[before]?.body).toBeUndefined()
            expect(new Headers(sent[before]?.headers as Record<string, string>).get('referer'))
                .toBe('https://marumaru105.com/')
            expect(new Headers(sent[before]?.headers as Record<string, string>).has('x-site')).toBe(false)
            await dispatch(client, request)
        }
        expect(timeouts.mock.calls).toEqual([[30000], [30000], [30000], [30000]])
        for (const method of Object.values(store)) expect(method).not.toHaveBeenCalled()
    })

    test('cross-origin and malformed public URLs fail before transport', async () => {
        const source = new Target(), request = { url: cover, origin: RequestOrigin.Cover as const }
        expect(() => source.getCoverTransport({ ...request, origin: RequestOrigin.Page })).toThrow(/identity/)
        expect(() => source.getPageTransport({ ...request, origin: RequestOrigin.Page })).toThrow(/identity/)
        for (const url of ['https://foreign.invalid/cover.webp', cover.replace('https:', 'http:'), cover.replace('https://', 'https://user@'),
            cover + '?token=x', cover + '#fragment', cover + '\n', cover.replace('cover.webp', '..'), cover.replace('123', '9007199254740992')])
            expect(() => source.getCoverTransport({ ...request, url })).toThrow()
        expect(() => source.getPageTransport({ url: page.replace('456', '9007199254740992'), origin: RequestOrigin.Page })).toThrow()
        expect(sent).toHaveLength(0)
    })

    test('revocation blocks chapters but does not revoke a public page before dispatch', async () => {
        const source = new Target(), request = { url: page, origin: RequestOrigin.Page as const }
        const client = source.getPageTransport(request)
        await revoke('123')
        await expect(source.getChapterData('123', '456')).rejects.toThrow(/Refresh Marumaru/)
        await expect(dispatch(client, request)).resolves.toBeDefined()
        expect(sent).toHaveLength(1)
    })

    test('revocation during image transport does not revoke public bytes', async () => {
        const source = new Target(), request = { url: cover, origin: RequestOrigin.Cover as const }
        respond = async () => {
            await revoke('123')
            return { status: 200, headers: { 'content-type': 'image/webp' }, text: 'transport-test-only' }
        }
        await expect(dispatch(source.getCoverTransport(request), request)).resolves.toBeDefined()
        await expect(accessPolicy('123')).rejects.toThrow(/Refresh Marumaru/)
        expect(sent).toHaveLength(1)
    })

    test('official SDK challenge detection is preserved', async () => {
        const source = new Target(), request = { url: cover, origin: RequestOrigin.Cover as const }
        respond = async () => ({ status: 200, headers: { 'cf-mitigated': 'challenge' }, text: 'test-only challenge' })
        await expect(dispatch(source.getCoverTransport(request), request)).rejects.toBeInstanceOf(CloudflareError)
        expect(sent).toHaveLength(1)
    })
    test('reuses exactly one client per image origin without constructor churn', () => {
        const source = new Target(), coverRequest = { url: cover, origin: RequestOrigin.Cover as const }, pageRequest = { url: page, origin: RequestOrigin.Page as const }
        expect(source.getCoverTransport(coverRequest)).toBe(source.getCoverTransport(coverRequest))
        expect(source.getPageTransport(pageRequest)).toBe(source.getPageTransport(pageRequest))
        expect(source.getCoverTransport(coverRequest)).not.toBe(source.getPageTransport(pageRequest))
    })

    test('shared clients check every dispatch URL, native origin and GET-without-body constraint', async () => {
        const interceptors = jest.spyOn(HttpClient.prototype, 'addRequestInterceptor'), source = new Target()
        const request = { url: cover, origin: RequestOrigin.Cover as const }, client = source.getCoverTransport(request)
        await expect(client.get(cover)).rejects.toThrow(/identity/)
        await expect(dispatch(client, { url: cover, origin: RequestOrigin.Page })).rejects.toThrow(/identity/)
        await expect(dispatch(client, { ...request, url: 'https://foreign.invalid/image.webp' })).rejects.toThrow(/identity/)
        const index = interceptors.mock.results.findIndex(result => result.type === 'return' && result.value === client)
        const interceptor = interceptors.mock.calls[index]?.[0]
        if (!interceptor) throw new Error('Missing image request interceptor')
        const context = { origin: RequestOrigin.Cover, requestId: 'method-control', attempt: 1, metadata: {} }
        expect(() => interceptor({ url: cover, method: HttpMethod.Post, headers: new HttpHeaders(), fragmentParams: Object.freeze({}) }, context)).toThrow(/image request/)
        expect(() => interceptor({ url: cover, method: HttpMethod.Get, headers: new HttpHeaders(), fragmentParams: Object.freeze({}), body: { kind: HttpBodyKind.Text, value: 'unexpected' } }, context)).toThrow(/image request/)
        expect(sent).toHaveLength(0)
    })

    test('concurrent public responses and a failed dispatch leave the reusable client independent', async () => {
        const unexpected = async () => { throw new Error('Public image transport must not use ObjectStore') }
        globals.ObjectStore = { get: unexpected, set: unexpected, remove: unexpected, boolean: unexpected }
        const source = new Target(), other = 'https://peer.storagewebtoon.store/manhwa/789/unissued.webp'
        let finish: ((value: {status: number; headers: Record<string, string>; text: string}) => void) | undefined
        let started: (() => void) | undefined
        const waiting = new Promise<void>(resolve => { started = resolve })
        respond = async message => {
            if (message.url === cover) return new Promise(resolve => { finish = resolve; started?.() })
            throw new Error('isolated transport failure')
        }
        const request = { url: cover, origin: RequestOrigin.Cover as const }, client = source.getCoverTransport(request)
        const first = dispatch(client, request)
        await waiting
        const second = { url: other, origin: RequestOrigin.Cover as const }
        await expect(dispatch(client, second)).rejects.toThrow('isolated transport failure')
        respond = async () => ({ status: 200, headers: { 'content-type': 'image/webp' }, text: 'transport-test-only' })
        await dispatch(client, second)
        finish?.({ status: 200, headers: { 'content-type': 'image/webp' }, text: 'transport-test-only' })
        await first
        expect(sent.map(message => message.url)).toEqual([cover, other, other])
    })

    test('redirected image response is rejected even for another valid public URL', async () => {
        const source = new Target(), request = { url: cover, origin: RequestOrigin.Cover as const }
        respond = async () => ({ status: 200, headers: { 'content-type': 'image/webp' }, text: 'transport-test-only', url: page })
        await expect(dispatch(source.getCoverTransport(request), request)).rejects.toThrow(/response identity/)
    })

    test('native API clients keep site headers isolated from the advertised reader origin', async () => {
        respond = async () => ({ status: 200, headers: { 'content-type': 'application/json' }, text: '{}' })
        const api = new MarumaruAPI()
        for (const url of ['https://marumaru105.com/api/works/123', 'https://api.storagewebtoon.store/api/v1/reader/A2/works/123', 'https://api.storagewebtoon.store/api/v1/reader/A2/episodes/456']) await api.json(url)
        expect(sent).toHaveLength(3)
        expect(sent.every(message => message.origin === RequestOrigin.General && message.method === HttpMethod.Get)).toBe(true)
        expect(new Headers(sent[0]?.headers as Record<string,string>).get('x-site')).toBe('marumaru')
        for (const message of sent.slice(1)) expect(new Headers(message.headers as Record<string,string>).get('x-site')).toBeNull()
        for (const message of sent) {
            const headers = new Headers(message.headers as Record<string,string>)
            expect(headers.get('referer')).toBe('https://marumaru105.com/')
            expect(headers.get('accept')).toBe('application/json')
        }
    })

    test('API routes reject credentials, cross-origin, tokens and document paths before I/O', async () => {
        const api = new MarumaruAPI()
        for (const url of ['https://marumaru105.com/manhwa/123', 'https://other.invalid/api/works/123', 'https://user@marumaru105.com/api/works/123', 'https://marumaru105.com/api/works/123?token=x', 'https://marumaru105.com/api/works/123\n']) {
            expect(() => validateAPIURL(url)).toThrow()
            await expect(api.json(url)).rejects.toThrow()
        }
        expect(sent).toHaveLength(0)
    })

    test('API rejects redirected JSON and preserves SDK challenge detection', async () => {
        const api = new MarumaruAPI(), url = 'https://marumaru105.com/api/works/123'
        respond = async () => ({ status: 200, headers: { 'content-type': 'application/json' }, text: '{}', url: url + '/other' })
        await expect(api.json(url)).rejects.toThrow(/invalid API response/)
        respond = async () => ({ status: 403, headers: { 'cf-mitigated': 'challenge' }, text: 'test-only challenge' })
        await expect(api.json(url)).rejects.toBeInstanceOf(CloudflareError)
    })

    test('native pagination can continue past the former hundred-page limit', async () => {
        const urls: string[] = [], stop = new Error('transport sentinel')
        const service = new MarumaruService(async url => { urls.push(url); throw stop })
        await expect(service.catalog(101)).rejects.toBe(stop)
        await expect(service.search('query', 101)).rejects.toBe(stop)
        expect(urls).toEqual(['https://marumaru105.com/api/works?mediaType=MANHWA&page=100&size=49', 'https://marumaru105.com/api/search?q=query&page=100&media=MANHWA&sort=LATEST'])
    })

    test('does not invent a User-Agent and preserves a caller-supplied request header', async () => {
        const source = new Target(), api = new MarumaruAPI(), request = { url: cover, origin: RequestOrigin.Cover as const }
        respond = async () => ({ status: 200, headers: { 'content-type': 'application/json' }, text: '{}' })
        await api.json('https://marumaru105.com/api/works/123')
        await api.json('https://api.storagewebtoon.store/api/v1/reader/A2/works/123')
        await dispatch(source.getCoverTransport(request), request)
        const pageRequest = { url: page, origin: RequestOrigin.Page as const }
        await dispatch(source.getPageTransport(pageRequest), pageRequest)
        for (const message of sent) expect(new Headers(message.headers as Record<string, string>).has('user-agent')).toBe(false)
        const supplied = 'TestHostNativeIdentity/1.0'
        source.getCoverTransport(request).addHeader('User-Agent', supplied)
        await dispatch(source.getCoverTransport(request), request)
        expect(new Headers(sent[4]?.headers as Record<string, string>).get('user-agent')).toBe(supplied)
    })

    test('SDK Cloudflare errors retain the actual API and image resolution URL', async () => {
        const source = new Target(), api = new MarumaruAPI(), url = 'https://marumaru105.com/api/works/123'
        respond = async () => ({ status: 503, headers: { server: 'cloudflare', 'content-type': 'text/html' }, text: '<html>cf-chl-test</html>' })
        await expect(api.json(url)).rejects.toMatchObject({ name: 'CloudflareError', resolutionURL: url })
        for (const [image, origin] of [[cover, RequestOrigin.Cover], [page, RequestOrigin.Page]] as const) {
            const request = { url: image, origin }
            const client = origin === RequestOrigin.Cover ? source.getCoverTransport(request) : source.getPageTransport(request)
            await expect(dispatch(client, request)).rejects.toMatchObject({ name: 'CloudflareError', resolutionURL: image })
        }
    })

    test('ordinary JSON 406 stays an HTTP failure, not a forged Cloudflare challenge', async () => {
        respond = async () => ({ status: 406, headers: { 'content-type': 'application/json' }, text: '{"status":406,"path":"/seo-gate"}' })
        await expect(new MarumaruAPI().json('https://marumaru105.com/api/works/123')).rejects.toThrow('Marumaru API request failed (HTTP 406)')
    })

    test('separate runtimes cannot overwrite a newer title grant with a catalog write', async () => {
        await revoke('123')
        const key = 'Marumaru.authorization.v1'
        const initial = await ObjectStore.get(key) as { titles: { id: string }[] }
        initial.titles = initial.titles.filter(title => title.id !== '123')
        const values = new Map<string, unknown>([[key, initial]])
        const clone = (value: unknown) => value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as unknown
        let release: (() => void) | undefined, started: (() => void) | undefined
        const waiting = new Promise<void>(resolve => { started = resolve })
        const held = new Promise<void>(resolve => { release = resolve })
        let delayed = false
        globals.ObjectStore = {
            get: async (name: string) => clone(values.get(name)),
            set: async (name: string, value: unknown) => {
                const state = value as { titles?: { id: string }[] }
                if (name === key && !delayed && state.titles?.some(title => title.id === '789')) {
                    delayed = true; started?.(); await held
                }
                values.set(name, clone(value))
            }
        }
        let catalog!: typeof import('../../sources/Marumaru/MarumaruPolicy'), detail!: typeof import('../../sources/Marumaru/MarumaruPolicy')
        jest.isolateModules(() => { catalog = jest.requireActual<typeof import('../../sources/Marumaru/MarumaruPolicy')>('../../sources/Marumaru/MarumaruPolicy') })
        jest.isolateModules(() => { detail = jest.requireActual<typeof import('../../sources/Marumaru/MarumaruPolicy')>('../../sources/Marumaru/MarumaruPolicy') })
        const pending = catalog.observe('789', false, await catalog.enter())
        await waiting
        await detail.observe('123', false, await detail.enter())
        await detail.grant('123', await detail.enter())
        release?.(); await pending
        await expect(accessPolicy('123')).resolves.toMatchObject({ revision: 0 })
    })

    test('revoked access cannot be restored by an older shared-state snapshot', async () => {
        const key = 'Marumaru.authorization.v1'
        const snapshot = JSON.parse(JSON.stringify(await ObjectStore.get(key))) as unknown
        await revoke('123')
        await ObjectStore.set(key, snapshot)
        await expect(accessPolicy('123')).rejects.toThrow(/Refresh Marumaru/)
        const source = new Target(), request = { url: page, origin: RequestOrigin.Page as const }
        await expect(dispatch(source.getPageTransport(request), request)).resolves.toBeDefined()
        expect(sent).toHaveLength(1)
    })

    test('separate persisted access keeps its issuing scope and rejects stronger classification', async () => {
        const policy = await enter({ allowedContentRatings: [ContentRating.SUGGESTIVE] })
        await grant('123', policy)
        await expect(accessPolicy('123')).resolves.toMatchObject(policy)
        const key = 'Marumaru.authorization.v1', older = JSON.parse(JSON.stringify(await ObjectStore.get(key))) as unknown
        await observe('123', true, await enter())
        await expect(accessPolicy('123')).rejects.toThrow(/Refresh Marumaru/)
        await ObjectStore.set(key, older)
        await expect(accessPolicy('123')).rejects.toThrow(/Refresh Marumaru/)
    })

    test('expired separate access does not fall back to fresh legacy evidence', async () => {
        const key = 'Marumaru.access.v2.123'
        const saved = await ObjectStore.get(key) as Record<string, unknown>
        await ObjectStore.set(key, { ...saved, at: Date.now() - 3600000 })
        await expect(accessPolicy('123')).rejects.toThrow(/Refresh Marumaru/)
        const source = new Target(), request = { url: page, origin: RequestOrigin.Page as const }
        await expect(dispatch(source.getPageTransport(request), request)).resolves.toBeDefined()
        expect(sent).toHaveLength(1)
    })

    test('missing access remains fail-closed before chapter network requests', async () => {
        await expect(new Target().getChapterData('789', '456')).rejects.toThrow(/Refresh Marumaru/)
        expect(sent).toHaveLength(0)
    })

    test('revocation invalidates a grant already waiting on another runtime write', async () => {
        const keys = ['Marumaru.authorization.v1', 'Marumaru.access.v2.123', 'Marumaru.access-epoch.v2.123']
        const values = new Map<string, unknown>()
        const clone = (value: unknown) => value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as unknown
        for (const key of keys) values.set(key, clone(await ObjectStore.get(key)))
        let release: (() => void) | undefined, started: (() => void) | undefined
        const waiting = new Promise<void>(resolve => { started = resolve })
        const held = new Promise<void>(resolve => { release = resolve })
        globals.ObjectStore = {
            get: async (key: string) => clone(values.get(key)),
            set: async (key: string, value: unknown) => {
                if (key === 'Marumaru.access.v2.123') { started?.(); await held }
                values.set(key, clone(value))
            }
        }
        let first!: typeof import('../../sources/Marumaru/MarumaruPolicy'), second!: typeof import('../../sources/Marumaru/MarumaruPolicy')
        jest.isolateModules(() => { first = jest.requireActual<typeof import('../../sources/Marumaru/MarumaruPolicy')>('../../sources/Marumaru/MarumaruPolicy') })
        jest.isolateModules(() => { second = jest.requireActual<typeof import('../../sources/Marumaru/MarumaruPolicy')>('../../sources/Marumaru/MarumaruPolicy') })
        const policy = await first.beginAccess('123', await first.enter())
        const pending = first.grant('123', policy)
        const rejected = expect(pending).rejects.toThrow(/content policy changed/)
        await waiting
        await second.revoke('123')
        release?.(); await rejected
        await expect(second.accessPolicy('123')).rejects.toThrow(/Refresh Marumaru/)
    })

    test('an older request cannot overwrite or revoke a newer native rating scope', async () => {
        const older = await beginAccess('123', await enter())
        const current = await beginAccess('123', await enter({ allowedContentRatings: [ContentRating.SUGGESTIVE] }))
        await grant('123', current)
        await expect(checkTitle('123', older)).rejects.toThrow(/content policy changed/)
        await expect(grant('123', older)).rejects.toThrow(/content policy changed/)
        await revoke('123', older)
        await expect(accessPolicy('123')).resolves.toEqual(current)
    })

    test('adult evidence survives stale snapshots while a new access grant is pending', async () => {
        const policy = await beginAccess('123', await enter({ allowedContentRatings: [ContentRating.SUGGESTIVE] }))
        const key = 'Marumaru.authorization.v1', older = JSON.parse(JSON.stringify(await ObjectStore.get(key))) as unknown
        await observe('123', true, await enter())
        await ObjectStore.set(key, older)
        await expect(checkTitle('123', policy)).rejects.toThrow(/allowed fresh metadata/)
        await expect(checkTitle('123', await enter())).resolves.toBe(true)
        await expect(grant('123', policy)).rejects.toThrow(/no allowed access/)
        await expect(accessPolicy('123')).rejects.toThrow(/Refresh Marumaru/)
        await expect(observe('123', false, await enter())).resolves.toBe(true)
        expect(sent).toHaveLength(0)
    })

    test('title checks require fresh metadata but not a completed detail grant', async () => {
        const policy = await beginAccess('789', await enter({ allowedContentRatings: [ContentRating.SUGGESTIVE] }))
        await expect(checkTitle('789', policy)).rejects.toThrow(/allowed fresh metadata/)
        await observe('789', false, policy)
        const writes = jest.spyOn(ObjectStore, 'set')
        await expect(checkTitle('789', policy)).resolves.toBe(false)
        expect(writes).not.toHaveBeenCalled()
        await expect(accessPolicy('789')).rejects.toThrow(/Refresh Marumaru/)
        await expect(checkTitle('123', policy)).rejects.toThrow(/identity mismatch/)
        await expect(checkTitle('789', { ...policy, revision: policy.revision + 1 })).rejects.toThrow(/content policy changed/)
        await grant('789', policy)
        const now = Date.now(), time = jest.spyOn(Date, 'now').mockReturnValue(now + 1800000)
        writes.mockClear()
        await expect(checkTitle('789', policy)).resolves.toBe(false)
        expect(writes).not.toHaveBeenCalled()
        time.mockReturnValue(now + 3600000)
        await expect(checkTitle('789', policy)).rejects.toThrow(/allowed fresh metadata/)
        await expect(accessPolicy('789')).rejects.toThrow(/Refresh Marumaru/)
        expect(sent).toHaveLength(0)
    })

    test('legacy images are never read or copied while metadata fields and access survive', async () => {
        const key = 'Marumaru.authorization.v1', state = await ObjectStore.get(key) as object
        const legacy = { ...state }
        Object.defineProperty(legacy, 'images', { enumerable: true, get: () => { throw new Error('Obsolete image data was read') } })
        await ObjectStore.set(key, legacy)
        const policy = await enter()
        await expect(checkTitle('123', policy)).resolves.toBe(false)
        await expect(accessPolicy('123')).resolves.toMatchObject(policy)
        await observe('789', false, policy)
        const projected = await ObjectStore.get(key) as { titles: { id: string }[]; access: { id: string }[] }
        expect(Object.keys(projected).sort()).toEqual(['access', 'revision', 'titles'])
        expect(projected.titles.map(title => title.id)).toEqual(['123', '789'])
        expect(projected.access.map(entry => entry.id)).toEqual(['123'])
        await ObjectStore.set(key, { ...projected, revision: -1 })
        await expect(enter()).rejects.toThrow(/Invalid Marumaru policy state/)
    })

    test('detail and search return the final stronger title classification', async () => {
        const card = { id: '123', title: 'Title', cover, genres: [], explicitlyAdult: false }
        jest.spyOn(MarumaruService.prototype, 'detail').mockResolvedValue({ ...card, chapters: [], episodesUrl: 'https://api.storagewebtoon.store/api/v1/reader/A2/works/123' })
        jest.spyOn(MarumaruService.prototype, 'catalog').mockResolvedValue({ items: [card] })
        const original = observe
        jest.spyOn(metadata, 'observe').mockImplementation(async (work, adult, policy) => {
            const first = await original(work, adult, policy)
            await original(work, true, policy)
            return first
        })
        const source = new Target()
        await expect(source.getContent('123')).resolves.toMatchObject({ contentRating: ContentRating.EXPLICIT })
        await ObjectStore.set('Marumaru.adult.v2.123', undefined)
        await ObjectStore.set('Marumaru.authorization.v1', { revision: 0, titles: [], access: [] })
        await expect(source.search({ page: 1 })).resolves.toMatchObject({ results: [{ contentRating: ContentRating.EXPLICIT }] })
        expect(sent).toHaveLength(0)
    })

    test('reader completion checks stronger metadata once without per-image requests', async () => {
        const policy = await enter({ allowedContentRatings: [ContentRating.SUGGESTIVE] })
        await grant('123', policy)
        jest.spyOn(MarumaruService.prototype, 'detail').mockResolvedValue({ id: '123', title: 'Title', cover, genres: [], explicitlyAdult: false,
            chapters: [{ id: '456', workId: '123', sourceNumber: 1, title: 'Chapter', date: new Date(0) }],
            episodesUrl: 'https://api.storagewebtoon.store/api/v1/reader/A2/works/123' })
        const reader = jest.spyOn(MarumaruService.prototype, 'reader').mockImplementation(async () => {
            await observe('123', true, await enter())
            return [page, page.replace('1.webp', '2.webp')]
        })
        const checked = jest.spyOn(metadata, 'checkTitle')
        await expect(new Target().getChapterData('123', '456')).rejects.toThrow(/allowed fresh metadata/)
        expect(reader).toHaveBeenCalledTimes(1)
        // One detail boundary and one post-reader boundary, independent of page count.
        expect(checked).toHaveBeenCalledTimes(2)
        expect(sent).toHaveLength(0)
    })

    test('a delayed old failure does not revoke a newer successful grant', async () => {
        const keys = ['Marumaru.authorization.v1', 'Marumaru.access.v2.123', 'Marumaru.access-epoch.v2.123']
        const values = new Map<string, unknown>()
        const clone = (value: unknown) => value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as unknown
        for (const key of keys) values.set(key, clone(await ObjectStore.get(key)))
        let release: (() => void) | undefined, started: (() => void) | undefined
        const waiting = new Promise<void>(resolve => { started = resolve })
        const held = new Promise<void>(resolve => { release = resolve })
        globals.ObjectStore = {
            get: async (key: string) => clone(values.get(key)),
            set: async (key: string, value: unknown) => {
                if (key.startsWith('Marumaru.revoked.v2.')) { started?.(); await held }
                values.set(key, clone(value))
            }
        }
        let first!: typeof import('../../sources/Marumaru/MarumaruPolicy'), second!: typeof import('../../sources/Marumaru/MarumaruPolicy')
        jest.isolateModules(() => { first = jest.requireActual<typeof import('../../sources/Marumaru/MarumaruPolicy')>('../../sources/Marumaru/MarumaruPolicy') })
        jest.isolateModules(() => { second = jest.requireActual<typeof import('../../sources/Marumaru/MarumaruPolicy')>('../../sources/Marumaru/MarumaruPolicy') })
        const older = await first.beginAccess('123', await first.enter())
        const pending = first.revoke('123', older)
        await waiting
        const current = await second.beginAccess('123', await second.enter({ allowedContentRatings: [ContentRating.SUGGESTIVE] }))
        await second.grant('123', current)
        release?.(); await pending
        await expect(second.accessPolicy('123')).resolves.toEqual(current)
    })

})
