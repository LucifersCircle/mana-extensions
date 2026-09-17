import {
    Highlight,
    SectionStyle
} from '@mana-app/types'
import { load } from 'cheerio'
import { decode } from 'html-entities'
import {
    VORTEX_FALLBACK_IMAGE,
    VortexCollection,
    VortexCollectionDetailResponse,
    VortexCollectionsResponse,
    VortexHomeSection
} from './VortexScansModels'
import { buildVortexContentId } from './VortexScansUtils'

const SERIALIZED_POST_PATTERN = /\{id:(\d+),slug:"([^"]+)"/g

export function parsePopularToday(html: string): Highlight[] {
    const $ = load(html)
    const heading = $('h1,h2,h3,h4,p')
        .filter((_, element) => $(element).text().trim() === 'Popular Today')
        .first()
    const section = heading.closest('section')
    if (section.length === 0) return []

    const postIds = parseSerializedPostIds(html)
    const seen = new Set<string>()
    const items: Highlight[] = []

    section.find('a[href^="/series/"]').each((_, element) => {
        const anchor = $(element)
        const href = anchor.attr('href') ?? ''
        const encodedSlug = href.slice('/series/'.length).split(/[?#]/)[0] ?? ''
        const slug = decodeSlug(encodedSlug)
        const id = postIds.get(slug)
        const cover = anchor.find('img[src]').first().attr('src') ?? ''
        const title = anchor.attr('title')?.trim()
            || anchor.find('h3').first().text().trim()

        if (!id || !slug || !title || !cover || seen.has(slug)) return
        seen.add(slug)

        const seriesType = anchor
            .find('img[src*="/theme/flags/"]')
            .first()
            .attr('alt')
            ?.trim()
        items.push({
            id: buildVortexContentId(id, slug),
            title: decode(title),
            cover,
            subtitle: seriesType ? formatSeriesType(seriesType) : undefined
        })
    })

    return items
}

export function selectPublishedCollections(
    response: VortexCollectionsResponse
): VortexCollection[] {
    return (response.collections ?? [])
        .filter((collection) => collection.isPublished !== false)
        .slice()
        .sort((left, right) =>
            (left.displayOrder ?? Number.MAX_SAFE_INTEGER)
            - (right.displayOrder ?? Number.MAX_SAFE_INTEGER)
        )
}

export function parseCollectionHighlights(
    response: VortexCollectionDetailResponse
): Highlight[] {
    return (response.collection?.works ?? [])
        .slice()
        .sort((left, right) => left.position - right.position)
        .map(({ post }) => ({
            id: buildVortexContentId(post.id, post.slug),
            title: decode(post.postTitle),
            cover: post.featuredImage || VORTEX_FALLBACK_IMAGE,
            subtitle: formatSeriesType(post.seriesType ?? '')
        }))
}

export function buildVortexHomeSections(
    collectionsResponse: VortexCollectionsResponse
): VortexHomeSection[] {
    const collections = selectPublishedCollections(collectionsResponse)

    return [
        {
            id: 'popular-today',
            title: 'Popular Today',
            style: SectionStyle.SimpleHeroPaged
        },
        {
            id: 'latest',
            title: 'Latest',
            style: SectionStyle.SimpleSingleRow
        },
        {
            id: 'new',
            title: 'New',
            style: SectionStyle.SimpleSingleRow
        },
        ...collections.map((collection) => ({
            id: `collection:${collection.slug}`,
            title: collection.title.trim(),
            style: SectionStyle.SimpleSingleRow
        })),
        {
            id: 'most-popular',
            title: 'Most Popular',
            style: SectionStyle.SimpleSingleRow
        }
    ]
}

function parseSerializedPostIds(html: string): Map<string, string> {
    const ids = new Map<string, string>()
    for (const match of html.matchAll(SERIALIZED_POST_PATTERN)) {
        const id = match[1]
        const slug = match[2]
        if (id && slug && !ids.has(slug)) ids.set(slug, id)
    }
    return ids
}

function decodeSlug(value: string): string {
    try {
        return decodeURIComponent(value)
    } catch {
        return value
    }
}

function formatSeriesType(value: string): string {
    const normalized = value.trim().toLowerCase()
    return normalized
        ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
        : ''
}
