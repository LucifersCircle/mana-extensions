/* SPDX-License-Identifier: GPL-3.0-or-later */
import { CatalogRating,
    Chapter,
    ChapterData,
    ChapterSource,
    Content,
    DeepLinkContext,
    Form,
    Highlight,
    CoverRequestHandler,
    HttpClient,
    HttpMethod,
    ImageRequest,
    PageRequestHandler,
    RequestOrigin,
    PageLink,
    PageLinkResolver,
    PageSection,
    PagedSearchResult,
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
    SourceInfo,
    SourcePreferenceProvider,
    UIListSection,
    UIToggle } from '@mana-app/types'
import { nativeRating } from '../../ContentRatingPolicy'
import { MangaStashApi } from './MangaStashApi'
import { FILTERS,
    Filters,
    searchURL,
    SORTS } from './MangaStashFilters'
import { Card,
    chapterId,
    Detail,
    DOMAIN,
    FEEDS,
    Listing,
    parseDetail,
    parseHome,
    parseListing,
    parseReader,
    readableChapters,
    seriesId,
    url,
    validId } from './MangaStashParser'
import { allowed,
    authorizeImage,
    changeSetting,
    check,
    enter,
    issue,
    known,
    observe,
    Policy,
    requireAllowed } from './MangaStashPolicy'

const TTL = 300000
export class Target implements ChapterSource, PageLinkResolver, CoverRequestHandler, PageRequestHandler, SourcePreferenceProvider {
    readonly info: SourceInfo = { id: 'MangaStash', version: '0.0.1-alpha.5', name: 'MangaStash', thumbnail: 'MangaStash.png', rating: CatalogRating.MIXED, website: DOMAIN,
        description: 'MangaStash native feeds and browse controls. Unlabeled titles use Suggestive only as a compatibility fallback. Some chapter dates are unavailable; their displayed upload ages are not reliable. Covers use the largest URL actually advertised per response.',
        supportedLanguages: ['en_US'], badges: ['Manga', 'Manhwa', 'Manhua'], developers: [{ name: 'Lucifers Circle', github: 'https://github.com/LucifersCircle' }] }
    readonly config = { owningLinks: ['mangastash.org'] }
    private readonly api = new MangaStashApi()
    private readonly cache = new Map<string, { at: number, html: string }>()
    private readonly pending = new Map<string, Promise<string>>()
    private readonly details = new Map<string, { at: number, value: Detail }>()
    async getPreferenceMenu(): Promise<Form> {
        const policy = await enter()
        return { sections: [UIListSection({ header: 'Content safety', footer: 'Off by default. When enabled, only titles explicitly labeled Safe by MangaStash are allowed; unlabeled listings are excluded. Source labels do not guarantee all-ages suitability. Unclassified titles otherwise use a Suggestive compatibility fallback, not a source rating.', children: [UIToggle({ id: 'onlySafe', title: 'Only explicitly Safe titles', value: policy.onlySafe, didChange: async (value) => { await changeSetting(value); this.cache.clear(); this.details.clear() } })] })] }
    }
    async getSortOptions(): Promise<SortOption[]> { return SORTS }
    async getSearchForm(): Promise<SearchForm> {
        return { sections: [SearchListSection({ footer: 'Browse filters and sorts apply only with an empty text query. Text search uses the source’s q-only search.', children: Object.entries(FILTERS).map(([id, group]) => id === 'rating' ? SearchMenuPicker({ id, title: group.title, options: group.options }) : SearchMultiPickerSheet({ id, title: group.title, options: group.options })) }), SearchSortSection({ header: 'Browse sort' })] }
    }
    private async html(target: string, policy: Policy): Promise<string> {
        await check(policy)
        const key = `${policy.revision}:${target}`, old = this.cache.get(key)
        if (old && Date.now() - old.at < TTL) return old.html
        let pending = this.pending.get(key)
        if (!pending) {
            pending = (async () => { const html = await this.api.text(target); await check(policy); this.cache.set(key, { at: Date.now(), html }); while (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value as string); return html })()
            this.pending.set(key, pending)
        }
        try { return await pending } finally { if (this.pending.get(key) === pending) this.pending.delete(key) }
    }
    private async highlights(items: Card[], policy: Policy, context?: SourceContext): Promise<Highlight[]> {
        const rated = await observe(items, policy), visible = rated.filter((item) => allowed(item, policy))
        if (!policy.onlySafe && items.length && !visible.length) throw new Error('MangaStash listings are excluded by the requested content-rating policy; unclassified listings use Suggestive compatibility, not a source rating')
        if (policy.onlySafe && items.length && !visible.length) throw new Error('MangaStash listings have no explicitly Safe metadata allowed by current policy. Turn off Only explicitly Safe titles to include unclassified listings.')
        await issue(visible, policy); await check(policy)
        return visible.map((item) => ({ id: item.id, title: item.title, cover: item.cover, webUrl: `${DOMAIN}/${item.id}/`, contentRating: nativeRating(item.rating), context }))
    }
    private checkHome(link: PageLink): void { if (link.id !== 'home') throw new Error('Unknown MangaStash page') }
    async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
        const policy = await enter(link.context); this.checkHome(link)
        if (policy.allowed?.length === 0) return []
        const feeds = parseHome(await this.html(`${DOMAIN}/`, policy))
        // Remove only complete duplicate ordered feeds from this same response.
        const seen = new Set<string>(), sections: PageSection[] = []
        for (const feed of FEEDS) {
            const signature = JSON.stringify(feeds[feed.id]?.map((item) => item.id))
            if (!seen.has(signature)) sections.push({ ...feed, style: SectionStyle.SimpleSingleRow })
            seen.add(signature)
        }
        await check(policy); return sections
    }
    async resolvePageSection(link: PageLink, sectionId: string): Promise<ResolvedPageSection> {
        const policy = await enter(link.context); this.checkHome(link)
        if (!FEEDS.some((feed) => feed.id === sectionId)) throw new Error('Unknown MangaStash section')
        if (policy.allowed?.length === 0) return { items: [] }
        const feeds = parseHome(await this.html(`${DOMAIN}/`, policy))
        return { items: await this.highlights(feeds[sectionId] ?? [], policy, link.context) }
    }
    async search(request: SearchRequest<Filters>): Promise<PagedSearchResult> {
        // Validate shapes/values before policy storage or HTTP, even under deny-all.
        const target = searchURL(request), policy = await enter(request.context)
        if (request.listId !== undefined && (!FEEDS.some((feed) => feed.id === request.listId) || request.query || request.sort || Object.keys(request.filters ?? {}).length)) throw new Error('Invalid MangaStash home feed request')
        if (policy.allowed?.length === 0) return { results: [], isLastPage: true }
        if (request.listId) {
            if ((request.page ?? 1) !== 1) return { results: [], isLastPage: true }
            const feeds = parseHome(await this.html(`${DOMAIN}/`, policy))
            return { results: await this.highlights(feeds[request.listId] ?? [], policy, request.context), isLastPage: true }
        }
        // Follow only source-advertised continuation with exact normalized scope.
        const desired = request.page ?? 1, first = searchURL({ ...request, page: 1 })
        let listing: Listing = parseListing(await this.html(first, policy), first), current = 1
        while (current < desired) {
            if (!listing.next) return { results: [], isLastPage: true }
            const next = listing.next
            listing = parseListing(await this.html(next, policy), next); current += 1
        }
        void target
        return { results: await this.highlights(listing.items, policy, request.context), isLastPage: !listing.next }
    }
    private async detail(id: string, policy: Policy): Promise<Detail> {
        validId(id)
        if (policy.allowed?.length === 0) throw new Error('MangaStash title is excluded by native content policy')
        const key = `${policy.revision}:${id}`, cached = this.details.get(key)
        let value = cached && Date.now() - cached.at < TTL ? cached.value : undefined
        if (!value) {
            value = parseDetail(await this.html(`${DOMAIN}/${id}/`, policy), id)
            this.details.set(key, { at: Date.now(), value }); while (this.details.size > 32) this.details.delete(this.details.keys().next().value as string)
        }
        const rated = (await observe([value.card], policy, value.chapters))[0]
        requireAllowed(rated, policy)
        if (!rated) throw new Error('MangaStash title classification missing')
        await issue([rated], policy); await check(policy)
        return { ...value, card: rated, content: { ...value.content, contentRating: nativeRating(rated.rating) } }
    }
    async getContent(id: string, context?: SourceContext): Promise<Content> { const policy = await enter(context); return (await this.detail(id, policy)).content }
    async getChapters(id: string): Promise<Chapter[]> { const policy = await enter(); return readableChapters((await this.detail(id, policy)).chapters) }
    async getChapterData(id: string, chapter: string): Promise<ChapterData> {
        validId(id); chapterId(`/${chapter}`, id)
        const policy = await enter()
        if (policy.allowed?.length === 0) throw new Error('MangaStash reader is excluded by native content policy')
        let metadata = await known(id, policy)
        if (!metadata?.chapters) { await this.detail(id, policy); metadata = await known(id, policy) }
        requireAllowed(metadata, policy)
        const selected = metadata?.chapters?.find((item) => item.chapterId === chapter)
        if (selected?.locked) throw new Error('MangaStash chapter is explicitly locked or requires access; no reader request was made')
        if (!selected) throw new Error('MangaStash chapter is not in the complete source inventory')
        const result = parseReader(await this.html(`${DOMAIN}/${chapter}`, policy), id, selected, metadata?.title ?? '')
        await issue([], policy, { id, chapter, urls: result.pages?.map((page) => page.url ?? '') ?? [] }); await check(policy)
        return result
    }
    private imageTransport(image: ImageRequest, origin: RequestOrigin.Cover | RequestOrigin.Page): HttpClient {
        const url = image.url, requestedOrigin = image.origin
        const policies = new Map<string, Policy>()
        return new HttpClient().addRequestInterceptor(async (request, context) => {
            if (requestedOrigin !== origin || context.origin !== origin || request.url !== url || request.method !== HttpMethod.Get) throw new Error('Invalid MangaStash image request')
            const policy = await enter(); await authorizeImage(request.url, policy); await check(policy)
            policies.set(context.requestId, policy)
            request.headers.setAll({ Referer: `${DOMAIN}/`, Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' })
            return request
        }).addResponseInterceptor(async (response, context) => {
            const policy = policies.get(context.requestId)
            policies.delete(context.requestId)
            if (!policy) throw new Error('MangaStash image authorization is missing')
            await authorizeImage(response.request.url, policy); await check(policy)
            return response
        })
    }
    getCoverTransport(request: ImageRequest): HttpClient { return this.imageTransport(request, RequestOrigin.Cover) }
    getPageTransport(request: ImageRequest): HttpClient { return this.imageTransport(request, RequestOrigin.Page) }
    async handleURL(target: string): Promise<DeepLinkContext | null> {
        let id: string, chapter: string | undefined
        try { const parsed = url(target); if (parsed.search) return null; if (/\/chapter-/.test(parsed.pathname)) { id = validId(parsed.pathname.split('/')[1] ?? ''); chapter = chapterId(parsed.href, id) } else id = seriesId(parsed.href) } catch { return null }
        const content = await this.getContent(id)
        if (chapter && !content.chapters?.some((item) => item.chapterId === chapter)) throw new Error('MangaStash deep link chapter does not belong to this title')
        return { content: { id, title: content.title, cover: content.cover, webUrl: content.webUrl, contentRating: content.contentRating } }
    }
}
