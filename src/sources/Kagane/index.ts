/* SPDX-License-Identifier: GPL-3.0-or-later */
import {
    CatalogRating,
    Chapter,
    ChapterData,
    Content,
    ContentSource,
    DeepLinkContext,
    Form,
    ImageRequestHandler,
    NetworkRequest,
    PagedSearchResult,
    PageLink,
    PageLinkResolver,
    PageSection,
    ResolvedPageSection,
    SearchExcludableMultiPickerSheet,
    SearchForm,
    SearchListSection,
    SearchMultiPickerSheet,
    SearchRequest,
    SearchSortSection,
    SearchTextField,
    SearchToggle,
    SortOption,
    SourceContext,
    SourceInfo,
    SourcePreferenceProvider,
    UIListSection,
    UIMultiPicker,
    UIPicker,
    UIToggle
} from '@mana-app/types'
import { KaganeApi } from './KaganeApi'
import { Challenge,
    Detail,
    DOMAIN,
    Filters,
    FORMATS,
    LANGUAGES,
    ManifestPage,
    options,
    PAGE_SIZE,
    RATINGS,
    SECTIONS,
    Settings,
    SORTS,
    STATUSES,
    UPLOADS,
    validId } from './KaganeModels'
import { allowed,
    available,
    classify,
    chapters,
    content,
    highlight,
    readerExpiry } from './KaganeParsers'
import { hasHidden,
    hostRatingKey,
    includedTagGroups,
    matchesTagGroups,
    selectedOptions,
    searchBody,
    selectedRatings } from './KaganeSearch'
import { groupTags,
    tagFilterId } from './tag-groups'

type ReaderSession = { challenge: Challenge, expiry: number }
type SearchPage = { result: PagedSearchResult, next: number, seenIDs: string[] }

export class Target implements ContentSource, PageLinkResolver, ImageRequestHandler, SourcePreferenceProvider {
    readonly info: SourceInfo = {
        id: 'Kagane', version: '0.0.1-alpha.2', name: 'Kagane',
        description: 'Kagane with current API support, grouped tags and global four-category content settings.',
        thumbnail: 'Kagane.png', rating: CatalogRating.MIXED, website: DOMAIN,
        badges: ['Manga', 'Manhwa', 'Manhua', 'Comic'], supportedLanguages: ['en_US'],
        developers: [{ name: 'Lucifers Circle', github: 'https://github.com/LucifersCircle' }, { name: 'PoppingMango Sources', github: 'https://github.com/PoppingMangoSources' }]
    }
    readonly config = { cloudflareResolutionURL: `${DOMAIN}/`, owningLinks: ['kagane.org'] }
    private readonly api = new KaganeApi()
    private settingsRevision = 0
    private settingsKey = ''
    private preferenceWrite: Promise<void> = Promise.resolve()
    private readonly searchPages = new Map<string, { at: number, pages: Map<number, Promise<SearchPage>> }>()
    private readonly readerImages = new Map<string, { seriesId: string, chapterId: string, page: ManifestPage, settingsKey: string }>()
    private readonly readerSessions = new Map<string, ReaderSession>()

    private async settings(): Promise<Settings> {
        await this.preferenceWrite
        const keys = ['contentRatings', 'showSource', 'showEdition', 'cleanTitle', 'showSpoilers', 'dataSaver', 'uploadSource', 'languages', 'excludedGenres', 'excludedTags', 'chapterTitle']
        const values = await Promise.all(keys.map((key) => ObjectStore.get(`Kagane.${key}`)))
        const [contentRatings, showSource, showEdition, cleanTitle, showSpoilers, dataSaver, uploadSource, languages, excludedGenres, excludedTags, chapterTitle] = values
        const stringArray = (value: unknown, fallback: string[]): string[] => Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : fallback
        const settings: Settings = {
            contentRatings: Array.isArray(contentRatings) ? RATINGS.filter((rating) => contentRatings.includes(rating)) : [...RATINGS], showSource: showSource === true, showEdition: showEdition === true,
            cleanTitle: cleanTitle === true, showSpoilers: showSpoilers === true, dataSaver: dataSaver === true,
            uploadSource: UPLOADS.some((option) => option.id === uploadSource) ? uploadSource as string : 'all',
            languages: stringArray(languages, ['en']), excludedGenres: stringArray(excludedGenres, []), excludedTags: stringArray(excludedTags, []),
            chapterTitle: ['optional', 'always', 'vol_chapter', 'original'].includes(chapterTitle as string) ? chapterTitle as string : 'always'
        }
        const key = JSON.stringify(settings)
        if (key !== this.settingsKey) {
            this.settingsKey = key
            this.settingsRevision += 1
            this.searchPages.clear()
            this.readerImages.clear()
            this.readerSessions.clear()
            this.api.invalidate()
        }
        return settings
    }

    private async save(key: string, value: boolean | string | string[]): Promise<void> {
        this.settingsRevision += 1
        this.searchPages.clear()
        this.readerImages.clear()
        this.readerSessions.clear()
        this.api.invalidate()
        this.preferenceWrite = this.preferenceWrite.catch(() => undefined).then(() => ObjectStore.set(`Kagane.${key}`, value))
        await this.preferenceWrite
    }

    private async withSettings<T>(operation: (settings: Settings) => Promise<T>): Promise<T> {
        const settings = await this.settings()
        const revision = this.settingsRevision
        const result = await operation(settings)
        await this.settings()
        if (revision !== this.settingsRevision) throw new Error('Kagane settings changed during this request; refresh to continue')
        return result
    }

    async getPreferenceMenu(): Promise<Form> {
        const settings = await this.settings()
        const [genres, tags] = await Promise.all([this.api.genres().catch(() => []), this.api.tags().catch(() => [])])
        return { sections: [
            UIListSection({ header: 'Content safety', footer: 'Native Mana rating policy controls visibility when supplied. All source categories are available by default; an explicitly saved source selection remains an additional filter. Selecting none hides all titles. Incomplete rating metadata uses a Mature compatibility fallback with a details note. Applied locally to browsing, searches, details, chapters and reading because API filters can be ignored. Site labels are not a guarantee of image content.', children: [
                UIMultiPicker({ id: 'contentRatings', title: 'Content categories to show', options: options(RATINGS), value: settings.contentRatings, didChange: (value) => this.save('contentRatings', value) }),
                UIMultiPicker({ id: 'excludedGenres', title: 'Hidden genres', options: genres.map((genre) => ({ id: genre.id, title: genre.genre_name })), value: settings.excludedGenres, didChange: (value) => this.save('excludedGenres', value) })
            ] }),
            UIListSection({ header: 'Catalog', footer: 'No languages selected means all languages. Upload filters and hidden tags apply globally.', children: [
                UIPicker({ id: 'uploadSource', title: 'Uploads', options: UPLOADS, value: settings.uploadSource, didChange: (value) => this.save('uploadSource', value) }),
                UIMultiPicker({ id: 'languages', title: 'Languages', options: LANGUAGES, value: settings.languages, didChange: (value) => this.save('languages', value) })
            ] }),
            ...groupTags(tags.map((tag) => ({ id: tag.id, title: tag.tag_name }))).map(({ group, options }) => UIListSection({ header: `Hidden tags: ${group.title}`, children: [
                UIMultiPicker({ id: `excludedTags:${group.id}`, title: group.title, options, value: settings.excludedTags.filter((id) => options.some((option) => option.id === id)), didChange: async (value) => { const current = await this.settings(); await this.save('excludedTags', [...current.excludedTags.filter((id) => !options.some((option) => option.id === id)), ...value]) } })
            ] })),
            UIListSection({ header: 'Titles and reader', children: [
                ...([['showSource', 'Show upload source in titles'], ['showEdition', 'Show edition in titles'], ['cleanTitle', 'Clean trailing title labels'], ['showSpoilers', 'Show spoiler tags'], ['dataSaver', 'Data saver']] as const).map(([key, title]) => UIToggle({ id: key, title, value: settings[key], didChange: (value) => this.save(key, value) })),
                UIPicker({ id: 'chapterTitle', title: 'Chapter titles', options: [{ id: 'always', title: 'Ch.X + Title' }, { id: 'vol_chapter', title: 'Vol.X Ch.Y + Title' }, { id: 'optional', title: 'Title only' }, { id: 'original', title: 'Original website title' }], value: settings.chapterTitle, didChange: (value) => this.save('chapterTitle', value) })
            ] })
        ] }
    }

    async getSearchForm(): Promise<SearchForm> {
        return this.withSettings(async (settings) => {
            const [genres, tags, sources] = await Promise.all([this.api.genres(), this.api.tags(), this.api.sources()])
            return { sections: [
                SearchListSection({ header: 'Filters', children: [
                    SearchMultiPickerSheet({ id: 'content_rating', title: 'Content rating', options: options(settings.contentRatings) }),
                    SearchMultiPickerSheet({ id: 'format', title: 'Format', options: FORMATS }),
                    SearchMultiPickerSheet({ id: 'upload_status', title: 'Status', options: STATUSES }),
                    SearchMultiPickerSheet({ id: 'source_id', title: 'Upload sources', options: sources.filter((source) => settings.uploadSource === 'all' || (settings.uploadSource === 'official' ? source.source_type === 'Official' : source.source_type !== 'Official')).map((source) => ({ id: source.source_id, title: source.title })) }),
                    SearchToggle({ id: 'exact_match', title: 'Exact title match' }),
                    SearchExcludableMultiPickerSheet({ id: 'genres', title: 'Genres', options: genres.map((genre) => ({ id: genre.id, title: genre.genre_name })) }),
                    SearchToggle({ id: 'match_all_genres', title: 'Match all genres' })
                ] }),
                SearchListSection({ header: 'Tags', footer: 'Match All Tags is off by default. Comma-separated tag names can be prefixed with - to exclude them.', children: [
                    SearchTextField({ id: 'tag_query', title: 'Find tags by name', placeholder: 'Tag, -excluded tag' }),
                    SearchToggle({ id: 'match_all_tags', title: 'Match All Tags' }),
                    ...groupTags(tags.map((tag) => ({ id: tag.id, title: tag.tag_name }))).map(({ group, options }) => SearchExcludableMultiPickerSheet({ id: tagFilterId(group.id), title: group.title, options }))
                ] }),
                SearchSortSection({ header: 'Sort' })
            ] }
        })
    }

    async getSortOptions(): Promise<SortOption[]> { return SORTS }

    async search(request: SearchRequest<Filters>): Promise<PagedSearchResult> {
        return this.withSettings(async (settings) => {
            const page = request.page ?? 1
            if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw new Error('Invalid Kagane page')
            const section = request.listId ? SECTIONS.find((entry) => entry.id === request.listId) : undefined
            if (request.listId && !section) throw new Error('Unknown Kagane discovery list')
            const ratings = selectedRatings(request, settings)
            const explicitSourceRatings = selectedOptions(request.filters, 'content_rating')
            if (!ratings.length) return { results: [], isLastPage: true }
            const tags = typeof request.filters?.tag_query === 'string' && request.filters.tag_query.trim() ? await this.api.tags() : []
            const conceptualTags = includedTagGroups(request.filters, tags)
            const body = searchBody(section ? { ...request, query: undefined, filters: undefined } : request, settings, tags)
            const sort = section?.sort ?? request.sort?.id ?? 'relevance'
            if (!SORTS.some((option) => option.id === sort)) throw new Error('Unknown Kagane sort')
            const sortParameter = sort === 'relevance' ? '' : `${sort},desc`
            const exact = request.filters?.exact_match === true
            const key = `${JSON.stringify(settings)}:${JSON.stringify(body)}:${sortParameter}:${exact}:${JSON.stringify(conceptualTags)}:${request.filters?.match_all_tags === true}:${hostRatingKey(request.context?.allowedContentRatings)}`
            let cached = this.searchPages.get(key)
            if (!cached || Date.now() - cached.at > 30_000) {
                if (this.searchPages.size >= 25) this.searchPages.delete(this.searchPages.keys().next().value as string)
                cached = { at: Date.now(), pages: new Map() }
                this.searchPages.set(key, cached)
            }
            const session = cached.pages
            const loadPage = (logicalPage: number): Promise<SearchPage> => {
                const existing = session.get(logicalPage)
                if (existing) return existing
                const promise = (async (): Promise<SearchPage> => {
                    const previous = logicalPage > 1 ? await loadPage(logicalPage - 1) : undefined
                    if (previous?.result.isLastPage) return { result: { results: [], isLastPage: true }, next: previous.next, seenIDs: previous.seenIDs }
                    let rawPage = previous?.next ?? 1
                    const seenIDs = new Set<string>(previous?.seenIDs ?? [])
                    for (let attempt = 0; attempt < 20; attempt += 1, rawPage += 1) {
                        if (rawPage > 1000) throw new Error('Kagane pagination exceeded its bounded page limit; refresh')
                        const response = await this.api.search(body, rawPage, PAGE_SIZE, sortParameter, exact)
                        const visible = response.content.filter((item) => {
                            if (!item || typeof item.series_id !== 'string' || typeof item.title !== 'string' || !item.title.trim()) throw new Error('Kagane search contains invalid titles')
                            validId(item.series_id)
                            if (seenIDs.has(item.series_id)) return false
                            seenIDs.add(item.series_id)
                            if (seenIDs.size > 10000) throw new Error('Kagane pagination exceeded its bounded title limit; refresh')
                            if (!classify(item) && explicitSourceRatings.length) return false
                            return matchesTagGroups(item.tags, conceptualTags, request.filters?.match_all_tags === true) && allowed(item, settings, ratings, request.context?.allowedContentRatings) && !!item.cover_image_id?.trim() && !hasHidden(item.genres, settings.excludedGenres) && !hasHidden(item.tags, settings.excludedTags)
                        })
                        if (visible.length || response.last) {
                            const sources = settings.showSource ? await this.api.sources() : []
                            return { result: { results: visible.map((item) => highlight(item, settings, sources)), isLastPage: response.last }, next: rawPage + 1, seenIDs: [...seenIDs] }
                        }
                    }
                    throw new Error('Kagane returned too many repeated or filtered-out pages; narrow your search')
                })().catch((error: unknown) => { session.delete(logicalPage); throw error })
                session.set(logicalPage, promise)
                return promise
            }
            const result = (await loadPage(page)).result
            // Only policy-filtered metadata is cached; origin and other native
            // context belong to the current request, including cache hits.
            return { ...result, results: result.results.map((item) => ({ ...item, context: request.context })) }
        })
    }

    private async requireAllowed(id: string, settings: Settings, context?: SourceContext): Promise<Detail> {
        validId(id)
        if (!settings.contentRatings.length || context?.allowedContentRatings?.length === 0) throw new Error('This title is excluded by Kagane or Mana content-rating policy')
        const details = await this.api.series(id)
        if (!allowed(details, settings, undefined, context?.allowedContentRatings) || hasHidden(details.genres?.map((genre) => genre.genre_id ?? ''), settings.excludedGenres) || hasHidden(details.tags?.map((tag) => tag.tag_id ?? ''), settings.excludedTags)) throw new Error('This title is excluded by Kagane content settings or its rating cannot be verified')
        const source = settings.uploadSource !== 'all' ? (await this.api.sources()).find((entry) => entry.source_id === details.source_id) : undefined
        if (settings.uploadSource !== 'all' && (!source || (settings.uploadSource === 'official' ? source.source_type !== 'Official' : source.source_type === 'Official'))) throw new Error('This title is excluded by Kagane upload-source settings')
        return details
    }

    async getContent(contentId: string, context?: SourceContext): Promise<Content> {
        return this.withSettings(async (settings) => content(contentId, await this.requireAllowed(contentId, settings, context), settings, await this.api.sources()))
    }

    async getChapters(contentId: string): Promise<Chapter[]> {
        return this.withSettings(async (settings) => {
            const details = await this.requireAllowed(contentId, settings)
            const [books, sources] = await Promise.all([this.api.books(contentId), this.api.sources()])
            return chapters(contentId, books, details, settings, sources)
        })
    }

    async getChapterData(contentId: string, chapterId: string): Promise<ChapterData> {
        return this.withSettings(async (settings) => {
            await this.requireAllowed(contentId, settings)
            validId(chapterId)
            const book = (await this.api.books(contentId)).find((entry) => entry.book_id === chapterId)
            if (!book || !available(book)) throw new Error('Kagane chapter is unavailable or does not belong to this series')
            const challenge = await this.api.challenge(chapterId, settings.dataSaver)
            if (Number.isSafeInteger(book.page_count) && (book.page_count ?? 0) > 0 && challenge.manifest?.pages?.length !== book.page_count) throw new Error('Kagane reader returned an incomplete chapter manifest')
            const pages = [...(challenge.manifest?.pages ?? [])].sort((left, right) => left.page_no - right.page_no).map((page) => ({ url: this.api.pageURL(challenge, chapterId, page, settings.dataSaver) }))
            // Authorize the exact issued URLs only under the settings that produced them.
            if (this.readerImages.size > 3000) this.readerImages.clear()
            this.readerSessions.set(`${contentId}:${chapterId}`, { challenge, expiry: readerExpiry(challenge.access_token) })
            for (const page of challenge.manifest?.pages ?? []) {
                const url = this.api.pageURL(challenge, chapterId, page, settings.dataSaver)
                this.readerImages.set(url, { seriesId: contentId, chapterId, page, settingsKey: JSON.stringify(settings) })
            }
            return { pages }
        })
    }

    async getSectionsForPage(link: PageLink): Promise<PageSection[]> {
        this.home(link)
        return SECTIONS.map(({ id, title, style }) => ({ id, title, style }))
    }

    async resolvePageSection(link: PageLink, sectionId: string): Promise<ResolvedPageSection> {
        this.home(link)
        const request = { page: 1, listId: sectionId, context: link.context }
        const result = await this.search(request)
        return { items: result.results, viewMoreLink: result.isLastPage ? undefined : { request } }
    }

    private home(link: PageLink): void { if (link.id !== 'home') throw new Error('Unknown Kagane page') }

    async handleURL(value: string): Promise<DeepLinkContext | null> {
        const match = /^https?:\/\/(?:www\.)?kagane\.org\/series\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/i.exec(value)
        if (!match?.[1]) return null
        const result = await this.getContent(match[1])
        return { content: { id: match[1], title: result.title, cover: result.cover, contentRating: result.contentRating, webUrl: result.webUrl } }
    }

    async willRequestImage(url: string): Promise<NetworkRequest> {
        const target = new URL(url)
        if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443') || (target.hostname !== 'kstatic.to' && target.hostname !== 'kagane.org' && !target.hostname.endsWith('.kagane.org'))) throw new Error('Untrusted Kagane image URL')
        if (!target.pathname.startsWith('/api/v2/image/') && !target.pathname.startsWith('/api/v2/books/page/')) throw new Error('Invalid Kagane image URL')
        let resolvedURL = url
        if (target.pathname.startsWith('/api/v2/books/page/')) {
            await this.withSettings(async (settings) => {
                const authorization = this.readerImages.get(url)
                if (!authorization || authorization.settingsKey !== this.settingsKey) throw new Error('Kagane reader settings changed; reopen the chapter')
                await this.requireAllowed(authorization.seriesId, settings)
                const key = `${authorization.seriesId}:${authorization.chapterId}`
                let session = this.readerSessions.get(key)
                if (!session || Date.now() >= session.expiry) {
                    const challenge = await this.api.challenge(authorization.chapterId, settings.dataSaver)
                    session = { challenge, expiry: readerExpiry(challenge.access_token) }
                    this.readerSessions.set(key, session)
                }
                const samePage = session.challenge.manifest?.pages?.find((page) => page.page_id === authorization.page.page_id && page.page_no === authorization.page.page_no && (page.ext || 'jxl') === (authorization.page.ext || 'jxl'))
                if (!samePage) throw new Error('Kagane chapter pages changed; reopen the chapter')
                resolvedURL = this.api.pageURL(session.challenge, authorization.chapterId, samePage, settings.dataSaver)
                this.readerImages.set(resolvedURL, authorization)
            })
        }
        return { url: resolvedURL, headers: { Referer: `${DOMAIN}/`, Origin: DOMAIN, Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5' } }
    }
}
