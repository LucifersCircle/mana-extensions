/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex; Copyright © 2026 Lucifers Circle */
import { CatalogRating,
    Chapter,
    ChapterData,
    ChapterSource,
    Content,
    CoverRequestHandler,
    DeepLinkContext,
    Highlight,
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
import { assertRatingPolicy,
    nativeRating,
    ratingAllowed } from '../../ContentRatingPolicy'
import { imageClient,
    QiScansApi } from './QiScansApi'
import { cards,
    chapters,
    detail,
    DOMAIN,
    Genre,
    imageURL,
    Page,
    pages,
    pagination,
    pathComponent,
    readable,
    Reader,
    Series,
    seriesURL,
    slug,
    SourceChapter } from './QiScansParser'
type Filters = { genre?: Option, status?: Option, type?: Option }
const SORTS = [{ id: 'latest', title: 'Latest Updated' }, { id: 'newest', title: 'Newest' }, { id: 'popular', title: 'Popular' }, { id: 'alphabetical', title: 'A–Z' }]
const STATUSES = ['ONGOING', 'COMPLETED', 'HIATUS', 'DROPPED']
const TYPES = ['MANGA', 'MANHWA', 'MANHUA']
const SECTIONS = [{ id: 'banners', title: 'Featured' }, { id: 'popular', title: 'Popular Today' }, { id: 'pinned', title: 'Pinned' }, { id: 'newSeries', title: 'New Series' }, { id: 'editorsPick', title: 'Editor\'s Pick' }]
export class Target implements ChapterSource, PageLinkResolver, CoverRequestHandler, PageRequestHandler {
    readonly info: SourceInfo = {
        id: 'QiScans', name: 'QiScans', thumbnail: 'QiScans.png', version: '0.0.1-alpha.2', website: DOMAIN, rating: CatalogRating.MIXED,
        description: 'QiScans legacy v1 public comic catalog, adapted from Inkdex QiScans. Unclassified titles use a Suggestive compatibility fallback, not a verified age rating. Text novels, redirected titles and paid chapters are excluded.',
        supportedLanguages: ['en_US'], badges: ['Manga', 'Manhwa', 'Manhua'],
        developers: [{ name: 'Lucifers Circle', github: 'https://github.com/LucifersCircle' }, { name: 'Inkdex', github: 'https://github.com/inkdex' }]
    }
    readonly config = { owningLinks: ['qimanhwa.com'] }
    private readonly api = new QiScansApi()
    private readonly coverClient = imageClient(RequestOrigin.Cover)
    private readonly pageClient = imageClient(RequestOrigin.Page)
    private readonly contexts = new Map<string, SourceContext | undefined>()
    private home?: { at: number, value: Record<string, Series[]> }
    private homePending?: Promise<Record<string, Series[]>>
    private genres?: Genre[]
    private readonly inventories = new Map<string, { at: number, rows: SourceChapter[] }>()
    private async taxonomy(): Promise<Genre[]> {
        if (!this.genres) {
            const values = await this.api.json<Genre[]>('/series/genres')
            if (!Array.isArray(values) || !values.length || values.some(value => !value.slug || !value.name?.trim()) || new Set(values.map(value => value.slug)).size !== values.length) throw new Error('Invalid QiScans genres')
            values.forEach(value => slug(value.slug as string))
            this.genres = values
        }
        return this.genres
    }
    async getSortOptions(): Promise<SortOption[]> { return SORTS }
    async getSearchForm(): Promise<SearchForm> {
        return { sections: [SearchListSection({ footer: 'Filters and sorting apply only to an empty search. Text search cannot be combined with browse controls. Text novels are omitted.', children: [
            SearchMenuPicker({ id: 'genre', title: 'Genre', options: [{ id: '', title: 'All Genres' }, ...(await this.taxonomy()).map(value => ({ id: value.slug as string, title: value.name.trim() }))] }),
            SearchMenuPicker({ id: 'status', title: 'Status', options: [{ id: '', title: 'All Statuses' }, ...STATUSES.map(id => ({ id, title: id }))] }),
            SearchMenuPicker({ id: 'type', title: 'Type', options: [{ id: '', title: 'All Types' }, ...TYPES.map(id => ({ id, title: id }))] })
        ] }), SearchSortSection({ header: 'Sort' })] }
    }
    private highlights(values: Series[], context?: SourceContext): Highlight[] {
        return ratingAllowed(undefined, context) ? cards(values).map(value => ({ ...value, webUrl: seriesURL(value.id), contentRating: nativeRating(undefined), context })) : []
    }
    async search(request: SearchRequest<Filters>): Promise<PagedSearchResult> {
        assertRatingPolicy(request.context)
        const page = request.page ?? 1, filters = request.filters ?? {}, sort = request.sort?.id ?? 'latest'
        if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || request.listId || (request.query !== undefined && (typeof request.query !== 'string' || request.query.length > 500)) || !filters || typeof filters !== 'object' || Array.isArray(filters) || Object.keys(filters).some(key => !['genre', 'status', 'type'].includes(key)) || !SORTS.some(value => value.id === sort)) throw new Error('Invalid QiScans search request')
        for (const value of Object.values(filters)) if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.id !== 'string') throw new Error('Invalid QiScans filter')
        const query = (request.query ?? '').trim().replace(/[\u2018\u2019]/g, '\'').replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, ' ')
        if (query && (Object.values(filters).some(value => value.id) || sort !== 'latest')) throw new Error('QiScans text search cannot be combined with browse filters or sorting')
        if (!ratingAllowed(undefined, request.context) || query.length === 1) return { results: [], isLastPage: true }
        const params = new URLSearchParams({ page: String(page), perPage: '20' })
        if (query) params.set('q', query)
        else {
            params.set('sort', sort)
            if (filters.status?.id) { if (!STATUSES.includes(filters.status.id)) throw new Error('Invalid QiScans status'); params.set('status', filters.status.id) }
            if (filters.type?.id) { if (!TYPES.includes(filters.type.id)) throw new Error('Invalid QiScans type'); params.set('type', filters.type.id) }
            if (filters.genre?.id) { if (!(await this.taxonomy()).some(value => value.slug === filters.genre?.id)) throw new Error('Invalid QiScans genre'); params.set('genre', filters.genre.id) }
        }
        let data = await this.api.json<{ data: Series[] }>('/series' + (query ? '/search' : '') + '?' + params.toString())
        // Paperback documents only data for search, unlike the chapter inventory.
        if (!Array.isArray(data.data)) throw new Error('Invalid QiScans search response')
        let results = this.highlights(data.data, request.context)
        // Preserve the upstream spelling retry only after a successful empty result,
        // never after an HTTP/access failure and never on another host.
        if (results.length === 0 && query.includes('\'')) {
            params.set('q', query.replace(/'/g, '\u2019'))
            data = await this.api.json<{ data: Series[] }>('/series/search?' + params.toString())
            if (!Array.isArray(data.data)) throw new Error('Invalid QiScans search response')
            results = this.highlights(data.data, request.context)
        }
        return { results, isLastPage: data.data.length < 20 }
    }
    async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
        assertRatingPolicy(link.context)
        if (link.id !== 'home') throw new Error('Unknown QiScans page')
        return ratingAllowed(undefined, link.context) ? SECTIONS.map(value => ({ ...value, style: SectionStyle.SimpleSingleRow })) : []
    }
    async resolvePageSection(link: PageLink, sectionId: string): Promise<ResolvedPageSection> {
        assertRatingPolicy(link.context)
        if (link.id !== 'home' || !SECTIONS.some(value => value.id === sectionId)) throw new Error('Unknown QiScans section')
        if (!ratingAllowed(undefined, link.context)) return { items: [] }
        if (!this.home || Date.now() - this.home.at >= 180000) {
            if (!this.homePending) this.homePending = this.api.json<Record<string, Series[]>>('/home').then(value => { this.home = { at: Date.now(), value }; return value }).finally(() => { this.homePending = undefined })
            await this.homePending
        }
        const values = this.home?.value[sectionId]
        if (!values) throw new Error('QiScans discovery section is missing')
        return { items: this.highlights(values, link.context) }
    }
    async getContent(id: string, context?: SourceContext): Promise<Content> {
        slug(id); assertRatingPolicy(context)
        if (!ratingAllowed(undefined, context)) throw new Error('QiScans title is excluded by content policy')
        const value = detail(await this.api.json<Series>('/series/' + pathComponent(id)), id)
        this.contexts.set(id, context ? { ...context, ...(context.allowedContentRatings ? { allowedContentRatings: [...context.allowedContentRatings] } : {}) } : undefined)
        while (this.contexts.size > 128) this.contexts.delete(this.contexts.keys().next().value as string)
        return value
    }
    private async inventory(id: string, refresh = false): Promise<SourceChapter[]> {
        slug(id)
        await this.getContent(id, this.contexts.get(id))
        const cached = this.inventories.get(id)
        if (!refresh && cached && Date.now() - cached.at < 180000) return cached.rows
        this.inventories.delete(id)
        const rows: SourceChapter[] = [], seen = new Set<string>()
        let page = 1, total: number | undefined, totalPages: number | undefined
        for (;;) {
            const data = await this.api.json<Page<SourceChapter>>('/series/' + pathComponent(id) + '/chapters?page=' + page + '&perPage=30&sort=desc')
            const next = pagination(data, page)
            if ((total !== undefined && total !== data.totalItems) || (totalPages !== undefined && totalPages !== data.totalPages)) throw new Error('QiScans chapter inventory changed during traversal')
            total = data.totalItems; totalPages = data.totalPages
            for (const row of data.data) {
                slug(row.slug)
                if (seen.has(row.slug)) throw new Error('QiScans chapter continuation repeated an identity')
                seen.add(row.slug); rows.push(row)
            }
            if (rows.length > total || (next !== null && rows.length >= total)) throw new Error('Invalid QiScans chapter inventory count')
            if (next === null) {
                if (rows.length !== total) throw new Error('QiScans chapter inventory is incomplete')
                chapters(rows, id)
                this.inventories.set(id, { at: Date.now(), rows })
                while (this.inventories.size > 32) this.inventories.delete(this.inventories.keys().next().value as string)
                return rows
            }
            page = next
        }
    }
    async getChapters(id: string): Promise<Chapter[]> { return chapters(await this.inventory(id, true), id) }
    async getChapterData(id: string, chapterId: string, chapter?: Chapter): Promise<ChapterData> {
        slug(id); slug(chapterId)
        const selected = (await this.inventory(id)).find(value => value.slug === chapterId)
        if (!selected || !readable(selected)) throw new Error('QiScans chapter is absent, non-public or paid')
        if (chapter && (chapter.chapterId !== chapterId || chapter.number !== selected.number || (chapter.webUrl && chapter.webUrl !== seriesURL(id, chapterId)))) throw new Error('QiScans chapter identity mismatch')
        return { pages: pages(await this.api.json<Reader>('/series/' + pathComponent(id) + '/chapters/' + pathComponent(chapterId)), id, selected) }
    }
    getCoverTransport(request: ImageRequest): HttpClient { if (request.origin !== RequestOrigin.Cover) throw new Error('Invalid QiScans cover origin'); imageURL(request.url); return this.coverClient }
    getPageTransport(request: ImageRequest): HttpClient { if (request.origin !== RequestOrigin.Page) throw new Error('Invalid QiScans page origin'); imageURL(request.url); return this.pageClient }
    async handleURL(value: string): Promise<DeepLinkContext | null> {
        let id: string
        try {
            const url = new URL(value), match = value.slice(DOMAIN.length).match(/^\/series\/([^/]+)\/?$/)
            if (!value.startsWith(DOMAIN + '/') || url.origin !== DOMAIN || url.username || url.password || url.search || url.hash || /[\\\s]/.test(value) || !match) return null
            id = slug(decodeURIComponent(match[1] ?? ''))
        } catch { return null }
        const content = await this.getContent(id, this.contexts.get(id))
        return { content: { id, title: content.title, cover: content.cover, webUrl: content.webUrl, contentRating: content.contentRating } }
    }
}
