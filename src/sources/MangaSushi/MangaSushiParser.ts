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
import { incompleteRatingInfo,
    nativeRating } from '../../ContentRatingPolicy'

export const DOMAIN = 'https://mangasushi.org'
export const BLOCKED_GENRES = new Set(['adult', 'mature', 'smut', 'hentai', 'erotica', 'ecchi'])
const EXPLICIT_GENRES = new Set(['hentai', 'smut', 'erotica'])
const ADULT_WARNING = '.adult-content, .manga-adult, .adult-warning, [data-adult="1"], [data-adult="true"]'

function itemRating(genres: Option[], warning: boolean): ContentRating | undefined {
    if (warning || genres.some((genre) => EXPLICIT_GENRES.has(genre.id.toLowerCase()))) return ContentRating.EXPLICIT
    if (genres.some((genre) => BLOCKED_GENRES.has(genre.id.toLowerCase()))) return ContentRating.MATURE
    return genres.length ? ContentRating.SAFE : undefined
}
export type QueryValue = string | number | boolean | null | QueryValue[] | { [key: string]: QueryValue }
export interface Listing {
    items: Series[]
    rawGenres?: string[][]
    queryVars?: { [key: string]: QueryValue }
    searchGenres?: { available: string[], selected: string[], condition: string }
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

function coverURL($: ReturnType<typeof load>, element: cheerio.Element | undefined): string {
    const current = imageURL($, element)
    const image = $(element)
    const base = new URL(current)
    const derivative = /-(\d+)x(\d+)(\.[a-z0-9]+)$/i
    const currentSize = base.pathname.match(derivative)
    // An unsuffixed original may only be displayed at thumbnail size. Never
    // mistake its HTML display dimensions for its intrinsic resolution.
    if (!currentSize) return current
    const width = Number(currentSize[1])
    const height = Number(currentSize[2])
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= width) return current
    const asset = base.pathname.replace(derivative, '$3')
    const candidates: Array<{ url: string, width: number, original: boolean }> = []
    for (const key of ['data-srcset', 'srcset']) {
        for (const entry of (image.attr(key) ?? '').split(',')) {
            const match = entry.trim().match(/^(\S+)\s+([1-9]\d*)w$/)
            if (!match?.[1]) continue
            try {
                const url = new URL(match[1], DOMAIN)
                const size = url.pathname.match(derivative)
                const candidateWidth = Number(match[2])
                const candidateHeight = Number(size?.[2])
                if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash
                    || url.origin !== base.origin || url.search !== base.search || url.pathname.replace(derivative, '$3') !== asset
                    || !Number.isSafeInteger(candidateWidth) || candidateWidth <= width) continue
                if (size && (Number(size[1]) !== candidateWidth || !Number.isSafeInteger(candidateHeight)
                    || candidateHeight <= height || candidateHeight <= candidateWidth
                    || Math.abs((candidateWidth / candidateHeight) / (width / height) - 1) > 0.05)) continue
                candidates.push({ url: url.href, width: candidateWidth, original: !size })
            } catch { /* Invalid advertised candidates do not invalidate the current cover. */ }
        }
    }
    // Prefer the largest advertised same-asset image, including an explicitly
    // listed original. Never manufacture an original by stripping a size suffix.
    return candidates.sort((a, b) => b.width - a.width || Number(b.original) - Number(a.original))[0]?.url ?? current
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

export interface GenreSelection { genres: string[], condition: 'or' | 'and', allowedTaxonomies: string[] }

export function genreSelection(genres: string[], condition = 'or', fields: { author?: string, artist?: string, release?: string } = {}): GenreSelection | undefined {
    if (!genres.length) return undefined
    if (!['or', 'and'].includes(condition) || genres.length > 100
        || new Set(genres).size !== genres.length || genres.some((genre) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(genre))) {
        throw new Error('Invalid MangaSushi genre filter selection')
    }
    return { genres, condition: condition as GenreSelection['condition'],
        allowedTaxonomies: (['author', 'artist', 'release'] as const).filter((key) => fields[key]?.trim()).map((key) => `wp-manga-${key}`) }
}

function genreSlug(value: string): string {
    try {
        const url = new URL(value, DOMAIN)
        if (url.origin === DOMAIN && !url.username && !url.password && !url.search && !url.hash) {
            return url.pathname.match(/^\/manga-genre\/([a-z0-9]+(?:-[a-z0-9]+)*)\/$/)?.[1] ?? ''
        }
    } catch { /* Unverified genre links cannot prove a requested filter. */ }
    return ''
}

function queryVariables(html: string, name: '__madara_query_vars' | 'manga_args' = '__madara_query_vars'): Listing['queryVars'] {
    const assignments = html.match(new RegExp(`\\b${name}\\s*=`, 'g')) ?? []
    if (!assignments.length) return undefined
    const serialized = html.match(new RegExp(`var\\s+${name}\\s*=\\s*(\\{[^\\n]+\\});`))
    if (assignments.length !== 1 || !serialized?.[1]) throw new Error('MangaSushi pagination query is ambiguous or malformed')
    const vars = JSON.parse(serialized[1]) as { [key: string]: QueryValue }
    // JSON.parse silently accepts duplicate keys. They are not an unambiguous
    // provider query, especially when a repeated tax_query changes its meaning.
    const stack: Array<{ keys?: Set<string>, key: boolean }> = []
    for (const token of serialized[1].match(/"(?:\\.|[^"\\])*"|[{}[\],:]/g) ?? []) {
        const current = stack[stack.length - 1]
        if (token === '{') stack.push({ keys: new Set(), key: true })
        else if (token === '[') stack.push({ key: false })
        else if (token === '}' || token === ']') stack.pop()
        else if (token === ',' && current?.keys) current.key = true
        else if (token.startsWith('"') && current?.keys && current.key) {
            const key = JSON.parse(token) as string
            if (current.keys.has(key)) throw new Error('MangaSushi pagination query contains duplicate keys')
            current.keys.add(key)
            current.key = false
        }
    }
    return vars
}

export function assertGenreSearch(listing: Listing, selection: GenreSelection | undefined, initial = false): void {
    if (!selection) return
    const fail = () => { throw new Error('MangaSushi did not apply the requested genre filter; refresh or change the selection') }
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((value) => b.includes(value))
    if (initial) {
        const form = listing.searchGenres
        if (!form || new Set(form.available).size !== form.available.length
            || !selection.genres.every((genre) => form.available.includes(genre))
            || !same(form.selected, selection.genres) || form.condition !== selection.condition) fail()
        const query = listing.queryVars?.tax_query
        if (query !== undefined || listing.items.length) {
            if (!query || Array.isArray(query) || typeof query !== 'object') return fail()
            const entries = Object.entries(query).filter(([key]) => key !== 'relation')
            if ((listing.queryVars?.post_type !== undefined && listing.queryVars.post_type !== 'wp-manga')
                || listing.queryVars?.template !== 'search' || query.relation !== 'OR'
                || !entries.length || entries.some(([key], index) => key !== String(index))) return fail()
            // Madara appends author/artist/release taxonomy clauses beside the
            // genre expression. Preserve only the observed flat siblings, tied
            // to fields actually requested, without accepting surprise taxa.
            const siblings = new Set<string>()
            for (const [, clause] of entries.slice(1)) {
                if (!clause || Array.isArray(clause) || typeof clause !== 'object'
                    || Object.keys(clause).some((key) => !['taxonomy', 'field', 'terms'].includes(key))
                    || typeof clause.taxonomy !== 'string' || !selection.allowedTaxonomies.includes(clause.taxonomy)
                    || siblings.has(clause.taxonomy) || clause.field !== 'term_id'
                    || !Array.isArray(clause.terms) || clause.terms.length !== 1
                    || !Number.isSafeInteger(clause.terms[0]) || Number(clause.terms[0]) < 1) return fail()
                siblings.add(clause.taxonomy)
            }
            let clauses: QueryValue[]
            if (selection.condition === 'or') clauses = [query[0] as QueryValue]
            else {
                // Madara serializes AND as one array-wrapped group inside the
                // root OR query. Accept this observed shape, not arbitrary trees.
                const wrapper = query[0]
                if (!Array.isArray(wrapper) || wrapper.length !== 1) return fail()
                const group = wrapper[0]
                if (!group || Array.isArray(group) || typeof group !== 'object' || group.relation !== 'AND') return fail()
                const entries = Object.entries(group).filter(([key]) => key !== 'relation')
                if (entries.length !== selection.genres.length || entries.some(([key], index) => key !== String(index))) return fail()
                clauses = entries.map(([, clause]) => clause)
            }
            const terms: string[] = [], fields: string[] = []
            for (const clause of clauses) {
                if (!clause || Array.isArray(clause) || typeof clause !== 'object'
                    || Object.keys(clause).some((key) => !['taxonomy', 'field', 'terms', 'operator'].includes(key))
                    || clause.taxonomy !== 'wp-manga-genre' || !['term_id', 'slug'].includes(String(clause.field))
                    || (clause.operator !== undefined && clause.operator !== 'IN')
                    || !Array.isArray(clause.terms)
                    || clause.terms.length !== (selection.condition === 'or' ? selection.genres.length : 1)) return fail()
                for (const term of clause.terms) {
                    if (clause.field === 'term_id' ? !Number.isSafeInteger(term) || Number(term) < 1
                        : typeof term !== 'string' || !selection.genres.includes(term)) fail()
                    terms.push(String(term))
                }
                fields.push(String(clause.field))
            }
            if (new Set(fields).size !== 1 || new Set(terms).size !== terms.length
                || (fields[0] === 'slug' && !same(terms, selection.genres))) fail()
            // The form exposes slugs, not numeric term IDs. Do not invent an ID
            // map: native taxonomy shape AND every raw card must prove semantics.
        }
    }
    if (listing.items.length && (!listing.rawGenres?.length || listing.rawGenres.some((genres) => {
        const matches = selection.genres.filter((genre) => genres.includes(genre)).length
        return selection.condition === 'and' ? matches !== selection.genres.length : matches === 0
    }))) fail()
}

export function parseListing(html: string, selector = '.c-tabs-item__content'): Listing {
    const $ = load(html)
    const items: Series[] = []
    const seen = new Set<string>()
    const rawGenres: string[][] = []
    $(selector).each((_, element) => {
        const item = $(element)
        const anchor = item.find('.post-title a').first()
        const href = anchor.attr('href')
        if (!href) throw new Error('MangaSushi listing is missing a series link')
        const id = seriesId(href)
        const title = text(anchor.attr('title') || anchor.text())
        if (!title) throw new Error('MangaSushi listing is missing a title')
        const field = (name: string) => item.find(`.mg_${name} .summary-content`).first()
        const genres = field('genres').find('a').toArray().map((node) => ({
            id: genreSlug($(node).attr('href') ?? ''),
            title: text($(node).text())
        })).filter((genre) => genre.id && genre.title)
        rawGenres.push(genres.map((genre) => genre.id))
        if (seen.has(id)) return
        seen.add(id)
        const warning = item.find(ADULT_WARNING).add(item.filter(ADULT_WARNING)).length > 0
        const explicit = warning || genres.some((genre) => BLOCKED_GENRES.has(genre.id.toLowerCase()))
        items.push({
            id,
            title,
            cover: coverURL($, item.find('img').first().get(0)),
            webUrl: seriesURL(id),
            subtitle: text(item.find('.chapter a, .chapter-item a').first().text()) || undefined,
            genres,
            authors: field('author').find('a').toArray().map((node) => text($(node).text())),
            artists: field('artists').find('a').toArray().map((node) => text($(node).text())),
            // Commas occur inside legitimate titles; retain the site's full alternative text.
            alternatives: [text(field('alternative').text())].filter(Boolean),
            status: status(field('status').text()),
            release: text(field('release').text()) || undefined,
            contentRating: itemRating(genres, warning),
            explicit,
            classified: genres.length > 0
        })
    })
    const template = $('#navigation-ajax').attr('data-template')
    const form = $('.search-advanced-form')
    // A short final search page has no AJAX vars. Its separate, explicit native
    // manga_args script still advertises the actual search taxonomy. Never use
    // it to replace malformed primary state or to construct a continuation.
    const vars = queryVariables(html) ?? (!template && selector === '.c-tabs-item__content'
        && form.length === 1 && form.find('input[name="post_type"]').attr('value') === 'wp-manga'
        ? queryVariables(html, 'manga_args') : undefined)
    let next: Listing['next']
    if (template) {
        if (!vars) throw new Error('MangaSushi pagination metadata is missing')
        if (vars.post_type !== 'wp-manga' || !/^madara-core\/content\/content-(search|archive)$/.test(template)) {
            throw new Error('MangaSushi pagination metadata changed')
        }
        next = { template, vars }
    }
    const options = form.find('input[name="genre[]"]')
    const condition = form.find('select[name="op"] option:selected').attr('value')
    return { items, rawGenres, queryVars: vars, searchGenres: form.length === 1 ? {
        available: options.toArray().map((node) => $(node).attr('value') ?? ''),
        selected: options.filter('[checked]').toArray().map((node) => $(node).attr('value') ?? ''),
        condition: condition === '1' ? 'and' : condition === '' ? 'or' : 'unknown'
    } : undefined, next, ended: items.length === 0 || $('.no-posts').length > 0 }
}

export function parseDetailMetadata(html: string, id: string): Series {
    const $ = load(html), root = $('.tab-summary').first()
    const field = (name: string) => root.find('.post-content_item').filter((_, node) =>
        text($(node).find('.summary-heading').text()).toLowerCase().replace(/\(s\)/g, '') === name
    ).first().find('.summary-content')
    const genres = field('genre').find('a').toArray().map((node) => ({
        id: ($(node).attr('href') ?? '').match(/\/manga-genre\/([^/?#]+)/)?.[1] ?? '', title: text($(node).text())
    })).filter((genre) => genre.id && genre.title)
    const warning = root.find(ADULT_WARNING).add(root.filter(ADULT_WARNING)).length > 0
    return { id, title: text($('.post-title h1').first().text()), cover: coverURL($, $('.summary_image img').first().get(0)),
        webUrl: seriesURL(id), genres, authors: field('author').find('a').toArray().map((node) => text($(node).text())),
        artists: field('artist').find('a').toArray().map((node) => text($(node).text())),
        alternatives: [text(field('alternative').text())].filter(Boolean), status: status(field('status').text()),
        release: text(field('release').text()) || undefined, explicit: warning || genres.some((genre) => BLOCKED_GENRES.has(genre.id.toLowerCase())),
        classified: genres.length > 0, contentRating: itemRating(genres, warning) }
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
        cover: coverURL($, $('.summary_image img').first().get(0)),
        webUrl: series.webUrl,
        summary: summary.text().replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim(),
        additionalTitles: series.alternatives,
        tags: series.genres,
        status: series.status,
        contentType: ContentType.MANGA,
        contentRating: nativeRating(series.contentRating),
        recommendedPanelMode: ReadingMode.PAGED_MANGA,
        additionalInfo: [...(people.length ? [staff.section({ id: 'staff', title: 'Staff', hasMore: false, items: people })] : []),
            ...(series.contentRating === undefined ? [incompleteRatingInfo()] : [])]
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
