import {
    CloudflareError,
    HttpClient,
    HttpMethod,
    HttpRequest,
    HttpResponse
} from '@mana-app/types'
import {
    VORTEX_API_URL,
    VORTEX_DOMAIN,
    VortexChapter,
    VortexChapterResponse,
    VortexChaptersResponse,
    VortexCollectionDetailResponse,
    VortexCollectionsResponse,
    VortexGenre,
    VortexPostResponse,
    VortexQueryResponse,
    VortexQueryValue
} from './VortexScansModels'
import { buildVortexApiUrl } from './VortexScansUtils'

export class VortexScansApi {
    private readonly client: HttpClient

    constructor(client?: HttpClient) {
        this.client = client ?? new HttpClient()
            .setRateLimit(4, 1000)
            .setTimeoutMs(30_000)
            .addHeader(
                'Accept',
                'application/json,text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
            )
            .addHeader('Referer', `${VORTEX_DOMAIN}/`)
            .addHeader('Origin', VORTEX_DOMAIN)
    }

    getPost(postId: string): Promise<VortexPostResponse> {
        return this.getJson('post', { postId })
    }

    getPostBySlug(postSlug: string): Promise<VortexPostResponse> {
        return this.getJson('post', { postSlug })
    }

    async getChapters(postId: string): Promise<VortexChaptersResponse> {
        const take = 500, chapters = new Map<number, VortexChapter>()
        let skip = 0, total: number | undefined
        // Bound provider errors without returning a silently truncated inventory.
        for (let page = 0; page < 20; page++) {
            const response = await this.getJson<VortexChaptersResponse>('chapters', {
                postId, skip, take, order: 'desc', search: ''
            })
            const rows = response.post?.chapters
            if (!Array.isArray(rows) || rows.length > take) throw new Error('VortexScans returned invalid chapter inventory')
            if (response.totalChapterCount !== undefined) {
                const count = response.totalChapterCount
                if (!Number.isSafeInteger(count) || count < 0 || (total !== undefined && total !== count)) {
                    throw new Error('VortexScans chapter total changed or is invalid; refresh')
                }
                total = count
            }
            const before = chapters.size
            for (const chapter of rows) {
                if (!chapter || !Number.isSafeInteger(chapter.id) || chapter.id <= 0
                    || (chapter.mangaPostId !== undefined && String(chapter.mangaPostId) !== postId)) {
                    throw new Error('VortexScans returned mismatched or invalid chapter identity')
                }
                const previous = chapters.get(chapter.id)
                if (previous && JSON.stringify(previous) !== JSON.stringify(chapter)) {
                    throw new Error('VortexScans chapter changed across inventory pages; refresh')
                }
                chapters.set(chapter.id, chapter)
            }
            if (total !== undefined && chapters.size > total) throw new Error('VortexScans chapter inventory exceeds its total; refresh')
            if ((total !== undefined && chapters.size === total) || (total === undefined && rows.length < take)) {
                return { post: { chapters: [...chapters.values()] }, ...(total === undefined ? {} : { totalChapterCount: total }) }
            }
            if (chapters.size === before) throw new Error('VortexScans chapter inventory stopped before completion; refresh')
            // Advance by consumed rows, not unique IDs or publicly readable rows.
            skip += rows.length
        }
        throw new Error('VortexScans chapter inventory exceeded 20 pages; refresh')
    }

    getChapter(chapterId: string): Promise<VortexChapterResponse> {
        return this.getJson('chapter', { chapterId })
    }

    getGenres(): Promise<VortexGenre[]> {
        return this.getJson('genres')
    }

    getCollections(): Promise<VortexCollectionsResponse> {
        return this.getJson('collections')
    }

    getCollection(slug: string): Promise<VortexCollectionDetailResponse> {
        return this.getJson(`collections/${encodeURIComponent(slug)}`)
    }

    query(parameters: Record<string, VortexQueryValue>): Promise<VortexQueryResponse> {
        return this.getJson('query', parameters)
    }

    getTaggedPosts(
        tag: 'latestUpdatePinned' | 'new',
        page: number,
        perPage: number
    ): Promise<VortexQueryResponse> {
        return this.getJson('posts', {
            page,
            perPage,
            searchTerm: '',
            isNovel: false,
            tag
        })
    }

    async getText(url: string): Promise<string> {
        const response = await this.client.request({
            url,
            method: HttpMethod.Get
        })
        await this.checkResponse(response)
        return response.text()
    }

    private async getJson<T>(
        path: string,
        parameters: Record<string, VortexQueryValue> = {}
    ): Promise<T> {
        const url = buildVortexApiUrl(path, parameters)
        const response = await this.client.request({
            url,
            method: HttpMethod.Get
        })
        await this.checkResponse(response)

        try {
            return await response.json<T>()
        } catch {
            throw new Error(`VortexScans returned invalid JSON from ${url}`)
        }
    }

    private async checkResponse(response: HttpResponse): Promise<void> {
        if (await isVortexChallenge(response)) {
            // Resolve the exact host which served the challenge. vShield can
            // protect api.vortexscans.org independently from vortexscans.org.
            throw new CloudflareError(response.request.url)
        }

        if (response.status === 404) {
            throw new Error(`The requested VortexScans page was not found: ${response.request.url}`)
        }
        if (response.status < 200 || response.status >= 300) {
            throw new Error(
                `VortexScans request failed with status ${response.status}: ${response.request.url}`
            )
        }
    }
}

export async function isVortexChallenge(response: HttpResponse): Promise<boolean> {
    const challengeHeader = response.headers.get('cf-mitigated')

    return response.status === 403
        || response.status === 503
        || `${challengeHeader ?? ''}`.toLowerCase() === 'challenge'
        || (isVortexUrl(response.request)
            && (await response.text()).includes('vShield'))
}

function isVortexUrl(request: HttpRequest): boolean {
    return request.url.startsWith(VORTEX_DOMAIN)
        || request.url.startsWith(VORTEX_API_URL)
}
