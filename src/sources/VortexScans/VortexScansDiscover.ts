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
    VortexHomeSection,
    VortexPost
} from './VortexScansModels'
import { buildVortexContentId } from './VortexScansUtils'
import { serializedProperty } from './VortexScansPageData'

const SERIALIZED_POST_PATTERN = /\{id:(\d+),slug:("(?:\\.|[^"\\])*")/g
const SERIALIZED_FIELD_PATTERN = /,([A-Za-z_]\w*):("(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?|true|false|null)/y
interface SerializedPost { id: string, cover?: string }

export function parsePopularToday(html: string): Highlight[] {
    const $ = load(html)
    const heading = $('h1,h2,h3,h4,p')
        .filter((_, element) => $(element).text().trim() === 'Popular Today')
        .first()
    const section = heading.closest('section')
    if (section.length === 0) return []

    const posts = parseSerializedPosts(html)
    const seen = new Set<string>()
    const items: Highlight[] = []

    section.find('a[href^="/series/"]').each((_, element) => {
        const anchor = $(element)
        const href = anchor.attr('href') ?? ''
        const encodedSlug = href.slice('/series/'.length).split(/[?#]/)[0] ?? ''
        const slug = decodeSlug(encodedSlug)
        const post = posts.get(slug)
        const id = post?.id
        const image = anchor.find('img[src]').first()
        const current = image.attr('src') ?? ''
        const cover = originalCover(image.attr('data-fallback-src'), current)
            ?? originalCover(post?.cover, current)
            ?? current
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

export interface VortexHomeData {
    featured: VortexPost[]
    today: VortexPost[]
    latest: VortexPost[]
    popular: VortexPost[]
    perPage: number
}

export function parseVortexHome(html: string, ratingMetadataOnly = false): VortexHomeData {
    const $ = load(html)
    const scripts = $('script').toArray().map((element) => $(element).text())
        .filter((script) => (script.startsWith('(self.$R=self.$R||{})["tsr"]=[];')
            || script.startsWith('$_TSR.router=')) && script.includes('$_TSR.router='))
    if (scripts.length !== 1) throw new Error('VortexScans returned missing or ambiguous router data')
    const property = <T>(key: string): T => serializedProperty<T>(scripts[0]!, key, ratingMetadataOnly)
    const posts = (value: unknown): VortexPost[] => {
        if (!Array.isArray(value) || value.length > 1000) throw new Error('VortexScans returned invalid home posts')
        const seen = new Set<string>()
        for (const post of value as VortexPost[]) {
            if (!Number.isSafeInteger(post?.id) || post.id < 1 || typeof post.slug !== 'string' || !post.slug.trim()
                || (/[\\/]/.test(post.slug) || post.slug.includes(String.fromCharCode(0))) || !post.postTitle?.trim() || (!ratingMetadataOnly && typeof post.featuredImage !== 'string')) {
                throw new Error('VortexScans returned invalid home identity')
            }
            if (!ratingMetadataOnly) {
                const cover = new URL(post.featuredImage as string)
                if (cover.protocol !== 'https:' || cover.username || cover.password) throw new Error('VortexScans returned invalid home cover')
            }
            if (seen.has(post.slug)) throw new Error('VortexScans returned repeated home identity')
            seen.add(post.slug)
        }
        return value as VortexPost[]
    }
    const featured = posts(property('combinedSliderPosts'))
    const latest = posts(property('latestMangaPosts'))
    const today = posts(property<{ data?: { posts?: VortexPost[] } }>('todayPosts')?.data?.posts)
    const monthly = posts(property('monthlyPosts'))
    const ranked = property<{ slug: string, title: string, coverImage: string, tags?: { name: string }[] }[]>('transformedTopSeries')
    const perPage = property<number>('perPage')
    if (perPage !== 36 || property<boolean>('hasPinnedSeriesSection') !== false
        || property<string[]>('latestReleaseFilters')?.join(',') !== 'latest,new'
        || !Array.isArray(ranked) || ranked.length > 100 || latest.length > perPage) {
        throw new Error('VortexScans homepage release configuration changed')
    }
    // Ranking IDs are positions, never post IDs. Only same-response canonical
    // monthly records may identify the website's first nine ranking cards.
    const canonical = new Map(monthly.map((post) => [post.slug, post]))
    const seen = new Set<string>()
    const popular = ranked.slice(0, 9).map((rank) => {
        const post = canonical.get(rank.slug)
        if (!post || rank.title !== post.postTitle || (!ratingMetadataOnly && rank.coverImage !== post.featuredImage) || seen.has(rank.slug)) {
            throw new Error('VortexScans monthly ranking has conflicting canonical identity')
        }
        seen.add(rank.slug)
        return { ...post, ratingGenres: Array.isArray(rank.tags) ? rank.tags : undefined }
    })
    // Full genre objects may appear elsewhere in this same response. Join only
    // the complete canonical ID AND slug, never a title or a ranking position.
    // Preserve every real named source warning, including on incomplete cards.
    const complete = (post: VortexPost): boolean => Array.isArray(post.genres) && post.genres.length > 0
        && post.genres.every((genre) => Number.isSafeInteger(genre?.id) && genre.id > 0 && typeof genre.name === 'string' && !!genre.name.trim())
    const metadata = new Map<string, VortexPost[]>()
    for (const post of [...featured, ...latest, ...popular, ...monthly, ...today]) {
        const id = buildVortexContentId(post.id, post.slug)
        metadata.set(id, [...(metadata.get(id) ?? []), post])
    }
    const enrich = (entries: VortexPost[]): VortexPost[] => entries.map((post) => {
        const matches = metadata.get(buildVortexContentId(post.id, post.slug)) ?? [post]
        const ratingGenres = matches.flatMap((entry) => [
            ...(Array.isArray(entry.genres) ? entry.genres : []),
            ...(Array.isArray(entry.ratingGenres) ? entry.ratingGenres : [])
        ])
            .filter((genre) => !!genre && typeof genre.name === 'string' && !!genre.name.trim())
        if (!matches.some((entry) => Array.isArray(entry.genres))) return { ...post, ratingGenres }
        if (!matches.some(complete)) {
            // Retain incomplete entries so named warnings propagate, but a
            // partial ordinary label list cannot be promoted to a Safe claim.
            return { ...post, genres: matches.flatMap((entry) => Array.isArray(entry.genres) ? entry.genres : []), ratingGenres }
        }
        const genres: NonNullable<VortexPost['genres']> = []
        for (const entry of matches) for (const genre of Array.isArray(entry.genres) ? entry.genres : []) {
            if (Number.isSafeInteger(genre?.id) && genre.id > 0 && typeof genre.name === 'string' && genre.name.trim()
                && !genres.some((known) => known.id === genre.id && known.name === genre.name)) genres.push(genre)
        }
        return { ...post, genres, ratingGenres }
    })
    return { featured: enrich(featured), today: enrich(today), latest: enrich(latest), popular: enrich(popular), perPage }
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
            id: 'featured',
            title: 'Featured',
            style: SectionStyle.SimpleHeroPaged
        },
        {
            id: 'popular-today',
            title: 'Popular Today',
            style: SectionStyle.SimpleHeroPaged
        },
        {
            id: 'latest',
            title: 'Latest Releases',
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

function parseSerializedPosts(html: string): Map<string, SerializedPost> {
    const posts = new Map<string, SerializedPost>()
    for (const match of html.matchAll(SERIALIZED_POST_PATTERN)) {
        const id = match[1]
        if (!id || !match[2]) continue
        try {
            const slug = JSON.parse(match[2]) as string
            if (!slug) continue
            const post = posts.get(slug) ?? { id }
            if (post.id !== id) continue
            posts.set(slug, post)
            // Only inspect bounded primitive fields of this exact post object.
            // Stop at nested/reference data; never execute the serialized script.
            const fields = html.slice((match.index ?? 0) + match[0].length,
                (match.index ?? 0) + match[0].length + 8192)
            SERIALIZED_FIELD_PATTERN.lastIndex = 0
            for (let count = 0; count < 32; count += 1) {
                const field = SERIALIZED_FIELD_PATTERN.exec(fields)
                if (!field) break
                if (field[1] === 'featuredImage') {
                    const value: unknown = JSON.parse(field[2] ?? 'null')
                    if (typeof value === 'string') post.cover = value
                    break
                }
            }
        } catch { /* Malformed metadata retains the existing card image. */ }
    }
    return posts
}

function originalCover(value: string | undefined, current: string): string | undefined {
    if (!value?.trim()) return undefined
    try {
        const original = new URL(value.trim())
        const image = new URL(current)
        if (original.origin !== 'https://storage.vortexscans.org' || original.username || original.password
            || original.search || original.hash || !original.pathname.startsWith('/upload/')) return undefined
        const sameOriginal = image.origin === original.origin && image.pathname === original.pathname && image.search === original.search
        const sameProxyAsset = image.protocol === 'https:' && /^i[0-3]\.wp\.com$/.test(image.hostname)
            && !image.username && !image.password && !image.hash
            && image.pathname === `/${original.hostname}${original.pathname}`
        return sameOriginal || sameProxyAsset ? value.trim() : undefined
    } catch { return undefined }
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
