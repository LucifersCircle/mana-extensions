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
    SearchRequest,
    SearchSortSection,
    SectionStyle,
    SortOption,
    SourceContext,
    SourceInfo } from '@mana-app/types'
import { load } from 'cheerio'
import { assertRatingPolicy,
    ratingAllowed } from '../../ContentRatingPolicy'
import { Api,
    imageClient } from './Api'
import { chapters,
    comicListing,
    detail,
    DOMAIN,
    imageURL,
    listing,
    reader,
    seriesURL,
    slug,
    text,
    UnsupportedNovelError } from './Parser'
const SORTS = [{ id: 'latest', title: 'Latest Updated' }, { id: 'new-manga', title: 'New' }, { id: 'alphabet', title: 'A–Z' }, { id: 'views', title: 'Most Viewed' }]
const COMIC_LISTS = [{ id: 'manga', title: 'Manga' }, { id: 'manhwa', title: 'Manhwa' }, { id: 'manhua', title: 'Manhua' }]
type Filters = { genres?: Option }
export class Target implements ChapterSource, PageLinkResolver, CoverRequestHandler, PageRequestHandler {
    readonly info: SourceInfo = { id: 'GourmetScans', name: 'GourmetScans', version: '0.0.1-alpha.7', website: DOMAIN, thumbnail: 'GourmetScans.png', rating: CatalogRating.MIXED,
        description: 'Gourmet Scans public comics, adapted from Inkdex. Novels, login-only and paid chapters are not supported. Search may show unclassified novels until their details identify them. Unclassified titles use a Suggestive compatibility fallback, not a verified age rating. Missing chapter dates are unknown.',
        supportedLanguages: ['en_US'], badges: ['Manga', 'Manhwa'], developers: [{ name: 'Lucifers Circle', github: 'https://github.com/LucifersCircle' }, { name: 'Inkdex', github: 'https://github.com/inkdex' }] }
    readonly config = { owningLinks: ['gourmetsupremacy.com'] }
    private readonly api = new Api()
    private readonly coverClient = imageClient(RequestOrigin.Cover)
    private readonly pageClient = imageClient(RequestOrigin.Page)
    private readonly documents = new Map<string, { at: number, html: string }>()
    private readonly contexts = new Map<string, SourceContext | undefined>()
    private readonly knownNovels = new Set<string>()
    private genres?: Option[]
    private async document(url: string, refresh = false): Promise<string> {
        const cached = this.documents.get(url)
        if (!refresh && cached && Date.now() - cached.at < 120000) return cached.html
        this.documents.delete(url)
        const html = await this.api.text(url)
        this.documents.set(url, { at: Date.now(), html })
        while (this.documents.size > 24) this.documents.delete(this.documents.keys().next().value as string)
        return html
    }
    async getSortOptions(): Promise<SortOption[]> { return SORTS }
    private searchURL(query: string, sort: string, page: number, genre = ''): string {
        const params = new URLSearchParams({ s: query, post_type: 'wp-manga', m_orderby: sort })
        if (genre) params.set('genre[]', genre)
        return `${DOMAIN}/${page > 1 ? `page/${page}/` : ''}?${params.toString()}`
    }
    async getSearchForm(): Promise<SearchForm> {
        if (!this.genres) {
            const $ = load(await this.document(this.searchURL('', 'latest', 1)))
            this.genres = $('input[name="genre[]"]').toArray().map(node => ({ id: $(node).attr('value') ?? '', title: text($(node).parent().find('label').text()) }))
            if (!this.genres.length || this.genres.some(value => !value.id || !value.title)) throw new Error('GourmetScans genre taxonomy is missing')
        }
        return { sections: [SearchListSection({ children: [SearchMenuPicker({ id: 'genres', title: 'Genre', options: [{ id: '', title: 'All Genres' }, ...this.genres] })] }), SearchSortSection({ header: 'Sort' })] }
    }
    async search(request: SearchRequest<Filters>): Promise<PagedSearchResult> {
        assertRatingPolicy(request.context)
        const page = request.page ?? 1, sort = request.sort?.id ?? 'latest', query = request.query ?? '', filters = request.filters ?? {}
        if (request.listId) {
            if (!COMIC_LISTS.some(value => value.id === request.listId) || !Number.isSafeInteger(page) || page < 1 || page > 100 || query !== '' || sort !== 'latest' || !filters || typeof filters !== 'object' || Array.isArray(filters) || Object.keys(filters).length) throw new Error('Invalid GourmetScans comic catalog request')
            const result = comicListing(await this.document(`${DOMAIN}/tag/${request.listId}/${page > 1 ? `page/${page}/` : ''}`), request.listId, page)
            return { results: result.items.filter(value => !this.knownNovels.has(value.id) && ratingAllowed(value.contentRating, request.context)).map(value => ({ ...value, context: request.context })), isLastPage: result.ended }
        }
        if (!Number.isSafeInteger(page) || page < 1 || page > 100 || typeof query !== 'string' || query.length > 500 || request.listId || !SORTS.some(value => value.id === sort) || !filters || typeof filters !== 'object' || Array.isArray(filters) || Object.keys(filters).some(key => key !== 'genres')) throw new Error('Invalid GourmetScans search')
        const genre = filters.genres?.id ?? ''
        if (filters.genres && (typeof genre !== 'string' || typeof filters.genres !== 'object')) throw new Error('Invalid GourmetScans genre')
        if (genre) { await this.getSearchForm(); if (!this.genres?.some(value => value.id === genre)) throw new Error('Unknown GourmetScans genre') }
        const result = listing(await this.document(this.searchURL(query.trim().replace(/[\u2018\u2019]/g, '\'').replace(/[\u201C\u201D]/g, '"'), sort, page, genre)), page)
        return { results: result.items.filter(value => !this.knownNovels.has(value.id) && ratingAllowed(value.contentRating, request.context)).map(value => ({ ...value, context: request.context })), isLastPage: result.ended }
    }
    async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
        assertRatingPolicy(link.context)
        if (link.id !== 'home') throw new Error('Unknown GourmetScans page')
        return COMIC_LISTS.map(value => ({ ...value, style: SectionStyle.SimpleSingleRow }))
    }
    async resolvePageSection(link: PageLink, sectionId: string): Promise<ResolvedPageSection> {
        if (link.id !== 'home' || !COMIC_LISTS.some(value => value.id === sectionId)) throw new Error('Unknown GourmetScans section')
        const result = await this.search({ page: 1, listId: sectionId, context: link.context })
        return { items: result.results, viewMoreLink: result.isLastPage ? undefined : { request: { page: 1, listId: sectionId, context: link.context } } }
    }
    async getContent(id: string, context?: SourceContext): Promise<Content> {
        slug(id); assertRatingPolicy(context)
        this.contexts.set(id, context ? { ...context, ...(context.allowedContentRatings ? { allowedContentRatings: [...context.allowedContentRatings] } : {}) } : undefined)
        while (this.contexts.size > 128) this.contexts.delete(this.contexts.keys().next().value as string)
        if (context?.allowedContentRatings?.length === 0) throw new Error('GourmetScans title is excluded by content policy')
        let content: Content
        try { content = detail(await this.document(seriesURL(id)), id) } catch (error) {
            if (error instanceof UnsupportedNovelError) {
                this.knownNovels.add(id)
                while (this.knownNovels.size > 256) this.knownNovels.delete(this.knownNovels.values().next().value as string)
            }
            throw error
        }
        if (!ratingAllowed(content.contentRating, context)) throw new Error('GourmetScans title is excluded by content policy')
        return content
    }
    async getChapters(id: string): Promise<Chapter[]> {
        if (!this.contexts.has(id)) throw new Error('Open GourmetScans details to establish content policy before reading')
        const html = await this.document(seriesURL(id), true), content = detail(html, id)
        if (!ratingAllowed(content.contentRating, this.contexts.get(id))) throw new Error('GourmetScans title is excluded by content policy')
        return chapters(html, id)
    }
    async getChapterData(id: string, chapterId: string, chapter?: Chapter): Promise<ChapterData> {
        slug(chapterId)
        if (!this.contexts.has(id)) throw new Error('Open GourmetScans details to establish content policy before reading')
        const html = await this.document(seriesURL(id)), content = detail(html, id)
        if (!ratingAllowed(content.contentRating, this.contexts.get(id))) throw new Error('GourmetScans title is excluded by content policy')
        const selected = chapters(html, id).find(value => value.chapterId === chapterId)
        if (!selected || (chapter && (chapter.chapterId !== chapterId || chapter.number !== selected.number || (chapter.webUrl && chapter.webUrl !== selected.webUrl)))) throw new Error('GourmetScans chapter is absent, paid or mismatched')
        return reader(await this.document(seriesURL(id) + chapterId + '/', true), id, chapterId)
    }
    getCoverTransport(request: ImageRequest): HttpClient { if (request.origin !== RequestOrigin.Cover) throw new Error('Invalid GourmetScans cover origin'); imageURL(request.url); return this.coverClient }
    getPageTransport(request: ImageRequest): HttpClient { if (request.origin !== RequestOrigin.Page) throw new Error('Invalid GourmetScans page origin'); imageURL(request.url); return this.pageClient }
    async handleURL(value: string): Promise<DeepLinkContext | null> {
        const match = value.match(/^https:\/\/gourmetsupremacy\.com\/project\/([a-z0-9-]+)\/$/)
        if (!match?.[1]) return null
        const id = slug(match[1]), content = await this.getContent(id, this.contexts.get(id))
        return { content: { id, title: content.title, cover: content.cover, webUrl: content.webUrl, contentRating: content.contentRating } }
    }
}
