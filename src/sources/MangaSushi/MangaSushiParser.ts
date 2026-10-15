import {
    Chapter,
    ChapterData,
    Content,
    ContentRating,
    ContentType,
    Highlight,
    Option,
    PublicationStatus,
    ReadingMode,
    staff
} from '@mana-app/types'
import { load } from 'cheerio'

export const DOMAIN = 'https://mangasushi.org'
export const BLOCKED_GENRES = new Set(['adult', 'mature', 'smut', 'hentai', 'erotica', 'ecchi'])
export type QueryValue = string | number | boolean | null | QueryValue[] | { [key: string]: QueryValue }
export interface Listing {
    items: Series[]
    next?: { template: string, vars: { [key: string]: QueryValue } }
    ended: boolean
}
export interface Series extends Highlight {
    genres: Option[]
    authors: string[]
    artists: string[]
    alternatives: string[]
    status?: PublicationStatus
    release?: string
    explicit: boolean
    classified: boolean
}

export function text(value: string): string {
    return value.replace(/\s+/g, ' ').trim()
}

export function seriesId(value: string): string {
    const match = value.match(/^(?:https?:\/\/(?:www\.)?mangasushi\.org)?\/manga\/([^/?#]+)\/?(?:[?#].*)?$/i)
    if (!match?.[1]) throw new Error('Invalid MangaSushi series URL')
    return decodeURIComponent(match[1])
}

export function seriesURL(id: string): string {
    if (!id || /[/?#]/.test(id)) throw new Error('Invalid MangaSushi series ID')
    return `${DOMAIN}/manga/${encodeURIComponent(id)}/`
}

export function imageURL($: ReturnType<typeof load>, element: cheerio.Element | undefined): string {
    if (!element) throw new Error('MangaSushi image is missing')
    const image = $(element)
    for (const key of ['data-src', 'data-lazy-src', 'src']) {
        const value = image.attr(key)?.trim()
        if (!value || /^(?:data:|javascript:)/i.test(value) || /dflazy|loading\.gif/i.test(value)) continue
        const url = new URL(value, DOMAIN)
        if (url.protocol === 'https:' || url.protocol === 'http:') return url.href
    }
    throw new Error('MangaSushi did not provide a usable image URL')
}

function status(value: string): PublicationStatus | undefined {
    switch (text(value).toLowerCase()) {
        case 'ongoing': return PublicationStatus.ONGOING
        case 'completed': return PublicationStatus.COMPLETED
        case 'canceled':
        case 'cancelled': return PublicationStatus.CANCELLED
        case 'on hold': return PublicationStatus.HIATUS
        default: return undefined
    }
}

export function parseListing(html: string, selector = '.c-tabs-item__content'): Listing {
    const $ = load(html)
    const items: Series[] = []
    const seen = new Set<string>()
    $(selector).each((_, element) => {
        const item = $(element)
        const anchor = item.find('.post-title a').first()
        const href = anchor.attr('href')
        if (!href) throw new Error('MangaSushi listing is missing a series link')
        const id = seriesId(href)
        if (seen.has(id)) return
        seen.add(id)
        const title = text(anchor.attr('title') || anchor.text())
        if (!title) throw new Error('MangaSushi listing is missing a title')
        const field = (name: string) => item.find(`.mg_${name} .summary-content`).first()
        const genres = field('genres').find('a').toArray().map((node) => ({
            id: ($(node).attr('href') ?? '').match(/\/manga-genre\/([^/?#]+)/)?.[1] ?? '',
            title: text($(node).text())
        })).filter((genre) => genre.id && genre.title)
        const explicit = genres.some((genre) => BLOCKED_GENRES.has(genre.id.toLowerCase()))
            || item.find('.adult-content, .manga-adult, .adult-warning, [data-adult="1"], [data-adult="true"]').length > 0
        items.push({
            id,
            title,
            cover: imageURL($, item.find('img').first().get(0)),
            webUrl: seriesURL(id),
            subtitle: text(item.find('.chapter a, .chapter-item a').first().text()) || undefined,
            genres,
            authors: field('author').find('a').toArray().map((node) => text($(node).text())),
            artists: field('artists').find('a').toArray().map((node) => text($(node).text())),
            // Commas occur inside legitimate titles; retain the site's full alternative text.
            alternatives: [text(field('alternative').text())].filter(Boolean),
            status: status(field('status').text()),
            release: text(field('release').text()) || undefined,
            contentRating: explicit ? ContentRating.MATURE : genres.length ? ContentRating.SAFE : undefined,
            explicit,
            classified: genres.length > 0
        })
    })
    const template = $('#navigation-ajax').attr('data-template')
    const serialized = html.match(/var\s+__madara_query_vars\s*=\s*(\{[^\n]+\});/)
    let next: Listing['next']
    if (template) {
        if (!serialized?.[1]) throw new Error('MangaSushi pagination metadata is missing')
        const vars = JSON.parse(serialized[1]) as { [key: string]: QueryValue }
        if (vars.post_type !== 'wp-manga' || !/^madara-core\/content\/content-(search|archive)$/.test(template)) {
            throw new Error('MangaSushi pagination metadata changed')
        }
        next = { template, vars }
    }
    return { items, next, ended: items.length === 0 || $('.no-posts').length > 0 }
}

export function parseContent(html: string, series: Series): Content {
    const $ = load(html)
    if ($('link[rel="canonical"]').attr('href') !== series.webUrl) {
        throw new Error('MangaSushi returned a different series detail page')
    }
    const title = text($('.post-title h1').first().text())
    if (!title || !$('#manga-chapters-holder').length) throw new Error('MangaSushi detail page is incomplete')
    const summary = $('.description-summary .summary__content').first().clone()
    summary.find('br').replaceWith('\n')
    summary.find('p').append('\n\n')
    const people = [
        ...series.authors.map((name) => staff.item({ id: `author:${name}`, title: name, subtitle: 'Author' })),
        ...series.artists.map((name) => staff.item({ id: `artist:${name}`, title: name, subtitle: 'Artist' }))
    ]
    return {
        title,
        cover: imageURL($, $('.summary_image img').first().get(0)),
        webUrl: series.webUrl,
        summary: summary.text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim(),
        additionalTitles: series.alternatives,
        tags: series.genres,
        status: series.status,
        contentType: ContentType.MANGA,
        contentRating: series.contentRating,
        recommendedPanelMode: ReadingMode.PAGED_MANGA,
        additionalInfo: people.length ? [staff.section({ id: 'staff', title: 'Staff', hasMore: false, items: people })] : undefined
    }
}

function chapterDate(value: string): Date {
    const absolute = Date.parse(value)
    if (Number.isFinite(absolute)) return new Date(absolute)
    const relative = value.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/i)
    if (relative) {
        const units: Record<string, number> = { second: 1000, minute: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 }
        return new Date(Date.now() - Number(relative[1]) * (units[relative[2]?.toLowerCase() ?? ''] ?? 0))
    }
    throw new Error(`MangaSushi chapter date is not recognized: ${value}`)
}

export function parseChapters(html: string, id: string): Chapter[] {
    const $ = load(html)
    const seen = new Set<string>()
    const chapters: Chapter[] = []
    $('.wp-manga-chapter').each((_, element) => {
        const row = $(element)
        const anchor = row.children('a').first()
        const href = anchor.attr('href')?.trim() ?? ''
        const base = seriesURL(id)
        if (!href.startsWith(base)) throw new Error('MangaSushi returned a chapter belonging to another series')
        const chapterId = href.slice(base.length).replace(/\/$/, '')
        if (!chapterId || /[/?#]/.test(chapterId)) throw new Error('MangaSushi chapter URL changed')
        if (seen.has(chapterId)) return
        seen.add(chapterId)
        const title = text(anchor.text())
        const number = Number(title.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i)?.[1] ?? chapterId.match(/chapter-(\d+(?:-\d+)?)/)?.[1]?.replace('-', '.'))
        if (!Number.isFinite(number)) throw new Error(`MangaSushi chapter number is not recognized: ${title}`)
        const release = row.find('.chapter-release-date')
        const date = chapterDate(release.find('[title]').attr('title') || text(release.text()))
        chapters.push({ chapterId, title, number, index: 0, date, language: 'en_US', webUrl: href })
    })
    if (!chapters.length) throw new Error('MangaSushi returned no chapters')
    return chapters.reverse().map((chapter, index) => ({ ...chapter, index }))
}

export function parseReader(html: string, id: string, chapterId: string): ChapterData {
    const $ = load(html)
    const expected = `${seriesURL(id)}${encodeURIComponent(chapterId)}/`
    if ($('link[rel="canonical"]').attr('href') !== expected
        || $('#wp-manga-current-chap').attr('value') !== chapterId) {
        throw new Error('MangaSushi returned a different series or chapter reader')
    }
    const images = $('.reading-content img.wp-manga-chapter-img').toArray()
    const pages = images.map((node) => imageURL($, node))
    if (!pages.length) throw new Error('MangaSushi returned no reader pages')
    if (new Set(pages).size !== pages.length) throw new Error('MangaSushi returned duplicate reader pages')
    const indices = images.map((node) => $(node).attr('id')?.match(/^image-(\d+)$/)?.[1])
    if (indices.some((index) => index !== undefined) && indices.some((index, position) => index === undefined || Number(index) !== position)) {
        throw new Error('MangaSushi reader page numbering is incomplete or out of order')
    }
    return { pages: pages.map((url) => ({ url })) }
}

export function formEncode(value: QueryValue, prefix = ''): string[] {
    if (value === null) return []
    if (typeof value !== 'object') return [`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`]
    return Object.entries(value).flatMap(([key, item]) => formEncode(item, prefix ? `${prefix}[${key}]` : key))
}
