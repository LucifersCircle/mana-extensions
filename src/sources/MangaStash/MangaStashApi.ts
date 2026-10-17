/* SPDX-License-Identifier: GPL-3.0-or-later */
import { HttpClient } from '@mana-app/types'
import { url } from './MangaStashParser'
export class MangaStashApi {
    private readonly client = new HttpClient().setRateLimit(2, 1000).setTimeoutMs(30000).addHeader('Accept', 'text/html,application/xhtml+xml;q=0.9')
    async text(target: string): Promise<string> {
        url(target)
        const response = await this.client.get(target)
        if (response.status !== 200) throw new Error(`MangaStash request failed (HTTP ${response.status})`)
        const text = await response.text()
        if (text.length > 4_000_000 || /cf-chl-|Just a moment\.\.\./i.test(text)) throw new Error('MangaStash page is unavailable or access-challenged')
        return text
    }
}
