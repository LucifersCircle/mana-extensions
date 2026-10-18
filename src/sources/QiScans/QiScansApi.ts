/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex; Copyright © 2026 Lucifers Circle */
import { HttpClient,
    HttpMethod,
    RequestOrigin } from '@mana-app/types'
import { API,
    DOMAIN,
    imageURL } from './QiScansParser'
function apiURL(value: string): string {
    const url = new URL(value)
    if (!value.startsWith(API + '/') || url.origin !== new URL(API).origin || url.username || url.password || url.hash || /[\\\r\n]/.test(value)) throw new Error('Invalid QiScans API URL')
    return url.href
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
        if (apiURL(response.url) !== expected) throw new Error('QiScans API redirect is not supported')
        // Fail closed, including administrative 403s. No alternate host, client,
        // automatic retries or challenge-solving path is used.
        if (response.status !== 200 || response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge') throw new Error(`QiScans API unavailable (HTTP ${response.status}); access restrictions are not bypassed`)
        const body = await response.text()
        if (body.length > 6_000_000) throw new Error('QiScans API response exceeds limit')
        return JSON.parse(body) as T
    }
}
export function imageClient(origin: RequestOrigin.Cover | RequestOrigin.Page): HttpClient {
    return new HttpClient().setTimeoutMs(30000).setRetry(0).addHeader('Referer', DOMAIN + '/').addRequestInterceptor((request, context) => {
        if (context.origin !== origin || request.method !== HttpMethod.Get || request.body !== undefined) throw new Error('Invalid QiScans image request origin')
        imageURL(request.url)
        return request
    }).addResponseInterceptor(response => {
        imageURL(response.url)
        if (response.status !== 200 || response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge') throw new Error(`QiScans image unavailable (HTTP ${response.status})`)
        return response
    })
}
