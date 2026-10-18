/* SPDX-License-Identifier: GPL-3.0-or-later */
import { BridgeOperation,
    HttpBridge,
    HttpClient,
    HttpHeaders,
    HttpMethod,
    imageDispatch,
    ImageRequest,
    RequestOrigin } from '@mana-app/types'
import { HijalaApi } from '../../sources/Hijala/HijalaApi'
import { Target } from '../../sources/Hijala/index'

const globals = globalThis as unknown as Record<string, unknown>
const cover = 'https://covers.example/series/cover.jpg?size=full'
const page = 'http://pages.example/chapter/001.webp?quality=original'
async function dispatch(client: HttpClient, image: ImageRequest): Promise<string> {
    const result = await client[imageDispatch](image)
    try { return await result.text() } finally { result.releaseNative() }
}

// Real SDK with a local-only bridge; not provider bytes or native cache evidence.
describe('Hijala reusable native image clients', () => {
    let priorBridge: unknown, priorStore: unknown, sent: Record<string, unknown>[]
    let store: { get: jest.Mock, set: jest.Mock, remove: jest.Mock }, metadata: jest.SpyInstance
    let respond: (message: Record<string, unknown>) => Promise<string>
    beforeEach(() => {
        priorBridge = globals.__manaHTTPBridge; priorStore = globals.ObjectStore; sent = []
        const unexpected = async () => { throw new Error('Images must not access metadata or ObjectStore') }
        store = { get: jest.fn(unexpected), set: jest.fn(unexpected), remove: jest.fn(unexpected) }
        globals.ObjectStore = store
        metadata = jest.spyOn(HijalaApi.prototype, 'text').mockImplementation(unexpected)
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
        expect(metadata).not.toHaveBeenCalled()
        for (const method of Object.values(store)) expect(method).not.toHaveBeenCalled()
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

    test('concurrent URLs and headers stay independent, with no metadata/storage and reusable clients after failure', async () => {
        const source = new Target(), coverImage = { url: cover, origin: RequestOrigin.Cover as const }
        const pageImage = { url: page, origin: RequestOrigin.Page as const }
        const coverClient = source.getCoverTransport(coverImage), pageClient = source.getPageTransport(pageImage)
        coverClient.addHeaders({ Referer: 'wrong', Origin: 'wrong', Accept: 'wrong', 'X-Control': 'cover' })
        pageClient.addHeader('X-Control', 'page')
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
            expect(message.method).toBe(HttpMethod.Get)
            expect(headers.get('referer')).toBe('https://en-hijala.com/')
            expect(headers.get('origin')).toBe('https://en-hijala.com')
            expect(headers.get('accept')).toBe('image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5')
            expect(headers.get('x-control')).toBe(message.origin === RequestOrigin.Cover ? 'cover' : 'page')
            expect(headers.has('authorization')).toBe(false); expect(headers.has('cookie')).toBe(false)
        }
    })

    test('wrong factories, cross-role/General dispatch and the existing non-GET guard reject before Fetch', async () => {
        const registered = jest.spyOn(HttpClient.prototype, 'addRequestInterceptor'), source = new Target()
        for (const origin of [RequestOrigin.Cover, RequestOrigin.Page] as const) {
            const image = { url: cover, origin }
            const factory = origin === RequestOrigin.Cover ? source.getCoverTransport.bind(source) : source.getPageTransport.bind(source)
            const client = factory(image)
            for (const wrong of [RequestOrigin.General, origin === RequestOrigin.Cover ? RequestOrigin.Page : RequestOrigin.Cover]) {
                const invalid = { ...image, origin: wrong } as ImageRequest
                expect(() => factory(invalid)).toThrow('Invalid Hijala image request')
                await expect(dispatch(client, invalid)).rejects.toThrow('Invalid Hijala image request')
            }
            await expect(client.get(cover)).rejects.toThrow('Invalid Hijala image request')
            const index = registered.mock.results.findIndex(result => result.type === 'return' && result.value === client)
            const interceptor = registered.mock.calls[index]?.[0]
            if (!interceptor) throw new Error('Missing SDK image interceptor')
            // Native image dispatch always uses GET; test the registered guard directly.
            expect(() => interceptor({ url: cover, method: HttpMethod.Post, headers: new HttpHeaders() },
                { origin, requestId: 'method-control', attempt: 1, metadata: {} })).toThrow('Invalid Hijala image request')
        }
        expect(sent).toHaveLength(0)
    })

    test('existing image URL rules retain HTTP/HTTPS, arbitrary CDN paths/queries and SDK fragment stripping', async () => {
        const source = new Target(), image = { url: cover, origin: RequestOrigin.Cover as const }
        const client = source.getCoverTransport(image)
        for (const url of [cover, page, 'http://CDN.example:80/arbitrary/../Image%20One.JPG?download=1',
            'https://another.example:8443/other/path?width=120#fragment']) {
            expect(source.getCoverTransport({ ...image, url })).toBe(client)
            await expect(dispatch(client, { ...image, url })).resolves.toBe(url.split('#')[0])
            expect(sent[sent.length - 1]?.url).toBe(url.split('#')[0])
        }
        const count = sent.length
        for (const url of ['', 'data:image/png;base64,AA==', 'https://user:pass@cdn.example/image.jpg', `${cover} `, `${cover}\n`]) {
            expect(() => source.getCoverTransport({ ...image, url })).toThrow()
            expect(() => source.getPageTransport({ url, origin: RequestOrigin.Page })).toThrow()
            await expect(dispatch(client, { ...image, url })).rejects.toThrow()
        }
        // The parser may resolve relative metadata URLs; transport does not rewrite them.
        expect(source.getCoverTransport({ ...image, url: '/relative.jpg' })).toBe(client)
        await expect(dispatch(client, { ...image, url: '/relative.jpg' })).rejects.toThrow('Relative HTTP URL requires setBaseURL')
        expect(sent).toHaveLength(count)
    })
})
