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
import { assertRatingPolicy,
    nativeRating,
    ratingAllowed } from '../../ContentRatingPolicy'
import { MangaSushiApi } from './MangaSushiApi'
import { authorizeImage,
    changeImagePolicy,
    beginImageEvidence,
    ensureImageEvidence,
    imageEvidenceAllowed,
    ImageEvidence,
    observeImageEvidence,
    imagePolicyRevision,
    issueImages } from './MangaSushiImages'
import { englishTitle,
    searchTitle } from './MangaSushiTitles'
import {
    assertGenreSearch,
    DOMAIN,
    GenreSelection,
    genreSelection,
    Listing,
    parseChapters,
    parseContent,
    parseDetailMetadata,
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
        version: '0.0.1-alpha.10',
        name: 'MangaSushi',
        description: 'MangaSushi with native discovery, search filters and Mana content-rating policy.',
        thumbnail: 'MangaSushi.png',
        rating: CatalogRating.MIXED,
        website: DOMAIN,
        badges: ['Manga'],
        supportedLanguages: ['en_US'],
        developers: [{ name: 'Lucifers Circle', github: 'https://github.com/LucifersCircle' }]
    }
    readonly config = { cloudflareResolutionURL: DOMAIN, owningLinks: ['mangasushi.org'] }
    private readonly api = new MangaSushiApi()
    private readonly listings = new Map<string, CacheEntry<Listing>>()
    private settingsRevision = 0
    private readonly evidence = new WeakMap<Series, ImageEvidence>()
    private readonly listingEvidence = new WeakMap<Listing, ImageEvidence>()
    private readonly observed = new WeakSet<Series>()
    private markListing(listing: Listing, evidence: ImageEvidence): Listing {
        this.listingEvidence.set(listing, evidence)
        for (const item of listing.items) this.evidence.set(item, evidence)
        return listing
    }
    private inheritEvidence(value: Series, original: Series): Series {
        const evidence = this.evidence.get(original)
        if (evidence) this.evidence.set(value, evidence)
        if (this.observed.has(original)) this.observed.add(value)
        return value
    }
    private readonly metadata = new Map<string, CacheEntry<Series>>()
    private readonly pendingListings = new Map<string, Promise<Listing>>()
    private readonly pendingHomes = new Map<string, Promise<{ popular: Listing, latest: Listing }>>()

    async getPreferenceMenu(): Promise<Form> {
        return { sections: [UIListSection({
            header: 'Content safety',
            footer: 'Off unless explicitly saved. Mana’s supplied content-rating policy controls search, discovery and details. This optional extra source exclusion uses the site’s non-adult filter and verified genres and applies to chapters and reading too. Titles without a source age rating use a Suggestive compatibility fallback, not a site-reported rating. Site labels do not guarantee image content.',
            children: [UIToggle({
                id: 'excludeNSFW',
                title: 'Exclude NSFW content',
                value: await this.excludeNSFW(),
                didChange: async (value) => {
                    this.settingsRevision += 1
                    await changeImagePolicy(value)
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
        assertRatingPolicy(request.context)
        return this.withSettings((exclude) => this.searchPage(request, exclude), (result) => result.results.map((item) => ({ url: item.cover ?? '', id: item.id })))
    }

    private async searchPage(request: SearchRequest<Filters>, exclude: boolean): Promise<PagedSearchResult> {
        const page = request.page ?? 1
        if (!Number.isInteger(page) || page < 1 || page > 100) throw new Error('Invalid MangaSushi page')
        if ((request.context?.allowedContentRatings !== undefined && !request.context.allowedContentRatings.some((rating) => [ContentRating.SUGGESTIVE, ContentRating.MATURE, ContentRating.EXPLICIT].includes(rating))) || (exclude && request.filters?.adult?.id === '1')) return { results: [], isLastPage: true }
        if (request.listId === 'popular') {
            const home = await this.home(exclude)
            return { results: page === 1 ? await this.visible(home.popular.items, exclude, home.latest, 1,
                home.latest.items.length + home.popular.items.length, request.context) : [], isLastPage: true }
        }
        if (request.listId && request.listId !== 'latest') throw new Error(`Unknown MangaSushi list: ${request.listId}`)
        const home = request.listId === 'latest' ? await this.home(exclude) : undefined
        const url = home ? 'home' : this.searchURL({ ...request, query: searchTitle(request.query ?? '') }, exclude)
        const genres = home ? undefined : genreSelection((request.filters?.genres ?? []).map((genre) => genre.id), request.filters?.condition?.id, request.filters)
        const first = home?.latest ?? await this.firstListing(url, exclude, genres)
        const selector = home ? '.page-item-detail' : '.c-tabs-item__content'
        const scope = `${exclude}:${url}`
        let listing = first, logicalPage = 1, noRawProgress = 0
        const seen = new Set<string>()
        for (let physicalPage = 1; physicalPage <= 100; physicalPage += 1) {
            if (!home) for (const item of listing.items) await this.cacheMetadata(item, exclude)
            const fresh = listing.items.filter((item) => !seen.has(item.id))
            noRawProgress = fresh.length ? 0 : noRawProgress + 1
            if (noRawProgress >= 10 && !listing.ended) throw new Error('MangaSushi provider repeated catalog pages without new raw series IDs; refresh or narrow your search')
            for (const item of listing.items) seen.add(item.id)
            const candidates = fresh.map((item) => this.fresh(this.metadata.get(`${exclude}:${item.id}`)) ?? item)
            const eligible = await Promise.all(candidates.map(async (item) => !exclude || (item.classified && !item.explicit && await imageEvidenceAllowed(item.id, this.evidence.get(item)))))
            const results = home
                ? await this.visible(fresh, exclude, first, physicalPage, physicalPage === 1 ? home.latest.items.length + home.popular.items.length : undefined, request.context)
                : candidates.filter((item, index) => !EDITORIAL_IDS.has(item.id) && eligible[index]
                        && ratingAllowed(item.contentRating, request.context)).map((item) => ({ ...this.highlight(item), context: request.context }))
            // Only eligible, nonduplicate pages consume a logical page. Mana stops
            // on zero results even when isLastPage is false.
            if (results.length) {
                if (logicalPage === page) return { results, isLastPage: listing.ended || !first.next }
                logicalPage += 1
            }
            if (listing.ended || !first.next) return { results: [], isLastPage: true }
            if (physicalPage === 100) throw new Error('MangaSushi listing traversal exceeded its verified bounds')
            listing = await this.continuation(first, physicalPage + 1, selector, scope, exclude, genres)
        }
        throw new Error('MangaSushi listing traversal exceeded its verified bounds')
    }

    async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
        assertRatingPolicy(link.context)
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
        assertRatingPolicy(link.context)
        this.checkHome(link)
        const result = await this.search({ page: 1, listId: sectionId, context: link.context })
        return {
            items: result.results,
            viewMoreLink: sectionId === 'latest' && !result.isLastPage ? { request: { page: 1, listId: sectionId, context: link.context } } : undefined
        }
    }

    async getContent(contentId: string, context?: SourceContext): Promise<Content> {
        assertRatingPolicy(context)
        return this.withSettings(async (exclude) => {
            if (context?.allowedContentRatings?.length === 0) throw new ExcludedContentError('This title is excluded by Mana’s content-rating policy')
            const result = await this.content(contentId, exclude)
            const metadata = this.fresh(this.metadata.get(`${exclude}:${contentId}`))
            const content = metadata?.explicit ? { ...result, contentRating: nativeRating(metadata.contentRating),
                additionalInfo: result.additionalInfo?.filter((section) => section.id !== 'content-rating-metadata') } : result
            if (!ratingAllowed(content.contentRating, context)) throw new ExcludedContentError('This title is excluded by Mana’s content-rating policy')
            return content
        }, (content) => [{ url: content.cover ?? '', id: contentId }])
    }

    private async content(contentId: string, exclude: boolean): Promise<Content> {
        if (EDITORIAL_IDS.has(contentId)) throw new ExcludedContentError('This MangaSushi entry is an editorial notice, not a series')
        const detailEvidence = await beginImageEvidence()
        const html = await this.api.text(seriesURL(contentId))
        const title = text(load(html)('.post-title h1').first().text())
        const detail = parseDetailMetadata(html, contentId)
        this.evidence.set(detail, detailEvidence)
        if (detail.explicit) await this.cacheMetadata(detail, exclude)
        let meta: Series
        try { meta = await this.resolveMetadata(contentId, title, exclude) } catch (error) {
            if (!(error instanceof ExcludedContentError) || exclude) throw error
            meta = detail
        }
        if (meta.contentRating === undefined && detail.contentRating !== undefined) {
            meta = this.inheritEvidence({ ...detail, authors: detail.authors.length ? detail.authors : meta.authors,
                artists: detail.artists.length ? detail.artists : meta.artists,
                alternatives: detail.alternatives.length ? detail.alternatives : meta.alternatives }, meta)
        }
        // A direct warning is positive evidence, not incomplete metadata. Never
        // downgrade it using a non-adult catalog row or an unknown fallback.
        if (detail.explicit || meta.explicit) {
            meta = this.inheritEvidence({ ...meta, explicit: true, contentRating: Math.max(nativeRating(meta.contentRating), nativeRating(detail.contentRating)) }, meta)
            this.observed.delete(meta)
        }
        await this.cacheMetadata(meta, exclude)
        if (exclude && (!meta.classified || meta.explicit)) throw new ExcludedContentError('This title is excluded by the saved NSFW setting')
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
            const result = parseReader(await this.api.text(`${seriesURL(contentId)}${encodeURIComponent(chapterId)}/`), contentId, chapterId)
            return result
        }, (result) => (result.pages ?? []).map((page) => ({ url: page.url ?? '', id: contentId, chapterId })))
    }

    async handleURL(url: string): Promise<DeepLinkContext | null> {
        const match = url.match(/^https?:\/\/(?:www\.)?mangasushi\.org\/manga\/([^/?#]+)\/?(?:[?#].*)?$/i)
        if (!match) return null
        const id = seriesId(url)
        const content = await this.getContent(id)
        return { content: { id, title: content.title, cover: content.cover, webUrl: content.webUrl, contentRating: content.contentRating } }
    }

    async willRequestImage(url: string): Promise<NetworkRequest> {
        const revision = this.settingsRevision, exclude = await this.excludeNSFW()
        await authorizeImage(url, await this.imageContext(exclude), exclude)
        if (revision !== this.settingsRevision) throw new Error('MangaSushi settings changed; refresh to continue')
        return { url, headers: { Referer: `${DOMAIN}/`, Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5' } }
    }

    private async excludeNSFW(): Promise<boolean> { return (await ObjectStore.boolean(SETTING)) === true }

    private async withSettings<T>(operation: (exclude: boolean) => Promise<T>, images?: (result: T) => Array<{ url: string, id: string, chapterId?: string }>): Promise<T> {
        const revision = this.settingsRevision
        const exclude = await this.excludeNSFW()
        const imageRevision = await imagePolicyRevision()
        await ensureImageEvidence()
        const result = await operation(exclude)
        const currentExclude = await this.excludeNSFW()
        if (revision !== this.settingsRevision || exclude !== currentExclude || imageRevision !== await imagePolicyRevision()) {
            throw new Error('MangaSushi settings changed during this request; refresh to continue')
        }
        if (images) {
            await issueImages(images(result).filter((item) => item.url).map((item) => {
                const meta = this.fresh(this.metadata.get(`${exclude}:${item.id}`))
                return { ...item, classified: meta?.classified === true, explicit: meta?.explicit === true, evidence: meta ? this.evidence.get(meta) : undefined }
            }), JSON.stringify([exclude, imageRevision]))
            if (revision !== this.settingsRevision || exclude !== await this.excludeNSFW() || imageRevision !== await imagePolicyRevision()) throw new Error('MangaSushi settings changed during this request; refresh to continue')
        }
        return result
    }

    private async imageContext(exclude: boolean): Promise<string> {
        if (exclude !== await this.excludeNSFW()) throw new Error('MangaSushi settings changed; refresh to continue')
        return JSON.stringify([exclude, await imagePolicyRevision()])
    }

    private checkHome(link: PageLink): void {
        if (link.id !== 'home') throw new Error(`Unknown MangaSushi page: ${link.id}`)
    }

    private highlight(item: Series): Highlight {
        return { id: item.id, title: englishTitle(item.id, item.title, item.alternatives), cover: item.cover, webUrl: item.webUrl, subtitle: item.subtitle, contentRating: nativeRating(item.contentRating) }
    }

    private fresh<T>(entry: CacheEntry<T> | undefined): T | undefined {
        return entry && Date.now() - entry.at < 180_000 ? entry.value : undefined
    }

    private async cacheMetadata(item: Series, exclude: boolean): Promise<void> {
        const evidence = this.evidence.get(item)
        if (!evidence) throw new Error('MangaSushi metadata has no source evidence')
        if (!this.observed.has(item)) {
            await observeImageEvidence(item.id, item.classified && !item.explicit, evidence)
            this.observed.add(item)
        }
        const key = `${exclude}:${item.id}`, prior = this.metadata.get(key)?.value
        const previousEvidence = prior ? this.evidence.get(prior) : undefined
        if (previousEvidence?.generation === evidence.generation && (previousEvidence.sequence > evidence.sequence || (previousEvidence.sequence === evidence.sequence && prior?.explicit && !item.explicit))) return
        // Authoritative search rows replace classification, including unknown.
        // Sparse home cards only reach this method when they carry a warning.
        this.metadata.set(key, { at: evidence.at, value: item })
    }

    private async firstListing(url: string, exclude: boolean, genres?: GenreSelection): Promise<Listing> {
        const key = `${exclude}:${url}`
        const cached = this.fresh(this.listings.get(key))
        if (cached) { assertGenreSearch(cached, genres, true); return cached }
        const evidence = await beginImageEvidence()
        const html = await this.api.text(url)
        if (!html.includes('search-advanced-form')) throw new Error('MangaSushi search page is incomplete')
        const result = this.markListing(parseListing(html), evidence)
        const emptyMessage = text(load(html)('.c-page-content .no-results.not-found .not-found-content').text())
        if (!result.items.length && (!/^No matches found\./i.test(emptyMessage) || result.next)) {
            throw new Error('MangaSushi search result layout changed without a verified empty state')
        }
        // Positive warnings remain safety evidence even when this response
        // fails genre integrity. Do not cache unrelated Safe metadata.
        for (const item of result.items) if (item.explicit) await this.cacheMetadata(item, exclude)
        assertGenreSearch(result, genres, true)
        for (const prior of this.listings.keys()) if (prior.startsWith(`${key}:page:`)) this.listings.delete(prior)
        this.listings.set(key, { at: Date.now(), value: result })
        for (const item of result.items) await this.cacheMetadata(item, exclude)
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

    private async continuation(first: Listing, page: number, selector: string, scope: string, exclude: boolean, genres?: GenreSelection): Promise<Listing> {
        if (!first.next) return { items: [], ended: true }
        const key = `${scope}:page:${page}`, cached = this.fresh(this.listings.get(key))
        if (cached) { assertGenreSearch(cached, genres); return cached }
        const pending = this.pendingListings.get(key)
        if (pending) return pending
        const revision = this.settingsRevision
        const request = (async () => {
            const evidence = await beginImageEvidence()
            const result = this.markListing(await this.api.more(first.next as NonNullable<Listing['next']>, page, selector), evidence)
            for (const item of result.items) if (item.explicit) await this.cacheMetadata(item, exclude)
            assertGenreSearch(result, genres)
            if (genres && result.queryVars && JSON.stringify(result.queryVars.tax_query) !== JSON.stringify(first.queryVars?.tax_query)) {
                throw new Error('MangaSushi continuation changed the requested genre filter')
            }
            if (revision !== this.settingsRevision) throw new Error('MangaSushi settings changed during this request; refresh to continue')
            this.listings.set(key, { at: Date.now(), value: result })
            return result
        })()
        this.pendingListings.set(key, request)
        try { return await request } finally { if (this.pendingListings.get(key) === request) this.pendingListings.delete(key) }
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
            const evidence = await beginImageEvidence()
            const html = await this.api.text(`${DOMAIN}/`)
            const $ = load(html)
            if (!/popular series/i.test($('.popular-slider .heading').text()) || !/what.s new/i.test($('.c-blog__heading h1').text())) {
                throw new Error('MangaSushi home sections changed')
            }
            const parsedPopular = this.markListing(parseListing(html, '.popular-slider .slider__item'), evidence)
            parsedPopular.next = undefined
            parsedPopular.ended = true
            const parsedLatest = this.markListing(parseListing(html, '#loop-content .page-item-detail'), evidence)
            if (!parsedPopular.items.length || !parsedLatest.items.length) throw new Error('MangaSushi home is incomplete')
            if (revision !== this.settingsRevision) throw new Error('MangaSushi settings changed during this request; refresh to continue')
            for (const prior of this.listings.keys()) if (prior.startsWith(`${key}:page:`)) this.listings.delete(prior)
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
            for (const item of cached.items) await this.cacheMetadata(item, exclude)
            return
        }
        const pending = this.pendingListings.get(key)
        if (pending) { await pending; return }
        const revision = this.settingsRevision
        const request = (async () => {
            const evidence = await beginImageEvidence()
            const result = this.markListing(await this.api.more({ template: 'madara-core/content/content-search', vars }, page, '.c-tabs-item__content'), evidence)
            if (revision !== this.settingsRevision) throw new Error('MangaSushi settings changed during this request; refresh to continue')
            this.listings.set(key, { at: Date.now(), value: result })
            for (const item of result.items) await this.cacheMetadata(item, exclude)
            return result
        })()
        this.pendingListings.set(key, request)
        try { await request } finally {
            if (this.pendingListings.get(key) === request) this.pendingListings.delete(key)
        }
    }

    private async visible(items: Series[], exclude: boolean, first?: Listing, page = 1, size?: number, context?: SourceContext): Promise<Highlight[]> {
        const series = items.filter((item) => !EDITORIAL_IDS.has(item.id))
        for (const item of series) if (item.explicit) await this.cacheMetadata(item, exclude)
        if (first && series.some((item) => !this.fresh(this.metadata.get(`${exclude}:${item.id}`)))) {
            await this.discoveryMetadata(first, page, exclude, size)
        }
        const checked = await Promise.all(series.map(async (item): Promise<Highlight | undefined> => {
            try {
                const cached = this.fresh(this.metadata.get(`${exclude}:${item.id}`))
                const metadata = exclude ? await this.resolveMetadata(item.id, item.title, true) : cached ?? item
                if (exclude && item.explicit) return undefined
                const contentRating = item.explicit ? Math.max(nativeRating(item.contentRating), nativeRating(metadata.contentRating)) : metadata.contentRating
                if (!ratingAllowed(contentRating, context)) return undefined
                return { ...this.highlight({ ...item, alternatives: metadata.alternatives, contentRating }), context }
            } catch (error) {
                if (error instanceof ExcludedContentError) return undefined
                throw error
            }
        }))
        return checked.filter((item): item is Highlight => item !== undefined)
    }

    private async resolveMetadata(id: string, title: string, exclude: boolean): Promise<Series> {
        if (EDITORIAL_IDS.has(id)) throw new ExcludedContentError('This MangaSushi entry is an editorial notice, not a series')
        let found = this.fresh(this.metadata.get(`${exclude}:${id}`))
        let lastEvidence: ImageEvidence | undefined
        if (!found) {
            if (!title) throw new ExcludedContentError('MangaSushi title cannot be verified')
            // WordPress sometimes fails to match its own typographic punctuation.
            // Retry a short title prefix, but accept only the same canonical ID.
            const prefix = title.replace(/[“”‘’–—~:!?()[\]{}]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 6).join(' ')
            for (const query of [...new Set([title, prefix])]) {
                const listing = await this.firstListing(this.searchURL({ page: 1, query }, exclude), exclude)
                lastEvidence = this.listingEvidence.get(listing)
                found = listing.items.find((item) => item.id === id)
                const seen = new Set(listing.items.map((item) => item.id))
                for (let page = 2; !found && listing.next && page <= 50; page += 1) {
                    const evidence = await beginImageEvidence()
                    const next = this.markListing(await this.api.more(listing.next, page, '.c-tabs-item__content'), evidence)
                    lastEvidence = evidence
                    if (next.items.length && next.items.every((item) => seen.has(item.id))) {
                        throw new Error('MangaSushi metadata continuation repeated a page')
                    }
                    for (const item of next.items) {
                        seen.add(item.id)
                        await this.cacheMetadata(item, exclude)
                    }
                    found = next.items.find((item) => item.id === id)
                    if (next.ended) break
                }
                if (found) break
            }
        }
        if (!found || (exclude && (!found.classified || found.explicit || !await imageEvidenceAllowed(id, this.evidence.get(found))))) {
            if (!found && lastEvidence) await observeImageEvidence(id, false, lastEvidence)
            throw new ExcludedContentError('This title is excluded by the NSFW setting or its classification could not be verified')
        }
        return found
    }

    private async requireAllowed(id: string, exclude: boolean): Promise<void> {
        if (EDITORIAL_IDS.has(id)) throw new ExcludedContentError('This MangaSushi entry is an editorial notice, not a series')
        if (!exclude) { seriesURL(id); return }
        const cached = this.fresh(this.metadata.get(`${exclude}:${id}`))
        if (cached?.classified && !cached.explicit && await imageEvidenceAllowed(id, this.evidence.get(cached))) return
        await this.content(id, exclude)
    }
}
