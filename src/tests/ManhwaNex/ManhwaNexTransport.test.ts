/* SPDX-License-Identifier: GPL-3.0-or-later */
import { AbortError,
    BridgeOperation,
    CloudflareError,
    HttpBridge,
    HttpClient,
    HttpHeaders,
    HttpMethod,
    imageDispatch,
    ImageRequest,
    RequestOrigin } from '@mana-app/types'
import { Target } from '../../sources/ManhwaNex/index'

const globals = globalThis as unknown as Record<string, unknown>
const cover = 'https://manhwanex.com/wp-content/uploads/unissued-cover.webp'
const page = 'https://cdn.manhwanex.com/manga_123abc/chapter-1/01.webp'
const origins = [RequestOrigin.Cover, RequestOrigin.Page] as const
const ok = (text = 'no-network-control') => ({ status: 200, headers: { 'content-type': 'image/webp' }, text })
function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>(done => { resolve = done })
    return { promise, resolve }
}
function transport(source: Target, image: ImageRequest): HttpClient {
    return image.origin === RequestOrigin.Cover ? source.getCoverTransport(image) : source.getPageTransport(image)
}
async function dispatch(client: HttpClient, image: ImageRequest, signal?: AbortSignal): Promise<string> {
    const response = await client[imageDispatch](image, signal)
    try { return await response.text() } finally { response.releaseNative() }
}

// Real SDK, local-only bridge. Control bodies do not represent provider bytes or
// native application cache guarantees. Metadata/chapter policy is tested separately.
describe('ManhwaNex native public-image transport', () => {
    let priorBridge: unknown, priorStore: unknown
    let sent: Record<string, unknown>[], lifecycle: Record<string, unknown>[]
    let respond: (message: Record<string, unknown>) => Promise<ReturnType<typeof ok>>
    let released: (message: Record<string, unknown>) => void
    let store: { get: jest.Mock, set: jest.Mock, boolean: jest.Mock }

    beforeEach(() => {
        priorBridge = globals.__manaHTTPBridge; priorStore = globals.ObjectStore
        sent = []; lifecycle = []; respond = async () => ok(); released = () => undefined
        const unexpected = async () => { throw new Error('Image transport must not access ObjectStore') }
        store = { get: jest.fn(unexpected), set: jest.fn(unexpected), boolean: jest.fn(unexpected) }
        globals.ObjectStore = store
        const bridge: HttpBridge = {
            now: () => Date.now(),
            send: async message => {
                if (message.operation === BridgeOperation.Release || message.operation === BridgeOperation.Cancel) {
                    lifecycle.push(message)
                    if (message.operation === BridgeOperation.Release) released(message)
                    return {}
                }
                if (message.operation !== BridgeOperation.Fetch) throw new Error('Unexpected no-network bridge operation')
                sent.push(message)
                const bodyID = `control-${sent.length}`
                return { bodyID, sessionID: 'test', url: message.url, ...await respond(message) }
            }
        }
        globals.__manaHTTPBridge = bridge
    })
    afterEach(() => {
        globals.__manaHTTPBridge = priorBridge; globals.ObjectStore = priorStore
        jest.restoreAllMocks()
        for (const method of Object.values(store)) expect(method).not.toHaveBeenCalled()
    })

    test('fresh, repeated and fresh-instance public images ignore missing, stale and removed legacy grants', async () => {
        const source = new Target()
        for (const legacy of [undefined, [[cover, 'old-title']], []]) {
            store.get.mockResolvedValue(legacy)
            for (const instance of [source, source, new Target()]) for (const origin of origins) for (const url of [cover, page]) {
                const image = { url, origin }
                await expect(dispatch(transport(instance, image), image)).resolves.toBe('no-network-control')
            }
        }
        expect(sent).toHaveLength(36)
    })

    test('one reusable client per origin sends exact URLs, required headers and caller headers', async () => {
        const source = new Target(), clients: HttpClient[] = []
        for (const origin of origins) {
            const image = { url: `${cover}.Name%20With%20Spaces`, origin }, client = transport(source, image)
            expect(client).toBeInstanceOf(HttpClient)
            expect(client).toBe(transport(source, { ...image, url: page }))
            clients.push(client)
            client.addHeaders({ Referer: 'https://wrong.invalid/', Accept: 'text/html', 'X-Control': 'preserved' })
            await dispatch(client, image)
            const message = sent[sent.length - 1], headers = new HttpHeaders(message?.headers as Record<string, string>)
            expect(message).toMatchObject({ url: image.url, origin, method: HttpMethod.Get, body: undefined })
            expect(headers.get('referer')).toBe('https://manhwanex.com/')
            expect(headers.get('accept')).toBe('image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5')
            expect(headers.get('x-control')).toBe('preserved')
            expect(headers.has('user-agent')).toBe(false)
        }
        expect(clients[0]).not.toBe(clients[1])
    })

    test('factories and reused-client dispatch reject unsafe URLs before Fetch', async () => {
        const source = new Target()
        const invalid = ['http://manhwanex.com/wp-content/uploads/image.webp', '/wp-content/uploads/image.webp',
            'https://manhwanex.com.foreign.invalid/wp-content/uploads/image.webp', cover.replace('https://', 'https://user:pass@'),
            cover.replace('.com/', '.com:444/'), cover.replace('.com/', '.com:443/'), `${cover}?token=x`, `${cover}?`, `${cover}#`,
            'https://manhwanex.com/wp-content/uploads-other/image.webp', 'https://cdn.manhwanex.com/manga_/image.webp',
            cover.replace('/unissued', '/other/../unissued'), `${cover}\n`, cover.replace('/unissued', '\\unissued'),
            ...['%2f', '%5c', '%00', '%25'].map(escape => `${cover}${escape}`)]
        for (const origin of origins) {
            const factory = origin === RequestOrigin.Cover ? source.getCoverTransport.bind(source) : source.getPageTransport.bind(source)
            const client = factory({ url: cover, origin })
            for (const url of invalid) {
                expect(() => factory({ url, origin })).toThrow()
                // SDK strips fragments before interceptors; raw factory rejects them.
                if (!url.includes('#')) await expect(dispatch(client, { url, origin })).rejects.toThrow()
            }
        }
        expect(sent).toHaveLength(0)
    })

    test('factory and dispatched origins match, and registered interceptors independently require GET', async () => {
        const registered = jest.spyOn(HttpClient.prototype, 'addRequestInterceptor'), source = new Target()
        for (const origin of origins) {
            const image = { url: cover, origin }, client = transport(source, image)
            const factory = origin === RequestOrigin.Cover ? source.getCoverTransport.bind(source) : source.getPageTransport.bind(source)
            for (const wrong of [RequestOrigin.General, origin === RequestOrigin.Cover ? RequestOrigin.Page : RequestOrigin.Cover, 99]) {
                const invalid = { ...image, origin: wrong } as ImageRequest
                expect(() => factory(invalid)).toThrow(/Invalid ManhwaNex image request/)
                await expect(dispatch(client, invalid)).rejects.toThrow(/Invalid ManhwaNex image request/)
            }
            await expect(client.get(image.url)).rejects.toThrow(/Invalid ManhwaNex image request/)
            const index = registered.mock.results.findIndex(result => result.type === 'return' && result.value === client)
            const interceptor = registered.mock.calls[index]?.[0]
            if (!interceptor) throw new Error('Missing SDK image interceptor')
            // imageDispatch always uses GET: invoke the registered SDK callback
            // with a valid image origin to test its method guard independently.
            for (const method of [HttpMethod.Head, HttpMethod.Post, HttpMethod.Put, HttpMethod.Patch, HttpMethod.Delete, HttpMethod.Options]) {
                await expect(Promise.resolve().then(() => interceptor({ url: cover, method, headers: new HttpHeaders(), fragmentParams: Object.freeze({}) },
                    { origin, requestId: 'method-control', attempt: 1, metadata: {} }))).rejects.toThrow(/Invalid ManhwaNex image request/)
            }
        }
        expect(sent).toHaveLength(0)
    })

    test('changing the source setting does not revoke in-flight public bytes or add image-stage policy reads', async () => {
        let exclude = false
        store.boolean.mockImplementation(async () => exclude)
        store.set.mockImplementation(async (_key: string, value: boolean) => { exclude = value })
        const source = new Target(), image = { url: page, origin: RequestOrigin.Page as const }
        const menu = await source.getPreferenceMenu() as unknown as { sections: Array<{ children: Array<{ didChange(value: boolean): Promise<void> }> }> }
        const toggle = menu.sections[0]?.children[0]
        if (!toggle) throw new Error('Missing preference callback')
        store.boolean.mockClear()
        const started = deferred<void>(), finish = deferred<ReturnType<typeof ok>>()
        respond = async () => { started.resolve(); return finish.promise }
        const pending = dispatch(source.getPageTransport(image), image)
        await started.promise
        await toggle.didChange(true)
        finish.resolve(ok('in-flight-public-control'))
        await expect(pending).resolves.toBe('in-flight-public-control')
        expect(store.set).toHaveBeenCalledTimes(1)
        expect(store.set).toHaveBeenCalledWith('ManhwaNex.excludeNSFW', true)
        store.set.mockClear(); respond = async () => ok()
        for (const instance of [source, new Target()]) await dispatch(instance.getPageTransport(image), image)
        expect(sent).toHaveLength(3)
    })

    test('concurrent successes are independent, and failed requests do not poison shared-client reuse', async () => {
        const image = { url: page, origin: RequestOrigin.Page as const }, client = new Target().getPageTransport(image)
        const other = { ...image, url: `${page}.other` }, failed = { ...image, url: `${page}.failure` }
        const started = deferred<void>(), finish = deferred<ReturnType<typeof ok>>()
        respond = async message => {
            if (message.url === image.url) { started.resolve(); return finish.promise }
            if (message.url === failed.url) throw new Error('isolated transport failure')
            return ok(String(message.url))
        }
        const first = dispatch(client, image)
        await started.promise
        await expect(dispatch(client, other)).resolves.toBe(other.url)
        await expect(dispatch(client, failed)).rejects.toThrow('isolated transport failure')
        finish.resolve(ok('first-request-control'))
        await expect(first).resolves.toBe('first-request-control')
        respond = async () => ok()
        await expect(dispatch(client, failed)).resolves.toBe('no-network-control')
        expect(sent.map(message => message.url)).toEqual([image.url, other.url, failed.url, failed.url])
        expect(new Set(sent.map(message => message.requestID)).size).toBe(4)
    })

    test('SDK cancellation is request-local, releases late bodies, and leaves later requests usable', async () => {
        const image = { url: cover, origin: RequestOrigin.Cover as const }, client = new Target().getCoverTransport(image)
        const controller = new AbortController(), started = deferred<void>(), finish = deferred<ReturnType<typeof ok>>(), lateRelease = deferred<void>()
        released = message => { if (message.bodyID === 'control-1') lateRelease.resolve() }
        respond = async message => {
            if (message.url === image.url) { started.resolve(); return finish.promise }
            return ok('concurrent-success')
        }
        const pending = dispatch(client, image, controller.signal), aborted = expect(pending).rejects.toBeInstanceOf(AbortError)
        await started.promise
        const concurrent = dispatch(client, { ...image, url: page })
        controller.abort()
        await aborted
        await expect(concurrent).resolves.toBe('concurrent-success')
        expect(lifecycle.filter(message => message.operation === BridgeOperation.Cancel)).toEqual([expect.objectContaining({ requestID: sent[0]?.requestID })])
        finish.resolve(ok('late-cancelled-control'))
        await lateRelease.promise
        await expect(dispatch(client, image, controller.signal)).rejects.toBeInstanceOf(AbortError)
        expect(sent).toHaveLength(2)
        respond = async () => ok()
        await expect(dispatch(client, image)).resolves.toBe('no-network-control')
        expect(lifecycle.filter(message => message.operation === BridgeOperation.Release && message.bodyID === 'control-1')).toHaveLength(1)
    })

    test('official SDK challenge detection remains intact and does not poison later images', async () => {
        const image = { url: cover, origin: RequestOrigin.Cover as const }, client = new Target().getCoverTransport(image)
        respond = async () => ({ status: 403, headers: { 'content-type': 'image/webp', 'cf-mitigated': 'challenge' }, text: 'control challenge' })
        await expect(dispatch(client, image)).rejects.toBeInstanceOf(CloudflareError)
        expect(lifecycle).toContainEqual({ operation: BridgeOperation.Release, bodyID: 'control-1' })
        respond = async () => ok()
        await expect(dispatch(client, image)).resolves.toBe('no-network-control')
        expect(sent).toHaveLength(2)
    })
})
