/* SPDX-License-Identifier: GPL-3.0-or-later */
import { Chapter,
    ChapterData,
    Content,
    ContentRating,
    ContentType,
    PublicationStatus,
    staff,
    tags } from '@mana-app/types'
import { load } from 'cheerio'
type CheerioAPI = ReturnType<typeof load>
import { incompleteRatingInfo,
    nativeRating } from '../../ContentRatingPolicy'
import { FILTERS,
    scope } from './MangaStashFilters'

export const DOMAIN = 'https://mangastash.org'
export const FEEDS = [{ id: 'popular', title: 'Popular This Month' }, { id: 'new', title: 'New Additions' }, { id: 'latest', title: 'Latest Updates' }]
export type Card = { id: string, title: string, cover: string, rating?: ContentRating, classified: boolean }
export type Listing = { items: Card[], next?: string }
export type SourceChapter = Chapter & { locked: boolean }
export type Detail = { card: Card, content: Content, chapters: SourceChapter[] }
export const text = (value: string): string => value.replace(/\s+/g, ' ').trim()
export function validId(id: string): string {
    if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,255}$/.test(id)) throw new Error('Invalid MangaStash series identity')
    return id
}
export function url(value: string): URL {
    if (typeof value !== 'string' || /[\s\\]/.test(value) || /%/i.test(value.split('?')[0] ?? '') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value)) throw new Error('Invalid MangaStash URL')
    const result = new URL(value, DOMAIN)
    if (result.origin !== DOMAIN || result.username || result.password || result.hash) throw new Error('Invalid MangaStash URL origin')
    return result
}
export function seriesId(value: string): string {
    const target = url(value)
    if (target.search || !/^\/[a-z0-9-]+\/$/.test(target.pathname)) throw new Error('Invalid MangaStash series URL')
    return validId(target.pathname.slice(1, -1))
}
export function chapterId(value: string, owner: string): string {
    validId(owner)
    const target = url(value)
    if (target.search || !new RegExp(`^/${owner}/chapter-[a-zA-Z0-9.-]+$`).test(target.pathname)) throw new Error('Invalid MangaStash chapter identity')
    return target.pathname.slice(1)
}
export function imageURL(value: string, id: string, chapter?: string): string {
    const target = url(value)
    if (target.search || !/\.(?:jpe?g|png|webp|avif|gif)$/i.test(target.pathname)) throw new Error('Invalid MangaStash image URL')
    validId(id)
    if (chapter) {
        chapterId(`/${chapter}`, id)
        if (!target.pathname.startsWith(`/content/${id}/chapter-`) || target.pathname.split('/').length !== 5) throw new Error('MangaStash reader image has wrong owner')
    } else {
        const namedCover = new RegExp(`^/content/covers/(?:thumbnails/)?${id}\\.(?:jpe?g|png|webp|avif|gif)$`, 'i').test(target.pathname)
        // The source also advertises an owned chapter page as a card/detail cover.
        // This validates a supplied URL only; it never invents a page or reader grant.
        const ownedPageCover = target.pathname.startsWith(`/content/${id}/`) && new RegExp(`^/content/${id}/chapter-\\d+(?:\\.\\d+)?/[a-zA-Z0-9_-]+\\.(?:jpe?g|png|webp|avif|gif)$`, 'i').test(target.pathname)
        if (!namedCover && !ownedPageCover) throw new Error('MangaStash cover has wrong owner')
    }
    return target.href
}
function canonical($: CheerioAPI, expected: string): void {
    const nodes = $('link[rel="canonical"]')
    if (nodes.length !== 1 || url(nodes.attr('href') ?? '').href !== expected) throw new Error('MangaStash canonical identity mismatch')
}
function labelRating(labels: string[], warnings = ''): ContentRating | undefined {
    if (warnings && !/safe|suggestive|mature|explicit|adult|18\+|nsfw|sexual content/i.test(warnings)) throw new Error('MangaStash source content warning is unrecognized')
    if (/explicit|adult|18\+|nsfw|sexual content/i.test(warnings)) return ContentRating.EXPLICIT
    if (/mature/i.test(warnings)) labels = [...labels, 'Mature']
    else if (/suggestive/i.test(warnings)) labels = [...labels, 'Suggestive']
    const known = labels.map((label) => ({ safe: ContentRating.SAFE, suggestive: ContentRating.SUGGESTIVE, mature: ContentRating.MATURE, explicit: ContentRating.EXPLICIT, adult: ContentRating.EXPLICIT, '18+': ContentRating.EXPLICIT, nsfw: ContentRating.EXPLICIT }[label.toLowerCase()])).filter((value): value is ContentRating => value !== undefined)
    return known.length ? Math.max(...known) : undefined
}
function cover($: CheerioAPI, node: ReturnType<CheerioAPI>, id: string): string {
    const img = node.find('img').first(), candidates: Array<{ value: string, size: number }> = []
    for (const field of ['data-srcset', 'srcset']) for (const part of (img.attr(field) ?? '').split(',')) {
        const match = part.trim().match(/^(\S+)\s+(\d+)w$/)
        if (match) candidates.push({ value: match[1] ?? '', size: Number(match[2]) })
    }
    for (const field of ['data-src', 'src']) if (img.attr(field)) candidates.push({ value: img.attr(field) ?? '', size: 0 })
    candidates.sort((a, b) => b.size - a.size)
    if (!candidates.length) throw new Error('MangaStash cover is missing')
    return imageURL(candidates[0]?.value ?? '', id)
}
function cards($: CheerioAPI, selector: string, root?: ReturnType<CheerioAPI>): Card[] {
    const items = (root ? root.find(selector) : $(selector)).toArray().map((node) => {
        const row = $(node), anchor = row.is('a') ? row : row.find('a.update-title').first(), id = seriesId(anchor.attr('href') ?? '')
        const title = text(row.find('h3').first().text() || row.find('.update-title').text())
        if (!title) throw new Error('MangaStash listing title is missing')
        const declared = row.find('.content-rating,.age-rating').toArray().map((node) => text($(node).text()))
        if (declared.some((label) => !/^(safe|suggestive|mature|explicit|adult|18\+|nsfw)$/i.test(label))) throw new Error('MangaStash content rating is unrecognized')
        const rating = labelRating(row.find('.badge,.content-rating,.age-rating').toArray().map((badge) => text($(badge).text())), text(row.find('.content-warning,.age-warning,.nsfw-warning').text()))
        return { id, title, cover: cover($, row, id), rating, classified: rating !== undefined }
    })
    if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('MangaStash listing contains duplicate identities')
    return items
}
export function parseHome(html: string): Record<string, Card[]> {
    const $ = load(html), result: Record<string, Card[]> = {}
    for (const feed of FEEDS) {
        const sections = $('section.home-section').filter((_, node) => text($(node).find('h2.section-title').first().text()) === feed.title)
        if (sections.length !== 1) throw new Error('MangaStash home section changed')
        const items = cards($, feed.id === 'latest' ? '.update-row' : '.series-card', sections)
        if (!items.length) throw new Error('MangaStash home feed is incomplete')
        result[feed.id] = items
    }
    return result
}
export function parseListing(html: string, requestURL: string): Listing {
    const $ = load(html), search = new URL(requestURL).pathname === '/search'
    if (!(search ? $('.search-page').length : $('#browse-form').length)) throw new Error('MangaStash listing page is incomplete')
    const requested = new URL(requestURL), page = Number(requested.searchParams.get('page') ?? 1)
    if (search) {
        const input = $('.search-form-large input[name="q"]')
        if (input.length !== 1 || input.attr('value') !== requested.searchParams.get('q')) throw new Error('MangaStash search query echo mismatch')
    } else {
        for (const group of Object.keys(FILTERS)) {
            const parameter = group === 'genres' ? 'genre' : group
            const expected = [...requested.searchParams].filter(([key]) => key.replace(/\[(?:\d*)\]$/, '') === parameter).map(([, value]) => value).filter(Boolean).sort()
            const name = group === 'rating' ? parameter : `${parameter}[]`
            const actual = $(`#browse-form input[name="${name}"][checked]`).toArray().map((node) => $(node).attr('value') ?? '').filter(Boolean).sort()
            if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('MangaStash selected filter scope mismatch')
        }
        const sort = $('select[name="sort"] option[selected]')
        if (sort.length !== 1 || new URL(sort.attr('value') ?? '', requestURL).searchParams.get('sort') !== (requested.searchParams.get('sort') ?? 'latest')) throw new Error('MangaStash selected sort mismatch')
    }
    const active = $('nav.pagination .page-num.active')
    if ((active.length && (active.length !== 1 || text(active.text()) !== String(page))) || (!active.length && page > 1)) throw new Error('MangaStash active source page mismatch')
    const items = cards($, search ? '.search-results > .search-result-row' : '.series-grid > .series-card')
    if (!items.length && !(search ? /^0 results?\b/i.test(text($('.search-summary').text())) : /^(?:0 series|No series found)/i.test(text($('.result-count,.empty-state').first().text())))) throw new Error('MangaStash listing is empty without a verified empty state')
    const links = $('nav.pagination a.page-next'), href = links.attr('href')
    if (links.length > 1) throw new Error('MangaStash listing has ambiguous continuation')
    let next: string | undefined
    if (href) {
        const target = url(href), page = Number(new URL(requestURL).searchParams.get('page') ?? 1)
        if (scope(target.href) !== scope(requestURL) || target.searchParams.getAll('page').length !== 1 || target.searchParams.get('page') !== String(page + 1)) throw new Error('MangaStash pagination changed source scope')
        next = target.href
    }
    return { items, next }
}
type DetailTagGroup = { title: string, values: Array<{ id: string, title: string, isNonInteractive: boolean }> }
function detailTagSections(groups: DetailTagGroup[]): ReturnType<typeof tags.section>[] {
    return groups.filter((group) => group.title !== 'Genres').flatMap((group, index) => {
        const owners = Object.entries(FILTERS).filter(([id, filter]) => id !== 'genres' && filter.title === group.title)
        // A section ID owns the native search field. Do not infer it from a label,
        // or route ambiguous groups and source metadata that has no browse control.
        const owner = owners.length === 1 && groups.filter((item) => item.title === group.title).length === 1 ? owners[0] : undefined
        const items = group.values.map((item, position) => {
            if (owner) try {
                const target = url(item.id), entries = [...target.searchParams]
                const option = owner[1].options.find((option) => option.id && option.id === entries[0]?.[1] && option.title === item.title)
                if (target.pathname === '/browse/' && entries.length === 1 && entries[0]?.[0] === owner[0] && option) return tags.item({ id: option.id, title: option.title, isNonInteractive: false })
            } catch { /* Malformed or unsupported metadata remains informational. */ }
            return tags.item({ id: `metadata-${index + 1}-${position + 1}`, title: item.title, isNonInteractive: true })
        })
        // Mana stores ten items per section. Only the owning section can route a
        // filter; keep overflow visible without inventing extra native fields.
        return Array.from({ length: Math.ceil(items.length / 10) }, (_, chunk) => tags.section({
            id: owner && chunk === 0 ? owner[0] : `source-metadata-${index + 1}-${chunk + 1}`,
            title: chunk === 0 ? group.title : `${group.title} (more ${chunk})`,
            items: items.slice(chunk * 10, (chunk + 1) * 10).map((item, position) => chunk === 0 && items.filter((other) => other.id === item.id).length === 1 ? item : tags.item({ ...item, id: `metadata-${index + 1}-${chunk * 10 + position + 1}`, isNonInteractive: true }))
        }))
    })
}
export function parseDetail(html: string, id: string): Detail {
    validId(id)
    const $ = load(html), webUrl = `${DOMAIN}/${id}/`
    canonical($, webUrl)
    if ($('.series-page').length !== 1) throw new Error('MangaStash detail page is incomplete')
    const title = text($('.series-meta h1').text()), labels = $('.series-badges .badge').toArray().map((node) => text($(node).text()))
    if (!title || !labels.includes('English')) throw new Error('MangaStash detail title or language is missing')
    const declared = $('.series-meta .content-rating,.series-meta .age-rating').toArray().map((node) => text($(node).text()))
    if (declared.some((label) => !/^(safe|suggestive|mature|explicit|adult|18\+|nsfw)$/i.test(label))) throw new Error('MangaStash content rating is unrecognized')
    const rating = labelRating([...labels, ...declared], text($('.series-page > .content-warning,.series-banner .content-warning,.series-meta .content-warning,.series-page > .age-warning,.series-meta .age-warning,.series-page > .nsfw-warning').text()))
    const original = $('meta[property="og:image"]').attr('content'), card = { id, title, cover: original ? imageURL(original, id) : cover($, $('.series-cover'), id), rating, classified: rating !== undefined }
    let missingReadableDates = false
    const chapters = $('#chapter-list > a.chapter-row').toArray().map((node, index) => {
        const row = $(node), chapter = chapterId(row.attr('href') ?? '', id), rawNumber = row.attr('data-num') ?? ''
        if (!/^\d+(?:\.\d+)?$/.test(rawNumber)) throw new Error('MangaStash chapter number is malformed')
        const actualDate = row.find('time[datetime]').attr('datetime') ?? row.attr('data-date'), date = actualDate ? new Date(actualDate) : new Date(0)
        if (!Number.isFinite(date.getTime())) throw new Error('MangaStash bulk chapter date is invalid')
        const locked = row.is('.locked,.chapter-locked,[data-locked="true"],[aria-disabled="true"]') || row.find('.locked,.chapter-locked,.chapter-lock').length > 0
            || /locked|premium|log ?in|sign ?in|unlock|members only|subscription/i.test(text(row.find('.chapter-meta').text()))
        if (!locked && !actualDate) missingReadableDates = true
        const rawTitle = text(row.find('.chapter-num').text()), number = Number(rawNumber)
        return { chapterId: chapter, number, index, date, locked, language: 'en_US', webUrl: `${DOMAIN}/${chapter}`, title: rawTitle === `Ch. ${rawNumber}` ? undefined : rawTitle }
    })
    const total = text($('.cl-toolbar h2').text()).match(/^Chapters \((\d+)\)$/)
    if (!total || Number(total[1]) !== chapters.length || !chapters.length || new Set(chapters.map((chapter) => chapter.chapterId)).size !== chapters.length) throw new Error('MangaStash complete chapter inventory is unavailable')
    const groups = $('.series-tags .tag-group').toArray().map((node) => ({ title: text($(node).find('.tag-category').text()).replace(/:$/, ''), values: $(node).find('.tag-chip').toArray().map((tag) => ({ id: $(tag).attr('href') ?? '', title: text($(tag).text()), isNonInteractive: true })) }))
    const genres = (groups.find((group) => group.title === 'Genres')?.values ?? []).map((item) => {
            const target = url(item.id)
            if (target.pathname !== '/browse/' || [...target.searchParams.keys()].length !== 1 || !target.searchParams.has('genre')) throw new Error('MangaStash genre destination is malformed')
            const id = target.searchParams.get('genre') ?? ''
            if (!id) throw new Error('MangaStash genre identity is missing')
            return { id, title: item.title, isNonInteractive: !FILTERS.genres?.options.some((option) => option.id === id) }
        }), formats = groups.find((group) => group.title === 'Formats')?.values.map((item) => item.title) ?? []
    const author = text($('.series-author').text()).replace(/^by\s+/i, '')
    const content: Content = { title, cover: card.cover, webUrl, contentRating: nativeRating(rating), summary: text($('.series-description').text()), chapters: readableChapters(chapters),
        status: labels.includes('Ongoing') ? PublicationStatus.ONGOING : labels.includes('Completed') ? PublicationStatus.COMPLETED : labels.includes('Hiatus') ? PublicationStatus.HIATUS : labels.includes('Cancelled') ? PublicationStatus.CANCELLED : undefined,
        contentType: formats.includes('Manga') ? ContentType.MANGA : formats.includes('Manhwa') ? ContentType.MANHWA : formats.includes('Manhua') ? ContentType.MANHUA : undefined,
        tags: genres,
        additionalInfo: [
            ...(author ? [staff.section({ id: 'author', title: 'Author', hasMore: false, items: [staff.item({ id: author, title: author })] })] : []),
            ...detailTagSections(groups),
            ...(rating === undefined ? [incompleteRatingInfo()] : []),
            ...(missingReadableDates ? [tags.section({ id: 'chapter-date-metadata', title: 'Chapter dates', items: [tags.item({ id: 'unavailable-dates', title: 'The site does not provide dates for some chapters. Their displayed upload ages are not reliable.', isNonInteractive: true })] })] : [])
        ] }
    return { card, content, chapters }
}
export function readableChapters(chapters: SourceChapter[]): Chapter[] {
    return chapters.filter((chapter) => !chapter.locked).map(({ locked, ...chapter }, index) => { void locked; return { ...chapter, index } })
}
export function parseReader(html: string, id: string, chapter: Chapter, title: string): ChapterData {
    chapterId(`/${chapter.chapterId}`, id)
    const $ = load(html), expected = `${DOMAIN}/${chapter.chapterId}`
    canonical($, expected)
    if ($('.reader').length !== 1 || $('.locked,.chapter-locked,.access-denied,.paywall').length) throw new Error('MangaStash reader is locked or unavailable')
    if ($('.reader-back').length !== 1 || seriesId($('.reader-back').attr('href') ?? '') !== id
        || $('.chapter-select option[selected]').length !== 1 || chapterId($('.chapter-select option[selected]').attr('value') ?? '', id) !== chapter.chapterId) throw new Error('MangaStash reader owner mismatch')
    const article = $('script[type="application/ld+json"]').toArray().map((node) => { try { return JSON.parse($(node).html() ?? '') as Record<string, unknown> } catch { return {} } }).filter((item) => item['@type'] === 'Article')
    if (article.length !== 1 || article[0]?.url !== expected || article[0]?.['@id'] !== expected || (article[0]?.isPartOf as { url?: unknown } | undefined)?.url !== `${DOMAIN}/${id}/`) throw new Error('MangaStash reader structured identity mismatch')
    const scripts = $('script:not([src])').toArray().map((node) => $(node).html() ?? '').filter((script) => /\bconst\s+readerConfig\s*=/.test(script))
    if (scripts.length !== 1) throw new Error('MangaStash reader configuration is missing')
    // Read only bounded scalar literals; never execute downloaded JavaScript.
    const body = scripts[0]?.match(/\bconst\s+readerConfig\s*=\s*\{([\s\S]{1,4096})\};/)?.[1]
    if (!body) throw new Error('MangaStash reader configuration is malformed')
    const fields = new Map<string, string>()
    const keys = new Set(['seriesSlug', 'chapterNum', 'chapterId', 'seriesId', 'midrollInterval', 'totalPages', 'format', 'prevChapter', 'nextChapter'])
    for (const line of body.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('//'))) {
        const field = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*?),?$/), key = field?.[1], value = field?.[2]
        if (!key || value === undefined || !keys.has(key) || fields.has(key)) throw new Error('MangaStash reader configuration contains duplicate or unsupported declarations')
        fields.set(key, value)
    }
    const numeric = (key: string): number => {
        const value = fields.get(key)
        if (!value || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error('MangaStash reader numeric identity is malformed')
        return Number(value)
    }
    if (fields.has('midrollInterval') && !/^\d+$/.test(fields.get('midrollInterval') ?? '')) throw new Error('MangaStash reader interval is not a literal')
    if (fields.has('format') && !/^'[a-z-]+'$/.test(fields.get('format') ?? '')) throw new Error('MangaStash reader format is not a literal')
    for (const key of ['prevChapter', 'nextChapter']) if (fields.has(key)) {
        let value: unknown
        try { value = JSON.parse(fields.get(key) ?? '') } catch { throw new Error('MangaStash adjacent chapter is not a JSON literal') }
        if (value !== null) {
            if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 || Object.keys(value).some((field) => !['number', 'pages'].includes(field))) throw new Error('MangaStash adjacent chapter literal is malformed')
            const adjacent = value as { number?: unknown, pages?: unknown }
            if (typeof adjacent.number !== 'number' || !Number.isFinite(adjacent.number) || adjacent.number < 0 || typeof adjacent.pages !== 'number' || !Number.isSafeInteger(adjacent.pages) || adjacent.pages < 1 || adjacent.pages > 1000) throw new Error('MangaStash adjacent chapter numbers are malformed')
        }
    }
    const slug = fields.get('seriesSlug')?.match(/^'([a-z0-9-]+)'$/)?.[1]
    const seriesNumber = numeric('seriesId'), chapterNumber = numeric('chapterId'), total = numeric('totalPages')
    if (slug !== id || numeric('chapterNum') !== chapter.number || !Number.isSafeInteger(seriesNumber) || seriesNumber < 1 || !Number.isSafeInteger(chapterNumber) || chapterNumber < 1
        || !Number.isSafeInteger(total) || total < 1 || total > 1000) throw new Error('MangaStash reader configuration identity mismatch')
    const heading = text($('.reader-chapter-title').text())
    if ($('.reader-chapter-title').length !== 1 || heading !== article[0]?.headline || heading !== `${title} Ch. ${chapter.number}`) throw new Error('MangaStash reader heading identity mismatch')
    const containers = $('#reader-pages > .reader-page')
    if ($('#reader-pages').length !== 1 || containers.length !== total) throw new Error('MangaStash reader page count mismatch')
    const pages = containers.toArray().map((node, index) => {
        const container = $(node), img = container.find('.reader-page-inner > img')
        if (container.attr('data-page') !== String(index + 1) || img.length !== 1) throw new Error('MangaStash reader has duplicate, gapped or invalid pages')
        const pageURL = imageURL(img.attr('data-src') || img.attr('src') || '', id, chapter.chapterId)
        const directoryNumber = new URL(pageURL).pathname.split('/')[3]?.match(/^chapter-(\d+(?:\.\d+)?)$/)?.[1]
        if (directoryNumber === undefined || Number(directoryNumber) !== chapter.number) throw new Error('MangaStash image chapter identity mismatch')
        return { url: pageURL }
    })
    if (new Set(pages.map((page) => page.url)).size !== pages.length || new Set(pages.map((page) => new URL(page.url).pathname.split('/').slice(0, -1).join('/'))).size !== 1) throw new Error('MangaStash reader has duplicate or mixed chapter images')
    return { pages }
}
