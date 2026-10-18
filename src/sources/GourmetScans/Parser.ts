/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex; Copyright © 2026 Lucifers Circle.
 * Adapted to Mana from Inkdex madara-extensions, 2026-10-18. */
import { Chapter,
    ChapterData,
    Content,
    ContentRating,
    ContentType,
    Highlight,
    Option,
    PublicationStatus,
    ReadingMode,
    staff,
    tags } from '@mana-app/types'
import { load } from 'cheerio'
import { AES } from 'crypto-es/lib/aes.js'
import { EvpKDF } from 'crypto-es/lib/evpkdf.js'
import { MD5Algo } from 'crypto-es/lib/md5.js'
import { Hex,
    Utf8 } from 'crypto-es/lib/core.js'
import { Base64 } from 'crypto-es/lib/enc-base64.js'
import { CipherParams,
    CBC,
    Pkcs7 } from 'crypto-es/lib/cipher-core.js'
import { incompleteRatingInfo,
    nativeRating } from '../../ContentRatingPolicy'
export const DOMAIN = 'https://gourmetsupremacy.com'
export const text = (value: string): string => value.replace(/\s+/g, ' ').trim()
export function slug(value: string): string {
    if (!/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(value) || value.length > 250) throw new Error('Invalid GourmetScans identity')
    return value
}
export const seriesURL = (id: string): string => `${DOMAIN}/project/${slug(id)}/`
export function imageURL(value: string): string {
    const url = new URL(value)
    if (url.origin !== DOMAIN || url.username || url.password || url.hash || url.search || !url.pathname.startsWith('/wp-content/uploads/') || /[\\\s]|%(?:2f|5c|00|25)/i.test(value) || url.href !== value || !/\.(?:jpe?g|png|webp|gif)$/i.test(url.pathname)) throw new Error('Unsupported GourmetScans image URL')
    return value
}
function image($: ReturnType<typeof load>, node: cheerio.Element | undefined): string {
    if (!node) throw new Error('Missing GourmetScans image')
    for (const key of ['data-src', 'data-lazy-src', 'src']) {
        const value = $(node).attr(key)?.trim()
        if (value && !value.startsWith('data:')) return imageURL(new URL(value, DOMAIN).href)
    }
    throw new Error('Missing GourmetScans image URL')
}
export function genreOptions($: ReturnType<typeof load>, selector: string): Option[] {
    return $(selector).toArray().map(node => ({ id: ($(node).attr('href') ?? '').match(/\/genre\/([^/?#]+)\/?$/)?.[1] ?? '', title: text($(node).text()) })).filter(value => value.id && value.title)
}
function rating(genres: Option[]): ContentRating | undefined {
    if (genres.some(value => ['smut', 'hentai', 'erotica'].includes(value.id))) return ContentRating.EXPLICIT
    if (genres.some(value => ['adult', 'mature'].includes(value.id))) return ContentRating.MATURE
    return undefined
}
export function listing(html: string, page: number): { items: Highlight[], ended: boolean } {
    const $ = load(html), rows = $('.c-tabs-item__content'), items: Highlight[] = [], seen = new Set<string>()
    const args = html.match(/var\s+manga_args\s*=\s*(\{[^\n]+\});/)
    if (!args) throw new Error('GourmetScans search metadata is missing')
    const data = JSON.parse(args[1] as string) as { paged?: string | number, template?: string }
    if (Number(data.paged || 1) !== page || data.template !== 'search') throw new Error('GourmetScans returned the wrong catalog page')
    rows.each((_, node) => {
        const root = $(node), anchor = root.find('.post-title a').first(), href = anchor.attr('href') ?? ''
        const id = href.match(/^https:\/\/gourmetsupremacy\.com\/project\/([^/]+)\/$/)?.[1]
        if (!id || !text(anchor.text())) throw new Error('GourmetScans catalog identity is missing')
        slug(id)
        if (seen.has(id)) throw new Error('GourmetScans repeated a catalog identity')
        seen.add(id)
        // Use the actual row, not document-wide genre metadata.
        const rowGenres = root.find('.mg_genres a').toArray().map(a => ({ id: ($(a).attr('href') ?? '').match(/\/genre\/([^/]+)\/$/)?.[1] ?? '', title: text($(a).text()) }))
        items.push({ id, title: text(anchor.text()), cover: image($, root.find('.tab-thumb img').first().get(0)), webUrl: href, contentRating: nativeRating(rating(rowGenres)), subtitle: text(root.find('.font-meta.chapter').text()) || undefined })
    })
    return { items, ended: rows.length < 12 }
}
function field($: ReturnType<typeof load>, name: string): cheerio.Cheerio {
    return $('.tab-summary').first().find('.post-content_item').filter((_, node) => text($(node).find('.summary-heading').text()).toLowerCase().replace(/\(s\)/g, '') === name).first().find('.summary-content')
}
export function detail(html: string, id: string): Content {
    const $ = load(html), expected = seriesURL(id)
    if ($('link[rel="canonical"]').attr('href') !== expected) throw new Error('GourmetScans returned another series')
    const heading = $('.post-title h1').first().clone(); heading.children().remove()
    const title = text(heading.text()), genres = genreOptions($, '.tab-summary .genres-content a'), age = rating(genres)
    if (!title || !field($, 'chapters').length) throw new Error('Incomplete GourmetScans detail')
    const type = text(field($, 'type').text()), status = text(field($, 'status').text()).toLowerCase()
    const people = ['author', 'artist'].flatMap(role => field($, role).find('a').toArray().map(a => staff.item({ id: `${role}:${text($(a).text())}`, title: text($(a).text()), subtitle: role })))
    return { title, cover: image($, $('.summary_image img').first().get(0)), webUrl: expected,
        summary: text($('.description-summary .summary__content, .summary__content').first().text()).replace(/Show more$/i, '').trim(),
        additionalTitles: [text(field($, 'alternative').text())].filter(Boolean), tags: genres,
        contentRating: nativeRating(age), contentType: type === 'Manhwa' ? ContentType.MANHWA : type === 'Manga' ? ContentType.MANGA : type === 'Manhua' ? ContentType.MANHUA : undefined,
        status: status === 'completed' ? PublicationStatus.COMPLETED : status === 'ongoing' ? PublicationStatus.ONGOING : undefined,
        recommendedPanelMode: ReadingMode.PAGED_MANGA,
        additionalInfo: [...(people.length ? [staff.section({ id: 'staff', title: 'Staff', hasMore: false, items: people })] : []), ...(age === undefined ? [incompleteRatingInfo()] : []), tags.section({ id: 'chapter-date', title: 'Chapter dates', items: [tags.item({ id: 'unknown-dates', title: 'Missing source chapter dates are unknown, not recent releases.', isNonInteractive: true })] })] }
}
export function chapters(html: string, id: string): Chapter[] {
    detail(html, id)
    const $ = load(html), rows = $('.wp-manga-chapter'), expected = Number(text(field($, 'chapters').text())), seen = new Set<string>(), result: Chapter[] = []
    if (!Number.isSafeInteger(expected) || expected < 1 || rows.length !== expected) throw new Error('Incomplete GourmetScans chapter inventory')
    rows.each((_, node) => {
        const row = $(node), anchor = row.children('a').first(), href = anchor.attr('href') ?? '', base = seriesURL(id)
        if (!href.startsWith(base) || !href.endsWith('/')) throw new Error('GourmetScans chapter owner mismatch')
        const chapterId = slug(href.slice(base.length, -1))
        if (seen.has(chapterId)) throw new Error('Repeated GourmetScans chapter identity')
        seen.add(chapterId)
        if (row.is('.premium, .locked, .paid, .login-required, [data-price], [data-coin]') || row.find('.fa-lock, .ion-locked, .chapter-premium, [data-price], [data-coin]').length || /(?:premium|locked|paid)/i.test(row.attr('class') ?? '')) return
        const title = text(anchor.text()), number = Number(title.match(/(?:chapter|side story|epilogue|prologue)\s*(\d+(?:\.\d+)?)/i)?.[1] ?? chapterId.match(/(?:chapter|side-story|epilogue|prologue)-(\d+(?:-\d+)?)/)?.[1]?.replace('-', '.'))
        if (!Number.isFinite(number)) throw new Error('Unsupported GourmetScans chapter numbering')
        const dateText = row.find('.chapter-release-date [title]').attr('title') ?? text(row.find('.chapter-release-date').text()), timestamp = Date.parse(dateText)
        result.push({ chapterId, title, number, index: 0, language: 'en_US', date: new Date(Number.isFinite(timestamp) ? timestamp : 0), webUrl: href })
    })
    return result.reverse().map((value, index) => ({ ...value, index }))
}
export function reader(html: string, id: string, chapterId: string): ChapterData {
    const $ = load(html), expected = seriesURL(id) + slug(chapterId) + '/'
    if ($('link[rel="canonical"]').attr('href') !== expected || $('#wp-manga-current-chap').attr('value') !== chapterId) throw new Error('GourmetScans reader identity mismatch')
    if ($('.reading-content.content-blocked, .reading-content.chapter-premium, .reading-content.login-required, .reading-content .content-blocked, .content-blocked.login-required, .reading-content .chapter-premium, .reading-content .login-required').length) throw new Error('GourmetScans chapter requires payment or login')
    const values: Record<string, string> = {}
    for (const node of $('script').toArray()) for (const match of $(node).text().matchAll(/var\s+(chapter_data|wpmangaprotectornonce)\s*=\s*'([^']*)';/g)) {
        if (values[match[1] as string] !== undefined) throw new Error('Ambiguous GourmetScans reader payload')
        values[match[1] as string] = match[2] as string
    }
    const payload = values.chapter_data, nonce = values.wpmangaprotectornonce
    if (!payload || payload.length > 2_000_000 || !nonce || !/^[a-f0-9]{10}$/.test(nonce)) throw new Error('Incomplete GourmetScans reader payload')
    const data = JSON.parse(payload) as { ct: string, iv: string, s: string }
    if (typeof data.ct !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.ct) || !/^[a-f0-9]{32}$/.test(data.iv) || !/^[a-f0-9]{16}$/.test(data.s)) throw new Error('Invalid GourmetScans reader encryption envelope')
    const ciphertext = Base64.parse(data.ct)
    if (!ciphertext.sigBytes || ciphertext.sigBytes % 16) throw new Error('Invalid GourmetScans reader cipher length')
    const key = EvpKDF(nonce, Hex.parse(data.s), { keySize: 8, hasher: MD5Algo, iterations: 1 })
    const decoded = AES.decrypt(CipherParams.create({ ciphertext }), key, { iv: Hex.parse(data.iv), mode: CBC, padding: Pkcs7 }).toString(Utf8)
    const pages: unknown = JSON.parse(JSON.parse(decoded))
    const count = $('.reading-content .page-break[id^="chapter-img-"]').length
    if (!Array.isArray(pages) || !count || pages.length !== count || pages.length > 1000 || pages.some(value => typeof value !== 'string') || new Set(pages).size !== pages.length) throw new Error('GourmetScans reader page inventory is incomplete')
    return { pages: pages.map(value => ({ url: imageURL(value as string) })) }
}
