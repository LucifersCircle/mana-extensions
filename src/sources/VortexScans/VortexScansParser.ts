import {
    Chapter,
    ChapterData,
    Content,
    ContentRating,
    ContentType,
    Highlight,
    PublicationStatus,
    ReadingMode,
    staff
} from '@mana-app/types'
import { decode } from 'html-entities'
import {
    VORTEX_FALLBACK_IMAGE,
    VORTEX_LANGUAGE,
    VortexChapter,
    VortexChapterData,
    VortexPost
} from './VortexScansModels'
import {
    buildVortexContentId,
    buildVortexSeriesUrl,
    encodePathComponent
} from './VortexScansUtils'

const CHAPTER_IMAGE_REGEX =
    /https?:\/\/[^"'\\\s]+\/(?:public\/)?upload\/series\/[^"'\\\s]+?\.(?:webp|jpe?g|png)(?:\?[^"'\\\s]*)?/gi

export class VortexScansParser {
    parseHighlights(posts: VortexPost[], home = false): Highlight[] {
        return (posts ?? [])
            .filter((post) =>
                Boolean(post.postTitle?.trim())
                && post.isNovel !== true
                && post.seriesType?.toUpperCase() !== 'NOVEL'
            )
            .map((post) => {
                const latestChapter = post.chapters?.[0]
                const chapterValue = latestChapter?.number
                    ?? post._count?.chapters
                    ?? 0

                return {
                    id: buildVortexContentId(post.id, post.slug),
                    title: decode(post.postTitle.trim()),
                    cover: post.featuredImage || VORTEX_FALLBACK_IMAGE,
                    contentRating: getVortexContentRating(post),
                    webUrl: buildVortexSeriesUrl(post.slug),
                    subtitle: home && latestChapter
                        ? `Ch. ${chapterValue}`
                        : `${chapterValue} Chapters`
                }
            })
    }

    parseContent(post: VortexPost): Content {
        if (post.isNovel === true || post.seriesType?.toUpperCase() === 'NOVEL') {
            throw new Error('Novels are not supported by VortexScans')
        }

        const title = decode(post.postTitle.trim())
        const author = post.author?.trim()
        const artist = post.artist?.trim()
        const staffItems = [
            ...(author
                ? [staff.item({ id: `author:${author}`, title: author, subtitle: 'Author' })]
                : []),
            ...(artist
                ? [staff.item({ id: `artist:${artist}`, title: artist, subtitle: 'Artist' })]
                : [])
        ]

        return {
            title,
            cover: post.featuredImage || VORTEX_FALLBACK_IMAGE,
            contentRating: getVortexContentRating(post),
            webUrl: buildVortexSeriesUrl(post.slug),
            status: mapVortexPublicationStatus(post.seriesStatus),
            contentType: mapVortexContentType(post.seriesType),
            recommendedPanelMode: ReadingMode.WEBTOON,
            summary: cleanVortexDescription(post.postContent),
            additionalTitles: parseAlternativeTitles(post.alternativeTitles, title),
            tags: (post.genres ?? [])
                .filter((genre) => genre.name.toLowerCase() !== 'hidden')
                .map((genre) => ({
                    id: genre.id.toString(),
                    title: genre.name
                })),
            ...(staffItems.length > 0
                ? {
                    additionalInfo: [staff.section({
                        id: 'staff',
                        title: 'Staff',
                        hasMore: false,
                        items: staffItems
                    })]
                }
                : {})
        }
    }

    parseChapters(chapters: VortexChapter[], seriesSlug?: string): Chapter[] {
        return (chapters ?? [])
            .filter((chapter) => !isVortexChapterLocked(chapter))
            .map((chapter) => ({
                chapter,
                number: parseChapterNumber(chapter.number)
            }))
            .sort((left, right) => {
                const numberDifference = left.number - right.number
                if (numberDifference !== 0) return numberDifference

                return parseDate(left.chapter.createdAt).getTime()
                    - parseDate(right.chapter.createdAt).getTime()
            })
            .map(({ chapter, number }, index) => {
                const chapterTitle = chapter.title?.trim()

                return {
                    chapterId: chapter.id.toString(),
                    number,
                    index,
                    date: parseDate(chapter.createdAt),
                    language: VORTEX_LANGUAGE,
                    volume: 0,
                    title: chapterTitle
                        ? `Chapter ${number} - ${chapterTitle}`
                        : `Chapter ${number}`,
                    thumbnail: chapter.featuredImage || undefined,
                    webUrl: seriesSlug && chapter.slug
                        ? `${buildVortexSeriesUrl(seriesSlug)}/${encodePathComponent(chapter.slug)}`
                        : undefined
                }
            })
    }

    parseChapterData(chapter: VortexChapterData): ChapterData {
        if (isVortexChapterDataLocked(chapter)) {
            throw new Error('This chapter is locked or inaccessible')
        }

        const images = chapter.images
        if (!Array.isArray(images) || images.length === 0) {
            throw new Error('No chapter pages were returned by VortexScans')
        }

        return {
            pages: images
                .slice()
                .sort((left, right) => {
                    const orderDifference = (left.order ?? Number.MAX_SAFE_INTEGER)
                        - (right.order ?? Number.MAX_SAFE_INTEGER)
                    if (orderDifference !== 0) return orderDifference
                    return pageNumberFromUrl(left.url) - pageNumberFromUrl(right.url)
                })
                .map((image) => ({
                    url: image.url.replace(/ /g, '%20')
                }))
        }
    }

    parseChapterPage(html: string): ChapterData {
        const candidates = [
            getSeoSectionPages(html),
            getDocumentPages(html),
            getIndexedPages(html)
        ].filter((pages) => pages.length > 0)

        const pages = candidates.reduce<string[]>((best, candidate) =>
            candidate.length > best.length ? candidate : best
        , [])

        if (pages.length === 0) {
            throw new Error('No chapter page data could be parsed from VortexScans')
        }

        return {
            pages: pages.map((url) => ({ url }))
        }
    }
}

export function isVortexChapterLocked(chapter: VortexChapter): boolean {
    const requiresPurchase = (chapter.price ?? 0) > 0
        && chapter.isPurchased !== true
        && chapter.hasPurchased !== true

    return chapter.isAccessible === false
        || chapter.isLocked === true
        || chapter.isTimeLocked === true
        || Boolean(chapter.isPermanentlyLocked)
        || chapter.isShortLinkLocked === true
        || requiresPurchase
}

export function mapVortexPublicationStatus(
    value: string | null | undefined
): PublicationStatus {
    switch (value?.toUpperCase()) {
        case 'COMPLETED':
            return PublicationStatus.COMPLETED
        case 'CANCELLED':
        case 'CANCELED':
        case 'DROPPED':
            return PublicationStatus.CANCELLED
        case 'HIATUS':
            return PublicationStatus.HIATUS
        default:
            return PublicationStatus.ONGOING
    }
}

export function mapVortexContentType(
    value: string | null | undefined
): ContentType {
    switch (value?.toUpperCase()) {
        case 'MANGA':
            return ContentType.MANGA
        case 'MANHUA':
            return ContentType.MANHUA
        case 'MANHWA':
            return ContentType.MANHWA
        default:
            return ContentType.COMIC
    }
}

export function getVortexContentRating(post: VortexPost): ContentRating {
    const genres = new Set((post.genres ?? [])
        .map((genre) => genre.name.trim().toLowerCase()))

    if (['mature', 'gore', 'blood', 'violence', 'terror']
        .some((genre) => genres.has(genre))) {
        return ContentRating.MATURE
    }
    if (genres.has('harem')) return ContentRating.SUGGESTIVE
    return ContentRating.SAFE
}

function isVortexChapterDataLocked(chapter: VortexChapterData): boolean {
    return chapter.isAccessible === false
        || chapter.isLocked === true
        || chapter.isLockedByCoins === true
        || Boolean(chapter.isPermanentlyLocked)
        || chapter.isShortLinkLocked === true
}

function parseAlternativeTitles(
    value: string | null | undefined,
    primaryTitle: string
): string[] {
    const normalizedPrimaryTitle = primaryTitle.toLowerCase()
    return Array.from(new Set((value ?? '')
        .split(/[,\n]/)
        .map((title) => decode(title).trim())
        .filter((title) =>
            title.length > 0 && title.toLowerCase() !== normalizedPrimaryTitle
        )))
}

function cleanVortexDescription(value: string | null | undefined): string {
    if (!value) return ''

    return decode(value
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|pre|div|li)>/gi, '\n')
        .replace(/<li[^>]*>/gi, '- ')
        .replace(/<[^>]+>/g, ''))
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

function parseChapterNumber(value: number | string): number {
    const number = Number(value)
    if (!Number.isFinite(number)) {
        throw new Error(`Invalid VortexScans chapter number: ${value}`)
    }
    return number
}

function parseDate(value: string | null | undefined): Date {
    const timestamp = value ? Date.parse(value) : NaN
    return new Date(Number.isNaN(timestamp) ? 0 : timestamp)
}

function normalizeImageUrl(url: string): string {
    return url.replace(/([^:])\/{2,}/g, '$1/')
}

function dedupePreservingOrder(urls: string[]): string[] {
    return Array.from(new Set(urls))
}

function extractChapterImageUrls(html: string): string[] {
    return dedupePreservingOrder(Array.from(
        html.matchAll(CHAPTER_IMAGE_REGEX),
        ([url]) => normalizeImageUrl(url)
    ))
}

function sortByPageNumber(urls: string[]): string[] {
    return urls.slice().sort((left, right) =>
        pageNumberFromUrl(left) - pageNumberFromUrl(right)
    )
}

function getSeoSectionPages(html: string): string[] {
    const section = html.match(
        /<section[^>]*aria-label="[^"]*comic pages"[^>]*>([\s\S]*?)<\/section>/i
    )
    return section?.[1] ? extractChapterImageUrls(section[1]) : []
}

function getDocumentPages(html: string): string[] {
    const urls = extractChapterImageUrls(html)
    const groups = new Map<string, string[]>()

    for (const url of urls) {
        const directory = url.replace(/\/[^/?#]+(?:\?.*)?$/, '')
        groups.set(directory, [...(groups.get(directory) ?? []), url])
    }

    let bestGroup: string[] = []
    for (const group of groups.values()) {
        if (group.length > bestGroup.length) bestGroup = group
    }
    return sortByPageNumber(bestGroup)
}

function getIndexedPages(html: string): string[] {
    const regex = /data-image-index="(\d+)"[^>]*src="(https?:\/\/[^"]+)"/gi
    const matches: Array<{ index: number, url: string }> = []
    let match: RegExpExecArray | null

    while ((match = regex.exec(html)) !== null) {
        if (!match[1] || !match[2]) continue
        matches.push({
            index: Number(match[1]),
            url: normalizeImageUrl(match[2])
        })
    }

    return dedupePreservingOrder(matches
        .sort((left, right) => left.index - right.index)
        .map(({ url }) => url))
}

function pageNumberFromUrl(url: string): number {
    const filename = url.split('/').pop() ?? ''
    const value = filename.match(/page[-_ ]*0*(\d+)/i)?.[1]
        ?? filename.match(/0*(\d+)/)?.[1]
    return value ? Number(value) : Number.MAX_SAFE_INTEGER
}
