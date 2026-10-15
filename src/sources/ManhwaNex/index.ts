import {
    CatalogRating,
    Chapter,
    ChapterData,
    Content,
    ContentSource,
    DeepLinkContext,
    Form,
    Highlight,
    ImageRequestHandler,
    NetworkRequest,
    Option,
    PagedSearchResult,
    PageLink,
    PageLinkResolver,
    PageSection,
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
    SourceInfo,
    SourcePreferenceProvider,
    UIListSection,
    UIToggle
} from '@mana-app/types'
import { load } from 'cheerio'
import { ManhwaNexApi } from './ManhwaNexApi'
import {
    chapterURL,
    DOMAIN,
    Listing,
    parseChapters,
    parseContent,
    parseListing,
    parseReader,
    Series,
    seriesId,
    seriesURL,
    text,
    validId,
    VERIFIED_GENRES
} from './ManhwaNexParser'

const SETTING = 'ManhwaNex.excludeNSFW'
const IMAGE_STORE = 'ManhwaNex.issuedImages'
const TTL = 300_000
const GENRES = VERIFIED_GENRES
const STATUSES = new Set(['on-going', 'end', 'canceled', 'on-hold', 'upcoming'])
const SORTS: SortOption[] = [{ id: 'relevance', title: 'Relevance', isDefault: true }]
type Filters = { genres?: Option[], condition?: Option, author?: string, artist?: string, release?: string, status?: Option[], adult?: Option }
type CacheEntry<T> = { at: number, value: T }
type Home = { popular: Series[], latest: Listing }
class ExcludedContentError extends Error {}

export class Target implements ContentSource, PageLinkResolver, ImageRequestHandler, SourcePreferenceProvider {
    readonly info: SourceInfo = {
        id: 'ManhwaNex', version: '0.0.1-alpha.2', name: 'ManhwaNex',
        description: 'ManhwaNex with native Popular Series, Latest Updates, search filters and persistent NSFW exclusion.',
        thumbnail: 'ManhwaNex.png', rating: CatalogRating.MIXED, website: DOMAIN,
        badges: ['Manhwa', 'Manhua', 'Manga'], supportedLanguages: ['en_US'],
        developers: [{ name: 'Lucifers Circle', github: 'https://github.com/LucifersCircle' }]
    }
    readonly config = { cloudflareResolutionURL: DOMAIN, owningLinks: ['manhwanex.com'] }
    private readonly api = new ManhwaNexApi()
    private revision = 0
    private readonly listings = new Map<string, CacheEntry<Listing>>()
    private readonly metadata = new Map<string, CacheEntry<Series>>()
    private readonly contentCache = new Map<string, CacheEntry<Content>>()
    private readonly pending = new Map<string, Promise<Listing>>()
    private readonly pendingContent = new Map<string, Promise<Content>>()
    private homeCache?: CacheEntry<Home>
    private homePending?: Promise<Home>
    private homeExclude?: boolean
    private homePendingExclude?: boolean
    private readonly issued = new Map<string, string>()
    private issuedLoaded?: Promise<void>
    private saveImages = Promise.resolve()

    async getPreferenceMenu(): Promise<Form> {
        return { sections: [UIListSection({ header: 'Content safety',
            footer: 'On by default. Requires the site’s non-adult classification and real genres; excludes Adult, Mature, Smut, Hentai, Erotica and Ecchi tags. Unverifiable titles are hidden. Site labels may be incomplete and do not guarantee image content or all-ages suitability. Applies to discovery, search, details, chapters and image requests. The conservative Mature app badge is separate from adult exclusion.',
            children: [UIToggle({ id: 'excludeNSFW', title: 'Exclude NSFW content', value: await this.excludeNSFW(), didChange: async (value) => {
                this.revision += 1
                await ObjectStore.set(SETTING, value)
                this.listings.clear(); this.metadata.clear(); this.contentCache.clear(); this.pending.clear(); this.pendingContent.clear()
                this.homeCache = undefined; this.homePending = undefined
            } })] })] }
    }

    async getSortOptions(): Promise<SortOption[]> { return SORTS }

    async getSearchForm(): Promise<SearchForm> {
        return this.withSettings(async (exclude) => {
            const $ = load(await this.api.text(this.searchURL({ page: 1 }, exclude)))
            const options = (name: string): Option[] => $(`.search-advanced-form input[name="${name}"]`).toArray().map((node) => ({
                id: $(node).attr('value') ?? '', title: text($(node).parent().find('label').text())
            })).filter((option) => option.id && option.title)
            const genres = options('genre[]'), statuses = options('status[]')
            if (genres.length !== GENRES.size || genres.some((item) => !GENRES.has(item.id))
                || statuses.length !== STATUSES.size || statuses.some((item) => !STATUSES.has(item.id))) throw new Error('ManhwaNex search taxonomy changed')
            return { sections: [SearchListSection({ children: [
                SearchMultiPickerSheet({ id: 'genres', title: 'Genres', options: genres }),
                SearchMenuPicker({ id: 'condition', title: 'Genres condition', options: [{ id: 'or', title: 'OR (any selected genre)' }, { id: 'and', title: 'AND (all selected genres)' }] }),
                SearchTextField({ id: 'author', title: 'Author' }), SearchTextField({ id: 'artist', title: 'Artist' }),
                SearchTextField({ id: 'release', title: 'Year of Released', placeholder: 'Year' }),
                SearchMultiPickerSheet({ id: 'status', title: 'Status', options: statuses }),
                SearchMenuPicker({ id: 'adult', title: 'Adult content', options: exclude ? [{ id: '0', title: 'None adult content (global setting)' }]
                    : [{ id: 'all', title: 'All' }, { id: '0', title: 'None adult content' }, { id: '1', title: 'Only adult content' }] })
            ] }), SearchSortSection({ header: 'Order by' })] }
        })
    }

    async search(request: SearchRequest<Filters>): Promise<PagedSearchResult> {
        return this.withSettings(async (exclude) => {
            if (exclude && request.filters?.adult?.id === '1') return { results: [], isLastPage: true }
            const page = request.page ?? 1
            if (!Number.isInteger(page) || page < 1 || page > 100) throw new Error('Invalid ManhwaNex page')
            if (request.listId) {
                if (!['popular', 'latest'].includes(request.listId)) throw new Error('Unknown ManhwaNex home section')
                const home = await this.home(exclude)
                if (request.listId === 'popular') return { results: page === 1 ? await this.highlights(home.popular, exclude) : [], isLastPage: true }
                const listing = page === 1 ? home.latest : await this.page(`${DOMAIN}/`, page, '.page-item-detail', false, exclude, home.latest)
                await this.classifyHome(listing.items, exclude)
                return { results: await this.highlights(listing.items, exclude), isLastPage: !listing.next }
            }
            const listing = await this.page(this.searchURL(request, exclude), page, '.c-tabs-item__content', true, exclude)
            return { results: await this.highlights(listing.items, exclude), isLastPage: !listing.next }
        })
    }

    async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
        this.checkHome(link)
        await this.withSettings((exclude) => this.home(exclude))
        return [{ id: 'popular', title: 'Popular Series', style: SectionStyle.SimpleSingleRow },
            { id: 'latest', title: 'Latest Updates', style: SectionStyle.SimpleSingleRow }]
    }

    async resolvePageSection(link: PageLink, sectionId: string): Promise<ResolvedPageSection> {
        this.checkHome(link)
        const result = await this.search({ page: 1, listId: sectionId })
        return { items: result.results, viewMoreLink: sectionId === 'latest' && !result.isLastPage ? { request: { page: 1, listId: sectionId } } : undefined }
    }

    async getContent(contentId: string): Promise<Content> { return this.withSettings((exclude) => this.content(contentId, exclude)) }

    async getChapters(contentId: string): Promise<Chapter[]> {
        return this.withSettings(async (exclude) => {
            await this.requireAllowed(contentId, exclude)
            return parseChapters(await this.api.chapters(contentId), contentId)
        })
    }

    async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
        return this.withSettings(async (exclude) => {
            await this.requireAllowed(contentId, exclude)
            const result = parseReader(await this.api.text(chapterURL(contentId, chapterId)), contentId, chapterId)
            await this.recordImages((result.pages ?? []).map((page) => ({ url: page.url ?? '', id: contentId })))
            return result
        })
    }

    async handleURL(url: string): Promise<DeepLinkContext | null> {
        let id: string
        try { id = seriesId(url) } catch { return null }
        const content = await this.getContent(id)
        return { content: { id, title: content.title, cover: content.cover, webUrl: content.webUrl, contentRating: content.contentRating } }
    }

    async willRequestImage(url: string): Promise<NetworkRequest> {
        return this.withSettings(async (exclude) => {
            this.checkImage(url)
            await this.loadIssued()
            const id = this.issued.get(url)
            if (!id) throw new Error('ManhwaNex image was not issued by this source; refresh the title or reader')
            await this.requireAllowed(id, exclude)
            return { url, headers: { Referer: `${DOMAIN}/`, Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5' } }
        })
    }

    private checkHome(link: PageLink): void { if (link.id !== 'home') throw new Error('Unknown ManhwaNex page') }
    private async excludeNSFW(): Promise<boolean> { return (await ObjectStore.boolean(SETTING)) !== false }
    private async withSettings<T>(operation: (exclude: boolean) => Promise<T>): Promise<T> {
        const revision = this.revision, exclude = await this.excludeNSFW()
        if (revision !== this.revision) throw new Error('ManhwaNex settings changed during this request; refresh to continue')
        const result = await operation(exclude)
        if (revision !== this.revision || exclude !== await this.excludeNSFW()) throw new Error('ManhwaNex settings changed during this request; refresh to continue')
        return result
    }
    private fresh<T>(entry?: CacheEntry<T>): T | undefined { return entry && Date.now() - entry.at < TTL ? entry.value : undefined }
    private put<T>(map: Map<string, CacheEntry<T>>, key: string, value: T, limit = 128): void {
        map.delete(key); map.set(key, { at: Date.now(), value })
        while (map.size > limit) map.delete(map.keys().next().value as string)
    }
    private cacheMetadata(item: Series, exclude: boolean): void { this.put(this.metadata, `${exclude}:${item.id}`, item, 512) }
    private allowed(item?: Series): boolean { return Boolean(item?.classified && !item.explicit) }

    private searchURL(request: SearchRequest<Filters>, exclude: boolean): string {
        if (request.sort && request.sort.id !== 'relevance') throw new Error('Unknown ManhwaNex sort')
        const params = new URLSearchParams({ s: request.query?.trim() ?? '', post_type: 'wp-manga' }), filters = request.filters
        for (const genre of filters?.genres ?? []) { if (!GENRES.has(genre.id)) throw new Error('Unknown ManhwaNex genre'); params.append('genre[]', genre.id) }
        if (filters?.condition && !['or', 'and'].includes(filters.condition.id)) throw new Error('Unknown ManhwaNex genre condition')
        if (filters?.condition?.id === 'and') params.set('op', '1')
        for (const key of ['author', 'artist', 'release'] as const) if (filters?.[key]?.trim()) params.set(key, filters[key]?.trim() ?? '')
        for (const value of filters?.status ?? []) { if (!STATUSES.has(value.id)) throw new Error('Unknown ManhwaNex status'); params.append('status[]', value.id) }
        if (filters?.adult && !['all', '0', '1'].includes(filters.adult.id)) throw new Error('Unknown ManhwaNex adult filter')
        if (exclude) params.set('adult', '0')
        else if (filters?.adult && filters.adult.id !== 'all') params.set('adult', filters.adult.id)
        return `${DOMAIN}/?${params.toString()}`
    }

    private async listing(url: string, selector: string, isSearch: boolean, exclude: boolean): Promise<Listing> {
        const key = `${exclude}:${url}`, cached = this.fresh(this.listings.get(key))
        if (cached) return cached
        const pending = this.pending.get(key)
        if (pending) return pending
        const revision = this.revision
        const request = (async () => {
            const html = await this.api.text(url), $ = load(html)
            if (isSearch && !$('.search-advanced-form').length) throw new Error('ManhwaNex search page is incomplete')
            const result = parseListing(html, selector, url)
            if (!result.items.length && !(isSearch && /^No matches found\./i.test(text($('.no-results .not-found-content').text())))) throw new Error('ManhwaNex listing is empty without a verified empty state')
            if (revision !== this.revision) throw new Error('ManhwaNex settings changed; refresh to continue')
            this.put(this.listings, key, result)
            if (isSearch) for (const item of result.items) this.cacheMetadata(item, exclude)
            return result
        })()
        this.pending.set(key, request)
        try { return await request } finally { if (this.pending.get(key) === request) this.pending.delete(key) }
    }

    private async page(firstURL: string, requestedPage: number, selector: string, isSearch: boolean, exclude: boolean, suppliedFirst?: Listing): Promise<Listing> {
        let result = suppliedFirst ?? await this.listing(firstURL, selector, isSearch, exclude)
        const seen = new Set(result.items.map((item) => item.id))
        for (let page = 2; page <= requestedPage; page += 1) {
            if (!result.next) return { items: [] }
            result = await this.listing(result.next, selector, isSearch, exclude)
            if (result.items.some((item) => seen.has(item.id))) throw new Error('ManhwaNex continuation repeated an earlier series')
            for (const item of result.items) seen.add(item.id)
        }
        return result
    }

    private async home(exclude: boolean): Promise<Home> {
        const cached = this.homeExclude === exclude ? this.fresh(this.homeCache) : undefined
        if (cached) return cached
        if (this.homePending && this.homePendingExclude === exclude) return this.homePending
        const revision = this.revision
        const request = (async () => {
            const html = await this.api.text(`${DOMAIN}/`), $ = load(html)
            if (text($('.widget-manga-popular-slider .heading').text()) !== 'Popular Series'
                || !$('h1,h2').toArray().some((node) => text($(node).text()) === 'Latest Updates')) throw new Error('ManhwaNex home sections changed')
            const popular = parseListing(html, '.widget-manga-popular-slider .slider__item').items
            const latest = parseListing(html, '.page-item-detail', `${DOMAIN}/`)
            if (!popular.length || !latest.items.length) throw new Error('ManhwaNex homepage is incomplete')
            await this.classifyHome([...latest.items, ...popular], exclude)
            if (revision !== this.revision) throw new Error('ManhwaNex settings changed; refresh to continue')
            const value = { popular, latest }; this.homeExclude = exclude; this.homeCache = { at: Date.now(), value }; return value
        })()
        this.homePending = request; this.homePendingExclude = exclude
        try { return await request } finally { if (this.homePending === request) this.homePending = undefined }
    }

    private async classifyHome(items: Series[], exclude: boolean): Promise<void> {
        const missing = items.filter((item) => !this.fresh(this.metadata.get(`${exclude}:${item.id}`)))
        if (!missing.length) return
        // Home cards have no taxonomy. One exact-ID native search-card batch supplies
        // all sections' metadata without reordering the homepage or N+1 detail loads.
        const ids = [...new Set(missing.map((item) => item.id))]
        const revision = this.revision, expected = new Set(missing.map((item) => item.id))
        const metadata = await this.api.metadata(ids, exclude)
        if (revision !== this.revision) throw new Error('ManhwaNex settings changed; refresh to continue')
        if (metadata.some((item) => !expected.has(item.id))) throw new Error('ManhwaNex metadata batch returned a foreign series')
        for (const item of metadata) this.cacheMetadata(item, exclude)
    }

    private async highlights(items: Series[], exclude: boolean): Promise<Highlight[]> {
        const results = items.flatMap((item): Highlight[] => {
            const metadata = this.fresh(this.metadata.get(`${exclude}:${item.id}`)) ?? item
            if (exclude && !this.allowed(metadata)) return []
            return [{ id: item.id, title: item.title, cover: item.cover, webUrl: item.webUrl, subtitle: item.subtitle, contentRating: metadata.contentRating }]
        })
        await this.recordImages(results.map((item) => ({ url: item.cover, id: item.id })))
        return results
    }

    private async content(id: string, exclude: boolean): Promise<Content> {
        validId(id)
        const key = `${exclude}:${id}`, pending = this.pendingContent.get(key)
        if (pending) return pending
        const request = this.loadContent(id, exclude)
        this.pendingContent.set(key, request)
        try { return await request } finally { if (this.pendingContent.get(key) === request) this.pendingContent.delete(key) }
    }

    private async loadContent(id: string, exclude: boolean): Promise<Content> {
        validId(id)
        const key = `${exclude}:${id}`, cached = this.fresh(this.contentCache.get(key))
        if (cached) { await this.recordImages([{ url: cached.cover, id }]); return cached }
        const revision = this.revision
        const html = await this.api.text(seriesURL(id))
        let result = parseContent(html, id, this.fresh(this.metadata.get(key)))
        if (exclude && !this.fresh(this.metadata.get(key))) {
            const bulk = await this.api.metadata([id], true)
            if (bulk.some((item) => item.id !== id)) throw new Error('ManhwaNex metadata returned a different series')
            if (!bulk.length || !this.allowed(bulk[0])) throw new ExcludedContentError('This title is excluded or its source classification could not be verified')
            if (revision !== this.revision) throw new Error('ManhwaNex settings changed; refresh to continue')
            this.cacheMetadata(bulk[0] as Series, true)
            result = parseContent(html, id, bulk[0])
        }
        if (exclude && (!this.allowed(result.metadata) || !this.allowed(this.fresh(this.metadata.get(key))))) throw new ExcludedContentError('This title is excluded by the NSFW setting or its classification could not be verified')
        if (revision !== this.revision) throw new Error('ManhwaNex settings changed; refresh to continue')
        this.cacheMetadata(result.metadata, exclude); this.put(this.contentCache, key, result.content)
        await this.recordImages([{ url: result.content.cover, id }]); return result.content
    }

    private async requireAllowed(id: string, exclude: boolean): Promise<void> {
        validId(id)
        if (!exclude) return
        if (this.allowed(this.fresh(this.metadata.get(`true:${id}`)))) return
        await this.content(id, true)
    }

    private checkImage(value: string): void {
        const url = new URL(value)
        if (/%(?:2f|5c|00|25)/i.test(value) || /\\/.test(value) || url.protocol !== 'https:' || url.username || url.password || url.hash || url.port || url.search
            || !['manhwanex.com', 'cdn.manhwanex.com'].includes(url.hostname)
            || !(url.hostname === 'cdn.manhwanex.com' ? /^\/manga_[a-z0-9]+\//i.test(url.pathname) : url.pathname.startsWith('/wp-content/uploads/'))) throw new Error('Unsupported ManhwaNex image URL')
    }
    private async loadIssued(): Promise<void> {
        if (!this.issuedLoaded) this.issuedLoaded = (async () => {
            const stored = await ObjectStore.get(IMAGE_STORE)
            if (!Array.isArray(stored)) return
            for (const entry of stored.slice(-8192)) {
                if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') continue
                try { this.checkImage(entry[0]); validId(entry[1]); this.issued.set(entry[0], entry[1]) } catch { /* Discard invalid persisted entries. */ }
            }
        })()
        return this.issuedLoaded
    }
    private async recordImages(images: Array<{ url: string, id: string }>): Promise<void> {
        await this.loadIssued()
        for (const { url, id } of images) { this.checkImage(url); validId(id); this.issued.delete(url); this.issued.set(url, id) }
        while (this.issued.size > 8192) this.issued.delete(this.issued.keys().next().value as string)
        this.saveImages = this.saveImages.then(() => ObjectStore.set(IMAGE_STORE, [...this.issued]))
        await this.saveImages
    }
}
