import {
    ExcludableMultiSelectProp,
    Option,
    SectionStyle
} from '@mana-app/types'

export const VORTEX_DOMAIN = 'https://vortexscans.org'
export const VORTEX_API_URL = 'https://api.vortexscans.org/api'
export const VORTEX_LANGUAGE = 'en_US'
export const VORTEX_PAGE_SIZE = 48
export const VORTEX_FALLBACK_IMAGE = 'https://i.imgur.com/GYUxEX8.png'

export type VortexQueryValue = string | number | boolean | undefined

export type VortexFilterProps = {
    genres?: ExcludableMultiSelectProp
    status?: Option
    type?: Option
}

export interface VortexGenre {
    id: number
    name: string
    color?: string | null
}

export interface VortexChapter {
    id: number
    number: number | string
    title?: string | null
    featuredImage?: string | null
    slug: string
    mangaPostId?: number
    createdAt?: string | null
    unlockAt?: string | null
    price?: number | null
    isAccessible?: boolean | null
    isLocked?: boolean | null
    isPurchased?: boolean | null
    hasPurchased?: boolean | null
    isPermanentlyLocked?: boolean | number | null
    isShortLinkLocked?: boolean | null
    isTimeLocked?: boolean | null
    mangaPost?: {
        slug?: string | null
    } | null
}

export interface VortexPost {
    id: number
    slug: string
    postTitle: string
    postContent?: string | null
    alternativeTitles?: string | null
    featuredImage?: string | null
    featuredImageCL?: string | null
    seriesStatus?: string | null
    seriesType?: string | null
    isNovel?: boolean | null
    genres?: VortexGenre[] | null
    chapters?: VortexChapter[] | null
    author?: string | null
    artist?: string | null
    _count?: {
        chapters?: number
    } | null
}

export interface VortexQueryResponse {
    posts: VortexPost[]
    totalCount?: number
}

export interface VortexPostResponse {
    post: VortexPost
    totalChapterCount?: number
}

export interface VortexChaptersResponse {
    post?: {
        chapters?: VortexChapter[] | null
    } | null
    totalChapterCount?: number
}

export interface VortexPageImage {
    id?: number
    url: string
    order?: number | null
}

export interface VortexChapterData {
    id?: number
    slug?: string
    images?: VortexPageImage[] | null
    isAccessible?: boolean | null
    isLocked?: boolean | null
    isLockedByCoins?: boolean | null
    isPermanentlyLocked?: boolean | number | null
    isShortLinkLocked?: boolean | null
}

export interface VortexChapterResponse {
    chapter?: VortexChapterData | null
}

export interface VortexHomeSection {
    id: string
    title: string
    style: SectionStyle
}

export interface VortexCollection {
    id: number
    slug: string
    title: string
    description?: string | null
    coverImage?: string | null
    bannerImage?: string | null
    artworkImage?: string | null
    displayOrder?: number | null
    totalViews?: number
    isPublished?: boolean
    likesCount?: number
    worksCount?: number
}

export interface VortexCollectionsResponse {
    collections?: VortexCollection[] | null
}

export interface VortexCollectionWork {
    id: number
    position: number
    post: Pick<
    VortexPost,
    'id' | 'slug' | 'postTitle' | 'featuredImage' | 'seriesType'
    >
}

export interface VortexCollectionDetailResponse {
    collection?: (VortexCollection & {
        works?: VortexCollectionWork[] | null
    }) | null
}
