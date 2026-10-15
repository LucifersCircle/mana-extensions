/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Lucifers Circle */
import { NetworkClientBuilder } from '@mana-app/types'
import { DOMAIN } from './HijalaModels'

export class HijalaApi {
    private readonly client = new NetworkClientBuilder()
        .setRateLimit(3, 1).setTimeout(30_000)
        .setStatusValidator((status) => status === 403 || status === 503 || (status >= 200 && status < 300))
        .addHeader('Referer', `${DOMAIN}/`).addHeader('Origin', DOMAIN)
        .addHeader('Accept', 'application/json,text/html;q=0.9,*/*;q=0.8').build()

    async text(url: string): Promise<string> {
        const response = await this.client.get(url)
        const challenged = Object.entries(response.headers).some(([name, value]) => name.toLowerCase() === 'cf-mitigated' && String(value).toLowerCase() === 'challenge') || /cf-chl-|Just a moment\.\.\./i.test(response.data)
        if (challenged) {
            throw new CloudflareError(DOMAIN)
        }
        if (response.status < 200 || response.status >= 300) throw new Error(`Hijala request failed (HTTP ${response.status})`)
        return response.data
    }
}
