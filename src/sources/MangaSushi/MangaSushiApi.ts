import { NetworkClientBuilder } from '@mana-app/types'
import { DOMAIN,
    formEncode,
    Listing,
    parseListing } from './MangaSushiParser'

export class MangaSushiApi {
    private readonly client = new NetworkClientBuilder()
        .setRateLimit(3, 1)
        .setTimeout(30_000)
        .setStatusValidator((status) => status === 403 || status === 503 || (status >= 200 && status < 300))
        .addHeader('Referer', `${DOMAIN}/`)
        .addHeader('Accept', 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8')
        .build()

    async text(url: string, body?: string): Promise<string> {
        const response = await this.client.request({
            url,
            method: body === undefined ? 'GET' : 'POST',
            body,
            headers: body === undefined ? {} : { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }
        })
        if (response.status === 403 || response.status === 503 || /cf-chl-|Just a moment\.\.\./i.test(response.data)) {
            throw new CloudflareError(url)
        }
        return response.data
    }

    async more(next: NonNullable<Listing['next']>, page: number, selector: string): Promise<Listing> {
        const body = formEncode({ action: 'madara_load_more', page: page - 1, template: next.template, vars: next.vars }).join('&')
        const html = await this.text(`${DOMAIN}/wp-admin/admin-ajax.php`, body)
        const result = parseListing(html, selector)
        if (!result.items.length && html.trim() && !/no-posts/.test(html)) {
            throw new Error('MangaSushi returned an unrecognized continuation response')
        }
        return result
    }
}
