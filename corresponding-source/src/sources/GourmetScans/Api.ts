/* SPDX-License-Identifier: GPL-3.0-or-later */
import { CloudflareError,
    HttpClient,
    HttpMethod,
    HttpResponse,
    RequestOrigin } from '@mana-app/types'
import { DOMAIN,
    imageURL } from './Parser'
export function documentURL(value: string): string {
    const url = new URL(value)
    if (url.origin !== DOMAIN || url.username || url.password || url.hash || /[\\\s]/.test(value) || url.href !== value || !/^(?:\/(?:page\/[1-9]\d*\/)?|\/project\/[a-z0-9-]+\/(?:[a-z0-9-]+\/)?)$/.test(url.pathname)) throw new Error('Unsupported GourmetScans document URL')
    if (url.pathname.startsWith('/project/') && url.search) throw new Error('Unexpected GourmetScans document query')
    return value
}
function challenge(response: HttpResponse, body = ''): void {
    if (response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge' || /cf-chl|cdn-cgi\/challenge-platform|challenges\.cloudflare\.com/i.test(body.slice(0, 8192))) throw new CloudflareError(response.request.url)
}
export class Api {
    private readonly client = new HttpClient().setTimeoutMs(30000).setRetry(0).setRateLimit(2, 1000).addHeader('Referer', DOMAIN + '/').addRequestInterceptor(request => {
        if (request.method !== HttpMethod.Get || request.body !== undefined) throw new Error('Unsupported GourmetScans request method')
        documentURL(request.url); return request
    })
    async text(url: string): Promise<string> { return this.read(url, (_response, body) => body) }
    async novel(url: string, sanitize: (body: string) => string): Promise<HttpResponse> {
        return this.read(url, (response, body) => response.withBody(sanitize(body), { contentType: 'text/html; charset=utf-8' }))
    }
    private async read<T>(url: string, transform: (response: HttpResponse, body: string) => T): Promise<T> {
        documentURL(url)
        const response = await this.client.get(url)
        try {
            if (response.url !== url) throw new Error('Unexpected GourmetScans redirect')
            const body = await response.text(); challenge(response, body)
            if (response.status !== 200) throw new Error(`GourmetScans unavailable (HTTP ${response.status})`)
            if (body.length > 5_000_000 || !/text\/html/i.test(response.headers.get('content-type') ?? '')) throw new Error('Invalid GourmetScans document')
            return transform(response, body)
        } finally { response.releaseNative() }
    }
}
export function imageClient(origin: RequestOrigin.Cover | RequestOrigin.Page): HttpClient {
    return new HttpClient().setTimeoutMs(30000).setRetry(0).addHeader('Referer', DOMAIN + '/').addRequestInterceptor((request, context) => {
        if (context.origin !== origin || request.method !== HttpMethod.Get || request.body !== undefined) throw new Error('Invalid GourmetScans image origin')
        imageURL(request.url); return request
    }).addResponseInterceptor(async response => {
        imageURL(response.url); challenge(response)
        if (response.status !== 200) throw new Error(`GourmetScans image unavailable (HTTP ${response.status})`)
        if (!/^image\/(?:jpeg|png|webp|gif)\b/i.test(response.headers.get('content-type') ?? '')) throw new Error('Invalid GourmetScans image content type')
        return response
    })
}
