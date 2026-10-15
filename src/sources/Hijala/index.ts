/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Lucifers Circle */
import { CatalogRating,
    Chapter,
    ChapterData,
    ChapterSource,
    Content,
    ContentRating,
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
    SearchExcludableMultiPickerSheet,
    SearchForm,
    SearchFormSubmission,
    SearchFormValidationResult,
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
    UIMultiPicker,
    UIToggle } from '@mana-app/types'
import { HijalaApi } from './HijalaApi'
import { API,
    Catalog,
    DOMAIN,
    HomeUpdate,
    LABELS,
    PAGE_SIZE,
    Post,
    PopularSeries,
    Preferences,
    SECTIONS,
    SORTS,
    STATUSES,
    TYPES } from './HijalaModels'
import { blockedGenre,
    catalog,
    chapterTitle,
    content,
    Detail,
    detail,
    genreOptions,
    genres,
    highlight,
    idToSlug,
    isLocked,
    nativeChapters,
    pageProperty,
    rating,
    reader,
    seriesURL,
    slugToId } from './HijalaParser'

export type Filters = {
    genres?: { included: Option[], excluded: Option[] }, statuses?: Option[], types?: Option[],
    direction?: Option, minChapters?: string, maxChapters?: string, createdAfter?: string, createdBefore?: string
}
type Cached<T> = { at: number, value: T }
type CatalogState = { at: number, invalid?: boolean, total?: number, values: Map<number, { next: number, result: PagedSearchResult }>, ids: Map<number, string[]>, references: number }
const MAX_CATALOG_TITLES = 10_000
const MAX_CATALOG_PAGES = 1_000
const MAX_CATALOG_ID_REFERENCES = 20_000
const MAX_CATALOG_ID_LENGTH = 2_048
const SETTING = 'Hijala.preferences'
// All Target objects in this source share the same persisted preference key.
let preferenceRevision = 0
let preferenceWrite: Promise<void> = Promise.resolve()
const options = (ids: string[]): Option[] => ids.map((id) => ({ id, title: LABELS[id] ?? id }))

export class Target implements ChapterSource, PageLinkResolver, SourcePreferenceProvider, ImageRequestHandler {
    readonly info: SourceInfo = {
        id: 'Hijala', version: '0.0.1-alpha.2', name: 'Hijala', thumbnail: 'Hijala.png', website: DOMAIN,
        description: 'Hijala public manga catalog, site filters, complete chapters and public reader. Default-on NSFW genre exclusion.',
        rating: CatalogRating.MIXED, supportedLanguages: ['en_US', 'es_ES', 'ru_RU'], badges: ['Manga', 'Manhwa', 'Manhua'],
        developers: [{ name: 'Lucifers Circle', website: 'https://pirate.vodka', github: 'https://github.com/LucifersCircle' }]
    }
    readonly config = { cloudflareResolutionURL: DOMAIN, owningLinks: ['en-hijala.com'] }
    private readonly api = new HijalaApi()
    private cacheRevision = preferenceRevision
    private readonly cache = new Map<string, Cached<string>>()
    private readonly pending = new Map<string, Promise<string>>()
    private readonly pages = new Map<string, CatalogState>()

    private async preferences(): Promise<Preferences> {
        const saved = await ObjectStore.get(SETTING) as Partial<Preferences> | null
        return { excludeNSFW: saved?.excludeNSFW !== false, hidePaid: saved?.hidePaid !== false,
            types: Array.isArray(saved?.types) ? TYPES.filter((id) => saved!.types!.includes(id)) : [...TYPES],
            sections: Array.isArray(saved?.sections) ? SECTIONS.map((item) => item.id).filter((id) => saved!.sections!.includes(id)) : SECTIONS.map((item) => item.id),
            excludedGenres: Array.isArray(saved?.excludedGenres) ? saved!.excludedGenres!.filter((id) => /^\d+$/.test(id)) : [] }
    }
    private async set<K extends keyof Preferences>(key: K, value: Preferences[K]): Promise<void> {
        preferenceRevision += 1
        const write = preferenceWrite.then(async () => {
            await ObjectStore.set(SETTING, { ...await this.preferences(), [key]: value })
            this.cache.clear(); this.pending.clear(); this.pages.clear()
        })
        preferenceWrite = write.catch(() => undefined)
        await write
    }
    private async withPreferences<T>(operation: (saved: Preferences) => Promise<T>): Promise<T> {
        let barrier: Promise<void>, revision: number, saved: Preferences
        // A callback increments revision before its queued store write commits. A
        // new read must await that write, not capture old preferences at the new revision.
        do {
            barrier = preferenceWrite
            await barrier
            revision = preferenceRevision
            saved = await this.preferences()
        } while (barrier !== preferenceWrite || revision !== preferenceRevision)
        if (this.cacheRevision !== revision) {
            this.cache.clear(); this.pending.clear(); this.pages.clear()
            this.cacheRevision = revision
        }
        const result = await operation(saved)
        const current = await this.preferences()
        if (barrier !== preferenceWrite || revision !== preferenceRevision || JSON.stringify(saved) !== JSON.stringify(current)) throw new Error('Hijala settings changed during this request; refresh to continue')
        return result
    }
    private async text(url: string): Promise<string> {
        for (const [key, entry] of this.cache) if (Date.now() - entry.at >= 180_000) this.cache.delete(key)
        if (this.cache.size >= 128 && !this.cache.has(url)) this.cache.delete(this.cache.keys().next().value as string)
        const cached = this.cache.get(url)
        if (cached && Date.now() - cached.at < 180_000) return cached.value
        const pending = this.pending.get(url)
        if (pending) return pending
        const revision = preferenceRevision
        const request = this.api.text(url)
        this.pending.set(url, request)
        try {
            const value = await request
            if (revision !== preferenceRevision) throw new Error('Hijala settings changed during this request; refresh to continue')
            this.cache.set(url, { at: Date.now(), value })
            return value
        } finally { if (this.pending.get(url) === request) this.pending.delete(url) }
    }
    async getPreferenceMenu(): Promise<Form> {
        const saved = await this.preferences(), taxonomy = genreOptions(await this.text(`${DOMAIN}/series/`))
        return { sections: [UIListSection({ header: 'Content safety',
            footer: 'NSFW exclusion is on by default. Uses verified genre labels (including Mature, Ecchi, Adult and Smut), not a four-category site rating. Missing or invalid genres are hidden. Labels may be incomplete; this does not guarantee image content. Applies to discovery, search, details, chapters and reading. Paid/login chapters always remain on the website.',
            children: [UIToggle({ id: 'excludeNSFW', title: 'Exclude NSFW content', value: saved.excludeNSFW, didChange: (value) => this.set('excludeNSFW', value) }),
                UIToggle({ id: 'hidePaid', title: 'Hide paid chapters', value: saved.hidePaid, didChange: (value) => this.set('hidePaid', value) })] }),
        UIListSection({ header: 'Catalog and discovery', children: [
            UIMultiPicker({ id: 'types', title: 'Content types', options: options(TYPES), value: saved.types, didChange: (value) => this.set('types', TYPES.filter((id) => value.includes(id))) }),
            UIMultiPicker({ id: 'excludedGenres', title: 'Excluded genres', options: taxonomy, value: saved.excludedGenres, didChange: (value) => this.set('excludedGenres', taxonomy.map((item) => item.id).filter((id) => value.includes(id))) }),
            UIMultiPicker({ id: 'sections', title: 'Discover sections', options: SECTIONS.filter((item) => item.id !== 'genres').map((item) => ({ id: item.id, title: item.title })), value: saved.sections.filter((id) => id !== 'genres'), didChange: (value) => this.set('sections', SECTIONS.map((item) => item.id).filter((id) => value.includes(id))) })
        ] })] }
    }
    async getSortOptions(): Promise<SortOption[]> { return SORTS.map(({ id, title }, index) => ({ id, title, isDefault: index === 0 })) }
    async getSearchForm(): Promise<SearchForm> {
        return { sections: [SearchListSection({ header: 'Filter series', footer: 'Persistent content types and excluded genres also apply. Dates use YYYY-MM-DD. Genre browsing is available here.', children: [
            SearchExcludableMultiPickerSheet({ id: 'genres', title: 'Genres', options: genreOptions(await this.text(`${DOMAIN}/series/`)) }),
            SearchMultiPickerSheet({ id: 'statuses', title: 'Status', options: options(STATUSES) }),
            SearchMultiPickerSheet({ id: 'types', title: 'Content types', options: options(TYPES) }),
            SearchMenuPicker({ id: 'direction', title: 'Order direction', options: [{ id: 'default', title: 'Default' }, { id: 'asc', title: 'Ascending' }, { id: 'desc', title: 'Descending' }] }),
            ...['minChapters', 'maxChapters', 'createdAfter', 'createdBefore'].map((id) => SearchTextField({ id, title: ({ minChapters: 'Minimum chapters', maxChapters: 'Maximum chapters', createdAfter: 'Created after', createdBefore: 'Created before' } as Record<string, string>)[id]! }))
        ] }), SearchSortSection({ header: 'Order by' })] }
    }
    async validateSearchForm(form: SearchFormSubmission<Filters>): Promise<SearchFormValidationResult> {
        try { this.validateFilters(form.filters); return { valid: true } }
        catch (error) { return { valid: false, message: (error as Error).message } }
    }
    private validateFilters(filters?: Filters): void {
        for (const field of ['minChapters', 'maxChapters'] as const) {
            const value = filters?.[field]?.trim()
            if (value && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) throw new Error('Chapter bounds must be non-negative whole numbers')
        }
        if (filters?.minChapters && filters.maxChapters && Number(filters.minChapters) > Number(filters.maxChapters)) throw new Error('Minimum chapters cannot exceed maximum')
        for (const field of ['createdAfter', 'createdBefore'] as const) {
            const value = filters?.[field]?.trim()
            if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error('Creation dates must use valid YYYY-MM-DD dates')
        }
        if (filters?.createdAfter && filters.createdBefore && filters.createdAfter > filters.createdBefore) throw new Error('Created after must not follow created before')
        if (filters?.direction && !['default', 'asc', 'desc'].includes(filters.direction.id)) throw new Error('Unknown order direction')
        if (filters?.statuses?.some((item) => !STATUSES.includes(item.id)) || filters?.types?.some((item) => !TYPES.includes(item.id))) throw new Error('Unknown status or content type')
        if ([...(filters?.genres?.included ?? []), ...(filters?.genres?.excluded ?? [])].some((item) => !/^\d+$/.test(item.id))) throw new Error('Invalid genre ID')
    }
    private allowed(post: Post, saved: Preferences, context?: SourceContext): boolean {
        const value = rating(post)
        return !post.isNovel && !!post.seriesType && saved.types.includes(post.seriesType)
            && (!saved.excludedGenres.length || value !== undefined)
            && !genres(post).some((genre) => saved.excludedGenres.includes(String(genre.id)))
            && (!saved.excludeNSFW || value === ContentRating.SAFE)
            && (context?.allowedContentRatings === undefined || (value !== undefined && context.allowedContentRatings.includes(value)))
    }
    private queryURL(request: SearchRequest<Filters>, saved: Preferences, excluded: string[]): string | undefined {
        this.validateFilters(request.filters)
        const sort = SORTS.find((item) => item.id === (request.sort?.id ?? (request.listId === 'popular' ? 'popular' : 'latest')))
        if (!sort) throw new Error('Unknown Hijala sort')
        const filters = request.filters, types = filters?.types?.length ? filters.types.map((item) => item.id).filter((id) => saved.types.includes(id)) : saved.types
        const included = [...new Set(filters?.genres?.included?.map((item) => item.id) ?? [])]
        const blocked = [...new Set([...excluded, ...saved.excludedGenres, ...(filters?.genres?.excluded?.map((item) => item.id) ?? [])])]
        if (!types.length || included.some((id) => blocked.includes(id))) return undefined
        const params = new URLSearchParams({ page: String(request.page), perPage: String(PAGE_SIZE), orderBy: sort.field,
            orderDirection: filters?.direction && filters.direction.id !== 'default' ? filters.direction.id : request.sort?.ascending === undefined ? sort.direction : request.sort.ascending ? 'asc' : 'desc', seriesType: types.join(',') })
        if (request.query?.trim()) params.set('searchTerm', request.query.trim())
        if (included.length) params.set('genreIds', included.join(','))
        if (blocked.length) params.set('excludedGenreIds', blocked.join(','))
        if (filters?.statuses?.length) params.set('seriesStatus', filters.statuses.map((item) => item.id).join(','))
        for (const field of ['minChapters', 'maxChapters', 'createdAfter', 'createdBefore'] as const) if (filters?.[field]?.trim()) params.set(field, filters[field]!.trim())
        return `${API}/api/query?${params.toString()}`
    }
    async search(request: SearchRequest<Filters>): Promise<PagedSearchResult> {
        return this.withPreferences((saved) => this.searchPage(request, saved))
    }
    private async searchPage(request: SearchRequest<Filters>, saved: Preferences): Promise<PagedSearchResult> {
        if (!Number.isSafeInteger(request.page) || request.page < 1 || request.page > MAX_CATALOG_PAGES) throw new Error('Invalid Hijala page')
        if (request.context?.allowedContentRatings?.length === 0) return { results: [], isLastPage: true }
        if (request.listId && !SECTIONS.some((item) => item.id === request.listId && item.id !== 'genres')) throw new Error('Unknown Hijala list')
        if (!saved.types.length) return { results: [], isLastPage: true }
        if (request.listId === 'featured') {
            const posts = pageProperty<Post[]>(await this.text(`${DOMAIN}/`), 'combinedSliderPosts')
            if (!Array.isArray(posts)) throw new Error('Hijala returned invalid featured series')
            return { results: request.page === 1 ? posts.filter((post) => this.allowed(post, saved, request.context)).map(highlight) : [], isLastPage: true }
        }
        let latestTag = 'latestUpdate'
        if (request.listId === 'latest' || request.listId === 'new') {
            const html = await this.home()
            if (!this.releaseFilters(html).includes(request.listId)) throw new Error('This Hijala release tab is disabled by the source')
            if (request.listId === 'latest') latestTag = this.latestTag(html)
        }
        const excluded = saved.excludeNSFW ? genreOptions(await this.text(`${DOMAIN}/series/`)).filter((genre) => blockedGenre(genre.title)).map((genre) => genre.id) : []
        const stateKey = JSON.stringify([{ ...request, page: undefined }, saved, preferenceRevision])
        const expired = this.pages.get(stateKey)
        for (const [key, entry] of this.pages) if (Date.now() - entry.at >= 180_000 && !(key === stateKey && request.page > 1)) this.pages.delete(key)
        if (request.page > 1 && expired && Date.now() - expired.at >= 180_000) throw new Error('Hijala catalog pagination expired; refresh from page 1')
        let stateEntry = this.pages.get(stateKey)
        if (stateEntry?.invalid) {
            if (request.page !== 1) throw new Error('Hijala catalog pagination is incomplete; restart from page 1')
            this.pages.delete(stateKey)
            stateEntry = undefined
        }
        if (!stateEntry) {
            if (this.pages.size >= 32) this.pages.delete(this.pages.keys().next().value as string)
            stateEntry = { at: Date.now(), values: new Map(), ids: new Map(), references: 0 }
            this.pages.set(stateKey, stateEntry)
        }
        if (stateEntry.ids.size > MAX_CATALOG_PAGES || stateEntry.values.size > MAX_CATALOG_PAGES || !Number.isSafeInteger(stateEntry.references) || stateEntry.references < 0 || stateEntry.references > MAX_CATALOG_ID_REFERENCES) {
            this.invalidateCatalog(stateEntry)
            throw new Error('Hijala continuation state exceeded its bounded catalog limits; restart from page 1')
        }
        const state = stateEntry.values
        const previous = state.get(request.page)
        if (previous) return previous.result
        for (let nativePage = 1; nativePage < request.page; nativePage++) {
            const earlier = state.get(nativePage)?.result ?? await this.searchPage({ ...request, page: nativePage }, saved)
            if (earlier.isLastPage) return { results: [], isLastPage: true }
        }
        const cursor = state.get(request.page - 1)
        if (request.page > 1 && (!cursor || !Number.isSafeInteger(cursor.next) || cursor.next < 2 || cursor.next > MAX_CATALOG_PAGES + 1 || !stateEntry.ids.has(cursor.next - 1))) {
            this.invalidateCatalog(stateEntry)
            throw new Error('Hijala continuation state is invalid or expired; restart from page 1')
        }
        let apiPage = request.page === 1 ? 1 : cursor?.next ?? 1
        const emitted = new Set([...state].filter(([page]) => page < request.page).flatMap(([, entry]) => entry.result.results.map((item) => item.id)))
        let lastURL: string | undefined
        for (let skipped = 0; skipped < 10; skipped++, apiPage++) {
            if (apiPage > MAX_CATALOG_PAGES || (stateEntry.ids.size >= MAX_CATALOG_PAGES && !stateEntry.ids.has(apiPage))) {
                this.invalidateCatalog(stateEntry, lastURL)
                throw new Error('Hijala continuation exceeded its bounded physical-page limit; restart from page 1')
            }
            const physical = { ...request, page: apiPage }
            const url = !request.listId || request.listId === 'popular'
                ? this.queryURL(physical, saved, excluded)
                : `${API}/api/posts?page=${apiPage}&perPage=${PAGE_SIZE}&searchTerm=&isNovel=false&tag=${request.listId === 'latest' || request.listId === 'updates' ? latestTag : request.listId}`
            if (!url) return { results: [], isLastPage: true }
            lastURL = url
            const data: Catalog = catalog(await this.text(url))
            const references = stateEntry.references + data.posts.length - (stateEntry.ids.get(apiPage)?.length ?? 0)
            // Most Chapters can publish the complete unique catalog instead of the requested page size.
            const completeFirstPage = apiPage === 1 && data.posts.length === data.totalCount
            if (data.totalCount > MAX_CATALOG_TITLES || (data.posts.length > PAGE_SIZE && !completeFirstPage) || references > MAX_CATALOG_ID_REFERENCES || data.posts.some((post) => post.slug.length > MAX_CATALOG_ID_LENGTH || slugToId(post.slug).length > MAX_CATALOG_ID_LENGTH)) {
                this.invalidateCatalog(stateEntry, url)
                throw new Error('Hijala catalog exceeded its bounded title or cumulative-ID limits; restart from page 1')
            }
            if ((stateEntry.total !== undefined && stateEntry.total !== data.totalCount) || data.posts.length > data.totalCount) {
                this.invalidateCatalog(stateEntry, url)
                throw new Error('Hijala catalog total changed during pagination; restart from page 1')
            }
            stateEntry.total = data.totalCount
            stateEntry.references = references
            stateEntry.ids.set(apiPage, data.posts.map((post) => post.slug))
            const rawIDs = new Set([...stateEntry.ids].filter(([page]) => page <= apiPage).flatMap(([, ids]) => ids))
            if ((!data.posts.length && rawIDs.size < data.totalCount) || rawIDs.size > data.totalCount) {
                this.invalidateCatalog(stateEntry, url)
                throw new Error('Hijala returned an incomplete catalog before accounting for its advertised titles; restart from page 1')
            }
            const results: Highlight[] = data.posts.filter((post) => this.allowed(post, saved, request.context)).flatMap((post) => {
                const item = highlight(post)
                if (request.listId !== 'updates') return [item]
                if (!Array.isArray(post.chapters)) throw new Error('Hijala returned invalid chapter updates')
                return post.chapters.filter((chapter) => !saved.hidePaid || !isLocked(chapter)).map((chapter): Highlight => {
                    if (!Number.isFinite(chapter.number) || typeof chapter.isLocked !== 'boolean') throw new Error('Hijala returned incomplete update access status')
                    const title = chapterTitle(chapter.title, chapter.number)
                    // A Mana highlight must keep the series ID. Put all visible updates in one native tile rather than duplicate IDs.
                    return { ...item, subtitle: `${isLocked(chapter) ? '[Paid] ' : ''}Chapter ${chapter.number}${title ? `: ${title}` : ''}` }
                }).slice(0, 1)
            }).filter((item) => {
                if (emitted.has(item.id)) return false
                emitted.add(item.id)
                return true
            })
            // Offset pages may overlap. Only the stable advertised unique total,
            // not physical page * page size, establishes complete traversal.
            const result = { results, isLastPage: rawIDs.size === data.totalCount }
            if (results.length || result.isLastPage) {
                state.set(request.page, { next: apiPage + 1, result })
                return result
            }
        }
        this.invalidateCatalog(stateEntry, lastURL)
        throw new Error('Hijala repeated or filtered ten catalog pages without new visible titles; restart from page 1')
    }
    private invalidateCatalog(state: CatalogState, url?: string): void {
        state.invalid = true
        if (!url) return
        const scope = new URL(url)
        scope.searchParams.delete('page')
        for (const key of this.cache.keys()) {
            const cachedURL = new URL(key)
            cachedURL.searchParams.delete('page')
            if (cachedURL.href === scope.href) this.cache.delete(key)
        }
    }
    private latestTag(html: string): string {
        const separatePinned = pageProperty<boolean>(html, 'hasPinnedSeriesSection')
        if (typeof separatePinned !== 'boolean') throw new Error('Hijala returned invalid pinned section configuration')
        return separatePinned ? 'latestUpdate' : 'latestUpdatePinned'
    }
    private releaseFilters(html: string): string[] {
        const filters = pageProperty<string[]>(html, 'latestReleaseFilters')
        if (!Array.isArray(filters) || new Set(filters).size !== filters.length || filters.some((id) => !['latest', 'new'].includes(id))) throw new Error('Hijala home release filters changed')
        return filters
    }
    private async home(): Promise<string> {
        const html = await this.text(`${DOMAIN}/`)
        this.releaseFilters(html)
        return html
    }
    private async bulkMetadata(): Promise<Map<string, Post>> {
        const posts = new Map<string, Post>()
        let total: number | undefined
        // Public query caps perPage at100. Fetch catalog pages in bulk, never one request per home tile.
        for (let page = 1; page <= 10; page++) {
            const data = catalog(await this.text(`${API}/api/query?page=${page}&perPage=100&orderBy=lastChapterAddedAt&orderDirection=desc`))
            if (total !== undefined && total !== data.totalCount) throw new Error('Hijala bulk catalog changed during metadata traversal; refresh')
            total = data.totalCount
            if (data.posts.length !== Math.min(100, Math.max(0, total - (page - 1) * 100))) throw new Error('Hijala returned incomplete bulk metadata')
            for (const post of data.posts) {
                if (posts.has(post.slug)) throw new Error('Hijala repeated a bulk metadata page')
                posts.set(post.slug, post)
            }
            if (page * 100 >= data.totalCount) {
                if (posts.size !== total) throw new Error('Hijala returned incomplete bulk metadata')
                return posts
            }
            if (!data.posts.length) throw new Error('Hijala returned incomplete bulk metadata')
        }
        throw new Error('Hijala bulk metadata exceeded its bounded catalog traversal')
    }
    async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
        if (link.id !== 'home') throw new Error('Unknown Hijala page')
        return this.withPreferences(async (saved) => {
            const enabled = this.releaseFilters(await this.home())
            return SECTIONS.filter((item) => saved.sections.includes(item.id) && (!['latest', 'new'].includes(item.id) || enabled.includes(item.id))).map((item) => ({ ...item, style: item.id === 'featured' ? SectionStyle.SimpleHero : SectionStyle.SimpleSingleRow }))
        })
    }
    async resolvePageSection(link: PageLink, sectionId: string): Promise<ResolvedPageSection> {
        if (link.id !== 'home' || !(await this.getSectionsForPage(link)).some((item) => item.id === sectionId)) throw new Error('Unknown Hijala section')
        if (link.context?.allowedContentRatings?.length === 0) return { items: [] }
        return this.withPreferences(async (saved) => {
            if (sectionId === 'new') {
                const result = await this.searchPage({ page: 1, listId: sectionId, context: link.context }, saved)
                return { items: result.results, viewMoreLink: result.isLastPage ? undefined : { request: { page: 1, listId: sectionId, context: link.context } } }
            }
            const html = await this.home()
            if (sectionId === 'featured' || sectionId === 'latest') {
                const posts = pageProperty<Post[]>(html, sectionId === 'featured' ? 'combinedSliderPosts' : 'latestMangaPosts')
                if (!Array.isArray(posts)) throw new Error('Hijala returned invalid home series')
                const items = posts.filter((post) => this.allowed(post, saved, link.context)).map(highlight)
                if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('Hijala returned duplicate home series')
                // Home's20 releases and API's latest catalog are ordered differently. View more opens the full catalog from its first page, not an invented continuation.
                return { items, viewMoreLink: sectionId === 'latest' ? { request: { page: 1, listId: 'latest', context: link.context } } : undefined }
            }
            const metadata = await this.bulkMetadata()
            if (sectionId === 'popular') {
                const posts = pageProperty<PopularSeries[]>(html, 'transformedTopSeries')
                if (!Array.isArray(posts)) throw new Error('Hijala returned invalid popular home series')
                const items = posts.slice(0, 9).flatMap((post) => {
                    const full = metadata.get(post.slug)
                    if (!full || !this.allowed(full, saved, link.context)) return []
                    if (post.title.trim() !== full.postTitle.trim() || post.coverImage !== full.featuredImage) throw new Error('Hijala popular metadata disagrees with the home page')
                    return [highlight(full)]
                })
                return { items }
            }
            if (sectionId !== 'updates') throw new Error('Unknown Hijala section')
            const updates = pageProperty<HomeUpdate[]>(html, 'chapterUpdates')
            if (!Array.isArray(updates)) throw new Error('Hijala returned invalid home chapter updates')
            const seen = new Set<string>(), items: Highlight[] = []
            for (const update of updates) {
                if (!Number.isFinite(update.chapterNumber) || typeof update.isPaid !== 'boolean') throw new Error('Hijala returned incomplete home update access status')
                const full = metadata.get(update.seriesSlug)
                if (!full || seen.has(update.seriesSlug) || (saved.hidePaid && update.isPaid) || !this.allowed(full, saved, link.context)) continue
                seen.add(update.seriesSlug)
                const item = highlight(full), title = chapterTitle(update.chapterTitle, update.chapterNumber)
                items.push({ ...item, subtitle: `${update.isPaid ? '[Paid] ' : ''}Chapter ${update.chapterNumber}${title ? `: ${title}` : ''}` })
            }
            // The site has45 home update entries. Native Mana has series links only, so show the latest visible update per series, without pretending there is a paged chapter feed.
            return { items }
        })
    }
    private async allowedDetail(id: string, saved: Preferences, context?: SourceContext): Promise<Detail> {
        const result = detail(await this.text(seriesURL(id)), id)
        if (!this.allowed(result.post, saved, context)) throw new Error('This title is excluded by Hijala content preferences')
        return result
    }
    async getContent(contentId: string, context?: SourceContext): Promise<Content> {
        return this.withPreferences(async (saved) => content(await this.allowedDetail(contentId, saved, context), contentId, saved.hidePaid))
    }
    async getChapters(contentId: string): Promise<Chapter[]> {
        return this.withPreferences(async (saved) => nativeChapters(await this.allowedDetail(contentId, saved), contentId, saved.hidePaid))
    }
    async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
        idToSlug(contentId)
        idToSlug(chapterId)
        return this.withPreferences(async (saved) => {
            const data = await this.allowedDetail(contentId, saved)
            const chapter = data.chapters.find((item) => slugToId(item.slug) === chapterId)
            if (!chapter) throw new Error('Hijala chapter does not belong to this series')
            if (isLocked(chapter)) throw new Error('This chapter requires access on the Hijala website')
            return reader(await this.text(seriesURL(contentId, chapterId)), contentId, chapterId)
        })
    }
    async handleURL(url: string): Promise<DeepLinkContext | null> {
        const match = url.match(/^https?:\/\/(?:www\.)?en-hijala\.com\/series\/([^/?#]+)(?:\/([^/?#]+))?\/?(?:[?#].*)?$/i)
        if (!match?.[1]) return null
        const id = slugToId(decodeURIComponent(match[1]))
        if (match[2]) slugToId(decodeURIComponent(match[2]))
        const result = await this.getContent(id)
        return { content: { id, title: result.title, cover: result.cover, webUrl: result.webUrl, contentRating: result.contentRating } }
    }
    async willRequestImage(url: string): Promise<NetworkRequest> {
        return { url, headers: { Referer: `${DOMAIN}/`, Origin: DOMAIN, Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5' } }
    }
}
