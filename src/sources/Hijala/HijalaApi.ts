/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Lucifers Circle */
import { CloudflareError,
    HttpClient } from '@mana-app/types'
import { DOMAIN } from './HijalaModels'

export class HijalaApi {
    private readonly client = new HttpClient()
        .setRateLimit(3, 1000).setTimeoutMs(30_000)
        .addHeader('Referer', `${DOMAIN}/`).addHeader('Origin', DOMAIN)
        .addHeader('Accept', 'application/json,text/html;q=0.9,*/*;q=0.8')

    async text(url: string): Promise<string> {
        const response = await this.client.get(url)
        const text = await response.text()
        const challenged = response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge' || /cf-chl-|Just a moment\.\.\./i.test(text)
        if (challenged) {
            throw new CloudflareError(DOMAIN)
        }
        if (response.status < 200 || response.status >= 300) throw new Error(`Hijala request failed (HTTP ${response.status})`)
        return text
    }
}
