/* SPDX-License-Identifier: GPL-3.0-or-later */
import { BridgeOperation,
    HttpBridge,
    HttpClient,
    HttpHeaders,
    HttpMethod,
    imageDispatch,
    ImageRequest,
    RequestOrigin } from '@mana-app/types'
import { VortexScansApi } from './VortexScansApi'
import { VORTEX_FALLBACK_IMAGE } from './VortexScansModels'
import { VortexScansParser } from './VortexScansParser'
import { Target } from './index'

const globals = globalThis as unknown as Record<string, unknown>
const cover = 'https://covers.example/series/cover.jpg?size=full'
const page = 'http://pages.example/chapter/001.webp?quality=original'
async function dispatch(client: HttpClient, image: ImageRequest): Promise<string> {
    const response = await client[imageDispatch](image)
    try { return await response.text() } finally { response.releaseNative() }
}

// Real SDK with a local-only bridge; not provider bytes or native cache evidence.
describe('VortexScans reusable native image clients', () => {
    let priorBridge: unknown, priorStore: unknown, sent: Record<string, unknown>[]
    let store: jest.Mock, metadata: jest.SpyInstance[]
    let respond: (message: Record<string, unknown>) => Promise<string>
    beforeEach(() => {
        priorBridge = globals.__manaHTTPBridge; priorStore = globals.ObjectStore; sent = []
        store = jest.fn(() => { throw new Error('Images must not access ObjectStore') })
        globals.ObjectStore = new Proxy({}, { get: store })
        metadata = (['getPost', 'getPostBySlug', 'getChapters', 'getChapter', 'getGenres', 'getCollections',
            'getCollection', 'query', 'getTaggedPosts', 'getText'] as const).map(method =>
            jest.spyOn(VortexScansApi.prototype, method).mockImplementation(async () => { throw new Error('Images must not access metadata') }))
        respond = async message => String(message.url)
        const bridge: HttpBridge = { now: () => Date.now(), send: async message => {
            if (message.operation === BridgeOperation.Release) return {}
            if (message.operation !== BridgeOperation.Fetch) throw new Error('Unexpected bridge operation')
            sent.push(message)
            const bodyID = `control-${sent.length}`
            return { bodyID, sessionID: 'control', url: message.url, status: 200, text: await respond(message) }
        } }
        globals.__manaHTTPBridge = bridge
    })
    afterEach(() => {
        globals.__manaHTTPBridge = priorBridge; globals.ObjectStore = priorStore
        expect(store).not.toHaveBeenCalled()
        for (const method of metadata) expect(method).not.toHaveBeenCalled()
        jest.restoreAllMocks()
    })

    test('synchronous factories return stable, distinct role clients local to each Target', () => {
        const source = new Target(), other = new Target()
        const first = source.getCoverTransport({ url: cover, origin: RequestOrigin.Cover })
        const second = source.getPageTransport({ url: page, origin: RequestOrigin.Page })
        expect(first).toBeInstanceOf(HttpClient); expect(second).toBeInstanceOf(HttpClient)
        expect(first).toBe(source.getCoverTransport({ url: page, origin: RequestOrigin.Cover }))
        expect(second).toBe(source.getPageTransport({ url: cover, origin: RequestOrigin.Page }))
        expect(first).not.toBe(second)
        expect(first).not.toBe(other.getCoverTransport({ url: cover, origin: RequestOrigin.Cover }))
        expect(second).not.toBe(other.getPageTransport({ url: page, origin: RequestOrigin.Page }))
        expect(sent).toHaveLength(0)
    })

    test('concurrent URLs and headers stay independent, with no metadata/storage and reuse after failure', async () => {
        const source = new Target(), coverImage = { url: cover, origin: RequestOrigin.Cover as const }
        const pageImage = { url: page, origin: RequestOrigin.Page as const }
        const coverClient = source.getCoverTransport(coverImage), pageClient = source.getPageTransport(pageImage)
        coverClient.addHeader('X-Control', 'cover'); pageClient.addHeader('X-Control', 'page')
        let finishCover!: (value: string) => void, finishPage!: (value: string) => void, started!: () => void
        const began = new Promise<void>(resolve => { started = resolve })
        let pending = 0, fail = true
        const otherCover = { ...coverImage, url: `${cover}&second=1` }, otherPage = { ...pageImage, url: `${page}&second=1` }
        respond = async message => {
            if (message.url === cover || message.url === page) {
                return new Promise(resolve => {
                    if (message.url === cover) finishCover = resolve; else finishPage = resolve
                    if (++pending === 2) started()
                })
            }
            if (message.url === otherPage.url && fail) throw new Error('controlled failure')
            return String(message.url)
        }
        const first = dispatch(coverClient, coverImage), second = dispatch(pageClient, pageImage)
        await began
        await expect(dispatch(coverClient, otherCover)).resolves.toBe(otherCover.url)
        await expect(dispatch(pageClient, otherPage)).rejects.toThrow('controlled failure')
        finishPage(page); finishCover(cover)
        await expect(first).resolves.toBe(cover); await expect(second).resolves.toBe(page)
        fail = false
        await expect(dispatch(pageClient, otherPage)).resolves.toBe(otherPage.url)
        expect(sent.map(message => message.url)).toEqual([cover, page, otherCover.url, otherPage.url, otherPage.url])
        for (const message of sent) {
            const headers = new HttpHeaders(message.headers as Record<string, string>)
            expect(message).toMatchObject({ method: HttpMethod.Get, body: undefined })
            expect(headers.get('referer')).toBe('https://vortexscans.org/')
            expect(headers.get('accept')).toBe('image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5')
            expect(headers.get('x-control')).toBe(message.origin === RequestOrigin.Cover ? 'cover' : 'page')
            expect(headers.has('origin')).toBe(false)
            expect(headers.has('authorization')).toBe(false); expect(headers.has('cookie')).toBe(false)
        }
    })

    test('wrong factories and cross-role/General dispatch reject before bridge Fetch', async () => {
        const source = new Target()
        for (const origin of [RequestOrigin.Cover, RequestOrigin.Page] as const) {
            const image = { url: cover, origin }
            const factory = origin === RequestOrigin.Cover ? source.getCoverTransport.bind(source) : source.getPageTransport.bind(source)
            const client = factory(image)
            for (const wrong of [RequestOrigin.General, origin === RequestOrigin.Cover ? RequestOrigin.Page : RequestOrigin.Cover]) {
                const invalid = { ...image, origin: wrong } as ImageRequest
                expect(() => factory(invalid)).toThrow('Invalid VortexScans image origin')
                await expect(dispatch(client, invalid)).rejects.toThrow('Invalid VortexScans image origin')
            }
            await expect(client.get(cover)).rejects.toThrow('Invalid VortexScans image origin')
        }
        expect(sent).toHaveLength(0)
    })

    test('source-advertised HTTP/HTTPS URLs, encoded pages and fallback retain SDK URL behavior', async () => {
        const source = new Target(), parser = new VortexScansParser()
        const post = { id: 1, slug: 'control', postTitle: 'Control', featuredImage: cover }
        const covers = parser.parseHighlights([post, { ...post, id: 2, featuredImage: undefined }])
        const pages = parser.parseChapterData({ images: [{ url: page, order: 0 },
            { url: 'https://another.example:8443/arbitrary/Image One.JPG?download=1#fragment', order: 1 }] }).pages
        if (!pages) throw new Error('Missing parsed VortexScans pages')
        expect(covers[1]?.cover).toBe(VORTEX_FALLBACK_IMAGE)
        expect(pages[1]?.url).toBe('https://another.example:8443/arbitrary/Image%20One.JPG?download=1#fragment')
        for (const image of [...covers.map(item => ({ url: item.cover, origin: RequestOrigin.Cover as const })),
            ...pages.map(item => ({ url: item.url, origin: RequestOrigin.Page as const }))]) {
            if (!image.url) throw new Error('Missing parsed VortexScans image URL')
            const request = { ...image, url: image.url }
            const client = request.origin === RequestOrigin.Cover ? source.getCoverTransport(request) : source.getPageTransport(request)
            await expect(dispatch(client, request)).resolves.toBe(request.url.split('#')[0])
            expect(sent[sent.length - 1]?.url).toBe(request.url.split('#')[0])
        }
        const count = sent.length, client = source.getCoverTransport({ url: cover, origin: RequestOrigin.Cover })
        for (const url of ['data:image/png;base64,AA==', 'ftp://cdn.example/image.jpg']) {
            const image = { url, origin: RequestOrigin.Cover as const }
            expect(source.getCoverTransport(image)).toBe(client)
            await expect(dispatch(client, image)).rejects.toThrow('Relative HTTP URL requires setBaseURL')
        }
        expect(sent).toHaveLength(count)
    })
})
