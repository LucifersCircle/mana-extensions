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
import { MangaSushiApi } from './MangaSushiApi'
import { englishTitle,
    searchTitle } from './MangaSushiTitles'
import {
    DOMAIN,
    Listing,
    parseChapters,
    parseContent,
    parseListing,
    parseReader,
    Series,
    seriesId,
    seriesURL,
    text
} from './MangaSushiParser'

const SETTING = 'MangaSushi.excludeNSFW'
const EDITORIAL_IDS = new Set(['mangasushi-donations', 'we-need-more-translators'])
const SORTS: SortOption[] = [
    { id: 'relevance', title: 'Relevance', isDefault: true },
    { id: 'latest', title: 'Latest' },
    { id: 'alphabet', title: 'A–Z' },
    { id: 'rating', title: 'Rating' },
    { id: 'trending', title: 'Trending' },
    { id: 'views', title: 'Most Views' },
    { id: 'new-manga', title: 'New' }
]
type Filters = { genres?: Option[], condition?: Option, author?: string, artist?: string, release?: string, status?: Option[], adult?: Option }
type CacheEntry<T> = { at: number, value: T }
class ExcludedContentError extends Error {}

export class Target implements ContentSource, PageLinkResolver, ImageRequestHandler, SourcePreferenceProvider {
    readonly info: SourceInfo = {
        id: 'MangaSushi',
        version: '0.0.1-alpha.4',
        name: 'MangaSushi',
        description: 'MangaSushi with the site’s discovery, search filters, and a global NSFW exclusion setting.',
        thumbnail: 'MangaSushi.png',
        rating: CatalogRating.MIXED,
        website: DOMAIN,
        badges: ['Manga'],
        supportedLanguages: ['en_US'],
        developers: [{ name: 'LucifersCircle', github: 'https://github.com/LucifersCircle' }]
    }
    readonly config = { cloudflareResolutionURL: DOMAIN, owningLinks: ['mangasushi.org'] }
    private readonly api = new MangaSushiApi()
    private readonly listings = new Map<string, CacheEntry<Listing>>()
    private settingsRevision = 0
    private readonly metadata = new Map<string, CacheEntry<Series>>()
    private readonly pendingListings = new Map<string, Promise<Listing>>()
    private readonly pendingHomes = new Map<string, Promise<{ popular: Listing, latest: Listing }>>()

    async getPreferenceMenu(): Promise<Form> {
        return { sections: [UIListSection({
            header: 'Content safety',
            footer: 'Enabled by default. Uses the site’s adult filter and excludes explicit Adult, Mature, Smut, Hentai, Erotica and Ecchi tags. Unrated or unverifiable titles are hidden. Site labels may be incomplete; this is not a guarantee of image content. Applies to discovery, search, details, chapters and reading.',
            children: [UIToggle({
                id: 'excludeNSFW',
                title: 'Exclude NSFW content',
                value: await this.excludeNSFW(),
                didChange: async (value) => {
                    this.settingsRevision += 1
                    await ObjectStore.set(SETTING, value)
                    this.listings.clear()
                    this.metadata.clear()
                    this.pendingListings.clear()
                    this.pendingHomes.clear()
                }
            })]
        })] }
    }

    async getSortOptions(): Promise<SortOption[]> { return SORTS }

    async getSearchForm(): Promise<SearchForm> {
        const exclude = await this.excludeNSFW()
        const $ = load(await this.api.text(`${DOMAIN}/?s=&post_type=wp-manga${exclude ? '&adult=0' : ''}`))
        const options = (name: string): Option[] => $(`.search-advanced-form input[name="${name}"]`).toArray().map((node) => ({
            id: $(node).attr('value') ?? '',
            title: text($(node).parent().find('label').text())
        })).filter((option) => option.id && option.title)
        const genres = options('genre[]')
        const statuses = options('status[]')
        if (!genres.length || statuses.length !== 5) throw new Error('MangaSushi search taxonomy changed')
        return { sections: [
            SearchListSection({ children: [
                SearchMultiPickerSheet({ id: 'genres', title: 'Genres', options: genres }),
                SearchMenuPicker({ id: 'condition', title: 'Genres condition', options: [{ id: 'or', title: 'OR (any selected genre)' }, { id: 'and', title: 'AND (all selected genres)' }] }),
                SearchTextField({ id: 'author', title: 'Author' }),
                SearchTextField({ id: 'artist', title: 'Artist' }),
                SearchTextField({ id: 'release', title: 'Year of Released', placeholder: 'Year' }),
                SearchMultiPickerSheet({ id: 'status', title: 'Status', options: statuses }),
                SearchMenuPicker({ id: 'adult', title: 'Adult content', options: exclude
                    ? [{ id: '0', title: 'None adult content (global setting)' }]
                    : [{ id: 'all', title: 'All' }, { id: '0', title: 'None adult content' }, { id: '1', title: 'Only adult content' }] })
            ] }),
            SearchSortSection({ header: 'Order by' })
        ] }
    }

    async search(request: SearchRequest<Filters>): Promise<PagedSearchResult> {
        return this.withSettings((exclude) => this.searchPage(request, exclude))
    }

    private async searchPage(request: SearchRequest<Filters>, exclude: boolean): Promise<PagedSearchResult> {
        const page = request.page ?? 1
        if (!Number.isInteger(page) || page < 1) throw new Error('Invalid MangaSushi page')
        if (request.listId === 'popular') {
            const home = await this.home(exclude)
            return { results: page === 1 ? await this.visible(home.popular.items, exclude, home.latest, 1, home.latest.items.length + home.popular.items.length) : [], isLastPage: true }
        }
        if (request.listId === 'latest') {
            const home = await this.home(exclude)
            const result = page === 1 ? home.latest : home.latest.next
                ? await this.continuation(home.latest, page, '.page-item-detail', `${exclude}:home`)
                : { items: [], ended: true }
            return { results: await this.visible(result.items, exclude, home.latest, page, page === 1 ? home.latest.items.length + home.popular.items.length : undefined), isLastPage: result.ended || (page === 1 && !result.next) }
        }
        if (request.listId) throw new Error(`Unknown MangaSushi list: ${request.listId}`)
        const url = this.searchURL({ ...request, query: searchTitle(request.query ?? '') }, exclude)
        const first = await this.firstListing(url, exclude)
        const listing = page === 1 ? first : first.next
            ? await this.continuation(first, page, '.c-tabs-item__content', `${exclude}:${url}`)
            : { items: [], ended: true }
        for (const item of listing.items) this.cacheMetadata(item, exclude)
        return {
            results: listing.items.filter((item) => !EDITORIAL_IDS.has(item.id) && (!exclude || (item.classified && !item.explicit))).map(this.highlight),
            isLastPage: listing.ended || (page === 1 && !listing.next)
        }
    }

    async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
        this.checkHome(link)
        return this.withSettings(async (exclude) => {
            await this.home(exclude)
            return [
                { id: 'popular', title: 'Popular Series', style: SectionStyle.SimpleSingleRow },
                { id: 'latest', title: 'What’s New', style: SectionStyle.SimpleSingleRow }
            ]
        })
    }

    async resolvePageSection(link: PageLink, sectionId: string): Promise<ResolvedPageSection> {
        this.checkHome(link)
        const result = await this.search({ page: 1, listId: sectionId })
        return {
            items: result.results,
            viewMoreLink: sectionId === 'latest' && !result.isLastPage ? { request: { page: 1, listId: sectionId } } : undefined
        }
    }

    async getContent(contentId: string): Promise<Content> {
        return this.withSettings((exclude) => this.content(contentId, exclude))
    }

    private async content(contentId: string, exclude: boolean): Promise<Content> {
        const html = await this.api.text(seriesURL(contentId))
        const title = text(load(html)('.post-title h1').first().text())
        const meta = await this.resolveMetadata(contentId, title, exclude)
        const content = parseContent(html, meta)
        const display = englishTitle(contentId, title, meta.alternatives)
        return {
            ...content,
            title: display,
            additionalTitles: [...new Set([...(display !== title ? [title] : []), ...(content.additionalTitles ?? [])])]
        }
    }

    async getChapters(contentId: string): Promise<Chapter[]> {
        return this.withSettings(async (exclude) => {
            await this.requireAllowed(contentId, exclude)
            return parseChapters(await this.api.text(`${seriesURL(contentId)}ajax/chapters/`, ''), contentId)
        })
    }

    async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
        return this.withSettings(async (exclude) => {
            await this.requireAllowed(contentId, exclude)
            if (!chapterId || /[/?#]/.test(chapterId)) throw new Error('Invalid MangaSushi chapter ID')
            return parseReader(await this.api.text(`${seriesURL(contentId)}${encodeURIComponent(chapterId)}/`), contentId, chapterId)
        })
    }

    async handleURL(url: string): Promise<DeepLinkContext | null> {
        const match = url.match(/^https?:\/\/(?:www\.)?mangasushi\.org\/manga\/([^/?#]+)\/?(?:[?#].*)?$/i)
        if (!match) return null
        const id = seriesId(url)
        const content = await this.getContent(id)
        return { content: { id, title: content.title, cover: content.cover, webUrl: content.webUrl, contentRating: content.contentRating } }
    }

    async willRequestImage(url: string): Promise<NetworkRequest> {
        return { url, headers: { Referer: `${DOMAIN}/`, Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5' } }
    }

    private async excludeNSFW(): Promise<boolean> { return (await ObjectStore.boolean(SETTING)) !== false }

    private async withSettings<T>(operation: (exclude: boolean) => Promise<T>): Promise<T> {
        const revision = this.settingsRevision
        const exclude = await this.excludeNSFW()
        const result = await operation(exclude)
        const currentExclude = await this.excludeNSFW()
        if (revision !== this.settingsRevision || exclude !== currentExclude) {
            throw new Error('MangaSushi settings changed during this request; refresh to continue')
        }
        return result
    }

    private checkHome(link: PageLink): void {
        if (link.id !== 'home') throw new Error(`Unknown MangaSushi page: ${link.id}`)
    }

    private highlight(item: Series): Highlight {
        return { id: item.id, title: englishTitle(item.id, item.title, item.alternatives), cover: item.cover, webUrl: item.webUrl, subtitle: item.subtitle, contentRating: item.contentRating }
    }

    private fresh<T>(entry: CacheEntry<T> | undefined): T | undefined {
        return entry && Date.now() - entry.at < 180_000 ? entry.value : undefined
    }

    private cacheMetadata(item: Series, exclude: boolean): void {
        this.metadata.set(`${exclude}:${item.id}`, { at: Date.now(), value: item })
    }

    private async firstListing(url: string, exclude: boolean): Promise<Listing> {
        const key = `${exclude}:${url}`
        const cached = this.fresh(this.listings.get(key))
        if (cached) return cached
        const html = await this.api.text(url)
        if (!html.includes('search-advanced-form')) throw new Error('MangaSushi search page is incomplete')
        const result = parseListing(html)
        const emptyMessage = text(load(html)('.c-page-content .no-results.not-found .not-found-content').text())
        if (!result.items.length && !/^No matches found\./i.test(emptyMessage)) {
            throw new Error('MangaSushi search result layout changed without a verified empty state')
        }
        this.listings.set(key, { at: Date.now(), value: result })
        for (const item of result.items) this.cacheMetadata(item, exclude)
        return result
    }

    private searchURL(request: SearchRequest<Filters>, exclude: boolean): string {
        const query = (request.query?.trim() ?? '').replace(/[‘’]/g, '\'').replace(/[“”]/g, '"')
        const params = new URLSearchParams({ s: query, post_type: 'wp-manga' })
        const sort = request.sort?.id ?? 'relevance'
        if (!SORTS.some((option) => option.id === sort)) throw new Error('Unknown MangaSushi sort')
        if (sort !== 'relevance') params.set('m_orderby', sort)
        const filters = request.filters
        for (const genre of filters?.genres ?? []) params.append('genre[]', genre.id)
        if (filters?.condition?.id === 'and') params.set('op', '1')
        for (const key of ['author', 'artist', 'release'] as const) {
            if (filters?.[key]?.trim()) params.set(key, filters[key]?.trim() ?? '')
        }
        for (const status of filters?.status ?? []) params.append('status[]', status.id)
        if (exclude) params.set('adult', '0')
        else if (['0', '1'].includes(filters?.adult?.id ?? '')) params.set('adult', filters?.adult?.id ?? '')
        return `${DOMAIN}/?${params.toString()}`
    }

    private async continuation(first: Listing, page: number, selector: string, scope: string): Promise<Listing> {
        if (!first.next) return { items: [], ended: true }
        const result = await this.api.more(first.next, page, selector)
        const ids = result.items.map((item) => item.id).join('\n')
        const previous = [first, ...[...this.listings.entries()]
            .filter(([key]) => key.startsWith(`${scope}:page:`) && key !== `${scope}:page:${page}`)
            .map(([, entry]) => this.fresh(entry)).filter((entry): entry is Listing => Boolean(entry))]
        if (ids && previous.some((entry) => entry.items.map((item) => item.id).join('\n') === ids)) {
            throw new Error('MangaSushi continuation repeated a catalog page')
        }
        this.listings.set(`${scope}:page:${page}`, { at: Date.now(), value: result })
        return result
    }

    private async home(exclude: boolean): Promise<{ popular: Listing, latest: Listing }> {
        const key = `${exclude}:home`
        const latest = this.fresh(this.listings.get(key))
        const popular = this.fresh(this.listings.get(`${key}:popular`))
        if (latest && popular) return { latest, popular }
        const pending = this.pendingHomes.get(key)
        if (pending) return pending
        const revision = this.settingsRevision
        const request = (async () => {
            const html = await this.api.text(`${DOMAIN}/`)
            const $ = load(html)
            if (!/popular series/i.test($('.popular-slider .heading').text()) || !/what.s new/i.test($('.c-blog__heading h1').text())) {
                throw new Error('MangaSushi home sections changed')
            }
            const parsedPopular = parseListing(html, '.popular-slider .slider__item')
            parsedPopular.next = undefined
            parsedPopular.ended = true
            const parsedLatest = parseListing(html, '#loop-content .page-item-detail')
            if (!parsedPopular.items.length || !parsedLatest.items.length) throw new Error('MangaSushi home is incomplete')
            if (revision !== this.settingsRevision) throw new Error('MangaSushi settings changed during this request; refresh to continue')
            this.listings.set(key, { at: Date.now(), value: parsedLatest })
            this.listings.set(`${key}:popular`, { at: Date.now(), value: parsedPopular })
            return { popular: parsedPopular, latest: parsedLatest }
        })()
        this.pendingHomes.set(key, request)
        try { return await request } finally {
            if (this.pendingHomes.get(key) === request) this.pendingHomes.delete(key)
        }
    }

    private async discoveryMetadata(first: Listing, page: number, exclude: boolean, size?: number): Promise<void> {
        if (!first.next) return
        const original = first.next.vars
        // Reuse the site's actual latest-update query and page boundaries. Its
        // native search template includes genres for every title in one response.
        if (original.meta_key !== '_latest_update' || original.orderby !== 'meta_value_num' || original.order !== 'desc') {
            throw new Error('MangaSushi discovery metadata query changed')
        }
        const count = size ?? Number(original.posts_per_page)
        if (!Number.isSafeInteger(count) || count < 1 || count > 100) throw new Error('MangaSushi discovery page size changed')
        const vars = {
            ...original,
            s: '',
            template: 'search',
            posts_per_page: String(count),
            manga_archives_item_layout: 'default',
            // Native adult=0 is necessary, but insufficient: visible() still
            // requires real genres and rejects every explicit tag, including Ecchi.
            meta_query: exclude ? { relation: 'AND', 0: original.meta_query ?? { relation: 'AND' }, 1: { key: 'manga_adult_content', value: '' } } : (original.meta_query ?? { relation: 'AND' })
        }
        const key = `${exclude}:discovery:${page}:${JSON.stringify(vars)}`
        const cached = this.fresh(this.listings.get(key))
        if (cached) {
            for (const item of cached.items) this.cacheMetadata(item, exclude)
            return
        }
        const pending = this.pendingListings.get(key)
        if (pending) { await pending; return }
        const revision = this.settingsRevision
        const request = (async () => {
            const result = await this.api.more({ template: 'madara-core/content/content-search', vars }, page, '.c-tabs-item__content')
            if (revision !== this.settingsRevision) throw new Error('MangaSushi settings changed during this request; refresh to continue')
            this.listings.set(key, { at: Date.now(), value: result })
            for (const item of result.items) this.cacheMetadata(item, exclude)
            return result
        })()
        this.pendingListings.set(key, request)
        try { await request } finally {
            if (this.pendingListings.get(key) === request) this.pendingListings.delete(key)
        }
    }

    private async visible(items: Series[], exclude: boolean, first?: Listing, page = 1, size?: number): Promise<Highlight[]> {
        const series = items.filter((item) => !EDITORIAL_IDS.has(item.id))
        if (first && series.some((item) => !this.fresh(this.metadata.get(`${exclude}:${item.id}`)))) {
            await this.discoveryMetadata(first, page, exclude, size)
        }
        if (!exclude) return series.map((item) => this.highlight({
            ...item,
            alternatives: this.fresh(this.metadata.get(`${exclude}:${item.id}`))?.alternatives ?? item.alternatives
        }))
        const checked = await Promise.all(series.map(async (item) => {
            try {
                const metadata = await this.resolveMetadata(item.id, item.title, exclude)
                return this.highlight({ ...item, alternatives: metadata.alternatives, contentRating: metadata.contentRating })
            } catch (error) {
                // Explicit exclusion is not a source outage. Network, challenge and
                // changed markup errors must remain visible instead of empty rows.
                if (error instanceof ExcludedContentError) return undefined
                throw error
            }
        }))
        return checked.filter((item): item is Highlight => item !== undefined)
    }

    private async resolveMetadata(id: string, title: string, exclude: boolean): Promise<Series> {
        if (EDITORIAL_IDS.has(id)) throw new ExcludedContentError('This MangaSushi entry is an editorial notice, not a series')
        let found = this.fresh(this.metadata.get(`${exclude}:${id}`))
        if (!found) {
            if (!title) throw new ExcludedContentError('MangaSushi title cannot be verified')
            // WordPress sometimes fails to match its own typographic punctuation.
            // Retry a short title prefix, but accept only the same canonical ID.
            const prefix = title.replace(/[“”‘’–—~:!?()[\]{}]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6).join(' ')
            for (const query of [...new Set([title, prefix])]) {
                const listing = await this.firstListing(this.searchURL({ page: 1, query }, exclude), exclude)
                found = listing.items.find((item) => item.id === id)
                const seen = new Set(listing.items.map((item) => item.id))
                for (let page = 2; !found && listing.next && page <= 50; page += 1) {
                    const next = await this.api.more(listing.next, page, '.c-tabs-item__content')
                    if (next.items.length && next.items.every((item) => seen.has(item.id))) {
                        throw new Error('MangaSushi metadata continuation repeated a page')
                    }
                    for (const item of next.items) {
                        seen.add(item.id)
                        this.cacheMetadata(item, exclude)
                    }
                    found = next.items.find((item) => item.id === id)
                    if (next.ended) break
                }
                if (found) break
            }
        }
        if (!found || (exclude && (!found.classified || found.explicit))) {
            throw new ExcludedContentError('This title is excluded by the NSFW setting or its classification could not be verified')
        }
        return found
    }

    private async requireAllowed(id: string, exclude: boolean): Promise<void> {
        if (EDITORIAL_IDS.has(id)) throw new ExcludedContentError('This MangaSushi entry is an editorial notice, not a series')
        if (!exclude) { seriesURL(id); return }
        const cached = this.fresh(this.metadata.get(`${exclude}:${id}`))
        if (cached?.classified && !cached.explicit) return
        await this.content(id, exclude)
    }
}
