/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex; Copyright © 2026 Lucifers Circle */
import { CatalogRating,
    Chapter,
    ChapterData,
    ChapterSource,
    CloudflareError,
    Content,
    CoverRequestHandler,
    DeepLinkContext,
    Highlight,
    HttpClient,
    HttpMethod,
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
    SectionStyle,
    SortOption,
    SourceContext,
    SourceInfo } from '@mana-app/types'
import { assertRatingPolicy,
    nativeRating,
    ratingAllowed } from '../../ContentRatingPolicy'
import { chapterToken,
    DOMAIN,
    MangaTaroApi } from './MangaTaroApi'
import { Card,
    catalog,
    Choices,
    choices,
    Detail,
    detail,
    home,
    imageURL,
    Inventory,
    LoadItem,
    nativeChapters,
    numeric,
    readable,
    seriesID,
    slug,
    SourceChapter,
    sourceURL } from './MangaTaroParser'

type Filters = { genres?: Option[], years?: Option[], types?: Option[], statuses?: Option[], genreMatchMode?: Option }
type Cached<T> = { at: number, value: T }
const TTL = 180000
const SECTIONS = [{ id: 'featured', title: 'Featured' }, { id: 'recent', title: 'Recently Added' }]
const SORTS = [
    { id: 'post_desc', title: 'Latest Updates' }, { id: 'post_asc', title: 'Oldest Updates' },
    { id: 'release_desc', title: 'Newest Release' }, { id: 'release_asc', title: 'Oldest Release' },
    { id: 'title_asc', title: 'Title A–Z' }, { id: 'title_desc', title: 'Title Z–A' },
    { id: 'popular_desc', title: 'Most Popular' }, { id: 'popular_asc', title: 'Least Popular' }
]
export class Target implements ChapterSource, PageLinkResolver, CoverRequestHandler, PageRequestHandler {
    readonly info: SourceInfo = {
        id: 'MangaTaro', name: 'MangaTaro', thumbnail: 'MangaTaro.png', version: '0.0.1-alpha.2', website: DOMAIN, rating: CatalogRating.MIXED,
        description: 'Public manga catalog, site filters and complete image chapters. Unclassified titles use a Suggestive compatibility fallback, not a verified age rating. Relative upload dates are approximate; unavailable dates remain unknown. Text novels and restricted chapters are not supported.',
        supportedLanguages: ['en_US'], badges: ['Manga', 'Manhwa', 'Manhua'],
        developers: [{ name: 'Lucifers Circle', github: 'https://github.com/LucifersCircle' }, { name: 'Inkdex', github: 'https://github.com/inkdex' }]
    }
    readonly config = { owningLinks: ['mangataro.org'] }
    private readonly api = new MangaTaroApi()
    private readonly coverClient = this.imageClient(RequestOrigin.Cover)
    private readonly pageClient = this.imageClient(RequestOrigin.Page)
    private taxonomy?: Cached<Choices>
    private homePage?: Cached<string>
    private readonly details = new Map<string, Cached<Detail>>()
    private readonly inventories = new Map<string, Cached<SourceChapter[]>>()
    // The SDK supplies rating context on details/search, not chapter methods.
    // Remember the last title context, independently of reusable public images.
    private readonly contexts = new Map<string, SourceContext | undefined>()
    private put<T>(cache: Map<string, Cached<T>>, key: string, value: T): T {
        cache.set(key, { at: Date.now(), value })
        while (cache.size > 32) cache.delete(cache.keys().next().value as string)
        return value
    }
    private async options(): Promise<Choices> {
        if (!this.taxonomy || Date.now() - this.taxonomy.at >= TTL) this.taxonomy = { at: Date.now(), value: choices(await this.api.text('/browse')) }
        return this.taxonomy.value
    }
    private async homeHTML(): Promise<string> {
        if (!this.homePage || Date.now() - this.homePage.at >= TTL) this.homePage = { at: Date.now(), value: await this.api.text('/home') }
        return this.homePage.value
    }
    async getSortOptions(): Promise<SortOption[]> { return SORTS }
    async getSearchForm(): Promise<SearchForm> {
        const values = await this.options()
        return { sections: [SearchListSection({ footer: 'Native MangaTaro browse controls. Text novels are omitted. Unclassified cards use Suggestive compatibility, not an all-ages rating.', children: [
            SearchMultiPickerSheet({ id: 'genres', title: 'Tags', options: values.genres }),
            SearchMultiPickerSheet({ id: 'types', title: 'Type', options: values.types }),
            SearchMultiPickerSheet({ id: 'statuses', title: 'Status', options: values.statuses }),
            SearchMultiPickerSheet({ id: 'years', title: 'Original year', options: values.years }),
            SearchMenuPicker({ id: 'genreMatchMode', title: 'Match tags', options: [{ id: 'any', title: 'Any selected tag' }, { id: 'all', title: 'All selected tags' }] })
        ] }), SearchSortSection({ header: 'Sort' })] }
    }
    private cards(items: Card[], context?: SourceContext): Highlight[] {
        return items.filter(item => ratingAllowed(this.details.get(item.id)?.value.rating ?? item.rating, context)).map(item => ({ ...item, webUrl: DOMAIN + '/manga/' + item.id, contentRating: nativeRating(this.details.get(item.id)?.value.rating ?? item.rating), context }))
    }
    async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
        assertRatingPolicy(link.context)
        if (link.id !== 'home') throw new Error('Unknown MangaTaro page')
        return link.context?.allowedContentRatings?.length === 0 ? [] : SECTIONS.map(item => ({ ...item, style: SectionStyle.SimpleSingleRow }))
    }
    async resolvePageSection(link: PageLink, sectionId: string): Promise<ResolvedPageSection> {
        assertRatingPolicy(link.context)
        if (link.id !== 'home' || !SECTIONS.some(item => item.id === sectionId)) throw new Error('Unknown MangaTaro section')
        if (link.context?.allowedContentRatings?.length === 0) return { items: [] }
        return { items: this.cards(home(await this.homeHTML(), sectionId), link.context) }
    }
    async search(request: SearchRequest<Filters>): Promise<PagedSearchResult> {
        assertRatingPolicy(request.context)
        const page = request.page ?? 1, filter = request.filters ?? {}
        if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || request.listId || (request.query !== undefined && (typeof request.query !== 'string' || request.query.length > 500)) || (request.sort && !SORTS.some(item => item.id === request.sort?.id)) || !filter || typeof filter !== 'object' || Array.isArray(filter) || Object.keys(filter).some(key => !['genres', 'types', 'statuses', 'years', 'genreMatchMode'].includes(key))) throw new Error('Invalid MangaTaro search request')
        if (request.context?.allowedContentRatings?.length === 0) return { results: [], isLastPage: true }
        const values = Object.keys(filter).length ? await this.options() : undefined
        const selected = (key: keyof Choices): string => {
            const options = filter[key] ?? []
            if (!Array.isArray(options) || options.some(option => !option || !values?.[key].some(value => value.id === option.id)) || new Set(options.map(option => option.id)).size !== options.length) throw new Error('Invalid MangaTaro ' + key + ' filter')
            return JSON.stringify(options.map(option => ['genres', 'years'].includes(key) ? Number(option.id) : option.id))
        }
        if (filter.genreMatchMode !== undefined && (!filter.genreMatchMode || typeof filter.genreMatchMode !== 'object' || Array.isArray(filter.genreMatchMode))) throw new Error('Invalid MangaTaro tag matching mode')
        const mode = filter.genreMatchMode?.id ?? 'any'
        if (!['any', 'all'].includes(mode)) throw new Error('Invalid MangaTaro tag matching mode')
        const rows = await this.api.json<LoadItem[]>('/wp-json/manga/v1/load', { page, search: request.query?.trim() ?? '', years: selected('years'), genres: selected('genres'), types: selected('types'), statuses: selected('statuses'), sort: request.sort?.id ?? 'post_desc', genreMatchMode: mode })
        return { results: this.cards(catalog(rows), request.context), isLastPage: rows.length === 0 }
    }
    private async metadata(id: string, context?: SourceContext): Promise<Detail> {
        slug(id); assertRatingPolicy(context)
        if (context?.allowedContentRatings?.length === 0) throw new Error('MangaTaro title is excluded by native content policy')
        const old = this.details.get(id)
        const value = old && Date.now() - old.at < TTL ? old.value : this.put(this.details, id, detail(await this.api.text('/manga/' + id), id, await this.options()))
        if (!ratingAllowed(value.rating, context)) throw new Error('MangaTaro title is excluded by native content policy')
        return value
    }
    async getContent(id: string, context?: SourceContext): Promise<Content> {
        slug(id); assertRatingPolicy(context)
        this.contexts.set(id, context ? { ...context, ...(context.allowedContentRatings ? { allowedContentRatings: [...context.allowedContentRatings] } : {}) } : undefined)
        while (this.contexts.size > 128) this.contexts.delete(this.contexts.keys().next().value as string)
        return (await this.metadata(id, context)).content
    }
    private async inventory(id: string): Promise<SourceChapter[]> {
        const metadata = await this.metadata(id, this.contexts.get(id)), old = this.inventories.get(id)
        if (old && Date.now() - old.at < TTL) return old.value
        const rows: SourceChapter[] = [], seen = new Set<string>(), urls = new Set<string>()
        let total: number | undefined
        for (;;) {
            const parameters = new URLSearchParams({ manga_id: metadata.numericId, offset: String(rows.length), limit: '500', order: 'DESC', ...chapterToken() })
            const value = await this.api.json<Inventory>('/auth/manga-chapters?' + parameters.toString())
            if (value.success !== true || !Array.isArray(value.chapters) || !Number.isSafeInteger(value.total) || value.total < 0 || value.total > 100000 || value.offset !== rows.length || value.limit !== 500 || typeof value.has_more !== 'boolean' || (total !== undefined && total !== value.total)) throw new Error('MangaTaro complete chapter inventory changed or is invalid')
            total = value.total
            for (const row of value.chapters) {
                numeric(row.id)
                if (!['media', 'text'].includes(row.chapter_type)) throw new Error('Unsupported MangaTaro chapter content type')
                if (seen.has(row.id) || urls.has(row.url)) throw new Error('MangaTaro chapter continuation repeated an identity')
                seen.add(row.id); urls.add(row.url); rows.push(row)
            }
            if (rows.length > total || (value.has_more && (!value.chapters.length || rows.length >= total))) throw new Error('MangaTaro chapter continuation stalled')
            if (!value.has_more) {
                if (rows.length !== total) throw new Error('MangaTaro chapter inventory is incomplete')
                nativeChapters(rows, id)
                return this.put(this.inventories, id, rows)
            }
        }
    }
    async getChapters(id: string): Promise<Chapter[]> { return nativeChapters(await this.inventory(id), id) }
    async getChapterData(id: string, chapterId: string, chapter?: Chapter): Promise<ChapterData> {
        slug(id); numeric(chapterId)
        const rows = await this.inventory(id), selected = rows.find(item => item.id === chapterId)
        if (!selected || !readable(selected)) throw new Error('MangaTaro chapter is unavailable or restricted in the complete title inventory')
        const native = nativeChapters([selected], id)[0]
        if (chapter && (chapter.chapterId !== chapterId || chapter.number !== native?.number || (chapter.webUrl && chapter.webUrl !== selected.url))) throw new Error('MangaTaro chapter identity mismatch')
        const value = await this.api.json<{ success: boolean, chapter_id: number, chapter_type: string, images: string[], total: number }>('/auth/chapter-content?chapter_id=' + chapterId)
        if (value.success !== true || String(value.chapter_id) !== chapterId || value.chapter_type !== 'media' || !Array.isArray(value.images) || !value.images.length || value.total !== value.images.length || new Set(value.images).size !== value.images.length) throw new Error('MangaTaro reader identity or complete image manifest is unavailable')
        await this.metadata(id, this.contexts.get(id))
        return { pages: value.images.map(url => ({ url: imageURL(url) })) }
    }
    private imageClient(origin: RequestOrigin.Cover | RequestOrigin.Page): HttpClient {
        return new HttpClient().setTimeoutMs(30000).addHeader('Referer', DOMAIN + '/').addRequestInterceptor((request, context) => {
            if (context.origin !== origin || request.method !== HttpMethod.Get || request.body !== undefined) throw new Error('Invalid MangaTaro image request origin')
            imageURL(request.url, origin === RequestOrigin.Cover)
            return request
        }).addResponseInterceptor(response => {
            imageURL(response.url, origin === RequestOrigin.Cover)
            if (response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge') throw new CloudflareError(response.request.url)
            return response
        })
    }
    getCoverTransport(request: ImageRequest): HttpClient { if (request.origin !== RequestOrigin.Cover) throw new Error('Invalid MangaTaro cover origin'); imageURL(request.url, true); return this.coverClient }
    getPageTransport(request: ImageRequest): HttpClient { if (request.origin !== RequestOrigin.Page) throw new Error('Invalid MangaTaro page origin'); imageURL(request.url); return this.pageClient }
    async handleURL(value: string): Promise<DeepLinkContext | null> {
        let id: string
        try { id = seriesID(sourceURL(value).href) } catch { return null }
        const content = await this.metadata(id, this.contexts.get(id))
        return { content: { id, title: content.content.title, cover: content.content.cover, webUrl: content.content.webUrl, contentRating: content.content.contentRating } }
    }
}
