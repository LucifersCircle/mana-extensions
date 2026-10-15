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
    staff,
    tags
} from '@mana-app/types'
import { load } from 'cheerio'

export const DOMAIN = 'https://manhwanex.com'
export const VERIFIED_GENRES = new Set(['action', 'adventure', 'cultivation-manhwa', 'fantasy', 'ghost-manhwa', 'martial-arts', 'romance', 'system-manhwa'])
export const BLOCKED_GENRES = new Set(['adult', 'mature', 'smut', 'hentai', 'erotica', 'ecchi'])
export interface Series extends Highlight {
    genres: Option[]
    authors: string[]
    artists: string[]
    alternatives: string[]
    release?: string
    status?: PublicationStatus
    statusText?: string
    explicit: boolean
    classified: boolean
    postId?: string
}
export interface Listing { items: Series[], next?: string }
export type QueryValue = string | number | boolean | null | QueryValue[] | { [key: string]: QueryValue }

export function text(value: string): string { return value.replace(/\s+/g, ' ').trim() }

export function validId(id: string): string {
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new Error('Invalid ManhwaNex canonical ID')
    return id
}

export function seriesURL(id: string): string { return `${DOMAIN}/manga/${validId(id)}/` }

export function seriesId(value: string): string {
    const url = new URL(value, DOMAIN)
    if (url.origin !== DOMAIN || url.username || url.password || url.search || url.hash) throw new Error('Invalid ManhwaNex series URL')
    const match = url.pathname.match(/^\/manga\/([^/]+)\/$/)
    if (!match?.[1]) throw new Error('Invalid ManhwaNex series URL')
    return validId(match[1])
}

export function chapterURL(id: string, chapterId: string): string { return `${seriesURL(id)}${validId(chapterId)}/` }

export function imageURL($: ReturnType<typeof load>, element: cheerio.Element | undefined): string {
    if (!element) throw new Error('ManhwaNex image is missing')
    for (const key of ['data-src', 'data-lazy-src', 'src']) {
        const value = $(element).attr(key)?.trim()
        if (!value || /^(?:data:|javascript:)|dflazy|loading\.gif/i.test(value)) continue
        const url = new URL(value, DOMAIN)
        if (url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.port) return url.href
    }
    throw new Error('ManhwaNex did not provide a usable HTTPS image')
}

export function coverURL($: ReturnType<typeof load>, element: cheerio.Element | undefined): string {
    const current = imageURL($, element)
    const image = $(element)
    const base = new URL(current)
    const derivative = /-(\d+)x(\d+)(\.[a-z0-9]+)$/i
    const currentSize = base.pathname.match(derivative)
    // An unsuffixed original is not a thumbnail merely because its HTML width is small.
    if (!currentSize) return current
    const width = Number(currentSize[1]), height = Number(currentSize[2])
    const asset = base.pathname.replace(derivative, '$3')
    let largest = { url: current, width }
    for (const key of ['data-srcset', 'srcset']) {
        for (const entry of (image.attr(key) ?? '').split(',')) {
            const match = entry.trim().match(/^(\S+)\s+([1-9]\d*)w$/)
            if (!match?.[1]) continue
            try {
                const url = new URL(match[1], DOMAIN)
                const size = url.pathname.match(derivative)
                const candidateWidth = Number(size?.[1] ?? match[2])
                const candidateHeight = Number(size?.[2] ?? height * candidateWidth / width)
                if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.origin !== base.origin
                    || url.search !== base.search || url.pathname.replace(derivative, '$3') !== asset
                    || candidateWidth !== Number(match[2]) || candidateWidth <= largest.width || candidateWidth > 10000
                    || (size && Math.abs((candidateWidth / candidateHeight) / (width / height) - 1) > 0.05)) continue
                largest = { url: url.href, width: candidateWidth }
            } catch { /* Ignore invalid advertised candidates, never synthesize variants. */ }
        }
    }
    return largest.url
}

function detailCoverURL($: ReturnType<typeof load>): string {
    const current = coverURL($, $('.summary_image img').first().get(0))
    const base = new URL(current), resized = base.pathname.match(/-(\d+)x(\d+)(\.[a-z0-9]+)$/i)
    if (!resized) return current
    const value = $('meta[property="og:image"]').attr('content')?.trim()
    if (!value) return current
    try {
        const original = new URL(value, DOMAIN)
        const width = Number($('meta[property="og:image:width"]').attr('content'))
        const height = Number($('meta[property="og:image:height"]').attr('content'))
        if (original.protocol !== 'https:' || original.origin !== base.origin || original.username || original.password || original.hash
            || original.search !== base.search || original.pathname !== base.pathname.replace(/-\d+x\d+(\.[a-z0-9]+)$/i, '$1')
            || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width > 20000 || height > 20000
            || width <= Number(resized[1]) || height <= Number(resized[2])) return current
        return original.href
    } catch { return current }
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

export function taxonomyId(value: string, kind: 'genre' | 'tag'): string {
    const url = new URL(value, DOMAIN)
    const match = url.pathname.match(new RegExp(`^/manga-${kind}/([^/]+)/$`))
    if (url.origin !== DOMAIN || url.username || url.password || url.search || url.hash || !match?.[1]
        || /%(?:2f|5c|00|25|2e)/i.test(match[1]) || /%(?![a-f0-9]{2})/i.test(match[1])) throw new Error('ManhwaNex taxonomy URL is invalid')
    let decoded: string
    try { decoded = decodeURIComponent(match[1]) } catch { throw new Error('ManhwaNex taxonomy encoding is invalid') }
    if (!/^(?:[a-z0-9_-]|%[a-f0-9]{2})+$/i.test(match[1]) || decoded.includes('/') || decoded.includes('\\')
        || decoded.includes('%') || [...decoded].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) throw new Error('ManhwaNex taxonomy ID is invalid')
    return match[1]
}

function taxonomy($: ReturnType<typeof load>, anchors: cheerio.Cheerio, kind: 'genre' | 'tag'): Option[] {
    return anchors.toArray().map((node) => {
        const title = text($(node).text())
        if (!title) throw new Error('ManhwaNex taxonomy label is missing')
        return { id: taxonomyId($(node).attr('href') ?? '', kind), title }
    })
}

function fields($: ReturnType<typeof load>, root: cheerio.Cheerio, detail: boolean): Pick<Series, 'genres' | 'authors' | 'artists' | 'alternatives' | 'release' | 'status' | 'statusText' | 'explicit' | 'classified' | 'contentRating'> {
    const field = (name: string) => detail ? root.find('.post-content_item').filter((_, node) => {
        const heading = text($(node).find('.summary-heading').text()).toLowerCase()
        return ({ genres: ['genre(s)', 'genres'], author: ['author(s)', 'authors'], artists: ['artist(s)', 'artists'], alternative: ['alternative'], release: ['release'], status: ['status'] }[name] ?? []).includes(heading)
    }).first().find('.summary-content') : root.find(`.mg_${name} .summary-content`).first()
    const genres = taxonomy($, field('genres').find('a'), 'genre')
    const explicit = genres.some((genre) => BLOCKED_GENRES.has(genre.id.toLowerCase()))
        || root.find('.adult-content, .manga-adult, .adult-warning, [data-adult="1"], [data-adult="true"]').length > 0
    return {
        genres,
        authors: field('author').find('a').toArray().map((node) => text($(node).text())).filter(Boolean),
        artists: field('artists').find('a').toArray().map((node) => text($(node).text())).filter(Boolean),
        // Preserve the entire source field: commas can belong to an English title.
        alternatives: [text(field('alternative').text())].filter(Boolean),
        release: text(field('release').text()) || undefined,
        status: status(field('status').text()),
        statusText: text(field('status').text()) || undefined,
        explicit,
        classified: genres.length > 0 && genres.every((genre) => VERIFIED_GENRES.has(genre.id)),
        // Source non-adult labels do not establish all-ages suitability.
        contentRating: explicit ? ContentRating.EXPLICIT : ContentRating.MATURE
    }
}

function context(url: URL): string {
    const pairs = [...url.searchParams.entries()].map(([key, value]) => `${key.replace(/^(genre|status)\[\d*\]$/, '$1[]')}=${value}`).sort()
    return pairs.join('&')
}

export function parseNext($: ReturnType<typeof load>, requestURL: string): string | undefined {
    const requested = new URL(requestURL)
    const currentPage = Number(requested.pathname.match(/^\/page\/([1-9]\d*)\/$/)?.[1] ?? '1')
    if (requested.origin !== DOMAIN || !['/', `/page/${currentPage}/`].includes(requested.pathname)) throw new Error('Invalid ManhwaNex listing URL')
    const shown = text($('.wp-pagenavi .current').text())
    if (shown && Number(shown) !== currentPage) throw new Error('ManhwaNex returned a different catalog page')
    const href = $('.wp-pagenavi a.nextpostslink').attr('href')
    if (!href) return undefined
    const next = new URL(href, requestURL)
    if (next.origin !== DOMAIN || next.username || next.password || next.hash
        || next.pathname !== `/page/${currentPage + 1}/` || context(next) !== context(requested)) {
        throw new Error('ManhwaNex continuation changed the query or did not advance')
    }
    return next.href
}

export function parseListing(html: string, selector: string, requestURL?: string): Listing {
    const $ = load(html), items: Series[] = [], seen = new Set<string>()
    $(selector).each((_, element) => {
        const row = $(element), anchor = row.find('.post-title a').first()
        const id = seriesId(anchor.attr('href') ?? '')
        if (seen.has(id)) throw new Error('ManhwaNex listing contains a duplicate series')
        seen.add(id)
        const title = text(anchor.attr('title') || anchor.text())
        if (!title) throw new Error('ManhwaNex listing title is missing')
        const postId = row.find('[data-post-id]').attr('data-post-id') || row.attr('data-post-id')
        items.push({ id, title, cover: coverURL($, row.find('img').first().get(0)), webUrl: seriesURL(id),
            subtitle: text(row.find('.chapter a, .chapter-item a').first().text()) || undefined,
            postId: postId && /^[1-9]\d*$/.test(postId) ? postId : undefined,
            ...fields($, row, false) })
    })
    return { items, next: requestURL ? parseNext($, requestURL) : undefined }
}

export function parseContent(html: string, id: string, bulk?: Series): { content: Content, metadata: Series } {
    const $ = load(html), canonical = $('link[rel="canonical"]').attr('href')
    if (canonical !== seriesURL(id)) throw new Error('ManhwaNex returned a different series detail page')
    const title = text($('.post-title h1').first().text())
    if (!title || !$('#manga-chapters-holder').length) throw new Error('ManhwaNex detail page is incomplete')
    const metadata: Series = { id, title, cover: detailCoverURL($), webUrl: seriesURL(id), postId: $('#manga-chapters-holder').attr('data-id'), ...fields($, $('.tab-summary').first(), true) }
    if (bulk) {
        if (!metadata.authors.length) metadata.authors = bulk.authors
        if (!metadata.artists.length) metadata.artists = bulk.artists
    }
    const summary = $('.description-summary .summary__content').first().clone()
    summary.find('br').replaceWith('\n')
    summary.find('p').append('\n\n')
    const people = [...metadata.authors.map((name) => staff.item({ id: `author:${name}`, title: name, subtitle: 'Author' })),
        ...metadata.artists.map((name) => staff.item({ id: `artist:${name}`, title: name, subtitle: 'Artist' }))]
    const type = $('.tab-summary .post-content_item').filter((_, node) => text($(node).find('.summary-heading').text()) === 'Type').find('.summary-content').text().trim()
    const typeMap: Record<string, ContentType> = { Manga: ContentType.MANGA, Manhwa: ContentType.MANHWA, Manhua: ContentType.MANHUA }
    const sourceTags = taxonomy($, $('.tab-summary .tags-content a'), 'tag').map((tag) => tags.item(tag))
    const sourceTagSections: Array<ReturnType<typeof tags.section>> = []
    for (let offset = 0; offset < sourceTags.length; offset += 10) {
        const group = offset / 10 + 1
        sourceTagSections.push(tags.section({ id: group === 1 ? 'source-tags' : `source-tags-${group}`,
            title: group === 1 ? 'Source tags' : `Source tags (${group})`, items: sourceTags.slice(offset, offset + 10) }))
    }
    const details = [metadata.statusText ? tags.item({ id: `status:${metadata.statusText}`, title: `Status: ${metadata.statusText}` }) : undefined, metadata.release ? tags.item({ id: `release:${metadata.release}`, title: `Release: ${metadata.release}` }) : undefined,
        type ? tags.item({ id: `type:${type}`, title: `Type: ${type}` }) : undefined].filter((item): item is ReturnType<typeof tags.item> => Boolean(item))
    return { metadata, content: { title, cover: metadata.cover, webUrl: metadata.webUrl,
        summary: summary.text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim(),
        additionalTitles: metadata.alternatives, tags: metadata.genres, status: metadata.status,
        contentType: typeMap[type], contentRating: metadata.contentRating, recommendedPanelMode: ReadingMode.WEBTOON,
        additionalInfo: [...(people.length ? [staff.section({ id: 'staff', title: 'Staff', hasMore: false, items: people })] : []),
            ...(details.length ? [tags.section({ id: 'publication', title: 'Publication', items: details })] : []),
            ...sourceTagSections] } }
}

function chapterDate(value: string): Date {
    const relative = value.match(/^(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago$/i)
    if (relative) {
        const units: Record<string, number> = { second: 1000, minute: 60000, hour: 3600000, day: 86400000, week: 604800000, month: 2592000000, year: 31536000000 }
        return new Date(Date.now() - Number(relative[1]) * (units[relative[2]?.toLowerCase() ?? ''] ?? 0))
    }
    if (/^yesterday$/i.test(value)) return new Date(Date.now() - 86400000)
    const absolute = Date.parse(value)
    if (Number.isFinite(absolute)) return new Date(absolute)
    throw new Error(`ManhwaNex chapter date is not recognized: ${value}`)
}

export function parseChapters(html: string, id: string): Chapter[] {
    const $ = load(html), chapters: Chapter[] = [], seen = new Set<string>()
    $('.wp-manga-chapter').each((_, node) => {
        const row = $(node), anchor = row.children('a').first(), href = anchor.attr('href')?.trim() ?? ''
        const base = seriesURL(id)
        if (!href.startsWith(base)) throw new Error('ManhwaNex chapter belongs to another series')
        const chapterId = validId(href.slice(base.length).replace(/\/$/, ''))
        if (href !== chapterURL(id, chapterId) || seen.has(chapterId)) throw new Error('ManhwaNex chapter ID is malformed or duplicated')
        seen.add(chapterId)
        const title = text(anchor.text())
        const value = title.match(/(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)/i)?.[1]
        const special = !value && /\b(?:prologue|special|extra|side story|epilogue|bonus)\b/i.test(title)
        const number = value ? Number(value) : special ? 0 : NaN
        if (!Number.isFinite(number)) throw new Error(`ManhwaNex chapter number is not recognized: ${title}`)
        const release = row.find('.chapter-release-date')
        const date = chapterDate(release.find('[title]').attr('title') || text(release.text()))
        const reportedVolume = row.closest('.wp-manga-volume').find('.volume-name').first().text().match(/\b(?:volume|vol\.?)\s*(\d+(?:\.\d+)?)/i)?.[1]
            ?? title.match(/\b(?:volume|vol\.?)\s*(\d+(?:\.\d+)?)/i)?.[1]
        const volume = reportedVolume === undefined ? undefined : Number(reportedVolume)
        chapters.push({ chapterId, title, number, index: 0, date, language: 'en_US', webUrl: href, volume: volume !== undefined && Number.isFinite(volume) ? volume : undefined })
    })
    if (!chapters.length) throw new Error('ManhwaNex returned no available chapters')
    return chapters.reverse().map((chapter, index) => ({ ...chapter, index }))
}

export function parseReader(html: string, id: string, chapterId: string): ChapterData {
    const $ = load(html)
    if ($('link[rel="canonical"]').attr('href') !== chapterURL(id, chapterId)
        || $('#wp-manga-current-chap').attr('value') !== chapterId) throw new Error('ManhwaNex returned a different reader')
    const images = $('.reading-content img.wp-manga-chapter-img').toArray()
    const pages = images.map((node) => imageURL($, node))
    if (!pages.length || new Set(pages).size !== pages.length) throw new Error('ManhwaNex reader images are missing or duplicated')
    const indices = images.map((node) => $(node).attr('id')?.match(/^image-(\d+)$/)?.[1])
    if (indices.some((index) => index !== undefined) && indices.some((index, position) => index === undefined || Number(index) !== position)) throw new Error('ManhwaNex reader image order changed')
    return { pages: pages.map((url) => ({ url })) }
}

export function formEncode(value: QueryValue, prefix = ''): string[] {
    if (value === null) return []
    if (typeof value !== 'object') return [`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`]
    return Object.entries(value).flatMap(([key, item]) => formEncode(item, prefix ? `${prefix}[${key}]` : key))
}
