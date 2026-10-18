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
const hasControl = (value: string): boolean => Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
export function slug(value: string): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 1024 || value === '.' || value === '..' || /[/\\]/.test(value) || hasControl(value)) throw new Error('Invalid QiScans canonical slug')
    return value
}
// Keep source identities verbatim; escape them only when building a URL segment.
export const pathComponent = (value: string): string => encodeURIComponent(slug(value)).replace(/[!'()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase())
export const seriesURL = (owner: string, chapter?: string): string => DOMAIN + '/series/' + pathComponent(owner) + (chapter === undefined ? '' : '/' + pathComponent(chapter))
export const text = (value: string): string => decode(value).replace(/\s+/g, ' ').trim()
// Upstream uses the returned media URLs, including external CDNs and query strings.
// A saved set of three media hosts and one path shape is not the API's contract.
export function imageURL(value: string): string {
    if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.includes('\\') || hasControl(value)) throw new Error('Invalid QiScans image URL')
    const url = new URL(value, DOMAIN), host = url.hostname.replace(/\.$/, '')
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash
        || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/i.test(host)
        || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)$/i.test(host)) throw new Error('Unsupported QiScans image route')
    return url.href
}
export function cards(values: Series[]): { id: string, title: string, cover: string, subtitle: string }[] {
    if (!Array.isArray(values)) throw new Error('Invalid QiScans catalog')
    const result = [], seen = new Set<string>()
    for (const item of values) {
        if (!item || typeof item !== 'object' || item.type === 'NOVEL' || (item.redirectUrl != null && (typeof item.redirectUrl !== 'string' || item.redirectUrl.trim())) || (item.publishStatus !== undefined && item.publishStatus !== 'PUBLIC') || typeof item.title !== 'string' || !text(item.title) || /^https?:\/\//i.test(item.title.trim())) continue
        let id: string, cover = ''
        try { id = slug(item.slug); pathComponent(id) } catch { continue }
        if (seen.has(id)) continue
        // An incomplete/promotional row must not take down every other card.
        try { if (item.cover) cover = imageURL(item.cover) } catch { /* Keep the title with a missing-cover placeholder. */ }
        seen.add(id)
        result.push({ id, title: text(item.title), cover, subtitle: [item.type, item.status].filter(value => typeof value === 'string' && value.trim()).map(value => value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase())).join(' • ') })
    }
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
    return { title: card.title, cover: card.cover, webUrl: seriesURL(id), contentRating: nativeRating(undefined), summary: $.root().text().trim(), additionalTitles: value.alternativeTitles ? value.alternativeTitles.split(/, ?/).map(text).filter(Boolean) : [], tags: (value.genres ?? []).map(genre => ({ id: String(genre.id), title: text(genre.name), isNonInteractive: true })), additionalInfo, contentType: value.type === 'MANGA' ? ContentType.MANGA : value.type === 'MANHWA' ? ContentType.MANHWA : value.type === 'MANHUA' ? ContentType.MANHUA : undefined, status: value.status === 'ONGOING' ? PublicationStatus.ONGOING : value.status === 'COMPLETED' ? PublicationStatus.COMPLETED : undefined, recommendedPanelMode: ['MANHWA', 'MANHUA'].includes(value.type) ? ReadingMode.WEBTOON : ReadingMode.PAGED_COMIC }
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
        return { chapterId: item.slug, number: item.number, index, title: item.title?.trim() || undefined, language: 'en', date: new Date(Number.isFinite(timestamp) ? timestamp : 0), webUrl: seriesURL(owner, item.slug) }
    })
}
export function pages(value: Reader, owner: string, chapter: SourceChapter): { url: string }[] {
    if (value.slug !== chapter.slug || value.number !== chapter.number || (value.series && value.series.slug !== owner) || !readable(value)) throw new Error('QiScans chapter is restricted or changed identity')
    if (!Array.isArray(value.images) || value.images.length === 0 || value.totalImages !== value.images.length || new Set(value.images.map(item => item.order)).size !== value.images.length || new Set(value.images.map(item => item.url)).size !== value.images.length) throw new Error('QiScans complete page manifest is unavailable')
    const sorted = value.images.slice().sort((a, b) => a.order - b.order)
    if (sorted.some(item => !Number.isSafeInteger(item.order) || item.order < 0)) throw new Error('Invalid QiScans page order')
    return sorted.map(item => ({ url: imageURL(item.url) }))
}
