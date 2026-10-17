/* SPDX-License-Identifier: GPL-3.0-or-later */
import { BridgeOperation,
    CloudflareError,
    HttpBridge,
    HttpClient,
    imageDispatch,
    ImageRequest,
    RequestOrigin } from '@mana-app/types'
import { Target } from './index'
import { enter,
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
    let respond: () => Promise<{ status: number, headers: Record<string, string>, text: string }>

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
                return { ...await respond(), bodyID: `fixture-${sent.length}`, sessionID: 'test', url: message.url }
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

    test('synchronous factories preserve separate origins and cover-only referrer', async () => {
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
                .toBe(origin === RequestOrigin.Cover ? 'https://marumaru105.com/' : null)
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
})
