import { BridgeOperation,
    ContentRating,
    HttpBridge,
    HttpClient,
    HttpHeaders,
    HttpMethod,
    imageDispatch,
    RequestOrigin } from '@mana-app/types'
import { Target } from '../../sources/MangaSushi/index'
import { MangaSushiApi } from '../../sources/MangaSushi/MangaSushiApi'
import * as parser from '../../sources/MangaSushi/MangaSushiParser'
import * as policy from '../../sources/MangaSushi/MangaSushiPolicy'

const globals = globalThis as unknown as Record<string, unknown>
const cover = 'https://mangasushi.org/wp-content/uploads/public-cover.jpg'
const page = 'https://mangasushi.org/wp-content/uploads/WP-manga/data/title/chapter/01.jpg'
const setting = 'MangaSushi.excludeNSFW'
function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>(done => { resolve = done })
    return { promise, resolve }
}

// Real SDK with a local bridge, not provider requests or native-app cache proof.
describe('MangaSushi public images and retained classification policy', () => {
    let previousStore: unknown, previousBridge: unknown, sent: Record<string, unknown>[]
    let store: { get: jest.Mock, set: jest.Mock, boolean: jest.Mock }, saved: Map<string, unknown>
    let response: (message: Record<string, unknown>) => Promise<string>
    beforeEach(() => {
        previousStore = globals.ObjectStore; previousBridge = globals.__manaHTTPBridge
        sent = []; saved = new Map()
        const unexpected = async () => { throw new Error('Public images must not access ObjectStore') }
        store = { get: jest.fn(unexpected), set: jest.fn(unexpected), boolean: jest.fn(unexpected) }
        globals.ObjectStore = store
        response = async message => String(message.url)
        const bridge: HttpBridge = { now: () => Date.now(), send: async message => {
            if (message.operation === BridgeOperation.Release) return {}
            if (message.operation !== BridgeOperation.Fetch) throw new Error('Unexpected bridge operation')
            sent.push(message)
            return { bodyID: String(sent.length), sessionID: 'control', url: message.url, status: 200, text: await response(message) }
        } }
        globals.__manaHTTPBridge = bridge
    })
    afterEach(() => { globals.ObjectStore = previousStore; globals.__manaHTTPBridge = previousBridge; jest.restoreAllMocks() })
    function metadataStore(): void {
        store.get.mockImplementation(async key => structuredClone(saved.get(key)))
        store.set.mockImplementation(async (key, value) => { saved.set(key, structuredClone(value)) })
        store.boolean.mockImplementation(async key => saved.get(key))
    }
    async function read(client: HttpClient, url: string, origin: RequestOrigin.Cover | RequestOrigin.Page): Promise<string> {
        const result = await client[imageDispatch]({ url, origin })
        try { return await result.text() } finally { result.releaseNative() }
    }

    test('two reusable clients serve fresh, repeated and concurrent public URLs without stored image permissions', async () => {
        const source = new Target(), covers = source.getCoverTransport({ url: cover, origin: RequestOrigin.Cover })
        const pages = source.getPageTransport({ url: page, origin: RequestOrigin.Page })
        expect(covers).toBe(source.getCoverTransport({ url: page, origin: RequestOrigin.Cover }))
        expect(pages).toBe(source.getPageTransport({ url: cover, origin: RequestOrigin.Page }))
        expect(covers).not.toBe(pages)
        const started = deferred<void>(), finish = deferred<string>()
        response = async message => message.url === page ? (started.resolve(), finish.promise) : String(message.url)
        const pending = read(pages, page, RequestOrigin.Page); await started.promise
        await expect(read(covers, cover, RequestOrigin.Cover)).resolves.toBe(cover)
        response = async () => { throw new Error('isolated failure') }
        await expect(read(pages, cover, RequestOrigin.Page)).rejects.toThrow('isolated failure')
        finish.resolve(page); await expect(pending).resolves.toBe(page)
        response = async message => String(message.url)
        await expect(read(pages, cover, RequestOrigin.Page)).resolves.toBe(cover)
        const fresh = new Target(), query = `${cover}?rendition=public`
        await expect(read(fresh.getCoverTransport({ url: query, origin: RequestOrigin.Cover }), query, RequestOrigin.Cover)).resolves.toBe(query)
        for (const message of sent) {
            const headers = new HttpHeaders(message.headers as Record<string, string>)
            expect(message.method).toBe(HttpMethod.Get)
            expect(headers.get('referer')).toBe('https://mangasushi.org/')
            expect(headers.get('accept')).toBe('image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5')
        }
        for (const method of Object.values(store)) expect(method).not.toHaveBeenCalled()
    })

    test('factory and dispatch URL, origin and GET guards remain independent of prior calls', async () => {
        const interceptors = jest.spyOn(HttpClient.prototype, 'addRequestInterceptor'), source = new Target()
        const image = { url: cover, origin: RequestOrigin.Cover as const }, client = source.getCoverTransport(image)
        for (const url of [cover.replace('https:', 'http:'), cover.replace('.org/', '.org:443/'), cover.replace('.org/', '.org.evil/'),
            cover.replace('https://', 'https://user@'), cover.replace('/uploads/', '/uploads/../'), `${cover}#fragment`,
            cover.replace('/uploads/', '/private/'), cover.replace('public-cover', 'dflazy'), `${cover}%2f`, `${cover}%25`]) {
            expect(() => source.getCoverTransport({ ...image, url })).toThrow()
            // SDK normalizes fragments before interceptors; raw factory rejects them.
            if (!url.includes('#')) await expect(read(client, url, RequestOrigin.Cover)).rejects.toThrow()
        }
        expect(() => source.getCoverTransport({ ...image, origin: RequestOrigin.Page })).toThrow()
        await expect(read(client, cover, RequestOrigin.Page)).rejects.toThrow()
        await expect(client.get(cover)).rejects.toThrow()
        const index = interceptors.mock.results.findIndex(result => result.type === 'return' && result.value === client)
        const interceptor = interceptors.mock.calls[index]?.[0]
        if (!interceptor) throw new Error('Missing registered SDK interceptor')
        expect(() => interceptor({ url: cover, method: HttpMethod.Post, headers: new HttpHeaders() },
            { origin: RequestOrigin.Cover, requestId: 'method-control', attempt: 1, metadata: {} })).toThrow()
        expect(sent).toHaveLength(0)
    })

    test('a setting change does not revoke public bytes already in flight or consult image evidence', async () => {
        metadataStore()
        const source = new Target(), started = deferred<void>(), finish = deferred<string>()
        response = async () => { started.resolve(); return finish.promise }
        const pending = read(source.getPageTransport({ url: page, origin: RequestOrigin.Page }), page, RequestOrigin.Page)
        await started.promise; await policy.changeSetting(true)
        for (const method of Object.values(store)) method.mockClear()
        finish.resolve('public body'); await expect(pending).resolves.toBe('public body')
        response = async () => 'still public'
        await expect(read(source.getPageTransport({ url: page, origin: RequestOrigin.Page }), page, RequestOrigin.Page)).resolves.toBe('still public')
        for (const method of Object.values(store)) expect(method).not.toHaveBeenCalled()
    })

    test('classification ordering and settings revisions survive without reading or writing legacy image grants', async () => {
        metadataStore(); saved.set('MangaSushi.issuedImages', 'obsolete state')
        saved.set('MangaSushi.imagePolicyRevision', 7); saved.set(setting, true)
        const older = await policy.beginClassificationEvidence(), newer = await policy.beginClassificationEvidence()
        await policy.observeClassificationEvidence('title', false, newer)
        await policy.observeClassificationEvidence('title', true, older)
        await expect(policy.classificationAllowed('title', older)).resolves.toBe(false)
        const current = await policy.beginClassificationEvidence()
        await policy.observeClassificationEvidence('title', true, current)
        const title = { id: 'title', classified: true, explicit: false, evidence: current }
        await expect(policy.checkTitles([title], true, 7)).resolves.toBeUndefined()
        await expect(policy.classificationAllowed('title', older)).resolves.toBe(false)
        await policy.changeSetting(false); await policy.changeSetting(true)
        await expect(policy.checkTitles([title], true, 7)).rejects.toThrow(/settings changed/)
        expect(await policy.policyRevision()).toBe(9)
        for (const method of Object.values(store)) expect(method.mock.calls.some(([key]) => key === 'MangaSushi.issuedImages')).toBe(false)
        expect(saved.get('MangaSushi.issuedImages')).toBe('obsolete state')
    })

    test('a fresh runtime cannot reuse an in-flight classification generation after the two legacy evidence keys are lost', async () => {
        metadataStore(); saved.set(setting, true)
        const older = await policy.beginClassificationEvidence()
        await policy.observeClassificationEvidence('title', true, older)
        saved.delete('MangaSushi.imageEvidence'); saved.delete('MangaSushi.imageEvidenceGeneration')
        let reloaded!: typeof policy
        jest.isolateModules(() => { reloaded = jest.requireActual('../../sources/MangaSushi/MangaSushiPolicy') as typeof policy })
        const newer = await reloaded.beginClassificationEvidence()
        expect(newer.generation).toBeGreaterThan(older.generation)
        await reloaded.observeClassificationEvidence('title', true, newer)
        await expect(policy.observeClassificationEvidence('title', true, older)).rejects.toThrow(/expired generation/)
        await expect(policy.checkTitles([{ id: 'title', classified: true, explicit: false, evidence: older }], true, 0)).rejects.toThrow(/expired generation/)
        await expect(reloaded.classificationAllowed('title', newer)).resolves.toBe(true)
    })

    test('reader completion rechecks title evidence once, rejecting a newer warning without per-page provider requests', async () => {
        metadataStore(); saved.set(setting, true)
        const source = new Target(), evidence = await policy.beginClassificationEvidence()
        await policy.observeClassificationEvidence('title', true, evidence)
        const metadata: parser.Series = { id: 'title', title: 'Title', cover, webUrl: 'https://mangasushi.org/manga/title/',
            classified: true, explicit: false, contentRating: ContentRating.SUGGESTIVE, genres: [], authors: [], artists: [], alternatives: [] }
        const internals = source as unknown as { metadata: Map<string, unknown>, evidence: WeakMap<parser.Series, policy.ClassificationEvidence> }
        internals.metadata.set('true:title', { at: evidence.at, value: metadata }); internals.evidence.set(metadata, evidence)
        const started = deferred<void>(), finish = deferred<string>()
        const request = jest.spyOn(MangaSushiApi.prototype, 'text').mockImplementation(async () => { started.resolve(); return finish.promise })
        // Isolate the final policy boundary. Real reader ownership/unavailable
        // parsing and provider bytes remain covered by the existing native suite.
        jest.spyOn(parser, 'parseReader').mockReturnValue({ pages: [{ url: page }, { url: page.replace('01', '02') }] })
        const checked = jest.spyOn(policy, 'checkTitles')
        const pending = source.getChapterData('title', 'chapter-1'); await started.promise
        await policy.observeClassificationEvidence('title', false, await policy.beginClassificationEvidence())
        finish.resolve('controlled reader'); await expect(pending).rejects.toThrow(/classification/)
        expect(request).toHaveBeenCalledTimes(1)
        expect(checked).toHaveBeenCalledTimes(1); expect(checked.mock.calls[0]?.[0]).toHaveLength(1)
        expect(sent).toHaveLength(0)
    })

    test('metadata callbacks retain native empty-policy handling and reject a setting round trip during a reader request', async () => {
        metadataStore()
        const source = new Target(), started = deferred<void>(), finish = deferred<string>()
        const request = jest.spyOn(MangaSushiApi.prototype, 'text').mockImplementation(async () => { started.resolve(); return finish.promise })
        jest.spyOn(parser, 'parseReader').mockReturnValue({ pages: [{ url: page }] })
        await expect(source.search({ page: 1, context: { allowedContentRatings: [] } })).resolves.toEqual({ results: [], isLastPage: true })
        await expect(source.getContent('title', { allowedContentRatings: [] })).rejects.toThrow(/content-rating policy/)
        for (const id of ['chapter\\1', 'chapter\u00001', 'x'.repeat(513)]) await expect(source.getChapterData('title', id)).rejects.toThrow(/Invalid MangaSushi chapter ID/)
        expect(request).not.toHaveBeenCalled()
        const pending = source.getChapterData('title', 'chapter-1'); await started.promise
        await policy.changeSetting(true); await policy.changeSetting(false)
        finish.resolve('controlled reader'); await expect(pending).rejects.toThrow(/settings changed/)
        expect(request).toHaveBeenCalledTimes(1)
    })
})
