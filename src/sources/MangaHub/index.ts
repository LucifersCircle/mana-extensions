/* SPDX-License-Identifier: GPL-3.0-only */
/* MangaHub protocol adapted from Elrulia and Nicartjay. Mana adaptation © 2026 Lucifers Circle.
 * Attribution and exact upstream revisions: THIRD_PARTY_NOTICES.md. */
import { CatalogRating,
    Chapter,
    ChapterData,
    ChapterSource,
    Content,
    CoverRequestHandler,
    DeepLinkContext,
    HttpClient,
    ImageRequest,
    PageLink,
    PageLinkResolver,
    PageRequestHandler,
    PageSection,
    PagedSearchResult,
    RequestOrigin,
    ResolvedPageSection,
    SearchForm,
    SearchRequest,
    SectionStyle,
    SourceContext,
    ContentRating,
    SourceInfo } from '@mana-app/types'
import { assertRatingPolicy,
    ratingAllowed } from '../../ContentRatingPolicy'
import { Api } from './Api'
import { decryptPages,
    envelope } from './Crypto'
import { chapters,
    detail,
    DOMAIN,
    listing,
    number,
    numericId,
    pageList,
    record,
    slug,
    unrestricted } from './Parser'

type Grant = { context?: SourceContext, revision: number, identity: number, rating?: ContentRating, chapters: Chapter[] }
export class Target implements ChapterSource, PageLinkResolver, CoverRequestHandler, PageRequestHandler {
    readonly info: SourceInfo = { id: 'MangaHub', name: 'MangaHub', version: '0.0.1-odt.alpha.1', website: DOMAIN, thumbnail: 'MangaHub.png', rating: CatalogRating.MIXED,
        description: 'Isolated Mana ODT candidate, not live-verified. One ordinary homepage session; access failures stop without refresh or bypass. Native AES-GCM required for encrypted pages. Unknown ratings use Suggestive compatibility, not a verified age rating. Missing/relative dates are unknown (epoch sentinel).',
        supportedLanguages: ['en_US'], badges: ['Manga', 'ODT'], developers: [{ name: 'Lucifers Circle', github: 'https://github.com/LucifersCircle' }] }
    readonly config = { owningLinks: ['mangahub.io'] }
    private readonly api = new Api()
    private readonly grants = new Map<string, Grant>()
    private readonly policies = new Map<string, SourceContext | undefined>()
    private readonly revisions = new Map<string, number>()
    private revision = 0
    private readonly covers = new Map<string, { id: string, revision?: number, rating?: ContentRating, context?: SourceContext }>()
    private readonly pages = new Map<string, { id: string, revision: number }>()
    private readonly coverClient = this.api.imageClient(RequestOrigin.Cover, url => this.coverGrant(url))
    private readonly pageClient = this.api.imageClient(RequestOrigin.Page, url => this.pageGrant(url))
    private revoke(id: string): void {
        this.grants.delete(id)
        for (const [url, grant] of this.covers) if (grant.id === id) this.covers.delete(url)
        for (const [url, grant] of this.pages) if (grant.id === id) this.pages.delete(url)
    }
    private issueCover(url: string, id: string, rating?: ContentRating, context?: SourceContext): void {
        const policy = context ? { ...context, ...(context.allowedContentRatings ? { allowedContentRatings: [...context.allowedContentRatings] } : {}) } : undefined
        this.covers.set(url, { id, revision: this.revisions.get(id), rating, context: policy })
        while (this.covers.size > 2000) this.covers.delete(this.covers.keys().next().value as string)
    }
    private coverGrant(url: string): void {
        const grant = this.covers.get(url)
        if (!grant || this.revisions.get(grant.id) !== grant.revision || !ratingAllowed(grant.rating, grant.context)) throw new Error('Unissued or policy-revoked MangaHub cover')
    }
    private grant(id: string, revision?: number): Grant {
        this.api.assertOpen(); slug(id)
        const grant = this.grants.get(id)
        if (!grant || this.revisions.get(id) !== grant.revision || (revision !== undefined && revision !== grant.revision) || !ratingAllowed(grant.rating, grant.context)) throw new Error('Open MangaHub title details to establish the current content policy before reading')
        return grant
    }
    private pageGrant(url: string): void {
        const grant = this.pages.get(url)
        if (!grant) throw new Error('Unissued MangaHub page')
        this.grant(grant.id, grant.revision)
    }
    async getSearchForm(): Promise<SearchForm> { return { sections: [] } }
    async search(request: SearchRequest): Promise<PagedSearchResult> {
        assertRatingPolicy(request.context)
        const page = request.page ?? 1, query = request.query ?? '', list = request.listId ?? 'popular'
        if (!Number.isSafeInteger(page) || page < 1 || page > 100 || typeof query !== 'string' || query.length > 500 || !['popular', 'latest'].includes(list) || request.sort || (request.filters !== undefined && (typeof request.filters !== 'object' || !request.filters || Array.isArray(request.filters) || Object.keys(request.filters).length))) throw new Error('Unsupported MangaHub search')
        if (request.context?.allowedContentRatings?.length === 0) return { results: [], isLastPage: true }
        const data = await this.api.graphql(`{ search(x:m01,q:${JSON.stringify(query.trim())},genre:"all",mod:${list === 'latest' ? 'LATEST' : 'POPULAR'},limit:30,offset:${(page - 1) * 30}) { rows { id title slug image genres } } }`)
        const found = listing(record(data.search).rows), items = found.items.filter(item => ratingAllowed(item.contentRating, request.context))
        items.forEach(item => this.issueCover(item.cover, item.id, item.contentRating, request.context))
        return { results: items.map(item => ({ ...item, context: request.context })), isLastPage: found.count < 30 || page === 100 }
    }
    async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
        assertRatingPolicy(link.context)
        if (link.id !== 'home') throw new Error('Unknown MangaHub page')
        return [{ id: 'popular', title: 'Popular', style: SectionStyle.SimpleSingleRow }, { id: 'latest', title: 'Latest Updates', style: SectionStyle.SimpleSingleRow }]
    }
    async resolvePageSection(link: PageLink, sectionId: string): Promise<ResolvedPageSection> {
        if (link.id !== 'home' || !['popular', 'latest'].includes(sectionId)) throw new Error('Unknown MangaHub section')
        return { items: (await this.search({ page: 1, listId: sectionId, context: link.context })).results }
    }
    async getContent(id: string, context?: SourceContext): Promise<Content> {
        slug(id); assertRatingPolicy(context)
        const revision = ++this.revision
        this.revoke(id); this.revisions.set(id, revision)
        while (this.revisions.size > 128) {
            const old = this.revisions.keys().next().value as string
            this.revoke(old); this.revisions.delete(old)
        }
        const policy = context ? { ...context, ...(context.allowedContentRatings ? { allowedContentRatings: [...context.allowedContentRatings] } : {}) } : undefined
        this.policies.set(id, policy)
        while (this.policies.size > 128) this.policies.delete(this.policies.keys().next().value as string)
        if (policy?.allowedContentRatings?.length === 0) throw new Error('MangaHub title is excluded by content policy')
        const data = await this.api.graphql(`{ manga(x:m01,slug:${JSON.stringify(id)}) { id title slug status image author artist genres description alternativeTitle chapters { number title date } } }`)
        try {
            const parsed = detail(data.manga, id), inventory = chapters(record(data.manga).chapters, id)
            if (this.revisions.get(id) !== revision) throw new Error('MangaHub content policy changed while loading')
            if (!ratingAllowed(parsed.content.contentRating, policy)) throw new Error('MangaHub title is excluded by content policy')
            this.grants.set(id, { context: policy, revision, identity: parsed.identity, rating: parsed.content.contentRating, chapters: inventory })
            while (this.grants.size > 128) this.grants.delete(this.grants.keys().next().value as string)
            this.issueCover(parsed.content.cover, id, parsed.content.contentRating, policy)
            return parsed.content
        } catch (error) { this.grants.delete(id); throw error }
    }
    async getChapters(id: string): Promise<Chapter[]> {
        return this.grant(id).chapters.map(chapter => ({ ...chapter, date: new Date(chapter.date.getTime()) }))
    }
    async getChapterData(id: string, chapterId: string, chapter?: Chapter): Promise<ChapterData> {
        const grant = this.grant(id), selected = grant.chapters.find(value => value.chapterId === chapterId)
        if (!selected || (chapter && (chapter.chapterId !== chapterId || chapter.number !== selected.number || (chapter.webUrl !== undefined && chapter.webUrl !== selected.webUrl)))) throw new Error('MangaHub chapter does not belong to the listed title inventory')
        const data = await this.api.graphql(`{ chapter(x:m01,slug:${JSON.stringify(id)},number:${selected.number}) { pages mangaID number manga { slug } } }`)
        try {
            this.grant(id, grant.revision)
            const row = record(data.chapter); unrestricted(row)
            if (numericId(row.mangaID) !== grant.identity || number(row.number) !== selected.number || slug(record(row.manga).slug) !== id) throw new Error('MangaHub reader ownership or chapter number mismatch')
            if (typeof row.pages !== 'string' || !row.pages.length || row.pages.length > 1_400_000) throw new Error('Missing or oversized MangaHub chapter pages')
            const value = row.pages.startsWith('enc:') ? await decryptPages(envelope(row.pages), await this.api.key()) : row.pages
            const urls = pageList(value)
            this.grant(id, grant.revision)
            urls.forEach(url => this.pages.set(url, { id, revision: grant.revision }))
            while (this.pages.size > 3000) this.pages.delete(this.pages.keys().next().value as string)
            return { pages: urls.map(url => ({ url })) }
        } catch (error) { return this.api.stop(error) }
    }
    getCoverTransport(request: ImageRequest): HttpClient {
        this.api.assertOpen()
        if (request.origin !== RequestOrigin.Cover || !this.covers.has(request.url)) throw new Error('Unissued MangaHub cover or invalid origin')
        this.coverGrant(request.url); return this.coverClient
    }
    getPageTransport(request: ImageRequest): HttpClient {
        if (request.origin !== RequestOrigin.Page) throw new Error('Invalid MangaHub image origin')
        this.pageGrant(request.url); return this.pageClient
    }
    async handleURL(value: string): Promise<DeepLinkContext | null> {
        const match = value.match(/^https:\/\/mangahub\.io\/manga\/([a-z0-9_-]+)$/)
        if (!match?.[1]) return null
        const id = slug(match[1])
        if (!this.policies.has(id)) return null // A deep link has no native policy context of its own.
        const content = await this.getContent(id, this.policies.get(id))
        return { content: { id, title: content.title, cover: content.cover, webUrl: content.webUrl, contentRating: content.contentRating } }
    }
}
