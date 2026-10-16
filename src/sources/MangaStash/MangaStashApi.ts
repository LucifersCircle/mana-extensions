/* SPDX-License-Identifier: GPL-3.0-or-later */
import { NetworkClientBuilder } from '@mana-app/types'
import { url } from './MangaStashParser'
export class MangaStashApi {
    private readonly client = new NetworkClientBuilder().setRateLimit(2, 1).setTimeout(30000).setStatusValidator((status) => status === 200).addHeader('Accept', 'text/html,application/xhtml+xml;q=0.9').build()
    async text(target: string): Promise<string> {
        url(target)
        const response = await this.client.get(target)
        if (typeof response.data !== 'string' || response.data.length > 4_000_000 || /cf-chl-|Just a moment\.\.\./i.test(response.data)) throw new Error('MangaStash page is unavailable or access-challenged')
        return response.data
    }
}
