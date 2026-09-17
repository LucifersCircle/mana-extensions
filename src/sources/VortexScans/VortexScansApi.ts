import {
    NetworkClientBuilder,
    NetworkRequest,
    NetworkResponse
} from '@mana-app/types'
import {
    VORTEX_API_URL,
    VORTEX_DOMAIN,
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
    private readonly client: NetworkClient

    constructor(client?: NetworkClient) {
        this.client = client ?? new NetworkClientBuilder()
            .setRateLimit(4, 1)
            .setTimeout(30_000)
            .setStatusValidator((status) =>
                status === 403
                || status === 404
                || status === 503
                || (status >= 200 && status < 300)
            )
            .addHeader(
                'Accept',
                'application/json,text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
            )
            .addHeader('Referer', `${VORTEX_DOMAIN}/`)
            .addHeader('Origin', VORTEX_DOMAIN)
            .build()
    }

    getPost(postId: string): Promise<VortexPostResponse> {
        return this.getJson('post', { postId })
    }

    getPostBySlug(postSlug: string): Promise<VortexPostResponse> {
        return this.getJson('post', { postSlug })
    }

    getChapters(postId: string): Promise<VortexChaptersResponse> {
        return this.getJson('chapters', {
            postId,
            skip: 0,
            take: 500,
            order: 'desc',
            search: ''
        })
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
            method: 'GET'
        })
        this.checkResponse(response)
        return response.data
    }

    private async getJson<T>(
        path: string,
        parameters: Record<string, VortexQueryValue> = {}
    ): Promise<T> {
        const url = buildVortexApiUrl(path, parameters)
        const response = await this.client.request({
            url,
            method: 'GET'
        })
        this.checkResponse(response)

        try {
            return JSON.parse(response.data) as T
        } catch {
            throw new Error(`VortexScans returned invalid JSON from ${url}`)
        }
    }

    private checkResponse(response: NetworkResponse): void {
        if (isVortexChallenge(response)) {
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

export function isVortexChallenge(response: NetworkResponse): boolean {
    const challengeHeader = Object.entries(response.headers ?? {})
        .find(([key]) => key.toLowerCase() === 'cf-mitigated')?.[1]

    return response.status === 403
        || response.status === 503
        || `${challengeHeader ?? ''}`.toLowerCase() === 'challenge'
        || (isVortexUrl(response.request)
            && typeof response.data === 'string'
            && response.data.includes('vShield'))
}

function isVortexUrl(request: NetworkRequest): boolean {
    return request.url.startsWith(VORTEX_DOMAIN)
        || request.url.startsWith(VORTEX_API_URL)
}
