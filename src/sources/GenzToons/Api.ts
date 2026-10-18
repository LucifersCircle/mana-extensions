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
    if (url.origin !== DOMAIN || url.username || url.password || url.hash || url.search || /[\\\s]/.test(value) || url.href !== value || !/^(?:\/series|\/series\/[a-z0-9-]+\/|\/chapter\/[a-z0-9]+-[a-z0-9]+\/)$/.test(url.pathname)) throw new Error('Unsupported GenzToons document URL')
    return value
}
function challenge(response: HttpResponse, body = ''): void {
    if (response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge' || /cf-chl|cdn-cgi\/challenge-platform|challenges\.cloudflare\.com/i.test(body.slice(0, 8192))) throw new CloudflareError(response.request.url)
}
export class Api {
    private readonly client = new HttpClient().setTimeoutMs(30000).setRetry(0).setRateLimit(2, 1000).addHeader('Referer', DOMAIN + '/').addRequestInterceptor(request => {
        if (request.method !== HttpMethod.Get || request.body !== undefined) throw new Error('Unsupported GenzToons request method')
        documentURL(request.url); return request
    })
    async text(url: string): Promise<string> {
        documentURL(url)
        const response = await this.client.get(url)
        try {
            if (response.url !== url) throw new Error('Unexpected GenzToons redirect')
            const body = await response.text(); challenge(response, body)
            if (response.status !== 200) throw new Error(`GenzToons unavailable (HTTP ${response.status})`)
            if (body.length > 5_000_000 || !/text\/html/i.test(response.headers.get('content-type') ?? '')) throw new Error('Invalid GenzToons document')
            return body
        } finally { response.releaseNative() }
    }
}
export function imageClient(origin: RequestOrigin.Cover | RequestOrigin.Page): HttpClient {
    return new HttpClient().setTimeoutMs(30000).setRetry(0).addHeader('Referer', DOMAIN + '/').addRequestInterceptor((request, context) => {
        if (context.origin !== origin || request.method !== HttpMethod.Get || request.body !== undefined) throw new Error('Invalid GenzToons image origin')
        imageURL(request.url, origin === RequestOrigin.Cover); return request
    }).addResponseInterceptor(async response => {
        if (response.url !== response.request.url) throw new Error('Unexpected GenzToons image redirect')
        imageURL(response.url, origin === RequestOrigin.Cover); challenge(response)
        if (response.status !== 200) throw new Error(`GenzToons image unavailable (HTTP ${response.status})`)
        // Preserve native headers and bytes, including the provider's text/plain
        // WebP label. MIME compatibility is handled by the host, never rewritten here.
        return response
    })
}
