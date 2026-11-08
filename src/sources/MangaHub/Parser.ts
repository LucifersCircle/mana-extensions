/* SPDX-License-Identifier: GPL-3.0-only */
/* Protocol/metadata references: Elrulia and Nicartjay. Mana adaptation © 2026 Lucifers Circle.
 * Exact pinned upstream revisions and retained licenses: THIRD_PARTY_NOTICES.md. */
import { Chapter,
    Content,
    ContentRating,
    Highlight,
    PublicationStatus,
    ReadingMode,
    staff } from '@mana-app/types'
import { incompleteRatingInfo,
    nativeRating } from '../../ContentRatingPolicy'
export const DOMAIN = 'https://mangahub.io'
export function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MangaHub object')
    return value as Record<string, unknown>
}
export function restricted(value: Record<string, unknown>): boolean {
    // Only actual restriction indicators, not an invented required "free" field.
    for (const key of ['paid', 'isPaid', 'locked', 'isLocked', 'premium', 'isPremium', 'requiresLogin', 'loginRequired', 'requiresPayment', 'requiresSubscription', 'blocked']) {
        if (value[key] !== undefined && value[key] !== false && value[key] !== 0 && value[key] !== null) return true
    }
    if (typeof value.status === 'string' && /^(?:locked|paid|premium|blocked|unauthorized|forbidden|login-required|payment-required)$/i.test(value.status)) return true
    return false
}
export function unrestricted(value: Record<string, unknown>): void {
    if (value.error !== undefined && value.error !== null) throw new Error('MangaHub reported an error')
    if (restricted(value)) throw new Error('MangaHub reports restricted content; no payment, login or access bypass')
}
export function slug(value: unknown): string {
    if (typeof value !== 'string' || value.length > 250 || !/^[a-z0-9]+(?:[a-z0-9_-]*[a-z0-9])?$/.test(value)) throw new Error('Unsupported MangaHub slug')
    return value
}
export function number(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000 || !/^\d+(?:\.\d{1,6})?$/.test(String(value))) throw new Error('Unsupported MangaHub chapter number')
    return value
}
export const seriesURL = (id: string): string => DOMAIN + '/manga/' + slug(id)
export const chapterURL = (id: string, value: number): string => DOMAIN + '/chapter/' + slug(id) + '/chapter-' + number(value)
export function imageURL(value: string, cover = false): string {
    if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid MangaHub image URL')
    const url = new URL(value), origin = cover ? 'https://thumb.mghcdn.com' : 'https://imgx.mghcdn.com'
    if (url.origin !== origin || url.href !== value || url.username || url.password || url.hash || url.search || !/^\/[A-Za-z0-9_().-]+(?:\/[A-Za-z0-9_().-]+)*$/.test(url.pathname) || url.pathname.slice(1).split('/').some(part => part === '.' || part === '..')) throw new Error('Unsupported MangaHub image URL')
    return value
}
function text(value: unknown, maximum = 50000): string {
    if (value === undefined || value === null) return ''
    if (typeof value !== 'string' || value.length > maximum) throw new Error('Invalid MangaHub text')
    return value.trim()
}
function genres(value: unknown): string[] { return text(value, 5000).split(',').map(item => item.trim()).filter(Boolean) }
export function sourceRating(value: unknown): ContentRating | undefined {
    const labels = genres(value).map(item => item.toLowerCase().replace(/\s+/g, '-'))
    if (labels.some(item => ['pornographic', 'hentai', 'smut', 'r-18', 'erotica'].includes(item))) return ContentRating.EXPLICIT
    if (labels.some(item => ['adult', 'mature', 'sexual-violence', 'gore'].includes(item))) return ContentRating.MATURE
    if (labels.some(item => ['ecchi', 'suggestive'].includes(item))) return ContentRating.SUGGESTIVE
    // Demographics and relationship genres do not establish an age rating.
    return undefined
}
function cover(value: unknown): string {
    const path = text(value, 2048)
    if (!path) return ''
    return imageURL(path.startsWith('https://') ? path : 'https://thumb.mghcdn.com/' + path, true)
}
export function numericId(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('Missing MangaHub numeric identity')
    return value
}
export function listing(value: unknown): { items: Highlight[], count: number } {
    if (!Array.isArray(value) || value.length > 30) throw new Error('Invalid MangaHub search page')
    const seenSlugs = new Set<string>(), seenIds = new Set<number>(), items: Highlight[] = []
    for (const entry of value) {
        const row = record(entry); unrestricted(row)
        const id = slug(row.slug), identity = numericId(row.id), title = text(row.title, 2000), image = cover(row.image)
        if (!title) throw new Error('Missing MangaHub search title')
        if (seenSlugs.has(id) || seenIds.has(identity)) continue
        seenSlugs.add(id); seenIds.add(identity)
        if (!image) continue // No alternate-site, alternate-title or invented cover fallback.
        items.push({ id, title, cover: image, webUrl: seriesURL(id), contentRating: nativeRating(sourceRating(row.genres)) })
    }
    return { items, count: value.length }
}
export function detail(value: unknown, expected: string): { content: Content, identity: number } {
    const row = record(value); unrestricted(row)
    if (slug(row.slug) !== slug(expected)) throw new Error('MangaHub title identity mismatch')
    const identity = numericId(row.id), title = text(row.title, 2000), image = cover(row.image), age = sourceRating(row.genres)
    if (!title || !image) throw new Error('MangaHub title metadata is incomplete; no fallback requests')
    const labels = genres(row.genres), people = ['author', 'artist'].flatMap(role => {
            const name = text(row[role], 2000)
            return name && !/^(?:-|n\/a|unknown)$/i.test(name) ? [staff.item({ id: role + ':' + name, title: name, subtitle: role === 'author' ? 'Author' : 'Artist' })] : []
        }), state = text(row.status, 100).toLowerCase(), alternatives = text(row.alternativeTitle, 10000)
    return { identity, content: { title, cover: image, webUrl: seriesURL(expected), summary: text(row.description),
        additionalTitles: alternatives ? [alternatives] : [], tags: labels.map(label => ({ id: label.toLowerCase(), title: label })),
        contentRating: nativeRating(age), status: state === 'ongoing' ? PublicationStatus.ONGOING : state === 'completed' ? PublicationStatus.COMPLETED : undefined,
        recommendedPanelMode: ReadingMode.PAGED_MANGA,
        additionalInfo: [...(people.length ? [staff.section({ id: 'staff', title: 'Staff', hasMore: false, items: people })] : []), ...(age === undefined ? [incompleteRatingInfo()] : [])] } }
}
export function chapters(value: unknown, id: string): Chapter[] {
    if (!Array.isArray(value) || value.length > 20000) throw new Error('Invalid MangaHub chapter inventory')
    const seen = new Set<number>(), rows: Chapter[] = []
    for (const entry of value) {
        const row = record(entry)
        if (row.error !== undefined && row.error !== null) throw new Error('MangaHub reported a chapter error')
        if (restricted(row)) continue
        const value = number(row.number)
        if (seen.has(value)) throw new Error('Ambiguous MangaHub chapter inventory')
        seen.add(value)
        let title = text(row.title, 2000)
        for (let i = 0; i < 3; i++) {
            const prefix = title.match(/^(?:chapter|ch\.?)\s*(\d+(?:\.\d+)?)(?=$|[\s:–—-])(?:\s*[:–—-]\s*|\s+)?/i)
            if (!prefix || Number(prefix[1]) !== value) break
            title = title.slice(prefix[0].length).trim()
        }
        const rawDate = text(row.date, 100)
        // SDK requires a Date. Epoch marks unknown, never an invented publication date.
        const date = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(rawDate) ? Date.parse(rawDate) : NaN
        rows.push({ chapterId: `${slug(id)}/chapter-${value}`, number: value, title: title || undefined, date: new Date(Number.isFinite(date) ? date : 0), language: 'en_US', index: 0, webUrl: chapterURL(id, value) })
    }
    return rows.sort((a, b) => a.number - b.number).map((row, index) => ({ ...row, index }))
}
export function pageList(value: string): string[] {
    if (value.length > 1_000_000) throw new Error('Oversized MangaHub page list')
    let payload: Record<string, unknown>
    try { payload = record(JSON.parse(value)) } catch { throw new Error('Invalid MangaHub page-list JSON') }
    unrestricted(payload)
    if (typeof payload.p !== 'string' || payload.p.length > 1024 || !Array.isArray(payload.i) || !payload.i.length || payload.i.length > 1000) throw new Error('Incomplete MangaHub page list')
    const seen = new Set<string>()
    return payload.i.map((item: unknown) => {
        if (typeof item !== 'string' || !item.length || item.length > 1024) throw new Error('Invalid MangaHub page name')
        const url = imageURL('https://imgx.mghcdn.com/' + payload.p + item)
        if (seen.has(url)) throw new Error('Repeated MangaHub page')
        seen.add(url); return url
    })
}
