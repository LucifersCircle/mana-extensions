/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex; Copyright © 2026 Lucifers Circle */
import { CloudflareError,
    HttpClient,
    HttpMethod,
    HttpResponse,
    RequestOrigin } from '@mana-app/types'
import { catalogURL,
    DOMAIN,
    publicURL } from './VyMangaParser'
function challenge(response: HttpResponse): void {
    if (response.headers.get('cf-mitigated')?.trim().toLowerCase() === 'challenge') throw new CloudflareError(response.request.url)
}
export class VyMangaApi {
    private readonly client = new HttpClient().setTimeoutMs(30000).setRetry(0).setRateLimit(2, 1000).addHeader('Referer', DOMAIN + '/').addRequestInterceptor(request => {
        if (request.method !== HttpMethod.Get || request.body !== undefined) throw new Error('Unsupported VyManga document method')
        publicURL(request.url); return request
    })
    async document(url: string, isReader = false): Promise<{ html: string, url: string }> {
        if (isReader) publicURL(url); else catalogURL(url)
        const response = await this.client.get(url)
        try {
            challenge(response)
            const finalURL = isReader ? publicURL(response.url) : catalogURL(response.url)
            if (!isReader) {
                const requested = new URL(url), actual = new URL(finalURL)
                if (requested.pathname.replace(/\/$/, '') !== actual.pathname.replace(/\/$/, '') || requested.search !== actual.search) throw new Error('Unexpected VyManga catalog redirect')
            }
            if (response.status !== 200) throw new Error(`VyManga unavailable (HTTP ${response.status})`)
            if (!/\btext\/html\b/i.test(response.headers.get('content-type') ?? '')) throw new Error('Invalid VyManga document content type')
            const html = await response.text()
            if (html.length > 8_000_000 || /<title>Site Unavailable<\/title>|Unable to access this site/i.test(html)) throw new Error('VyManga document is unavailable or too large')
            return { html, url: finalURL }
        } finally { response.releaseNative() }
    }
}
export function imageClient(origin: RequestOrigin.Cover | RequestOrigin.Page, issued: Map<string, string>): HttpClient {
    return new HttpClient().setTimeoutMs(30000).setRetry(0).addRequestInterceptor((request, context) => {
        if (context.origin !== origin || request.method !== HttpMethod.Get || request.body !== undefined || !issued.has(request.url)) throw new Error('Unissued VyManga image or invalid origin; reopen the title or chapter')
        publicURL(request.url)
        request.headers.set('Referer', issued.get(request.url) as string)
        return request
    }).addResponseInterceptor(response => {
        challenge(response)
        if (publicURL(response.url) !== response.request.url) throw new Error('Unexpected VyManga image redirect')
        if (response.status !== 200 || !/^image\/(?:jpeg|png|webp|gif|avif|bmp)\b/i.test(response.headers.get('content-type') ?? '')) throw new Error('Invalid VyManga image response')
        return response
    })
}
