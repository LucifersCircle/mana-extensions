/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright 2024 Paperback Community; Mana adaptation © 2026 Lucifers Circle. */
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
    SearchListSection,
    SearchExcludableMultiPickerSheet,
    SearchRequest,
    SectionStyle,
    SourceContext,
    SourceInfo } from '@mana-app/types'
import { assertRatingPolicy,
    ratingAllowed } from '../../ContentRatingPolicy'
import { Api,
    imageClient } from './Api'
import { chapters,
    chapterURL,
    detail,
    DOMAIN,
    genreOptions,
    imageURL,
    listing,
    reader,
    selectedGenres,
    seriesURL,
    slug } from './Parser'
export class Target implements ChapterSource, PageLinkResolver, CoverRequestHandler, PageRequestHandler {
    readonly info: SourceInfo = { id: 'GenzToons', name: 'GenzToons', version: '0.0.1-alpha.4', website: DOMAIN, thumbnail: 'GenzToons.png', rating: CatalogRating.MIXED,
        description: 'Genz Toons public comics, adapted from nicartjay and keiyoushi. Novels and paid chapters are excluded. Unclassified titles use a Suggestive compatibility fallback, not a verified age rating. Relative or missing dates are unknown. Draft: image MIME compatibility is unverified.',
        supportedLanguages: ['en_US'], badges: ['Manga', 'Manhwa', 'Manhua'], developers: [{ name: 'Lucifers Circle', github: 'https://github.com/LucifersCircle' }, { name: 'nicartjay', github: 'https://github.com/Nicartjay' }, { name: 'keiyoushi', github: 'https://github.com/keiyoushi' }] }
    readonly config = { owningLinks: ['genztoons.org'] }
    private readonly api = new Api()
    private readonly coverClient = imageClient(RequestOrigin.Cover)
    private readonly pageClient = imageClient(RequestOrigin.Page)
    private readonly documents = new Map<string, { at: number, html: string }>()
    private readonly contexts = new Map<string, SourceContext | undefined>()
    private readonly epochs = new Map<string, number>()
    private readonly policyRevisions = new Map<string, number>()
    private nextEpoch = 0
    private readonly covers = new Set<string>()
    private readonly pages = new Map<string, { id: string, epoch: number }>()
    private async document(url: string, refresh = false): Promise<string> {
        const cached = this.documents.get(url)
        if (!refresh && cached && Date.now() - cached.at < 120000) return cached.html
        this.documents.delete(url)
        const html = await this.api.text(url)
        this.documents.set(url, { at: Date.now(), html })
        while (this.documents.size > 24) this.documents.delete(this.documents.keys().next().value as string)
        return html
    }
    private issue(urls: string[], target: Set<string>): void {
        urls.forEach(url => target.add(url))
        while (target.size > 3000) target.delete(target.values().next().value as string)
    }
    async getSearchForm(): Promise<SearchForm> {
        return { sections: [SearchListSection({ children: [SearchExcludableMultiPickerSheet({ id: 'genres', title: 'Genres', options: genreOptions(await this.document(DOMAIN + '/series')) })] })] }
    }
    async search(request: SearchRequest): Promise<PagedSearchResult> {
        assertRatingPolicy(request.context)
        const page = request.page ?? 1, query = request.query ?? '', genres = selectedGenres(request.filters)
        if (!Number.isSafeInteger(page) || page < 1 || typeof query !== 'string' || query.length > 500 || request.listId || request.sort) throw new Error('Invalid GenzToons search')
        if (page > 1 || request.context?.allowedContentRatings?.length === 0) return { results: [], isLastPage: true }
        const items = listing(await this.document(DOMAIN + '/series'), genres).filter(value => value.title.toLowerCase().includes(query.trim().toLowerCase()) && ratingAllowed(value.contentRating, request.context))
        this.issue(items.map(value => value.cover), this.covers)
        return { results: items.map(value => ({ ...value, context: request.context })), isLastPage: true }
    }
    async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
        assertRatingPolicy(link.context)
        if (link.id !== 'home') throw new Error('Unknown GenzToons page')
        return [{ id: 'catalog', title: 'Comics', style: SectionStyle.SimpleSingleRow }]
    }
    async resolvePageSection(link: PageLink, sectionId: string): Promise<ResolvedPageSection> {
        if (link.id !== 'home' || sectionId !== 'catalog') throw new Error('Unknown GenzToons section')
        return { items: (await this.search({ page: 1, context: link.context })).results }
    }
    async getContent(id: string, context?: SourceContext): Promise<Content> {
        slug(id); assertRatingPolicy(context)
        const policy = context ? { ...context, ...(context.allowedContentRatings ? { allowedContentRatings: [...context.allowedContentRatings] } : {}) } : undefined
        const samePolicy = this.contexts.has(id) && this.policyRevisions.has(id) && JSON.stringify(this.contexts.get(id)?.allowedContentRatings?.slice().sort()) === JSON.stringify(policy?.allowedContentRatings?.slice().sort())
        const epoch = ++this.nextEpoch
        this.epochs.set(id, epoch)
        if (!samePolicy) {
            this.contexts.delete(id)
            this.policyRevisions.set(id, epoch)
            while (this.policyRevisions.size > 128) this.policyRevisions.delete(this.policyRevisions.keys().next().value as string)
        }
        while (this.epochs.size > 128) this.epochs.delete(this.epochs.keys().next().value as string)
        if (context?.allowedContentRatings?.length === 0) throw new Error('GenzToons title is excluded by content policy')
        const content = detail(await this.document(seriesURL(id)), id)
        if (this.epochs.get(id) !== epoch) throw new Error('GenzToons content policy changed while loading')
        if (!ratingAllowed(content.contentRating, policy)) { this.contexts.delete(id); throw new Error('GenzToons title is excluded by content policy') }
        this.contexts.set(id, policy)
        while (this.contexts.size > 128) this.contexts.delete(this.contexts.keys().next().value as string)
        this.issue([content.cover], this.covers)
        return content
    }
    private requireContext(id: string, epoch?: number): number {
        slug(id)
        const current = this.policyRevisions.get(id)
        if (!this.contexts.has(id) || current === undefined || (epoch !== undefined && current !== epoch)) throw new Error('Open GenzToons details to establish content policy before reading')
        return current
    }
    async getChapters(id: string): Promise<Chapter[]> {
        const epoch = this.requireContext(id)
        const html = await this.document(seriesURL(id), true), content = detail(html, id)
        this.requireContext(id, epoch)
        if (!ratingAllowed(content.contentRating, this.contexts.get(id))) throw new Error('GenzToons title is excluded by content policy')
        return chapters(html, id)
    }
    async getChapterData(id: string, chapterId: string, chapter?: Chapter): Promise<ChapterData> {
        const epoch = this.requireContext(id); chapterURL(chapterId)
        const html = await this.document(seriesURL(id)), content = detail(html, id)
        this.requireContext(id, epoch)
        if (!ratingAllowed(content.contentRating, this.contexts.get(id))) throw new Error('GenzToons title is excluded by content policy')
        const selected = chapters(html, id).find(value => value.chapterId === chapterId)
        if (!selected || (chapter && (chapter.chapterId !== chapterId || chapter.number !== selected.number || (chapter.webUrl && chapter.webUrl !== selected.webUrl)))) throw new Error('GenzToons chapter is absent, paid or mismatched')
        const result = reader(await this.document(chapterURL(chapterId), true), id, selected)
        this.requireContext(id, epoch)
        for (const page of result.pages ?? []) if (page.url) this.pages.set(page.url, { id, epoch })
        while (this.pages.size > 3000) this.pages.delete(this.pages.keys().next().value as string)
        return result
    }
    getCoverTransport(request: ImageRequest): HttpClient {
        if (request.origin !== RequestOrigin.Cover || !this.covers.has(request.url)) throw new Error('Unissued GenzToons cover or invalid origin')
        imageURL(request.url, true); return this.coverClient
    }
    getPageTransport(request: ImageRequest): HttpClient {
        const grant = this.pages.get(request.url)
        if (request.origin !== RequestOrigin.Page || !grant) throw new Error('Unissued GenzToons page or invalid origin')
        this.requireContext(grant.id, grant.epoch)
        imageURL(request.url); return this.pageClient
    }
    async handleURL(value: string): Promise<DeepLinkContext | null> {
        const match = value.match(/^https:\/\/genztoons\.org\/series\/([a-z0-9-]+)\/$/)
        if (!match?.[1]) return null
        const id = slug(match[1]), content = await this.getContent(id, this.contexts.get(id))
        return { content: { id, title: content.title, cover: content.cover, webUrl: content.webUrl, contentRating: content.contentRating } }
    }
}
