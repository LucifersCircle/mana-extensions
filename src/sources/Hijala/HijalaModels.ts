/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Lucifers Circle */

export const DOMAIN = 'https://en-hijala.com'
export const API = 'https://api.en-hijala.com'
export const PAGE_SIZE = 20
export const SECTIONS = [
    { id: 'featured', title: 'Featured' }, { id: 'latest', title: 'Latest Releases' },
    { id: 'new', title: 'New' },
    { id: 'popular', title: 'Most Popular' }, { id: 'updates', title: 'Latest Updates' }
]
export const SORTS = [
    { id: 'latest', title: 'Latest Chapters', field: 'lastChapterAddedAt', direction: 'desc' },
    { id: 'popular', title: 'Most Popular', field: 'totalViews', direction: 'desc' },
    { id: 'newest', title: 'Newest Added', field: 'createdAt', direction: 'desc' },
    { id: 'oldest', title: 'Oldest First', field: 'createdAt', direction: 'asc' },
    { id: 'chapters', title: 'Most Chapters', field: 'chaptersCount', direction: 'desc' },
    { id: 'title', title: 'A–Z', field: 'postTitle', direction: 'asc' }
] as const
export const STATUSES = ['ONGOING', 'COMPLETED', 'CANCELLED', 'DROPPED', 'MASS_RELEASED', 'COMING_SOON', 'ONE_SHOT', 'HIATUS']
export const TYPES = ['MANHWA', 'MANHUA', 'MANGA', 'SPANISH', 'RUSSIAN']
export const LABELS: Record<string, string> = {
    MANHWA: 'Manhwa', MANHUA: 'Manhua', MANGA: 'Manga', SPANISH: 'Spanish', RUSSIAN: 'Russian',
    ONGOING: 'Ongoing', COMPLETED: 'Completed', CANCELLED: 'Cancelled', DROPPED: 'Dropped',
    MASS_RELEASED: 'Mass released', COMING_SOON: 'Coming soon', ONE_SHOT: 'One-shot', HIATUS: 'Hiatus'
}
export interface Genre { id: number, name: string }
export interface SiteChapter {
    slug: string, number: number, title?: string | null, volume?: number | string | null,
    createdAt?: string, isLocked?: boolean, isAccessible?: boolean,
    isShortLinkLocked?: boolean, isLockedByCoins?: boolean, isPermanentlyLocked?: boolean | number,
    price?: number, team?: { name: string } | null
}
export interface Post {
    slug: string, postTitle: string, featuredImage: string, postContent?: string,
    alternativeTitles?: string, author?: string, artist?: string, releaseDate?: string,
    seriesStatus?: string, seriesType?: string, isNovel?: boolean, averageRating?: number,
    genres?: Genre[], chapters?: SiteChapter[], _count?: { chapters: number }
}
export interface Catalog { posts: Post[], totalCount: number }
export interface ReaderChapter extends SiteChapter {
    seriesSlug?: string, isNovel?: boolean, requiresProtectedFetch?: boolean,
    publicImages?: { url: string, order: number }[],
    mangaPost?: { slug: string, isNovel?: boolean }, images?: { url: string, order: number }[]
}
export interface Preferences {
    excludeNSFW: boolean, ratingPreferenceVersion?: number, hidePaid: boolean, types: string[], sections: string[], excludedGenres: string[]
}

export interface HomeUpdate {
    chapterSlug: string, chapterNumber: number, chapterTitle?: string,
    isPaid: boolean, seriesSlug: string, seriesTitle: string, seriesImage: string
}
export interface PopularSeries { slug: string, title: string, coverImage: string }
