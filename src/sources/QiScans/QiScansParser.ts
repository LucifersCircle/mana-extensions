/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex; Copyright © 2026 Lucifers Circle */
import { Chapter,
    Content,
    ContentType,
    PublicationStatus,
    ReadingMode,
    staff,
    tags } from '@mana-app/types'
import { load } from 'cheerio'
import { decode } from 'html-entities'
import { incompleteRatingInfo,
    nativeRating } from '../../ContentRatingPolicy'
// Preserve the upstream v1 host contract. Current qimanga.com migration is unverified.
export const DOMAIN = 'https://qimanhwa.com'
export const API = 'https://api.qimanhwa.com/api/v1'
export type Genre = { id: number, slug?: string, name: string }
export type Series = { slug: string, title: string, cover?: string, type: string, status: string, redirectUrl?: string, publishStatus?: string, alternativeTitles?: string, description?: string, author?: string, artist?: string, genres?: Genre[], stats?: { averageRating?: number | null, reviewCount?: number } }
export type SourceChapter = { slug: string, number: number, title?: string | null, createdAt: string, publishStatus: string, price: number, discountedPrice?: number | null, isFree: boolean, requiresPurchase: boolean }
export type Reader = SourceChapter & { images: { url: string, order: number }[], totalImages: number, series?: { slug: string } }
export type Page<T> = { data: T[], totalItems: number, totalPages: number, current: number, next: number | null }
export function slug(value: string): string {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,255}$/i.test(value) || value.includes('..')) throw new Error('Invalid QiScans canonical slug')
    return value
}
export const text = (value: string): string => decode(value).replace(/\s+/g, ' ').trim()
// Public image origins/routes observed in the current site's browser output.
// This conservative guard is not proof of compatibility with the legacy API.
export function imageURL(value: string): string {
    if (typeof value !== 'string' || /[\s\\]/.test(value) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(value) || /%(?:2e|2f|5c)/i.test(value)) throw new Error('Invalid QiScans image URL')
    const url = new URL(value)
    if (url.protocol !== 'https:' || !['media.qimanga.com', 'media.qimanhwa.com', 'media.qiscans.org'].includes(url.hostname) || url.port || url.username || url.password || url.hash || url.search || !url.pathname.startsWith('/file/qiscans/') || !/\.(?:webp|png|jpe?g|avif|gif)$/i.test(url.pathname)) throw new Error('Unsupported QiScans image route')
    return url.href
}
export function cards(values: Series[]): { id: string, title: string, cover: string, subtitle: string }[] {
    if (!Array.isArray(values)) throw new Error('Invalid QiScans catalog')
    const result = values.filter(item => item.type !== 'NOVEL' && !item.redirectUrl?.trim() && typeof item.title === 'string' && item.title.trim() && !/^https?:\/\//i.test(item.title)).map(item => ({ id: slug(item.slug), title: text(item.title), cover: item.cover ? imageURL(item.cover) : '', subtitle: [item.type, item.status].filter(Boolean).map(value => value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase())).join(' • ') }))
    if (new Set(result.map(item => item.id)).size !== result.length) throw new Error('Duplicate QiScans catalog identity')
    return result
}
export function detail(value: Series, id: string): Content {
    if (value.slug !== slug(id) || value.type === 'NOVEL' || value.redirectUrl?.trim() || (value.publishStatus !== undefined && value.publishStatus !== 'PUBLIC')) throw new Error('QiScans title is unavailable or has changed identity')
    const card = cards([value])[0]
    if (!card) throw new Error('QiScans title is missing')
    const $ = load(value.description ?? ''); $('br').replaceWith('\n'); $('p').append('\n\n')
    const additionalInfo: NonNullable<Content['additionalInfo']> = [incompleteRatingInfo()]
    const creators = [['author', 'Author', value.author], ['artist', 'Artist', value.artist]].filter(item => typeof item[2] === 'string' && item[2]?.trim()).map(item => staff.item({ id: item[0] as string, title: text(item[2] as string), subtitle: item[1] }))
    if (creators.length) additionalInfo.push(staff.section({ id: 'creators', title: 'Creators', items: creators, hasMore: false }))
    const score = value.stats?.averageRating
    if (typeof score === 'number' && Number.isFinite(score) && score >= 0 && score <= 5) additionalInfo.push(tags.section({ id: 'source-score', title: 'Source reader score', items: [tags.item({ id: 'average', title: `${score}/5`, isNonInteractive: true })] }))
    return { title: card.title, cover: card.cover, webUrl: DOMAIN + '/series/' + id, contentRating: nativeRating(undefined), summary: $.root().text().trim(), additionalTitles: value.alternativeTitles ? value.alternativeTitles.split(/, ?/).map(text).filter(Boolean) : [], tags: (value.genres ?? []).map(genre => ({ id: String(genre.id), title: text(genre.name), isNonInteractive: true })), additionalInfo, contentType: value.type === 'MANGA' ? ContentType.MANGA : value.type === 'MANHWA' ? ContentType.MANHWA : value.type === 'MANHUA' ? ContentType.MANHUA : undefined, status: value.status === 'ONGOING' ? PublicationStatus.ONGOING : value.status === 'COMPLETED' ? PublicationStatus.COMPLETED : undefined, recommendedPanelMode: value.type === 'MANHWA' ? ReadingMode.WEBTOON : ReadingMode.PAGED_COMIC }
}
export function pagination<T>(value: Page<T>, page: number): number | null {
    if (!value || !Array.isArray(value.data) || value.current !== page || !Number.isSafeInteger(value.totalItems) || value.totalItems < 0 || value.totalItems > 100000 || !Number.isSafeInteger(value.totalPages) || value.totalPages < 0 || value.totalPages > 10000 || (value.totalPages === 0 ? value.totalItems !== 0 || page !== 1 : page > value.totalPages)) throw new Error('Invalid QiScans v1 pagination')
    const last = value.totalPages === 0 || page === value.totalPages
    if (last ? value.next !== null : value.next !== page + 1 || value.data.length === 0) throw new Error('QiScans v1 continuation is incomplete or stalled')
    return value.next
}
export function readable(value: SourceChapter): boolean {
    return value.publishStatus === 'PUBLIC' && value.requiresPurchase === false && value.isFree === true && typeof value.price === 'number' && value.price === 0 && (value.discountedPrice == null || value.discountedPrice === 0)
}
export function chapters(values: SourceChapter[], owner: string): Chapter[] {
    return values.filter(readable).slice().sort((a, b) => a.number - b.number || Date.parse(a.createdAt) - Date.parse(b.createdAt)).map((item, index) => {
        slug(item.slug)
        if (typeof item.number !== 'number' || !Number.isFinite(item.number) || item.number < 0) throw new Error('Invalid QiScans chapter number')
        const timestamp = Date.parse(item.createdAt)
        return { chapterId: item.slug, number: item.number, index, title: item.title?.trim() || undefined, language: 'en', date: new Date(Number.isFinite(timestamp) ? timestamp : 0), webUrl: DOMAIN + '/series/' + slug(owner) + '/' + item.slug }
    })
}
export function pages(value: Reader, owner: string, chapter: SourceChapter): { url: string }[] {
    if (value.slug !== chapter.slug || value.number !== chapter.number || (value.series && value.series.slug !== owner) || !readable(value)) throw new Error('QiScans chapter is restricted or changed identity')
    if (!Array.isArray(value.images) || value.images.length === 0 || value.totalImages !== value.images.length || new Set(value.images.map(item => item.order)).size !== value.images.length || new Set(value.images.map(item => item.url)).size !== value.images.length) throw new Error('QiScans complete page manifest is unavailable')
    const sorted = value.images.slice().sort((a, b) => a.order - b.order)
    if (sorted.some(item => !Number.isSafeInteger(item.order) || item.order < 0)) throw new Error('Invalid QiScans page order')
    return sorted.map(item => ({ url: imageURL(item.url) }))
}
