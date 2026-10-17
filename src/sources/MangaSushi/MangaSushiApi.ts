import { Body,
    CloudflareError,
    HttpClient,
    HttpMethod } from '@mana-app/types'
import { DOMAIN,
    formEncode,
    Listing,
    parseListing } from './MangaSushiParser'

export class MangaSushiApi {
    private readonly client = new HttpClient()
        .setRateLimit(3, 1000)
        .setTimeoutMs(30_000)
        .addHeader('Referer', `${DOMAIN}/`)
        .addHeader('Accept', 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8')

    async text(url: string, body?: string): Promise<string> {
        const response = await this.client.request({
            url,
            method: body === undefined ? HttpMethod.Get : HttpMethod.Post,
            body: body === undefined ? undefined : Body.text(body, 'application/x-www-form-urlencoded; charset=UTF-8')
        })
        const text = await response.text()
        if (response.status === 403 || response.status === 503 || /cf-chl-|Just a moment\.\.\./i.test(text)) {
            throw new CloudflareError(url)
        }
        if (!response.ok) throw new Error(`MangaSushi request failed (HTTP ${response.status})`)
        return text
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
