import {
    CatalogRating,
    Chapter,
    ChapterData,
    Content,
    ContentSource,
    DeepLinkContext,
    Highlight,
    ImageRequestHandler,
    NetworkRequest,
    Option,
    PagedSearchResult,
    PageLink,
    PageLinkResolver,
    PageSection,
    ResolvedPageSection,
    SearchExcludableMultiPickerSheet,
    SearchForm,
    SearchListSection,
    SearchMenuPicker,
    SearchRequest,
    SearchSortSection,
    SortOption,
    SourceContext,
    SourceInfo
} from '@mana-app/types'
import { nativeRating,
    ratingAllowed } from '../../ContentRatingPolicy'
import { VortexScansApi } from './VortexScansApi'
import {
    buildVortexHomeSections,
    parseCollectionHighlights,
    parsePopularToday,
    parseVortexHome,
    VortexHomeData
} from './VortexScansDiscover'
import {
    VORTEX_DOMAIN,
    VORTEX_LANGUAGE,
    VORTEX_PAGE_SIZE,
    VortexFilterProps,
    VortexCollectionsResponse,
    VortexQueryResponse,
    VortexQueryValue
} from './VortexScansModels'
import { VortexScansParser } from './VortexScansParser'
import {
    buildVortexContentId,
    buildVortexSeriesUrl,
    encodePathComponent,
    normalizeVortexSearchTerm,
    parseVortexContentId
} from './VortexScansUtils'

const STATUS_OPTIONS: Option[] = [
    { id: 'ONGOING', title: 'Ongoing' },
    { id: 'COMPLETED', title: 'Completed' },
    { id: 'CANCELLED', title: 'Cancelled' },
    { id: 'DROPPED', title: 'Dropped' },
    { id: 'MASS_RELEASED', title: 'Mass Released' },
    { id: 'COMING_SOON', title: 'Coming Soon' },
    { id: 'HIATUS', title: 'Hiatus' }
]

const TYPE_OPTIONS: Option[] = [
    { id: 'MANHWA', title: 'Manhwa' },
    { id: 'MANHUA', title: 'Manhua' },
    { id: 'MANGA', title: 'Manga' },
    { id: 'SPANISH', title: 'Spanish' },
    { id: 'RUSSIAN', title: 'Russian' }
]

const SORT_OPTIONS: SortOption[] = [
    {
        id: 'lastChapterAddedAt',
        title: 'Latest Chapters',
        isDefault: true,
        isOrderable: true,
        defaultAscending: false
    },
    {
        id: 'totalViews',
        title: 'Most Popular',
        isOrderable: true,
        defaultAscending: false
    },
    {
        id: 'createdAt',
        title: 'Date Added',
        isOrderable: true,
        defaultAscending: false
    },
    {
        id: 'postTitle',
        title: 'Alphabetical',
        isOrderable: true,
        defaultAscending: true
    }
]

export class Target implements
    ContentSource,
    PageLinkResolver,
    ImageRequestHandler {
    readonly info: SourceInfo = {
        id: 'VortexScans',
        version: '0.0.1-alpha.9',
        name: 'VortexScans',
        description: 'Read manga, manhwa, and manhua from VortexScans.',
        thumbnail: 'VortexScans.png',
        rating: CatalogRating.MIXED,
        website: VORTEX_DOMAIN,
        badges: ['Manga', 'Manhua', 'Manhwa'],
        supportedLanguages: [VORTEX_LANGUAGE],
        developers: [
            {
                name: 'Lucifers Circle',
                github: 'https://github.com/LucifersCircle'
            }
        ]
    }

    readonly config = {
        cloudflareResolutionURL: VORTEX_DOMAIN,
        owningLinks: ['vortexscans.org']
    }

    private readonly api = new VortexScansApi()
    private readonly parser = new VortexScansParser()
    private readonly sparseLists = new Map<string, { at: number, value: Promise<Highlight[]> }>()
    private readonly rawPages = new Map<string, { at: number, value: { items: Highlight[], ids: string[], last: boolean, total?: number } }>()
    private readonly pendingPages = new Map<string, Promise<{ items: Highlight[], ids: string[], last: boolean, total?: number }>>()

    private homeCache?: { at: number, value: Promise<string> }
    private collectionsCache?: { at: number, value: Promise<VortexCollectionsResponse> }
    private decodedHome?: { html: string, value: VortexHomeData }

    async getContent(contentId: string, context?: SourceContext): Promise<Content> {
        if (context?.allowedContentRatings?.length === 0) throw new Error('This title is excluded by Mana content-rating policy')
        const { id } = parseVortexContentId(contentId)
        const response = await this.api.getPost(id)

        if (!response.post || response.post.id.toString() !== id) {
            throw new Error(`VortexScans returned invalid content data for ${contentId}`)
        }
        const content = this.parser.parseContent(response.post)
        if (!ratingAllowed(content.contentRating, context)) throw new Error('This title is excluded by Mana content-rating policy')
        return content
    }

    async getChapters(contentId: string): Promise<Chapter[]> {
        const { id, slug } = parseVortexContentId(contentId)
        const response = await this.api.getChapters(id)
        const chapters = response.post?.chapters

        if (!Array.isArray(chapters)) {
            throw new Error(`VortexScans returned invalid chapter data for ${contentId}`)
        }
        const resolvedSlug = slug
            ?? chapters.find((chapter) => chapter.mangaPost?.slug)?.mangaPost?.slug
            ?? undefined
        return this.parser.parseChapters(chapters, resolvedSlug)
    }

    async getChapterData(
        contentId: string,
        chapterId: string,
        chapter?: Chapter
    ): Promise<ChapterData> {
        try { decodeURIComponent(contentId) } catch { throw new Error('Invalid VortexScans reader identity') }
        const { id, slug } = parseVortexContentId(contentId)
        if ((slug === undefined && contentId !== id) || typeof chapterId !== 'string' || !validVortexId(id) || !validVortexId(chapterId)
            || (slug !== undefined && !validVortexSlug(slug))) {
            throw new Error('Invalid VortexScans reader identity')
        }
        if (chapter && (chapter.chapterId !== chapterId
            || (chapter.webUrl !== undefined && (!validVortexChapterUrl(chapter.webUrl)
                || (slug !== undefined && !chapter.webUrl.startsWith(`${buildVortexSeriesUrl(slug)}/`)))))) {
            throw new Error('VortexScans chapter reference does not match the requested identity')
        }

        // API identity and access failures are terminal. The previous catch-all
        // HTML fallback could turn unrelated images or a locked chapter into pages.
        const response = await this.api.getChapter(chapterId)
        const data = response?.chapter, owner = data?.mangaPost
        const seriesSlug = owner?.slug, chapterSlug = data?.slug
        if (!data || !validVortexId(data.id) || String(data.id) !== chapterId
            || !validVortexId(data.mangaPostId) || String(data.mangaPostId) !== id
            || (owner?.id !== undefined && (!validVortexId(owner.id) || String(owner.id) !== id))
            || !validVortexSlug(seriesSlug) || !validVortexSlug(chapterSlug)
            || (slug !== undefined && seriesSlug !== slug)) {
            throw new Error('VortexScans returned mismatched or incomplete reader identity')
        }
        const webUrl = `${buildVortexSeriesUrl(seriesSlug)}/${encodePathComponent(chapterSlug)}`
        if (chapter?.webUrl !== undefined && chapter.webUrl !== webUrl) {
            throw new Error('VortexScans chapter reference does not match the returned identity')
        }
        return this.parser.parseChapterData(data)
    }

    async getSearchForm(): Promise<SearchForm> {
        const genres = await this.api.getGenres()
        if (!Array.isArray(genres)) {
            throw new Error('VortexScans returned invalid genre data')
        }

        return {
            sections: [
                SearchListSection({
                    children: [SearchExcludableMultiPickerSheet({
                        id: 'genres',
                        title: 'Genres',
                        options: genres
                            .filter((genre) => {
                                const name = genre.name.trim().toLowerCase()
                                return name.length > 0 && name !== 'hidden'
                            })
                            .map((genre) => ({
                                id: genre.id.toString(),
                                title: genre.name.trim()
                            }))
                    })]
                }),
                SearchListSection({
                    header: 'Filters',
                    children: [
                        SearchMenuPicker({
                            id: 'status',
                            title: 'Status',
                            options: STATUS_OPTIONS
                        }),
                        SearchMenuPicker({
                            id: 'type',
                            title: 'Type',
                            options: TYPE_OPTIONS
                        })
                    ]
                }),
                SearchSortSection({ header: 'Sort' })
            ]
        }
    }

    async getSortOptions(): Promise<SortOption[]> {
        return SORT_OPTIONS
    }

    async search(request: SearchRequest<VortexFilterProps>): Promise<PagedSearchResult> {
        const page = request.page ?? 1
        if (!Number.isSafeInteger(page) || page < 1 || page > 100) throw new Error('Invalid VortexScans page')
        validateVortexGenres(request.filters?.genres)
        if (request.context?.allowedContentRatings?.length === 0) return { results: [], isLastPage: true }
        if (request.listId?.startsWith('collection:')) {
            const slug = request.listId.slice('collection:'.length)
            if (!/^[A-Za-z0-9_-]+$/.test(slug)) throw new Error('Invalid VortexScans collection')
            if (page > 1) return { results: [], isLastPage: true }
            const items = await this.sparseList(`collection:${slug}`, async () => parseCollectionHighlights(await this.api.getCollection(slug)))
            return { results: this.visible(items, request.context), isLastPage: true }
        }
        if (request.listId && !['latest', 'new', 'most-popular'].includes(request.listId)) throw new Error(`Unknown VortexScans section: ${request.listId}`)
        // Reconstruct each logical page from cached unfiltered physical pages.
        // Native policy is request-scoped, never a reader-global or raw-cache cap.
        const seen = new Set<string>()
        let logical = 0, noProgress = 0
        for (let physical = 1; physical <= 100; physical++) {
            const raw = await this.rawPage(request, physical)
            const fresh = raw.items.filter((item) => !seen.has(item.id))
            const before = seen.size
            raw.ids.forEach((id) => seen.add(id))
            noProgress = seen.size === before ? noProgress + 1 : 0
            const results = this.visible(fresh, request.context)
            if (!raw.ids.length && raw.total !== undefined && seen.size < raw.total) throw new Error('VortexScans returned an incomplete catalog page before its total was reached; refresh')
            const last = raw.last || (raw.total !== undefined && seen.size >= raw.total)
            if (!last && noProgress >= 10) throw new Error('VortexScans returned ten repeated catalog pages without new IDs; refresh')
            if (!results.length && !last) continue
            logical += 1
            if (logical === page) return { results, isLastPage: last, ...(request.context?.allowedContentRatings === undefined && raw.total !== undefined ? { totalResultCount: raw.total } : {}) }
            if (last) return { results: [], isLastPage: true }
        }
        throw new Error('VortexScans pagination exceeded100 physical pages; refresh or narrow your search')
    }

    async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
        if (link.id !== 'home') {
            throw new Error(`Unknown VortexScans page: ${link.id}`)
        }

        if (link.context?.allowedContentRatings?.length === 0) return []
        const collections = await this.collections()

        return buildVortexHomeSections(collections).map((section) => ({
            id: section.id,
            title: section.title,
            style: section.style
        }))
    }

    async resolvePageSection(
        link: PageLink,
        sectionId: string
    ): Promise<ResolvedPageSection> {
        if (link.id !== 'home') {
            throw new Error(`Unknown VortexScans page: ${link.id}`)
        }

        if (link.context?.allowedContentRatings?.length === 0) return { items: [] }
        return this.resolveHomeSection(sectionId, link.context)
    }

    async handleURL(url: string): Promise<DeepLinkContext | null> {
        const match = url.match(/^https?:\/\/(?:www\.)?vortexscans\.org\/series\/([^/?#]+)/i)
        if (!match?.[1]) return null

        let slug: string
        try {
            slug = decodeURIComponent(match[1])
        } catch {
            slug = match[1]
        }

        const response = await this.api.getPostBySlug(slug)
        return response.post
            ? { content: this.parser.parseHighlights([response.post])[0] }
            : null
    }

    async willRequestImage(url: string): Promise<NetworkRequest> {
        return {
            url,
            headers: {
                Referer: `${VORTEX_DOMAIN}/`,
                Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5'
            }
        }
    }

    private async searchCatalog(
        request: SearchRequest<VortexFilterProps>,
        page: number
    ): Promise<VortexQueryResponse> {
        const searchTerm = normalizeVortexSearchTerm(request.query)
        const parameters = this.buildSearchParameters(request, page, searchTerm)
        let response = await this.api.query(parameters)

        if ((response.posts?.length ?? 0) === 0 && searchTerm.includes('\'')) {
            response = await this.api.query({
                ...parameters,
                searchTerm: searchTerm.replace(/'/g, '\u2019')
            })
        }
        return response
    }

    private async resolveHomeSection(
        sectionId: string,
        context: PageLink['context']
    ): Promise<ResolvedPageSection> {
        switch (sectionId) {
            case 'featured':
                return { items: this.visible(this.parser.parseHighlights((await this.home()).featured, true), context) }
            case 'popular-today':
                return {
                    items: this.visible(await this.sparseList('popular-today', async () => {
                        const items = parsePopularToday(await this.homeText())
                        // Cover-only malformed strings retain the verified DOM
                        // image; malformed identity/rating data must fail visibly.
                        const home = parseVortexHome(await this.homeText(), true)
                        const metadata = this.parser.parseHighlights([...home.today, ...home.featured, ...home.latest, ...home.popular])
                        const byID = new Map(metadata.map((item) => [item.id, item]))
                        return items.map((item) => {
                            const exact = byID.get(item.id)
                            if (!exact) throw new Error('VortexScans Popular Today is missing verified canonical rating metadata')
                            return { ...item, contentRating: exact.contentRating }
                        })
                    }), context)
                }
            case 'latest':
                return {
                    items: this.visible(this.parser.parseHighlights((await this.home()).latest, true), context),
                    viewMoreLink: { request: { page: 1, listId: 'latest', context } }
                }
            case 'most-popular':
                return { items: this.visible(this.parser.parseHighlights((await this.home()).popular, true), context) }
            case 'new':
                return this.resolveSearchSection(sectionId, true, context)
            default:
                if (sectionId.startsWith('collection:')) {
                    return this.resolveSearchSection(sectionId, false, context)
                }
                throw new Error(`Unknown VortexScans section: ${sectionId}`)
        }
    }

    private async resolveSearchSection(
        listId: string,
        containsMore: boolean,
        context: SearchRequest['context']
    ): Promise<ResolvedPageSection> {
        const request: SearchRequest = { page: 1, listId, context }
        const result = await this.search(request)
        return {
            items: result.results,
            viewMoreLink: containsMore
                ? { request }
                : undefined
        }
    }

    private buildSearchParameters(
        request: SearchRequest<VortexFilterProps>,
        page: number,
        searchTerm: string
    ): Record<string, VortexQueryValue> {
        return {
            page,
            perPage: VORTEX_PAGE_SIZE,
            searchTerm: searchTerm || undefined,
            seriesStatus: request.filters?.status?.id,
            seriesType: request.filters?.type?.id,
            genreIds: request.filters?.genres?.included
                ?.map((genre) => genre.id)
                .join(',') || undefined,
            excludedGenreIds: request.filters?.genres?.excluded
                ?.map((genre) => genre.id)
                .join(',') || undefined,
            orderBy: request.sort?.id ?? 'lastChapterAddedAt',
            orderDirection: request.sort
                ? (request.sort.ascending ? 'asc' : 'desc')
                : 'desc'
        }
    }

    private homeText(): Promise<string> {
        if (this.homeCache && Date.now() - this.homeCache.at < 180000) return this.homeCache.value
        const value = this.api.getText(VORTEX_DOMAIN).catch((error: unknown) => {
            if (this.homeCache?.value === value) this.homeCache = undefined
            throw error
        })
        this.homeCache = { at: Date.now(), value }
        return value
    }

    private async home(): Promise<VortexHomeData> {
        const html = await this.homeText()
        if (this.decodedHome?.html === html) return this.decodedHome.value
        const value = parseVortexHome(html)
        this.decodedHome = { html, value }
        return value
    }

    private collections(): Promise<VortexCollectionsResponse> {
        if (this.collectionsCache && Date.now() - this.collectionsCache.at < 180000) return this.collectionsCache.value
        const value = this.api.getCollections().catch((error: unknown) => {
            if (this.collectionsCache?.value === value) this.collectionsCache = undefined
            throw error
        })
        this.collectionsCache = { at: Date.now(), value }
        return value
    }

    private async sparseList(key: string, load: () => Promise<Highlight[]>): Promise<Highlight[]> {
        const cached = this.sparseLists.get(key)
        if (cached && Date.now() - cached.at < 180000) return cached.value
        const value = load().catch((error: unknown) => { if (this.sparseLists.get(key)?.value === value) this.sparseLists.delete(key); throw error })
        this.sparseLists.delete(key)
        this.sparseLists.set(key, { at: Date.now(), value })
        while (this.sparseLists.size > 32) this.sparseLists.delete(this.sparseLists.keys().next().value as string)
        return value
    }

    private visible(items: Highlight[], context?: SourceContext): Highlight[] {
        const seen = new Set<string>()
        return items.filter((item) => {
            if (seen.has(item.id) || !ratingAllowed(item.contentRating, context)) return false
            seen.add(item.id)
            return true
        }).map((item) => ({ ...item, contentRating: nativeRating(item.contentRating), context }))
    }

    private async rawPage(request: SearchRequest<VortexFilterProps>, page: number): Promise<{ items: Highlight[], ids: string[], last: boolean, total?: number }> {
        const key = JSON.stringify({ ...request, page, context: undefined })
        const cached = this.rawPages.get(key)
        if (cached && Date.now() - cached.at < 180000) return cached.value
        const pending = this.pendingPages.get(key)
        if (pending) return pending
        const load = (async () => {
            const home = request.listId === 'latest' || request.listId === 'new' ? await this.home() : undefined
            const pageSize = home?.perPage ?? VORTEX_PAGE_SIZE
            const response = request.listId === 'latest' && page === 1
                ? { posts: home!.latest }
                : request.listId === 'latest' || request.listId === 'new'
                    ? await this.api.getTaggedPosts(request.listId === 'latest' ? 'latestUpdatePinned' : 'new', page, pageSize)
                    : request.listId === 'most-popular' ? await this.api.query({ page, perPage: VORTEX_PAGE_SIZE, view: 'archive', orderBy: 'totalViews', orderDirection: 'desc', isNovel: false })
                        : await this.searchCatalog(request, page)
            if (!Array.isArray(response.posts)) throw new Error('VortexScans returned invalid catalog data')
            const ids = response.posts.map((post) => buildVortexContentId(post.id, post.slug))
            const total = !request.listId || request.listId === 'most-popular' ? response.totalCount : undefined
            const validTotal = typeof total === 'number' && Number.isSafeInteger(total) && total >= 0 ? total : undefined
            // Catalog totals are authoritative even when a physical page is
            // short. Tagged feeds expose an unrelated global total, so only
            // those feeds retain the short-page termination heuristic.
            const value = { items: this.parser.parseHighlights(response.posts), ids, last: validTotal === undefined && response.posts.length < pageSize, total: validTotal }
            this.rawPages.delete(key)
            this.rawPages.set(key, { at: Date.now(), value })
            while (this.rawPages.size > 128) this.rawPages.delete(this.rawPages.keys().next().value as string)
            return value
        })()
        this.pendingPages.set(key, load)
        try { return await load } finally { if (this.pendingPages.get(key) === load) this.pendingPages.delete(key) }
    }
}

function validVortexId(value: unknown): boolean {
    return (typeof value === 'string' || typeof value === 'number')
        && /^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value))
}

function validVortexSlug(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value === value.trim()
        && value !== '.' && value !== '..' && !/[/\\]/.test(value)
        && !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
}

function validVortexChapterUrl(value: string): boolean {
    const match = /^https:\/\/vortexscans\.org\/series\/([^/?#]+)\/([^/?#]+)$/.exec(value)
    if (!match?.[1] || !match[2]) return false
    try {
        const series = decodeURIComponent(match[1]), chapter = decodeURIComponent(match[2])
        return validVortexSlug(series) && validVortexSlug(chapter)
            && value === `${buildVortexSeriesUrl(series)}/${encodePathComponent(chapter)}`
    } catch { return false }
}

function validateVortexGenres(genres: VortexFilterProps['genres']): void {
    if (genres === undefined) return
    if (!genres || typeof genres !== 'object' || Array.isArray(genres)
        || Object.keys(genres).some((key) => !['included', 'excluded'].includes(key))) {
        throw new Error('Invalid VortexScans genre selection')
    }
    for (const selection of [genres.included, genres.excluded]) {
        if (selection === undefined) continue
        if (!Array.isArray(selection) || Array.from(selection).some((genre) =>
            !genre || typeof genre !== 'object' || Array.isArray(genre) || typeof genre.id !== 'string' || !validVortexId(genre.id))) {
            throw new Error('Invalid VortexScans genre selection')
        }
    }
}
