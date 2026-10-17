/* SPDX-License-Identifier: GPL-3.0-or-later */
import { BridgeOperation,
    CloudflareError,
    ContentRating,
    HttpBridge,
    HttpClient,
    imageDispatch,
    ImageRequest,
    RequestOrigin,
    HttpMethod } from '@mana-app/types'
import { MarumaruAPI,
    MarumaruService,
    validateAPIURL } from './MarumaruService'
import { Target } from './index'
import { enter,
    accessPolicy,
    beginAccess,
    grant,
    issue,
    observe,
    revoke } from './MarumaruPolicy'

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
        await issue('123', [cover], policy)
        await grant('123', policy)
        await issue('123', [page], policy, '456')
    })

    afterEach(() => {
        globals.__manaHTTPBridge = priorBridge
        globals.ObjectStore = priorStore
    })

    async function dispatch(client: HttpClient, request: ImageRequest) {
        const response = await client[imageDispatch](request)
        response.releaseNative()
        return response
    }

    test('synchronous factories preserve separate origins and the site-domain referrer', async () => {
        const source = new Target()
        for (const [url, origin] of [[cover, RequestOrigin.Cover], [page, RequestOrigin.Page]] as const) {
            const request = { url, origin }
            const client = origin === RequestOrigin.Cover ? source.getCoverTransport(request) : source.getPageTransport(request)
            expect(client).toBeInstanceOf(HttpClient)
            const before = sent.length
            await dispatch(client, request)
            expect(sent).toHaveLength(before + 1)
            expect(sent[before]).toMatchObject({ url, origin })
            expect(new Headers(sent[before]?.headers as Record<string, string>).get('referer'))
                .toBe('https://marumaru105.com/')
            expect(new Headers(sent[before]?.headers as Record<string, string>).has('x-site')).toBe(false)
        }
    })

    test('cross-origin, foreign and unissued images fail before transport', async () => {
        const source = new Target()
        expect(() => source.getCoverTransport({ url: cover, origin: RequestOrigin.Page })).toThrow(/identity/)
        expect(() => source.getPageTransport({ url: cover, origin: RequestOrigin.Page })).toThrow(/identity/)
        expect(() => source.getCoverTransport({ url: 'https://foreign.invalid/cover.webp', origin: RequestOrigin.Cover })).toThrow(/identity/)
        const request = { url: cover.replace('cover.webp', 'unissued.webp'), origin: RequestOrigin.Cover as const }
        await expect(dispatch(source.getCoverTransport(request), request)).rejects.toThrow(/not issued/)
        expect(sent).toHaveLength(0)
    })

    test('revocation after factory creation is checked before dispatch', async () => {
        const source = new Target(), request = { url: page, origin: RequestOrigin.Page as const }
        const client = source.getPageTransport(request)
        await revoke('123')
        await expect(dispatch(client, request)).rejects.toThrow(/not issued/)
        expect(sent).toHaveLength(0)
    })

    test('revocation during image transport prevents response acceptance', async () => {
        const source = new Target(), request = { url: cover, origin: RequestOrigin.Cover as const }
        respond = async () => {
            await revoke('123')
            return { status: 200, headers: { 'content-type': 'image/webp' }, text: 'transport-test-only' }
        }
        await expect(dispatch(source.getCoverTransport(request), request)).rejects.toThrow(/not issued/)
        expect(sent).toHaveLength(1)
    })

    test('official SDK challenge detection is preserved', async () => {
        const source = new Target(), request = { url: cover, origin: RequestOrigin.Cover as const }
        respond = async () => ({ status: 403, headers: { 'cf-mitigated': 'challenge' }, text: 'test-only challenge' })
        await expect(dispatch(source.getCoverTransport(request), request)).rejects.toBeInstanceOf(CloudflareError)
        expect(sent).toHaveLength(1)
    })
    test('reuses exactly one client per image origin without constructor churn', () => {
        const source = new Target(), coverRequest = { url: cover, origin: RequestOrigin.Cover as const }, pageRequest = { url: page, origin: RequestOrigin.Page as const }
        expect(source.getCoverTransport(coverRequest)).toBe(source.getCoverTransport(coverRequest))
        expect(source.getPageTransport(pageRequest)).toBe(source.getPageTransport(pageRequest))
        expect(source.getCoverTransport(coverRequest)).not.toBe(source.getPageTransport(pageRequest))
    })

    test('shared client checks every dispatch URL and native origin', async () => {
        const source = new Target(), request = { url: cover, origin: RequestOrigin.Cover as const }, client = source.getCoverTransport(request)
        await expect(client.get(cover)).rejects.toThrow(/identity/)
        await expect(dispatch(client, { url: cover, origin: RequestOrigin.Page })).rejects.toThrow(/identity/)
        await expect(dispatch(client, { ...request, url: cover.replace('cover.webp', 'unissued.webp') })).rejects.toThrow(/not issued/)
        expect(sent).toHaveLength(0)
    })

    test('concurrent same-origin responses retain independent exact-URL policy evidence', async () => {
        const source = new Target(), other = 'https://peer.storagewebtoon.store/manhwa/789/cover.webp', policy = await enter()
        await observe('789', false, policy); await issue('789', [other], policy)
        let finish: ((value: {status: number; headers: Record<string, string>; text: string}) => void) | undefined
        let started: (() => void) | undefined
        const waiting = new Promise<void>(resolve => { started = resolve })
        respond = async message => {
            if (message.url === cover) return new Promise(resolve => { finish = resolve; started?.() })
            return { status: 200, headers: { 'content-type': 'image/webp' }, text: 'transport-test-only' }
        }
        const request = { url: cover, origin: RequestOrigin.Cover as const }
        const first = dispatch(source.getCoverTransport(request), request)
        const rejected = expect(first).rejects.toThrow(/not issued/)
        await waiting
        const second = { url: other, origin: RequestOrigin.Cover as const }
        await dispatch(source.getCoverTransport(second), second)
        await revoke('123')
        finish?.({ status: 200, headers: { 'content-type': 'image/webp' }, text: 'transport-test-only' })
        await rejected
        expect(sent.map(message => message.url)).toEqual([cover, other])
    })

    test('redirected image response is rejected even for another valid issued URL', async () => {
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
        let catalog!: typeof import('./MarumaruPolicy'), detail!: typeof import('./MarumaruPolicy')
        jest.isolateModules(() => { catalog = jest.requireActual<typeof import('./MarumaruPolicy')>('./MarumaruPolicy') })
        jest.isolateModules(() => { detail = jest.requireActual<typeof import('./MarumaruPolicy')>('./MarumaruPolicy') })
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
        await expect(dispatch(source.getPageTransport(request), request)).rejects.toThrow(/not issued/)
        expect(sent).toHaveLength(0)
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
        await expect(dispatch(source.getPageTransport(request), request)).rejects.toThrow(/not issued/)
        expect(sent).toHaveLength(0)
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
        let first!: typeof import('./MarumaruPolicy'), second!: typeof import('./MarumaruPolicy')
        jest.isolateModules(() => { first = jest.requireActual<typeof import('./MarumaruPolicy')>('./MarumaruPolicy') })
        jest.isolateModules(() => { second = jest.requireActual<typeof import('./MarumaruPolicy')>('./MarumaruPolicy') })
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
        await expect(grant('123', older)).rejects.toThrow(/content policy changed/)
        await revoke('123', older)
        await expect(accessPolicy('123')).resolves.toEqual(current)
    })

    test('adult evidence survives stale snapshots while a new access grant is pending', async () => {
        const policy = await beginAccess('123', await enter({ allowedContentRatings: [ContentRating.SUGGESTIVE] }))
        const key = 'Marumaru.authorization.v1', older = JSON.parse(JSON.stringify(await ObjectStore.get(key))) as unknown
        await observe('123', true, await enter())
        await ObjectStore.set(key, older)
        await expect(grant('123', policy)).rejects.toThrow(/no allowed access/)
        await expect(accessPolicy('123')).rejects.toThrow(/Refresh Marumaru/)
        await expect(observe('123', false, await enter())).resolves.toBe(true)
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
        let first!: typeof import('./MarumaruPolicy'), second!: typeof import('./MarumaruPolicy')
        jest.isolateModules(() => { first = jest.requireActual<typeof import('./MarumaruPolicy')>('./MarumaruPolicy') })
        jest.isolateModules(() => { second = jest.requireActual<typeof import('./MarumaruPolicy')>('./MarumaruPolicy') })
        const older = await first.beginAccess('123', await first.enter())
        const pending = first.revoke('123', older)
        await waiting
        const current = await second.beginAccess('123', await second.enter({ allowedContentRatings: [ContentRating.SUGGESTIVE] }))
        await second.grant('123', current)
        release?.(); await pending
        await expect(second.accessPolicy('123')).resolves.toEqual(current)
    })

})
