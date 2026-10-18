/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex; Copyright © 2026 Lucifers Circle */
import { Chapter,
    Content,
    ContentRating,
    ContentType,
    Option,
    PublicationStatus,
    ReadingMode,
    staff,
    tags } from '@mana-app/types'
import { load } from 'cheerio'
import { decode } from 'html-entities'
import { incompleteRatingInfo,
    nativeRating } from '../../ContentRatingPolicy'
import { DOMAIN } from './MangaTaroApi'
export const text = (value: string): string => decode(value).replace(/\s+/g, ' ').trim()
export function slug(value: string): string {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,255}$/.test(value)) throw new Error('Invalid MangaTaro series identity')
    return value
}
export function numeric(value: string): string {
    if (typeof value !== 'string' || !/^[1-9]\d{0,14}$/.test(value)) throw new Error('Invalid MangaTaro numeric identity')
    return value
}
export function sourceURL(value: string): URL {
    if (typeof value !== 'string' || /[\s\\%]/.test(value) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value)) throw new Error('Invalid MangaTaro URL')
    const url = new URL(value, DOMAIN)
    if (url.origin !== DOMAIN || url.username || url.password || url.hash) throw new Error('Invalid MangaTaro URL origin')
    return url
}
export function seriesID(value: string): string {
    const url = sourceURL(value), match = url.pathname.match(/^\/manga\/([^/]+)\/?$/)
    if (!match || url.search) throw new Error('Invalid MangaTaro series URL')
    return slug(match[1] ?? '')
}
export function imageURL(value: string, cover = false): string {
    // Keep the site’s exact missing-cover marker; never fabricate a cover/page.
    if (cover && value === 'https://via.placeholder.com/300x400') return value
    if (typeof value !== 'string' || /[\s\\]/.test(value) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value)) throw new Error('Invalid MangaTaro image URL')
    const url = new URL(value)
    if (url.protocol !== 'https:' || !['mangataro.org', 'mangataro.yachts'].includes(url.hostname) || url.port || url.username || url.password || url.hash || url.search || !/\.(?:webp|png|jpe?g|avif|gif)$/i.test(url.pathname) || /%2f|%5c|%2e/i.test(url.pathname)) throw new Error('Unsupported MangaTaro public image URL')
    if (!(url.hostname === 'mangataro.org' ? url.pathname.startsWith('/content/media/') : url.pathname.startsWith('/storage/chapters/'))) throw new Error('Unsupported MangaTaro image route')
    return url.href
}
export function labelRating(labels: string[]): ContentRating | undefined {
    if (labels.some(value => /^(?:adult|hentai|smut|19\+|18\+|explicit)$/i.test(text(value)))) return ContentRating.EXPLICIT
    if (labels.some(value => /^mature$/i.test(text(value)))) return ContentRating.MATURE
    if (labels.some(value => /^(?:ecchi|suggestive)$/i.test(text(value)))) return ContentRating.SUGGESTIVE
    return undefined
}
export type Card = { id: string, title: string, cover: string, subtitle?: string, rating?: ContentRating }
export type LoadItem = { id: string, title: string, url: string, cover: string, type: string }
export type SourceChapter = { id: string, chapter: string, title: string, date: string, chapter_type: string, language: string, group_id?: string | null, group_name?: string | null, url: string, locked?: boolean, is_locked?: boolean, requires_login?: boolean, price?: number }
export type Inventory = { success: boolean, chapters: SourceChapter[], total: number, offset: number, limit: number, has_more: boolean }
export type Detail = { numericId: string, content: Content, rating?: ContentRating }
export type Choices = { genres: Option[], years: Option[], types: Option[], statuses: Option[] }
export function choices(html: string): Choices {
    const $ = load(html)
    const options = (kind: string): Option[] => $('.' + kind + '-btn').toArray().map(node => ({ id: $(node).attr('data-value') ?? '', title: text(kind === 'genre' ? $(node).children('div').first().text() : $(node).text()) })).filter(item => item.id && item.title && item.title !== 'Novel')
    const result = { genres: options('genre'), years: options('year'), types: options('type'), statuses: options('status') }
    for (const values of Object.values(result)) if (!values.length || new Set(values.map(item => item.id)).size !== values.length) throw new Error('MangaTaro browse controls are incomplete')
    return result
}
export function catalog(items: LoadItem[]): Card[] {
    if (!Array.isArray(items)) throw new Error('Invalid MangaTaro catalog response')
    const result = items.filter(item => item.type !== 'Novel').map(item => {
        numeric(String(item.id))
        const title = text(item.title)
        if (!title) throw new Error('Missing MangaTaro title')
        return { id: seriesID(item.url), title, cover: imageURL(item.cover, true) }
    })
    if (new Set(result.map(item => item.id)).size !== result.length) throw new Error('Duplicate MangaTaro catalog identities')
    return result
}
// These are the site's public aggregate lists, not account reading history.
export function feedCards(value: unknown, chapters = false): Card[] {
    if (!Array.isArray(value)) throw new Error('Invalid MangaTaro discovery feed')
    const seen = new Set<string>(), result: Card[] = []
    for (const item of value) {
        if (!item || typeof item !== 'object') throw new Error('Invalid MangaTaro discovery item')
        if (item.manga_type === 'Novel') continue
        const id = seriesID(chapters ? item.manga_url : item.permalink)
        const title = text(chapters ? item.manga_title : item.title)
        if (!title) throw new Error('Missing MangaTaro discovery title')
        const cover = item.cover === '' || item.cover == null || item.cover === 'https://via.placeholder.com/800x600' ? '' : imageURL(item.cover, true)
        // A popular-chapter feed can contain several chapters of one title.
        // Keep its first ranked occurrence without inventing new title IDs.
        if (seen.has(id)) continue
        seen.add(id)
        result.push({ id, title, cover, ...(chapters && typeof item.chapter_number === 'string' && item.chapter_number.trim() ? { subtitle: 'Chapter ' + text(item.chapter_number) } : {}) })
    }
    return result
}
export function home(html: string, section: string): Card[] {
    const $ = load(html)
    const embedded = section === 'popular' ? '#unified-manga-slider' : section === 'highscore' ? '#highscore-manga-slider' : undefined
    if (embedded) {
        const initial = $(embedded).attr('data-initial')
        if (!initial) throw new Error('MangaTaro embedded discovery feed is missing')
        return feedCards(JSON.parse(initial))
    }
    const selector = section === 'featured' ? '#featured-carousel .carousel-slide' : section === 'recent' ? '#manga-grid > .group' : section === 'completed' ? '#sidebar-completed > a' : undefined
    if (!selector) throw new Error('Unknown MangaTaro home section')
    const result = $(selector).toArray().filter(node => !$(node).find('span').toArray().some(span => text($(span).text()) === 'Novel')).map(node => {
        const row = $(node), anchor = section === 'completed' ? row : row.find('a[href*="/manga/"]').first()
        const cover = row.find('img').first().attr('src')
        return { id: seriesID(anchor.attr('href') ?? ''), title: text(row.find('h2,h3').text() || row.find('a[href*="/manga/"]').last().text()), cover: cover ? imageURL(cover, true) : '', rating: labelRating(row.find('span').toArray().map(node => $(node).text())) }
    })
    if (!result.length || result.some(item => !item.title) || new Set(result.map(item => item.id)).size !== result.length) throw new Error('MangaTaro home section is incomplete')
    return result
}
export function detail(html: string, id: string, options: Choices): Detail {
    const $ = load(html), expected = DOMAIN + '/manga/' + slug(id)
    if ($('link[rel="canonical"]').attr('href') !== expected) throw new Error('MangaTaro detail identity mismatch')
    const numericId = numeric($('body').attr('data-manga-id') ?? '')
    const schema = $('script[type="application/ld+json"]').toArray().map(node => JSON.parse($(node).text()) as Record<string, unknown>).find(value => value['@type'] === 'ComicSeries')
    if (!schema || schema.url !== expected) throw new Error('MangaTaro detail schema identity mismatch')
    const titleNode = $('h1').last(), title = text(titleNode.text()), area = titleNode.parent()
    const description = $('#description-content-tab').clone(); description.find('br').replaceWith('\n'); description.find('p').append('\n\n')
    const labels = [...new Set(area.find('a[href*="/tag/"]').toArray().map(node => text($(node).text())))]
    const rating = labelRating(labels)
    const sourceTags = labels.map(title => { const option = options.genres.find(option => option.title.toLowerCase() === title.toLowerCase()); return { id: option?.id ?? title, title, isNonInteractive: !option } })
    const data = area.children('div').filter((_, node) => $(node).find('> span').length >= 3).first().children('span').toArray().map(node => text($(node).text()))
    const type = String(schema.genre ?? ''), status = String(schema.status ?? '')
    if (!title || type === 'Novel') throw new Error('MangaTaro title is missing or is a text novel')
    const author = schema.author && typeof schema.author === 'object' ? String((schema.author as { name?: string }).name ?? '') : ''
    const stats = [data.find(value => /^\d{4}$/.test(value)) ? 'Original year: ' + data.find(value => /^\d{4}$/.test(value)) : '', text($('.rating-badge').last().text()) ? 'MangaTaro user score: ' + text($('.rating-badge').last().text()) : ''].filter(Boolean)
    const additionalInfo: NonNullable<Content['additionalInfo']> = []
    if (author) additionalInfo.push(staff.section({ id: 'creators', title: 'Author & Artist', hasMore: false, items: [staff.item({ id: 'author-artist', title: text(author) })] }))
    if (stats.length) additionalInfo.push(tags.section({ id: 'source-metadata', title: 'Source metadata', items: stats.map((title, index) => tags.item({ id: String(index), title, isNonInteractive: true })) }))
    if (rating === undefined) additionalInfo.push(incompleteRatingInfo())
    const malID = $('.mal-info-section').attr('data-mal-id')
    // A real title can have no source cover. Do not replace it with the site logo
    // or let the absent image prevent valid metadata and chapters from loading.
    const cover = schema.image == null || schema.image === '' ? '' : imageURL(String(schema.image), true)
    return { numericId, rating, content: { title, cover, webUrl: expected, contentRating: nativeRating(rating), summary: description.text().trim(), additionalTitles: [text(titleNode.next('p').text())].filter(Boolean), tags: sourceTags, contentType: type === 'Manhwa' ? ContentType.MANHWA : type === 'Manhua' ? ContentType.MANHUA : type === 'Manga' ? ContentType.MANGA : undefined, status: status === 'Ongoing' ? PublicationStatus.ONGOING : status === 'Completed' ? PublicationStatus.COMPLETED : undefined, recommendedPanelMode: type === 'Manhwa' ? ReadingMode.WEBTOON : ReadingMode.PAGED_COMIC, additionalInfo, ...(malID ? { trackerInfo: { mal: malID } } : {}) } }
}
export function readable(item: SourceChapter): boolean { return item.chapter_type === 'media' && !item.locked && !item.is_locked && !item.requires_login && !(Number(item.price) > 0) }
function relativeDate(value: string, now: number): Date {
    const normalized = text(value).toLowerCase()
    if (/^(?:just now|a moment ago|moments ago)$/.test(normalized)) return new Date(now)
    const match = normalized.match(/^(\d+|a|an)\s*(seconds?|minutes?|hours?|days?|weeks?|months?|years?|s|m|h|d|w|y)\s+ago$/)
    if (match) {
        const unit = match[2] ?? '', scale = /^s/.test(unit) ? 1000 : /^m(?:$|in)/.test(unit) ? 60000 : /^h/.test(unit) ? 3600000 : /^d/.test(unit) ? 86400000 : /^w/.test(unit) ? 604800000 : /^month/.test(unit) ? 2592000000 : 31536000000
        return new Date(now - (/^\d+$/.test(match[1] ?? '') ? Number(match[1]) : 1) * scale)
    }
    // Unknown source dates are not fabricated as the current publication time.
    return new Date(0)
}
export function nativeChapters(items: SourceChapter[], owner: string): Chapter[] {
    const now = Date.now()
    return items.filter(readable).slice().reverse().map((item, index) => {
        numeric(item.id)
        const target = sourceURL(item.url)
        if (target.search || !target.pathname.startsWith('/read/' + slug(owner) + '/') || !target.pathname.endsWith('-' + item.id) || target.pathname.split('/').length !== 4) throw new Error('MangaTaro chapter does not belong to this title')
        const label = text(item.chapter), parsed = Number(label), subtitle = text(item.title ?? '')
        return { chapterId: item.id, number: Number.isFinite(parsed) && label ? parsed : 0, index, webUrl: target.href, date: relativeDate(item.date, now), language: item.language || 'en', title: [Number.isFinite(parsed) && label ? '' : label, subtitle === 'N/A' ? '' : subtitle].filter(Boolean).join(' — ') || undefined, ...(item.group_name ? { provider: { id: item.group_id || item.group_name, name: text(item.group_name) } } : {}) }
    })
}
