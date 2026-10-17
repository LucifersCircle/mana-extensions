import { Body,
    CloudflareError,
    HttpClient,
    HttpMethod } from '@mana-app/types'
import { load } from 'cheerio'
import { DOMAIN,
    formEncode,
    parseListing,
    QueryValue,
    Series,
    seriesURL,
    validId } from './ManhwaNexParser'

export class ManhwaNexApi {
    private readonly client = new HttpClient()
        .setRateLimit(3, 1000)
        .setTimeoutMs(30_000)
        .addHeader('Referer', `${DOMAIN}/`)
        .addHeader('Accept', 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8')

    async text(url: string, method: 'GET' | 'POST' = 'GET', body?: string): Promise<string> {
        const target = new URL(url)
        if (target.origin !== DOMAIN || target.username || target.password || target.hash) throw new Error('Invalid ManhwaNex request target')
        const response = await this.client.request({ url, method: method === 'GET' ? HttpMethod.Get : HttpMethod.Post,
            body: body === undefined ? undefined : Body.text(body, 'application/x-www-form-urlencoded; charset=UTF-8') })
        const text = await response.text()
        if (response.status === 403 || response.status === 503 || /cf-chl-|Just a moment\.\.\./i.test(text)) throw new CloudflareError(url)
        if (!response.ok) throw new Error(`ManhwaNex request failed (HTTP ${response.status})`)
        return text
    }

    async chapters(id: string): Promise<string> {
        const pending = new Set([1]), pages = new Map<number, string>(), chapterLinks = new Set<string>()
        while (pending.size) {
            const page = Math.min(...pending)
            pending.delete(page)
            if (pages.has(page)) continue
            const html = await this.text(`${seriesURL(id)}ajax/chapters/?t=${page}`, 'POST'), $ = load(html)
            const rows = $('.wp-manga-chapter')
            if (!rows.length) throw new Error('ManhwaNex chapter pagination returned an empty page')
            rows.each((_, node) => {
                const href = $(node).children('a').first().attr('href') ?? ''
                if (chapterLinks.has(href)) throw new Error('ManhwaNex chapter pagination repeated a chapter')
                chapterLinks.add(href)
            })
            $('.listing-chapters_wrap .pagination .page a[data-page]').each((_, node) => {
                const value = $(node).attr('data-page') ?? ''
                if (!/^[1-9]\d*$/.test(value) || Number(value) > 100) throw new Error('ManhwaNex chapter pagination exceeded its verified bounds')
                const next = Number(value)
                if (!pages.has(next) && next !== page) pending.add(next)
            })
            $('.listing-chapters_wrap .pagination').remove()
            pages.set(page, $.root().html() ?? '')
        }
        const ordered = [...pages].sort(([a], [b]) => a - b)
        if (ordered.some(([page], index) => page !== index + 1)) throw new Error('ManhwaNex chapter pagination has an unresolved gap')
        return ordered.map(([, html]) => html).join('\n')
    }

    async metadata(seriesIds: string[], exclude: boolean): Promise<Series[]> {
        const ids = [...new Set(seriesIds)]
        if (!ids.length || ids.length > 64 || ids.some((id) => { try { validId(id); return false } catch { return true } })) throw new Error('Invalid ManhwaNex metadata batch')
        const vars: { [key: string]: QueryValue } = { post_type: 'wp-manga', posts_per_page: ids.length, template: 'search', paged: 0,
            s: '', post_name__in: ids }
        if (exclude) vars.meta_query = { relation: 'AND', 0: { key: 'manga_adult_content', value: '' } }
        const body = formEncode({ action: 'madara_load_more', page: -1, template: 'madara-core/content/content-search', vars }).join('&')
        const html = await this.text(`${DOMAIN}/wp-admin/admin-ajax.php`, 'POST', body)
        const listing = parseListing(html, '.c-tabs-item__content')
        if (!listing.items.length && html.trim() && !/no-posts/.test(html)) throw new Error('ManhwaNex returned an unrecognized metadata response')
        if (listing.items.length > ids.length) throw new Error('ManhwaNex metadata batch exceeded its requested bounds')
        return listing.items
    }
}
