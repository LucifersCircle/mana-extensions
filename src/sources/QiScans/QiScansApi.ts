/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex; Copyright © 2026 Lucifers Circle */
import { CloudflareError,
    HttpClient,
    HttpMethod,
    HttpResponse,
    RequestOrigin } from '@mana-app/types'
import { API,
    DOMAIN,
    imageURL } from './QiScansParser'
function apiURL(value: string): string {
    const url = new URL(value)
    if (!value.startsWith(API + '/') || url.origin !== new URL(API).origin || url.username || url.password || url.hash || /[\\\r\n]/.test(value)) throw new Error('Invalid QiScans API URL')
    return url.href
}
function checkCloudflare(response: HttpResponse, body = ''): void {
    const html = /\btext\/html\b/i.test(response.headers.get('content-type') ?? '') || /^\s*(?:<!doctype\s+html|<html)\b/i.test(body)
    if (response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge'
        || (html && /cf-chl|cf-turnstile|cdn-cgi\/challenge-platform|challenges\.cloudflare\.com/i.test(body.slice(0, 8192)))) {
        // Let Mana resolve the actual challenged API/CDN host and manage cookies.
        throw new CloudflareError(response.request.url)
    }
}
export class QiScansApi {
    private readonly client = new HttpClient().setTimeoutMs(30000).setRetry(0).setRateLimit(3, 1000).addHeader('Referer', DOMAIN + '/')
        .addRequestInterceptor(request => {
            if (request.method !== HttpMethod.Get || request.body !== undefined) throw new Error('Invalid QiScans API method')
            apiURL(request.url)
            return request
        })
    async json<T>(path: string): Promise<T> {
        const expected = apiURL(API + path)
        const response = await this.client.get(expected)
        try {
            if (apiURL(response.url) !== expected) throw new Error('QiScans API redirect is not supported')
            checkCloudflare(response)
            const body = await response.text()
            if (body.length > 6_000_000) throw new Error('QiScans API response exceeds limit')
            checkCloudflare(response, body)
            // Ordinary denials remain HTTP errors; they are not CF challenges.
            if (response.status !== 200) throw new Error(`QiScans API unavailable (HTTP ${response.status})`)
            return JSON.parse(body) as T
        } finally { response.releaseNative() }
    }
}
export function imageClient(origin: RequestOrigin.Cover | RequestOrigin.Page): HttpClient {
    return new HttpClient().setTimeoutMs(30000).setRetry(0).addHeader('Referer', DOMAIN + '/').addRequestInterceptor((request, context) => {
        if (context.origin !== origin || request.method !== HttpMethod.Get || request.body !== undefined) throw new Error('Invalid QiScans image request origin')
        imageURL(request.url)
        return request
    }).addResponseInterceptor(async response => {
        imageURL(response.url)
        checkCloudflare(response)
        if (/\btext\/html\b/i.test(response.headers.get('content-type') ?? '')) checkCloudflare(response, await response.text())
        if (response.status !== 200) throw new Error(`QiScans image unavailable (HTTP ${response.status})`)
        return response
    })
}
