/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex; Copyright © 2026 Lucifers Circle */
import { CatalogRating,
    Chapter,
    ChapterData,
    ChapterSource,
    Content,
    CoverRequestHandler,
    DeepLinkContext,
    HttpClient,
    ImageRequest,
    Option,
    PageLink,
    PageLinkResolver,
    PageRequestHandler,
    PageSection,
    PagedSearchResult,
    RequestOrigin,
    ResolvedPageSection,
    SearchForm,
    SearchListSection,
    SearchMenuPicker,
    SearchMultiPickerSheet,
    SearchRequest,
    SearchSortSection,
    SearchTextField,
    SectionStyle,
    SortOption,
    SourceContext,
    SourceInfo } from '@mana-app/types'
import { assertRatingPolicy,
    ratingAllowed } from '../../ContentRatingPolicy'
import { imageClient,
    VyMangaApi } from './VyMangaApi'
import { cards,
    CATALOG_HOSTS,
    chapters,
    detail,
    DOMAIN,
    genres,
    mangaID,
    mangaURL,
    publicURL,
    reader,
    slug } from './VyMangaParser'
const SORTS = [{ id: 'updated_at', title: 'Latest Updates' }, { id: 'viewed', title: 'Most Viewed' }, { id: 'scored', title: 'Top Rated' }, { id: 'created_at', title: 'Newest' }]
const SECTIONS = [{ id: 'viewed', title: 'Popular' }, { id: 'updated_at', title: 'Latest Updates' }, { id: 'scored', title: 'Top Rated' }, { id: 'created_at', title: 'Newest' }]
type Filters = { genres?: Option[], excludedGenres?: Option[], author?: string, status?: Option, searchType?: Option, order?: Option }
export class Target implements ChapterSource, PageLinkResolver, CoverRequestHandler, PageRequestHandler {
    readonly info: SourceInfo = { id: 'VyManga', name: 'VyManga', version: '0.0.1-alpha.1', website: DOMAIN, rating: CatalogRating.MIXED,
        description: 'ODT candidate, not live verified. On-device test candidate adapted from Popmango’s VyManga. Public chapters only. Reader redirects, page completeness and image bytes await device verification. Unclassified titles use a Suggestive compatibility fallback, not a verified source age rating. Missing dates are unknown (epoch). Reopen details before chapters and images after restarting the app.',
        supportedLanguages: ['en_US'], badges: ['ODT candidate'], developers: [{ name: 'Lucifers Circle', github: 'https://github.com/LucifersCircle' }, { name: 'Popmango', github: 'https://github.com/PoppingMangoSources' }, { name: 'Inkdex', github: 'https://github.com/inkdex' }] }
    readonly config = { owningLinks: CATALOG_HOSTS, cloudflareResolutionURL: DOMAIN }
    private readonly api = new VyMangaApi()
    private readonly covers = new Map<string, string>()
    private readonly pages = new Map<string, string>()
    private readonly coverClient = imageClient(RequestOrigin.Cover, this.covers)
    private readonly pageClient = imageClient(RequestOrigin.Page, this.pages)
    private readonly contexts = new Map<string, SourceContext | undefined>()
    private readonly policyVersions = new Map<string, number>()
    private policySequence = 0
    private revision(id: string, version?: number): number {
        const current = this.policyVersions.get(id)
        if (!this.contexts.has(id) || current === undefined || (version !== undefined && current !== version)) throw new Error('VyManga content policy changed; reopen details before reading')
        return current
    }
    private readonly metadata = new Map<string, { html: string, url: string, at: number }>()
    private taxonomy?: Option[]
    private issue(map: Map<string, string>, urls: string[], referer: string): void {
        for (const url of urls) if (url) map.set(publicURL(url), referer)
        while (map.size > 5000) map.delete(map.keys().next().value as string)
    }
    private async document(id: string, refresh = false): Promise<{ html: string, url: string }> {
        const cached = this.metadata.get(id)
        if (!refresh && cached && Date.now() - cached.at < 60000) return cached
        this.metadata.delete(id)
        const result = await this.api.document(mangaURL(id))
        this.metadata.set(id, { ...result, at: Date.now() })
        while (this.metadata.size > 48) this.metadata.delete(this.metadata.keys().next().value as string)
        return result
    }
    async getSortOptions(): Promise<SortOption[]> { return SORTS }
    async getSearchForm(): Promise<SearchForm> {
        if (!this.taxonomy) this.taxonomy = genres((await this.api.document(`${DOMAIN}/search`)).html)
        if (!this.taxonomy.length) throw new Error('VyManga genre taxonomy is missing')
        return { sections: [SearchListSection({ children: [
            SearchMultiPickerSheet({ id: 'genres', title: 'Include genres', options: this.taxonomy }),
            SearchMultiPickerSheet({ id: 'excludedGenres', title: 'Exclude genres', options: this.taxonomy }),
            SearchTextField({ id: 'author', title: 'Author' }),
            SearchMenuPicker({ id: 'status', title: 'Status', options: [{ id: '', title: 'All' }, { id: '0', title: 'Ongoing' }, { id: '1', title: 'Completed' }] }),
            SearchMenuPicker({ id: 'searchType', title: 'Title match', options: [{ id: '0', title: 'Contains' }, { id: '1', title: 'Begins with' }, { id: '2', title: 'Ends with' }] }),
            SearchMenuPicker({ id: 'order', title: 'Order', options: [{ id: 'desc', title: 'Descending' }, { id: 'asc', title: 'Ascending' }] })
        ] }), SearchSortSection({ header: 'Sort' })] }
    }
    async search(request: SearchRequest<Filters>): Promise<PagedSearchResult> {
        assertRatingPolicy(request.context)
        const page = request.page ?? 1, sort = request.sort?.id ?? request.listId ?? 'updated_at', query = request.query ?? '', filters = request.filters ?? {}
        if (!Number.isSafeInteger(page) || page < 1 || page > 1000 || typeof query !== 'string' || query.length > 500 || !SORTS.some(value => value.id === sort)
            || (request.listId !== undefined && !SECTIONS.some(value => value.id === request.listId)) || !filters || typeof filters !== 'object' || Array.isArray(filters)
            || Object.keys(filters).some(key => !['genres', 'excludedGenres', 'author', 'status', 'searchType', 'order'].includes(key))) throw new Error('Invalid VyManga search')
        if (request.context?.allowedContentRatings?.length === 0) return { results: [], isLastPage: true }
        if (/^https?:\/\//i.test(query)) {
            const id = mangaID(query), content = await this.getContent(id, request.context)
            return { results: [{ ...content, id, context: request.context }], isLastPage: true }
        }
        const params = new URLSearchParams({ q: query.trim(), page: String(page), search_po: '0', author_po: '0', sort, sort_type: 'desc' })
        if (filters.author !== undefined) {
            if (typeof filters.author !== 'string' || filters.author.length > 300) throw new Error('Invalid VyManga author')
            params.set('author', filters.author)
        }
        for (const [key, values] of [['status', ['', '0', '1']], ['searchType', ['0', '1', '2']], ['order', ['asc', 'desc']]] as const) {
            const value = filters[key]
            if (value !== undefined && (!value || typeof value !== 'object' || !values.some(option => option === value.id))) throw new Error('Invalid VyManga search option')
            if (value?.id) params.set(key === 'status' ? 'completed' : key === 'searchType' ? 'search_po' : 'sort_type', value.id)
        }
        const selected: string[] = []
        for (const key of ['genres', 'excludedGenres'] as const) {
            const values = filters[key] ?? []
            if (!Array.isArray(values) || values.some(value => !value || typeof value !== 'object' || !/^\d+$/.test(value.id))) throw new Error('Invalid VyManga genres')
            if (values.length) {
                await this.getSearchForm()
                for (const value of values) {
                    if (!this.taxonomy?.some(option => option.id === value.id) || selected.includes(value.id)) throw new Error('Unknown, repeated or conflicting VyManga genre')
                    selected.push(value.id); params.append(key === 'genres' ? 'genre[]' : 'exclude_genre[]', value.id)
                }
            }
        }
        const result = await this.api.document(`${DOMAIN}/search?${params.toString()}`), parsed = cards(result.html, result.url)
        this.issue(this.covers, parsed.items.map(item => item.cover), result.url)
        return { results: parsed.items.filter(item => ratingAllowed(item.contentRating, request.context)).map(item => ({ ...item, context: request.context })), isLastPage: parsed.ended }
    }
    async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
        assertRatingPolicy(link.context)
        if (link.id !== 'home') throw new Error('Unknown VyManga page')
        return SECTIONS.map(section => ({ ...section, style: SectionStyle.SimpleSingleRow }))
    }
    async resolvePageSection(link: PageLink, sectionID: string): Promise<ResolvedPageSection> {
        if (link.id !== 'home' || !SECTIONS.some(section => section.id === sectionID)) throw new Error('Unknown VyManga section')
        const result = await this.search({ page: 1, listId: sectionID, context: link.context })
        return { items: result.results, viewMoreLink: result.isLastPage ? undefined : { request: { page: 1, listId: sectionID, context: link.context } } }
    }
    async getContent(id: string, context?: SourceContext): Promise<Content> {
        slug(id); assertRatingPolicy(context)
        const version = ++this.policySequence
        this.policyVersions.set(id, version)
        while (this.policyVersions.size > 256) this.policyVersions.delete(this.policyVersions.keys().next().value as string)
        const policy = context ? { ...context, ...(context.allowedContentRatings ? { allowedContentRatings: [...context.allowedContentRatings] } : {}) } : undefined
        this.contexts.delete(id)
        if (context?.allowedContentRatings?.length === 0) throw new Error('VyManga title excluded by content policy')
        const document = await this.document(id), content = detail(document.html, id, document.url)
        if (this.policyVersions.get(id) !== version) throw new Error('VyManga content policy changed; reopen details before reading')
        if (!ratingAllowed(content.contentRating, policy)) throw new Error('VyManga title excluded by content policy')
        this.contexts.set(id, policy)
        while (this.contexts.size > 48) this.contexts.delete(this.contexts.keys().next().value as string)
        this.issue(this.covers, [content.cover], document.url)
        return content
    }
    private async inventory(id: string, refresh = false): Promise<Chapter[]> {
        slug(id)
        if (!this.contexts.has(id)) throw new Error('Open VyManga details before reading to establish content policy')
        const version = this.revision(id), policy = this.contexts.get(id)
        const document = await this.document(id, refresh), content = detail(document.html, id, document.url)
        this.revision(id, version)
        if (!ratingAllowed(content.contentRating, policy)) throw new Error('VyManga title excluded by content policy')
        return chapters(document.html, document.url)
    }
    async getChapters(id: string): Promise<Chapter[]> { return this.inventory(id, true) }
    async getChapterData(id: string, chapterID: string, chapter?: Chapter): Promise<ChapterData> {
        publicURL(chapterID)
        const version = this.revision(id)
        const selected = (await this.inventory(id)).find(value => value.chapterId === chapterID)
        if (!selected || (chapter && (chapter.chapterId !== selected.chapterId || chapter.number !== selected.number || chapter.webUrl !== selected.webUrl))) throw new Error('VyManga chapter is absent, paid or mismatched')
        this.revision(id, version)
        const url = new URL(chapterID); url.searchParams.set('view', '0')
        const document = await this.api.document(url.href, true), urls = reader(document.html, document.url)
        this.revision(id, version)
        this.issue(this.pages, urls, document.url)
        return { pages: urls.map(url => ({ url })) }
    }
    getCoverTransport(request: ImageRequest): HttpClient {
        if (request.origin !== RequestOrigin.Cover || !this.covers.has(publicURL(request.url))) throw new Error('Unissued VyManga cover or invalid origin; reopen details')
        return this.coverClient
    }
    getPageTransport(request: ImageRequest): HttpClient {
        if (request.origin !== RequestOrigin.Page || !this.pages.has(publicURL(request.url))) throw new Error('Unissued VyManga page or invalid origin; reopen chapter')
        return this.pageClient
    }
    async handleURL(value: string): Promise<DeepLinkContext | null> {
        let id: string
        try { id = mangaID(value) } catch { return null }
        const content = await this.getContent(id, this.contexts.get(id))
        return { content: { id, title: content.title, cover: content.cover, webUrl: content.webUrl, contentRating: content.contentRating } }
    }
}
