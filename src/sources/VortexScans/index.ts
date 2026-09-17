import {
    CatalogRating,
    Chapter,
    ChapterData,
    Content,
    ContentSource,
    DeepLinkContext,
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
    SourceInfo
} from '@mana-app/types'
import { VortexScansApi } from './VortexScansApi'
import {
    buildVortexHomeSections,
    parseCollectionHighlights,
    parsePopularToday
} from './VortexScansDiscover'
import {
    VORTEX_DOMAIN,
    VORTEX_LANGUAGE,
    VORTEX_PAGE_SIZE,
    VortexFilterProps,
    VortexPost,
    VortexQueryResponse,
    VortexQueryValue
} from './VortexScansModels'
import { VortexScansParser } from './VortexScansParser'
import {
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
        version: '1.0.5',
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

    async getContent(contentId: string): Promise<Content> {
        const { id } = parseVortexContentId(contentId)
        const response = await this.api.getPost(id)

        if (!response.post || response.post.id.toString() !== id) {
            throw new Error(`VortexScans returned invalid content data for ${contentId}`)
        }
        return this.parser.parseContent(response.post)
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
        _contentId: string,
        chapterId: string,
        chapter?: Chapter
    ): Promise<ChapterData> {
        try {
            const response = await this.api.getChapter(chapterId)
            if (!response.chapter) {
                throw new Error(`VortexScans returned no data for chapter ${chapterId}`)
            }
            return this.parser.parseChapterData(response.chapter)
        } catch (error) {
            if (!chapter?.webUrl) throw error
            return this.parser.parseChapterPage(await this.api.getText(chapter.webUrl))
        }
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

    async search(
        request: SearchRequest<VortexFilterProps>
    ): Promise<PagedSearchResult> {
        const page = request.page ?? 1

        switch (request.listId) {
            case 'latest':
                return this.toTaggedSearchResult(
                    await this.api.getTaggedPosts(
                        'latestUpdatePinned',
                        page,
                        VORTEX_PAGE_SIZE
                    )
                )
            case 'new':
                return this.toTaggedSearchResult(
                    await this.api.getTaggedPosts('new', page, VORTEX_PAGE_SIZE)
                )
            case 'most-popular':
                return this.toSearchResult(await this.api.query({
                    page,
                    perPage: VORTEX_PAGE_SIZE,
                    view: 'archive',
                    orderBy: 'totalViews',
                    orderDirection: 'desc',
                    isNovel: false
                }), page, false)
            default:
                if (request.listId?.startsWith('collection:')) {
                    const slug = request.listId.slice('collection:'.length)
                    if (!/^[A-Za-z0-9_-]+$/.test(slug)) {
                        throw new Error('Invalid VortexScans collection')
                    }

                    const results = parseCollectionHighlights(
                        await this.api.getCollection(slug)
                    )
                    return {
                        results,
                        isLastPage: true,
                        totalResultCount: results.length
                    }
                }
                if (request.listId) {
                    throw new Error(`Unknown VortexScans section: ${request.listId}`)
                }

                return this.toSearchResult(
                    await this.searchCatalog(request, page),
                    page,
                    false
                )
        }
    }

    async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
        if (link.id !== 'home') {
            throw new Error(`Unknown VortexScans page: ${link.id}`)
        }

        const collections = await this.api.getCollections()

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
            case 'popular-today':
                return {
                    items: parsePopularToday(
                        await this.api.getText(VORTEX_DOMAIN)
                    )
                }
            case 'latest':
            case 'new':
            case 'most-popular':
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
                ?.filter((genre) => /^\d+$/.test(genre.id))
                .map((genre) => genre.id)
                .join(',') || undefined,
            excludedGenreIds: request.filters?.genres?.excluded
                ?.filter((genre) => /^\d+$/.test(genre.id))
                .map((genre) => genre.id)
                .join(',') || undefined,
            orderBy: request.sort?.id ?? 'lastChapterAddedAt',
            orderDirection: request.sort
                ? (request.sort.ascending ? 'asc' : 'desc')
                : 'desc'
        }
    }

    private toTaggedSearchResult(
        response: VortexQueryResponse
    ): PagedSearchResult {
        const posts: VortexPost[] = Array.isArray(response.posts)
            ? response.posts
            : []

        return {
            results: this.parser.parseHighlights(posts),
            // VortexScans currently returns the global catalog totalCount for
            // tagged feeds, so page length is the reliable pagination signal.
            isLastPage: posts.length < VORTEX_PAGE_SIZE
        }
    }

    private toSearchResult(
        response: VortexQueryResponse,
        page: number,
        home: boolean
    ): PagedSearchResult {
        const posts: VortexPost[] = Array.isArray(response.posts)
            ? response.posts
            : []
        const totalCount = response.totalCount

        return {
            results: this.parser.parseHighlights(posts, home),
            isLastPage: typeof totalCount === 'number'
                ? page * VORTEX_PAGE_SIZE >= totalCount
                : posts.length < VORTEX_PAGE_SIZE,
            ...(typeof totalCount === 'number' ? { totalResultCount: totalCount } : {})
        }
    }
}
