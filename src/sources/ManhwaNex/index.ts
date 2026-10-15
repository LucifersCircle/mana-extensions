import {
    CatalogRating,
    Chapter,
    ChapterData,
    Content,
    ContentRating,
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
    SourceContext,
    SourceInfo,
    SourcePreferenceProvider,
    UIListSection,
    UIToggle
} from '@mana-app/types'
import { load } from 'cheerio'
import { nativeRating,
    ratingAllowed } from '../../ContentRatingPolicy'
import { ManhwaNexApi } from './ManhwaNexApi'
import {
    chapterURL,
    DOMAIN,
    HomeCategory,
    Listing,
    parseChapters,
    parseContent,
    parseHomeCategories,
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
type Home = { popular: Series[], latest: Listing, categories: HomeCategory[] }
class ExcludedContentError extends Error {}

export class Target implements ContentSource, PageLinkResolver, ImageRequestHandler, SourcePreferenceProvider {
    readonly info: SourceInfo = {
        id: 'ManhwaNex', version: '0.0.1-alpha.4', name: 'ManhwaNex',
        description: 'ManhwaNex with native discovery, search filters and Mana content-rating policy.',
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
    private readonly pendingMetadata = new Map<string, Promise<void>>()
    private homeCache?: CacheEntry<Home>
    private homePending?: Promise<Home>
    private homeExclude?: boolean
    private homePendingExclude?: boolean
    private readonly issued = new Map<string, string>()
    private issuedLoaded?: Promise<void>
    private saveImages = Promise.resolve()

    async getPreferenceMenu(): Promise<Form> {
        return { sections: [UIListSection({ header: 'Content safety',
            footer: 'Off unless explicitly saved. Mana’s supplied content-rating policy controls search, discovery and details. This optional extra source exclusion requires verified non-adult metadata and applies to chapters and image requests too. Missing rating metadata uses a Mature compatibility fallback, not a site-reported rating. Site labels do not guarantee image content or all-ages suitability.',
            children: [UIToggle({ id: 'excludeNSFW', title: 'Exclude NSFW content', value: await this.excludeNSFW(), didChange: async (value) => {
                this.revision += 1
                await ObjectStore.set(SETTING, value)
                this.listings.clear(); this.metadata.clear(); this.contentCache.clear(); this.pending.clear(); this.pendingContent.clear(); this.pendingMetadata.clear()
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
            if ((request.context?.allowedContentRatings !== undefined && !request.context.allowedContentRatings.some((rating) => rating === ContentRating.MATURE || rating === ContentRating.EXPLICIT))
                || (exclude && request.filters?.adult?.id === '1')) return { results: [], isLastPage: true }
            const page = request.page ?? 1
            if (!Number.isInteger(page) || page < 1 || page > 100) throw new Error('Invalid ManhwaNex page')
            if (request.listId) {
                const home = await this.home(exclude)
                if (['popular', 'latest'].includes(request.listId)) {
                    await this.classifyCards([...home.latest.items, ...home.popular], exclude)
                    if (request.listId === 'popular') return { results: page === 1 ? await this.highlights(home.popular, exclude, request.context) : [], isLastPage: true }
                }
                const category = home.categories.find((item) => item.id === request.listId)
                if (request.listId !== 'latest' && !category) throw new Error('Unknown ManhwaNex home section')
                const listing = category ? await this.page(category.url, page, '.page-item-detail.manga', false, exclude, undefined, request.context)
                    : await this.page(`${DOMAIN}/`, page, '.page-item-detail', false, exclude, home.latest, request.context)
                return { results: await this.highlights(listing.items, exclude, request.context), isLastPage: !listing.next }
            }
            const listing = await this.page(this.searchURL(request, exclude), page, '.c-tabs-item__content', true, exclude, undefined, request.context)
            return { results: await this.highlights(listing.items, exclude, request.context), isLastPage: !listing.next }
        })
    }

    async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
        this.checkHome(link)
        const home = await this.withSettings((exclude) => this.home(exclude))
        return [{ id: 'popular', title: 'Popular Series', style: SectionStyle.SimpleSingleRow },
            { id: 'latest', title: 'Latest Updates', style: SectionStyle.SimpleSingleRow },
            ...home.categories.map(({ id, title }) => ({ id, title, style: SectionStyle.SimpleSingleRow }))]
    }

    async resolvePageSection(link: PageLink, sectionId: string): Promise<ResolvedPageSection> {
        this.checkHome(link)
        const result = await this.search({ page: 1, listId: sectionId, context: link.context })
        return { items: result.results, viewMoreLink: !result.isLastPage ? { request: { page: 1, listId: sectionId, context: link.context } } : undefined }
    }

    async getContent(contentId: string, context?: SourceContext): Promise<Content> {
        return this.withSettings(async (exclude) => {
            if (context?.allowedContentRatings?.length === 0) throw new ExcludedContentError('This title is excluded by Mana’s content-rating policy')
            const result = await this.content(contentId, exclude)
            const metadata = this.fresh(this.metadata.get(`${exclude}:${contentId}`))
            const content = metadata?.explicit ? { ...result, contentRating: ContentRating.EXPLICIT,
                additionalInfo: result.additionalInfo?.filter((section) => section.id !== 'content-rating-metadata') } : result
            if (!ratingAllowed(content.contentRating, context)) throw new ExcludedContentError('This title is excluded by Mana’s content-rating policy')
            return content
        }, (exclude) => this.checkAllowed(contentId, exclude))
    }

    async getChapters(contentId: string): Promise<Chapter[]> {
        return this.withSettings(async (exclude) => {
            await this.requireAllowed(contentId, exclude)
            return parseChapters(await this.api.chapters(contentId), contentId)
        }, (exclude) => this.checkAllowed(contentId, exclude))
    }

    async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
        return this.withSettings(async (exclude) => {
            await this.requireAllowed(contentId, exclude)
            const result = parseReader(await this.api.text(chapterURL(contentId, chapterId)), contentId, chapterId)
            this.checkAllowed(contentId, exclude)
            await this.recordImages((result.pages ?? []).map((page) => ({ url: page.url ?? '', id: contentId })))
            return result
        }, (exclude) => this.checkAllowed(contentId, exclude))
    }

    async handleURL(url: string): Promise<DeepLinkContext | null> {
        let id: string
        try { id = seriesId(url) } catch { return null }
        const content = await this.getContent(id)
        return { content: { id, title: content.title, cover: content.cover, webUrl: content.webUrl, contentRating: content.contentRating } }
    }

    async willRequestImage(url: string): Promise<NetworkRequest> {
        let contentId = ''
        return this.withSettings(async (exclude) => {
            this.checkImage(url)
            await this.loadIssued()
            const id = this.issued.get(url)
            if (!id) throw new Error('ManhwaNex image was not issued by this source; refresh the title or reader')
            contentId = id
            await this.requireAllowed(id, exclude)
            return { url, headers: { Referer: `${DOMAIN}/`, Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5' } }
        }, (exclude) => this.checkAllowed(contentId, exclude))
    }

    private checkHome(link: PageLink): void { if (link.id !== 'home') throw new Error('Unknown ManhwaNex page') }
    private async excludeNSFW(): Promise<boolean> { return (await ObjectStore.boolean(SETTING)) === true }
    private async withSettings<T>(operation: (exclude: boolean) => Promise<T>, validate?: (exclude: boolean) => void): Promise<T> {
        const revision = this.revision, exclude = await this.excludeNSFW()
        if (revision !== this.revision) throw new Error('ManhwaNex settings changed during this request; refresh to continue')
        const result = await operation(exclude)
        if (revision !== this.revision || exclude !== await this.excludeNSFW()) throw new Error('ManhwaNex settings changed during this request; refresh to continue')
        validate?.(exclude)
        return result
    }
    private fresh<T>(entry?: CacheEntry<T>): T | undefined { return entry && Date.now() - entry.at < TTL ? entry.value : undefined }
    private put<T>(map: Map<string, CacheEntry<T>>, key: string, value: T, limit = 128): void {
        map.delete(key); map.set(key, { at: Date.now(), value })
        while (map.size > limit) map.delete(map.keys().next().value as string)
    }
    private cacheMetadata(item: Series, exclude: boolean): void {
        const key = `${exclude}:${item.id}`, entry = this.metadata.get(key), prior = this.fresh(entry)
        const explicit = item.explicit || prior?.explicit === true
        this.put(this.metadata, key, explicit ? { ...item, explicit, contentRating: ContentRating.EXPLICIT } : item, 512)
        // No cache reuse, safe batch or repeated warning extends live evidence.
        const updated = this.metadata.get(key)
        if (prior?.explicit && entry && updated) updated.at = entry.at
        if (explicit) this.contentCache.delete(key)
    }
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

    private async page(firstURL: string, requestedPage: number, selector: string, isSearch: boolean, exclude: boolean, suppliedFirst?: Listing, context?: SourceContext): Promise<Listing> {
        let raw = suppliedFirst ?? await this.listing(firstURL, selector, isSearch, exclude), logicalPage = 1
        const seen = new Set<string>()
        for (let sourcePage = 1; sourcePage <= 100; sourcePage += 1) {
            const fresh = raw.items.filter((item) => !seen.has(item.id))
            for (const item of raw.items) seen.add(item.id)
            if (!isSearch) await this.classifyCards(fresh, exclude, raw.items)
            else for (const item of raw.items) if (item.explicit) this.cardMetadata(item, exclude)
            const items = fresh.filter((item) => {
                const metadata = this.cardMetadata(item, exclude)
                return (!exclude || this.allowed(metadata)) && ratingAllowed(metadata.contentRating, context)
            })
            // Mana stops on empty results, even with isLastPage=false. Reconstruct
            // stable logical pages from cached native pages and skip empty overlap
            // or exclusion pages without consuming a logical page number.
            if (items.length) {
                if (logicalPage === requestedPage) return { items, next: raw.next }
                logicalPage += 1
            }
            if (!raw.next) return { items: [] }
            if (sourcePage === 100) throw new Error('ManhwaNex listing traversal exceeded its verified bounds')
            raw = await this.listing(raw.next, selector, isSearch, exclude)
        }
        throw new Error('ManhwaNex listing traversal exceeded its verified bounds')
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
            if (revision !== this.revision) throw new Error('ManhwaNex settings changed; refresh to continue')
            const value = { popular, latest, categories: parseHomeCategories($) }; this.homeExclude = exclude; this.homeCache = { at: Date.now(), value }; return value
        })()
        this.homePending = request; this.homePendingExclude = exclude
        try { return await request } finally { if (this.homePending === request) this.homePending = undefined }
    }

    private async classifyCards(items: Series[], exclude: boolean, observed = items): Promise<void> {
        const missing = items.filter((item) => !this.fresh(this.metadata.get(`${exclude}:${item.id}`)))
        // Record all observed warnings before an unrelated metadata await, including
        // duplicate cards. Compute missing IDs first so new warnings still get full metadata.
        for (const item of observed) if (item.explicit) this.cardMetadata(item, exclude)
        if (!missing.length) return
        // Home and archive cards have no taxonomy. One exact-ID native search-card
        // batch supplies a requested page without reordering it or N+1 detail loads.
        const ids = [...new Set(missing.map((item) => item.id))]
        const key = `${exclude}:${[...ids].sort().join(',')}`, pending = this.pendingMetadata.get(key)
        if (pending) return pending
        const revision = this.revision, expected = new Set(ids)
        const request = (async () => {
            const metadata = await this.api.metadata(ids, exclude)
            if (revision !== this.revision) throw new Error('ManhwaNex settings changed; refresh to continue')
            if (metadata.some((item) => !expected.has(item.id))) throw new Error('ManhwaNex metadata batch returned a foreign series')
            for (const item of metadata) this.cacheMetadata(item, exclude)
        })()
        this.pendingMetadata.set(key, request)
        try { await request } finally { if (this.pendingMetadata.get(key) === request) this.pendingMetadata.delete(key) }
    }

    private cardMetadata(item: Series, exclude: boolean): Series {
        const cached = this.fresh(this.metadata.get(`${exclude}:${item.id}`)), base = cached ?? item
        // Non-adult bulk membership cannot erase an adult marker or blocked
        // genre on the current native card. Preserve the complete bulk metadata.
        const explicit = base.explicit || item.explicit
        const metadata = { ...base, explicit, contentRating: explicit ? ContentRating.EXPLICIT : base.contentRating }
        if (item.explicit && !cached?.explicit) this.cacheMetadata(metadata, exclude)
        return metadata
    }

    private async highlights(items: Series[], exclude: boolean, context?: SourceContext): Promise<Highlight[]> {
        const results = items.flatMap((item): Highlight[] => {
            const metadata = this.cardMetadata(item, exclude)
            if ((exclude && !this.allowed(metadata)) || !ratingAllowed(metadata.contentRating, context)) return []
            return [{ id: item.id, title: item.title, cover: item.cover, webUrl: item.webUrl, subtitle: item.subtitle, contentRating: nativeRating(metadata.contentRating), context }]
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
        if (this.fresh(this.metadata.get(key))?.explicit) {
            result.metadata = { ...result.metadata, explicit: true, contentRating: ContentRating.EXPLICIT }
            result.content = { ...result.content, contentRating: ContentRating.EXPLICIT }
        }
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

    private checkAllowed(id: string, exclude: boolean): void {
        if (exclude && !this.allowed(this.fresh(this.metadata.get(`true:${id}`)))) throw new ExcludedContentError('This title is excluded or its current source classification could not be verified')
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
