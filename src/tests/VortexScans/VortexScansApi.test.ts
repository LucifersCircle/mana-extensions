import { BridgeOperation,
    CloudflareError,
    HttpBridge,
    HttpClient,
    HttpHeaders,
    HttpMethod,
    HttpResponse,
    imageDispatch,
    RateLimiter,
    RateLimitAction,
    RequestOrigin } from '@mana-app/types'
import { Target } from '../../sources/VortexScans/index'
import { VortexScansApi } from '../../sources/VortexScans/VortexScansApi'

const domain = 'https://vortexscans.org'
const apiURL = 'https://api.vortexscans.org/api/post?postId=42'
const response = (body: string, status = 200, headers: Record<string, string> = {}): HttpResponse => new HttpResponse(
    { url: apiURL, method: HttpMethod.Get, headers: new HttpHeaders() },
    { bodyID: 'fixture', sessionID: 'fixture', url: apiURL, status, headers },
    new TextEncoder().encode(body)
)

describe('VortexScans SDK HTTP transport', () => {
    afterEach(() => jest.restoreAllMocks())

    test('injected real HttpClient responses use asynchronous bodies and numeric methods', async () => {
        const client = new HttpClient(), request = jest.spyOn(client, 'request').mockResolvedValue(response('{"post":{"id":42}}'))
        await expect(new VortexScansApi(client).getPost('42')).resolves.toEqual({ post: { id: 42 } })
        expect(request).toHaveBeenCalledWith({ url: apiURL, method: HttpMethod.Get })
        request.mockResolvedValue(response('<html>Ordinary source HTML</html>'))
        await expect(new VortexScansApi(client).getText(domain)).resolves.toBe('<html>Ordinary source HTML</html>')
    })

    test('status failures and JSON errors remain failures instead of empty successful data', async () => {
        const client = new HttpClient(), request = jest.spyOn(client, 'request')
        for (const [status, message] of [[404, /not found/], [401, /status 401/], [500, /status 500/]] as const) {
            request.mockResolvedValue(response('{}', status))
            await expect(new VortexScansApi(client).getPost('42')).rejects.toThrow(message)
        }
        request.mockResolvedValue(response('not JSON'))
        await expect(new VortexScansApi(client).getPost('42')).rejects.toThrow(/invalid JSON/)
    })

    test('source-specific vShield and deliberate challenge statuses retain the exact API resolution URL', async () => {
        const client = new HttpClient(), request = jest.spyOn(client, 'request')
        for (const value of [response('<html>vShield verification</html>'), response('', 403), response('', 503), response('', 200, { 'CF-Mitigated': 'challenge' })]) {
            request.mockResolvedValue(value)
            await expect(new VortexScansApi(client).getPost('42')).rejects.toMatchObject({ name: 'CloudflareError', resolutionURL: apiURL })
        }
        request.mockRejectedValue(new CloudflareError(apiURL))
        await expect(new VortexScansApi(client).getPost('42')).rejects.toMatchObject({ resolutionURL: apiURL })
    })

    test('four requests per second uses milliseconds rather than a 1 ms interval', () => {
        const api = new VortexScansApi()
        const { client } = api as unknown as { client: { limiter: RateLimiter } }
        const context = { request: { url: apiURL, method: HttpMethod.Get, headers: new HttpHeaders() }, requestId: 'test', origin: RequestOrigin.General, attempt: 0, metadata: {}, nowMs: 1000 }
        expect(client.limiter.tryAcquire(context)).toEqual({ action: RateLimitAction.Allow })
        expect(client.limiter.tryAcquire(context)).toEqual({ action: RateLimitAction.Wait, retryAfterMs: 250 })
    })

    test('real Cover and Page dispatch preserve source headers and reject cross-origin client reuse', async () => {
        const globals = globalThis as unknown as Record<string, unknown>, prior = globals.__manaHTTPBridge
        const sent: Record<string, unknown>[] = []
        const bridge: HttpBridge = {
            now: () => Date.now(),
            send: async (message) => {
                if (message.operation === BridgeOperation.Release || message.operation === BridgeOperation.Cancel) return {}
                if (message.operation !== BridgeOperation.Fetch) throw new Error('Unexpected test bridge operation')
                sent.push(message)
                return { bodyID: `fixture-${sent.length}`, sessionID: 'test', status: 200, url: message.url, headers: { 'content-type': 'image/webp' }, text: 'test-only-body' }
            }
        }
        globals.__manaHTTPBridge = bridge
        try {
            const source = new Target()
            for (const origin of [RequestOrigin.Cover, RequestOrigin.Page] as const) {
                const image = { url: 'https://storage.vortexscans.org/image.webp', origin }
                const client = origin === RequestOrigin.Cover ? source.getCoverTransport(image) : source.getPageTransport(image)
                expect(client).toBeInstanceOf(HttpClient)
                const result = await client[imageDispatch](image)
                expect(await result.text()).toBe('test-only-body')
                result.releaseNative()
                const request = sent[sent.length - 1]
                expect(request?.origin).toBe(origin)
                expect(new Headers(request?.headers as Record<string, string>).get('referer')).toBe(`${domain}/`)
                expect(new Headers(request?.headers as Record<string, string>).get('accept')).toContain('image/webp')
                const wrong = { ...image, origin: origin === RequestOrigin.Cover ? RequestOrigin.Page : RequestOrigin.Cover } as const
                await expect(client[imageDispatch](wrong)).rejects.toThrow(/image origin/)
            }
            expect(sent).toHaveLength(2)
        } finally { globals.__manaHTTPBridge = prior }
    })
})
