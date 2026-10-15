/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */
/* Rating compatibility adapted from the Kagane source originally © 2026 Inkdex. */
import { Chapter,
    Content,
    ContentRating,
    ContentType,
    Highlight,
    PublicationStatus,
    ReadingMode,
    staff } from '@mana-app/types'
import { decode } from 'html-entities'
import { AlternateTitle,
    Book,
    chapterURL,
    Classification,
    Detail,
    imageURL,
    Rating,
    RATINGS,
    Series,
    seriesURL,
    Settings,
    UploadSource } from './KaganeModels'

export function classify(value: Classification): Rating | undefined {
    const legacyValue = value.content_rating
    const legacy = typeof legacyValue === 'string' ? RATINGS.find((rating) => rating.toLowerCase() === legacyValue.trim().toLowerCase()) : undefined
    if (value.age_rating === undefined && value.is_pornographic === undefined) return legacy
    if (typeof value.is_pornographic !== 'boolean') return undefined
    let rating: Rating
    if (value.age_rating === 'Safe' && !value.is_pornographic) rating = 'Safe'
    else if (value.age_rating === 'FifteenPlus' && !value.is_pornographic) rating = 'Suggestive'
    else if (value.age_rating === 'EighteenPlus') rating = value.is_pornographic ? 'Pornographic' : 'Erotica'
    else return undefined
    return value.content_rating != null && legacy !== rating ? undefined : rating
}

export function manaRating(value: Classification): ContentRating {
    switch (classify(value)) {
        case 'Safe': return ContentRating.SAFE
        case 'Suggestive': return ContentRating.SUGGESTIVE
        case 'Erotica': return ContentRating.MATURE
        default: return ContentRating.EXPLICIT
    }
}

export function allowed(value: Classification, settings: Settings, selected?: readonly string[], host?: readonly ContentRating[]): boolean {
    const rating = classify(value)
    if (!rating || !settings.contentRatings.includes(rating)) return false
    if (selected?.length && (!rating || !selected.includes(rating))) return false
    return host === undefined || host.includes(manaRating(value))
}

/** Prefer English only when the provider explicitly labels the title as English.
 * Catalog alternate_titles are unlabelled strings and cannot establish a language.
 */
export function preferredTitle(primary: string, language?: string | null, alternates: AlternateTitle[] = []): string {
    const isEnglish = (value?: string | null): boolean => typeof value === 'string' && /^(?:en(?:[-_][a-z0-9]{2,8})*|english)$/i.test(value.trim())
    if (isEnglish(language)) return primary.trim()
    return alternates.find((entry) => isEnglish(entry.label) && entry.title.trim())?.title.trim() || primary.trim()
}

export function displayTitle(title: string, settings: Settings, sources: UploadSource[], sourceId?: string | null, edition?: string | null): string {
    let result = title.trim()
    if (settings.cleanTitle) result = result.replace(/(?:\([^()]*\)|\[[^[\]]*\])\s*$/, '').trim() || result
    if (settings.showEdition && edition?.trim()) result += ` (${edition.trim()})`
    const source = sources.find((item) => item.source_id === sourceId)
    if (settings.showSource && source?.title) result += ` [${source.title}]`
    return result
}

export function highlight(series: Series, settings: Settings, sources: UploadSource[]): Highlight {
    const latest = series.latest_chapters?.[0]
    const subtitle = latest?.chapter_no ? `Ch. ${latest.chapter_no}` : latest?.volume_no ? `Vol. ${latest.volume_no}` : latest?.title?.trim()
    return {
        id: series.series_id,
        title: displayTitle(preferredTitle(series.title, series.title_language), settings, sources, series.source_id, series.edition_info),
        cover: imageURL(series.cover_image_id), webUrl: seriesURL(series.series_id), contentRating: manaRating(series),
        subtitle: subtitle || (typeof series.current_books === 'number' ? `${series.current_books} Chapters` : undefined),
        badge: series.format ? { text: series.format } : undefined,
        info: [
            ...(series.publication_status ? [{ key: 'Status', value: series.publication_status }] : []),
            ...(series.start_year ? [{ key: 'Year', value: String(series.start_year) }] : [])
        ]
    }
}

export function content(id: string, details: Detail, settings: Settings, sources: UploadSource[]): Content {
    const type = ({ Manga: ContentType.MANGA, Manhwa: ContentType.MANHWA, Manhua: ContentType.MANHUA, Comic: ContentType.COMIC } as Record<string, ContentType>)[details.format ?? '']
    const status = ({ Ongoing: PublicationStatus.ONGOING, Completed: PublicationStatus.COMPLETED, Hiatus: PublicationStatus.HIATUS, Abandoned: PublicationStatus.CANCELLED } as Record<string, PublicationStatus>)[details.upload_status ?? '']
    const covers = [...(details.series_covers ?? [])].sort((left, right) => Number(right.is_main) - Number(left.is_main)).map((cover) => imageURL(cover.image_id)).filter(Boolean)
    const tags = [
        ...(details.genres ?? []).filter((genre) => settings.showSpoilers || !genre.is_spoiler).map((genre) => ({ id: genre.genre_id ?? genre.genre_name, title: genre.genre_name })),
        ...(details.tags ?? []).filter((tag) => settings.showSpoilers || !(tag.is_spoiler || tag.spoiler)).map((tag) => ({ id: tag.tag_id ?? tag.tag_name, title: tag.tag_name }))
    ]
    const people = (details.series_staff ?? []).map((person) => staff.item({ id: `${person.role}:${person.name}`, title: person.name, subtitle: person.role }))
    const description = decode((details.description ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]*>/g, '')).trim()
    const source = sources.find((item) => item.source_id === details.source_id)?.title
    const summary = [
        typeof details.average_rating === 'number' && details.average_rating > 0 ? `Rating: ${(details.average_rating / 10).toFixed(1)}/10` : '',
        description, source ? `Source: ${source}` : '', details.edition_info ? `Edition: ${details.edition_info}` : ''
    ].filter(Boolean).join('\n\n')
    return {
        title: displayTitle(preferredTitle(details.title, details.title_language, details.series_alternate_titles), settings, sources, details.source_id, details.edition_info),
        cover: covers[0] ?? '', additionalCovers: covers.slice(1), summary, tags, contentType: type, status,
        additionalTitles: [...new Set([details.title.trim(), ...(details.series_alternate_titles ?? []).map((entry) => entry.title.trim())].filter(Boolean))],
        contentRating: manaRating(details), webUrl: seriesURL(id),
        recommendedPanelMode: tags.some((tag) => /^(?:webtoon|long strip)$/i.test(tag.title)) ? ReadingMode.WEBTOON : type === ContentType.MANHWA || type === ContentType.MANHUA || type === ContentType.COMIC ? ReadingMode.PAGED_COMIC : ReadingMode.PAGED_MANGA,
        additionalInfo: people.length ? [staff.section({ id: 'staff', title: 'Staff', hasMore: false, items: people })] : undefined
    }
}

function date(value?: string | null): Date {
    if (!value) return new Date(0)
    const parsed = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`)
    return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed
}

export function available(book: Book): boolean {
    return book.is_locked !== true && book.requires_login !== true && book.is_paid !== true && (!book.available_at || date(book.available_at).getTime() <= Date.now())
}

export function chapters(id: string, books: Book[], details: Detail, settings: Settings, sources: UploadSource[]): Chapter[] {
    const source = sources.find((item) => item.source_id === details.source_id)
    // The current cursor API is oldest first. Its sort_no is a position, not
    // necessarily a chapter number (decimal chapters and volume-only books exist).
    return [...books].sort((left, right) => (left.sort_no ?? 0) - (right.sort_no ?? 0)).filter(available).map((book, index) => {
        const parsed = Number.parseFloat(book.chapter_no?.trim() || book.title.match(/^\s*(?:episodes?|chapters?|chap|chp|ch|eps?)\s*\.?\s*#?\s*(\d+(?:\.\d+)?)/i)?.[1] || '')
        const volume = Number.parseFloat(book.volume_no ?? '')
        const number = Number.isFinite(parsed) ? parsed : Number.isFinite(volume) ? 0 : book.sort_no ?? index + 1
        const original = book.title.trim()
        let name = original.replace(/(?:\s*\{[^{}]*\})+\s*$/, '').replace(/^\s*(?:episodes?|chapters?|chap|chp|ch|eps?)\s*\.?\s*#?\s*\d+(?:\.\d+)?\s*(?:[-:\u2013\u2014]\s*)?/i, '').trim()
        if (Number.isFinite(parsed)) {
            const escaped = String(parsed).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            name = name.replace(new RegExp(`^${escaped}(?:\\.\\s+|\\s*[-:\\u2013\\u2014]\\s*|\\s+)`), '').trim()
        }
        const label = `${settings.chapterTitle === 'vol_chapter' && Number.isFinite(volume) ? `Vol.${volume} ` : ''}Ch.${number}`
        const title = settings.chapterTitle === 'original' ? original : settings.chapterTitle === 'optional' ? name || original : `${label}${name ? ` - ${name}` : ''}`
        const provider = source?.title || (book.groups ?? []).map((group) => group.title).join(', ')
        return {
            chapterId: book.book_id, number, index, title, date: date(book.released_at ?? book.created_at),
            volume: Number.isFinite(volume) ? volume : undefined,
            language: details.translated_language ?? settings.languages[0] ?? 'en', webUrl: chapterURL(id, book.book_id),
            provider: provider ? { id: source?.source_id ?? provider, name: provider + (source?.source_type === 'Official' ? ' ✓' : '') } : undefined
        }
    }).map((chapter, index) => ({ ...chapter, index })).reverse()
}

/** Decode only the public token's expiration hint, never execute remote content. */
export function readerExpiry(token: string): number {
    try {
        const payload = token.split('.')[1]
        if (!payload) return Date.now() + 60_000
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
        let bits = 0
        let count = 0
        let decoded = ''
        for (const character of payload.replace(/-/g, '+').replace(/_/g, '/')) {
            if (character === '=') break
            const value = alphabet.indexOf(character)
            if (value < 0) return Date.now() + 60_000
            bits = (bits << 6) | value
            count += 6
            if (count >= 8) { count -= 8; decoded += String.fromCharCode((bits >> count) & 255) }
        }
        const claims: unknown = JSON.parse(decoded)
        if (typeof claims === 'object' && claims !== null && 'exp' in claims) {
            const exp = (claims as { exp?: unknown }).exp
            if (typeof exp === 'number' && Number.isFinite(exp)) return exp * 1000 - 15_000
        }
    } catch { /* Opaque tokens use a short conservative refresh interval. */ }
    return Date.now() + 60_000
}
