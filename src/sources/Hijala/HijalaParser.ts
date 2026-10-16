/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Lucifers Circle */
// Native Mana adaptation of the bounded Hijala public-data parser. See THIRD_PARTY_NOTICES.md.
import { Chapter,
    ChapterData,
    Content,
    ContentRating,
    ContentType,
    Highlight,
    PublicationStatus,
    ReadingMode,
    staff } from '@mana-app/types'
import { load } from 'cheerio'
import { incompleteRatingInfo,
    nativeRating } from '../../ContentRatingPolicy'
import { Catalog,
    DOMAIN,
    Genre,
    LABELS,
    Post,
    ReaderChapter,
    SiteChapter } from './HijalaModels'
import { serializedProperty } from './HijalaPageData'

export function slugToId(slug: string): string {
    if (typeof slug !== 'string' || !slug.trim() || slug === '.' || slug === '..' || /[/\\]/.test(slug) || Array.from(slug).some((char) => char.charCodeAt(0) < 32)) throw new Error('Hijala returned an invalid slug')
    return encodeURIComponent(slug).replace(/[!'*~]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}
export function idToSlug(id: string): string {
    if (typeof id !== 'string' || !id.trim()) throw new Error('Hijala received an invalid content ID')
    const slug = decodeURIComponent(id)
    slugToId(slug)
    return slug
}
export const seriesURL = (id: string, chapterId?: string): string => `${DOMAIN}/series/${slugToId(idToSlug(id))}${chapterId ? `/${slugToId(idToSlug(chapterId))}` : ''}`
export const plainText = (value: string): string => load(value.replace(/<br\s*\/?\s*>|<\/p>/gi, '\n')).root().text().trim()

export function pageProperty<T>(html: string, key: string): T {
    const $ = load(html)
    const scripts = $('script').toArray().map((node) => $(node).text()).filter((text) => text.startsWith('(self.$R=self.$R||{})["tsr"]=[];') && text.includes('$_TSR.router='))
    if (scripts.length !== 1) throw new Error('Hijala returned missing or ambiguous router data')
    return serializedProperty<T>(scripts[0]!, key)
}

const validGenre = (genre: Genre): boolean => !!genre && Number.isSafeInteger(genre.id) && genre.id > 0 && typeof genre.name === 'string' && !!genre.name.trim()
export function genres(post: Post): Genre[] {
    return Array.isArray(post.genres) ? post.genres.filter(validGenre) : []
}
export const completeGenres = (post: Post): boolean => Array.isArray(post.genres) && post.genres.length > 0 && post.genres.every(validGenre)
const explicitGenre = /^(adult|hentai|erotica|pornographic|pornography|smut)$/i
const matureGenre = /^mature$/i
const suggestiveGenre = /^(ecchi|suggestive)$/i
export function rating(post: Post): ContentRating | undefined {
    const tags = genres(post)
    if (tags.some((tag) => explicitGenre.test(tag.name.trim()))) return ContentRating.EXPLICIT
    if (tags.some((tag) => matureGenre.test(tag.name.trim()))) return ContentRating.MATURE
    if (tags.some((tag) => suggestiveGenre.test(tag.name.trim()))) return ContentRating.SUGGESTIVE
    // Ordinary genre labels do not establish a source age rating.
    return undefined
}
export const blockedGenre = (name: string): boolean => explicitGenre.test(name.trim()) || matureGenre.test(name.trim()) || suggestiveGenre.test(name.trim())
export function imageURL(value: string): string {
    if (typeof value !== 'string' || !value.trim() || /\s/.test(value)) throw new Error('Hijala returned an invalid image URL')
    const url = new URL(value, DOMAIN)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Hijala returned an invalid image URL')
    return url.href
}
export function highlight(post: Post): Highlight {
    if (!post.postTitle?.trim() || !post.featuredImage) throw new Error('Hijala returned an incomplete series card')
    const id = slugToId(post.slug)
    return { id, title: post.postTitle.trim(), cover: imageURL(post.featuredImage), webUrl: seriesURL(id),
        subtitle: post.seriesType ? LABELS[post.seriesType] ?? post.seriesType : undefined, contentRating: nativeRating(rating(post)) }
}
export function catalog(text: string): Catalog {
    const data = JSON.parse(text) as Catalog
    if (!Array.isArray(data.posts) || !Number.isSafeInteger(data.totalCount) || data.totalCount < 0 || new Set(data.posts.map((post) => post.slug)).size !== data.posts.length) throw new Error('Hijala returned an invalid catalog response')
    data.posts.forEach(highlight)
    return data
}
export function genreOptions(html: string): { id: string, title: string }[] {
    const data = pageProperty<Genre[]>(html, 'genres')
    if (!Array.isArray(data) || !data.length || data.some((genre) => !Number.isSafeInteger(genre.id) || !genre.name?.trim()) || new Set(data.map((genre) => genre.id)).size !== data.length) throw new Error('Hijala returned invalid genres')
    return data.map((genre) => ({ id: String(genre.id), title: genre.name.trim() }))
}
export function chapterTitle(value: string | null | undefined, number: number): string {
    const title = value?.trim() ?? ''
    if (/^\d+(?:\.\d+)?$/.test(title) && Number(title) === number) return ''
    const prefix = title.match(/^(?:(?:chapter|episode|ch\.?)\s*|#\s*)(\d+(?:\.\d+)?)(?=$|\s|[-:–—])/i)
    return prefix && Number(prefix[1]) === number ? title.slice(prefix[0].length).replace(/^\s*[-:–—]?\s*/, '') : title
}
export const isLocked = (chapter: SiteChapter): boolean => chapter.isLocked === true || chapter.isAccessible === false || (chapter.isAccessible !== true && (chapter.isLockedByCoins === true || chapter.isShortLinkLocked === true || !!chapter.isPermanentlyLocked || (chapter.price ?? 0) > 0))
export function chapterDate(value: string | undefined): Date {
    if (!value || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) throw new Error('Hijala returned an invalid chapter date')
    const date = new Date(value)
    if (!Number.isFinite(date.getTime()) || !new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().startsWith(value.slice(0, 10))) throw new Error('Hijala returned an invalid chapter date')
    return date
}
export interface Detail { post: Post, chapters: SiteChapter[] }
export function detail(html: string, id: string): Detail {
    const post = pageProperty<Post>(html, 'post')
    const chapters = pageProperty<SiteChapter[]>(html, 'initialChapters')
    const total = pageProperty<number>(html, 'totalChapterCount')
    if (post.slug !== idToSlug(id)) throw new Error('Hijala returned a different series')
    highlight(post)
    if (!Number.isSafeInteger(total) || total < 0 || total !== post._count?.chapters || !Array.isArray(chapters) || chapters.length !== total || chapters.some((chapter) => typeof chapter.isLocked !== 'boolean') || new Set(chapters.map((chapter) => chapter.slug)).size !== chapters.length) throw new Error('Hijala returned an incomplete chapter list or access status')
    chapters.forEach((chapter) => { slugToId(chapter.slug); if (!Number.isFinite(chapter.number)) throw new Error('Hijala returned an invalid chapter number') })
    return { post, chapters }
}
export function nativeChapters(data: Detail, id: string, hidePaid: boolean): Chapter[] {
    // Validate completeness before filtering; index the visible sequence from zero.
    const ordered = [...data.chapters].sort((a, b) => a.number - b.number || a.slug.localeCompare(b.slug)).filter((chapter) => !hidePaid || !isLocked(chapter))
    return ordered.map((chapter, index): Chapter => {
        const volume = chapter.volume == null || chapter.volume === '' ? undefined : Number(chapter.volume)
        if (volume !== undefined && (!Number.isFinite(volume) || volume < 0)) throw new Error('Hijala returned an invalid volume')
        const chapterId = slugToId(chapter.slug)
        const title = chapterTitle(chapter.title, chapter.number)
        return { chapterId, number: chapter.number, index, title: `${isLocked(chapter) ? '[Paid] ' : ''}${title}`.trim() || undefined,
            volume, date: chapterDate(chapter.createdAt), language: data.post.seriesType === 'SPANISH' ? 'es_ES' : data.post.seriesType === 'RUSSIAN' ? 'ru_RU' : 'en_US',
            provider: chapter.team?.name ? { id: chapter.team.name, name: chapter.team.name } : undefined, webUrl: seriesURL(id, chapterId) }
    })
}
export function content(data: Detail, id: string, hidePaid: boolean): Content {
    const post = data.post, item = highlight(post)
    const people = [ ...(post.author?.trim() ? [staff.item({ id: `author:${post.author}`, title: post.author.trim(), subtitle: 'Author' })] : []),
        ...(post.artist?.trim() && post.artist.trim() !== post.author?.trim() ? [staff.item({ id: `artist:${post.artist}`, title: post.artist.trim(), subtitle: 'Artist' })] : []) ]
    const statuses: Record<string, PublicationStatus> = { ONGOING: PublicationStatus.ONGOING, COMPLETED: PublicationStatus.COMPLETED, CANCELLED: PublicationStatus.CANCELLED, DROPPED: PublicationStatus.CANCELLED, HIATUS: PublicationStatus.HIATUS }
    const types: Record<string, ContentType> = { MANHWA: ContentType.MANHWA, MANHUA: ContentType.MANHUA, MANGA: ContentType.MANGA }
    return { title: item.title, cover: item.cover, contentRating: item.contentRating, webUrl: item.webUrl, summary: plainText(post.postContent ?? ''),
        additionalTitles: [...new Set((post.alternativeTitles ?? '').split(/\s*[•\n]\s*|\s+\/\s+/).map((title) => title.trim()).filter((title) => title && title !== item.title))],
        tags: genres(post).map((genre) => ({ id: String(genre.id), title: genre.name.trim() })), status: statuses[post.seriesStatus ?? ''],
        contentType: post.isNovel ? ContentType.NOVEL : types[post.seriesType ?? ''] ?? ContentType.COMIC,
        recommendedPanelMode: post.seriesType === 'MANGA' ? ReadingMode.PAGED_MANGA : ReadingMode.WEBTOON,
        additionalInfo: [...(people.length ? [staff.section({ id: 'staff', title: 'Staff', hasMore: false, items: people })] : []), ...(rating(post) === undefined ? [incompleteRatingInfo()] : [])],
        chapters: nativeChapters(data, id, hidePaid) }
}
export function reader(html: string, id: string, chapterId: string): ChapterData {
    const data = pageProperty<ReaderChapter>(html, 'chapter')
    if (typeof data.seriesSlug !== 'string' || typeof data.isNovel !== 'boolean' || typeof data.isLocked !== 'boolean' || typeof data.isAccessible !== 'boolean') throw new Error('Hijala returned incomplete reader identity or access status')
    if (data.slug !== idToSlug(chapterId) || data.seriesSlug !== idToSlug(id)) throw new Error('Hijala returned a different chapter')
    if (data.requiresProtectedFetch !== false || isLocked(data)) throw new Error('This chapter requires access on the Hijala website')
    if (data.isNovel) throw new Error('Novel reading is not supported by this source')
    if (!Array.isArray(data.publicImages) || !data.publicImages.length) throw new Error('Hijala returned no public reader pages')
    const images = [...data.publicImages].sort((a, b) => a.order - b.order)
    if (images.some((item) => !Number.isInteger(item.order) || item.order < 0 || !item.url) || new Set(images.map((item) => item.order)).size !== images.length || new Set(images.map((item) => item.url)).size !== images.length) throw new Error('Hijala returned invalid page ordering')
    return { pages: images.map((item) => ({ url: imageURL(item.url) })) }
}
