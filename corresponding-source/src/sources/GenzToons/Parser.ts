/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright 2024 Paperback Community; Mana adaptation © 2026 Lucifers Circle.
 * Keyoapp selectors and UID loader adapted from nicartjay / keiyoushi.
 * Exact upstream and retained MIT notice: THIRD_PARTY_NOTICES.md. */
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
export const DOMAIN = 'https://genztoons.org'
export const text = (value: string): string => value.replace(/\s+/g, ' ').trim()
const comicTypes = new Set(['manga', 'manhwa', 'manhua', 'comic', 'mangatoon'])
export function slug(value: string): string {
    if (typeof value !== 'string' || !/^[a-z0-9]+(?:[a-z0-9-]*[a-z0-9])?$/.test(value) || value.length > 250) throw new Error('Invalid GenzToons identity')
    return value
}
export const seriesURL = (id: string): string => `${DOMAIN}/series/${slug(id)}/`
export function chapterURL(id: string): string {
    if (!/^chapter\/[a-z0-9]+-[a-z0-9]+$/.test(id)) throw new Error('Invalid GenzToons chapter identity')
    return `${DOMAIN}/${id}/`
}
function identity(value: string, kind: 'series' | 'chapter'): string {
    const url = new URL(value, DOMAIN), match = url.pathname.match(new RegExp(`^/${kind}/([^/]+)/$`))
    if (!match || url.origin !== DOMAIN || url.search || url.hash || url.username || url.password || /[\\\s%]/.test(value)) throw new Error('Invalid GenzToons canonical link')
    const id = kind === 'series' ? slug(match[1] as string) : `chapter/${match[1]}`
    if (kind === 'chapter') chapterURL(id)
    return id
}
export function imageURL(value: string, cover = false): string {
    const url = new URL(value)
    if (url.href !== value || url.username || url.password || url.hash || /[\\\s%]/.test(value)) throw new Error('Invalid GenzToons image URL')
    const upload = /^[A-Za-z0-9_-]+(?:\.(?:avif|webp|png|jpe?g))?$/
    if (!cover) {
        if (url.origin !== 'https://cdn.meowing.org' || url.search || !url.pathname.startsWith('/uploads/') || !upload.test(url.pathname.slice(9))) throw new Error('Unsupported GenzToons page URL')
    } else {
        // Preserve the exact provider-supplied cover proxy URL, not a rewritten CDN URL.
        const target = url.searchParams.get('url') ?? '', width = url.searchParams.get('w') ?? ''
        if (url.origin !== 'https://wsrv.nl' || url.pathname !== '/' || !target.startsWith('cdn.meowing.org/uploads/') || !upload.test(target.slice(24)) || !/^[1-9]\d{0,3}$/.test(width) || [...url.searchParams.keys()].sort().join(',') !== 'url,w') throw new Error('Unsupported GenzToons cover URL')
    }
    return value
}
function cover(style: string): string {
    const value = style.match(/url\(['"]?([^'"()]+)['"]?\)/)?.[1]
    if (!value) throw new Error('Missing GenzToons cover')
    return imageURL(value, true)
}
function rating(genres: string[]): ContentRating | undefined {
    const values = genres.map(value => value.toLowerCase())
    if (values.some(value => ['smut', 'hentai', 'erotica'].includes(value))) return ContentRating.EXPLICIT
    if (values.some(value => ['adult', 'mature'].includes(value))) return ContentRating.MATURE
    return undefined
}
export function listing(html: string): Highlight[] {
    const $ = load(html), rows = $('#searched_series_page > button'), seen = new Set<string>(), result: Highlight[] = []
    if (!rows.length || $('link[rel="canonical"]').attr('href') !== DOMAIN + '/series') throw new Error('Incomplete GenzToons catalog')
    rows.each((_, node) => {
        const row = $(node), type = row.attr('data-type') ?? ''
        if (type === 'novel') return
        if (!comicTypes.has(type)) throw new Error('Unknown GenzToons catalog type')
        const anchor = row.children('a').first(), id = identity(anchor.attr('href') ?? '', 'series'), title = text(anchor.attr('title') ?? '')
        if (!title || seen.has(id)) throw new Error('Incomplete or repeated GenzToons catalog identity')
        seen.add(id)
        const genres: unknown = JSON.parse(row.attr('tags') ?? '[]')
        if (!Array.isArray(genres) || genres.some(value => typeof value !== 'string')) throw new Error('Invalid GenzToons catalog genres')
        result.push({ id, title, cover: cover(row.find('[style*="background-image"]').first().attr('style') ?? ''), webUrl: seriesURL(id), contentRating: nativeRating(rating(genres)), subtitle: type })
    })
    return result
}
function field($: ReturnType<typeof load>, name: string): string {
    return text($('div > span').filter((_, node) => text($(node).text()) === name).first().parent().next('div').text())
}
export function detail(html: string, id: string): Content {
    const $ = load(html), expected = seriesURL(id), title = text($('h1').first().text()), type = field($, 'Type').toLowerCase(), status = field($, 'Status').toLowerCase()
    if ($('link[rel="canonical"]').attr('href') !== expected || !title || $('#chapters').length !== 1 || !comicTypes.has(type)) throw new Error('GenzToons returned an unsupported or mismatched series')
    const genres = $('a[href^="/series/?genre="]').toArray().map(node => ({ id: new URL($(node).attr('href') ?? '', DOMAIN).searchParams.get('genre') ?? '', title: text($(node).text()).replace(/,$/, '') }))
    const age = rating(genres.map(value => value.title)), people = ['Author', 'Artist'].flatMap(role => {
        const name = field($, role)
        return name && name !== '-' && name.toLowerCase() !== 'n/a' ? [staff.item({ id: role + ':' + name, title: name, subtitle: role })] : []
    })
    const synopsis = $('#expand_content > p').clone(); synopsis.find('br').replaceWith(' ')
    return { title, cover: cover($('[style*="--photoURL:url"]').first().attr('style') ?? ''), webUrl: expected,
        summary: text(synopsis.text()), additionalTitles: $('#expand_content span').toArray().map(node => text($(node).text())).filter(value => value && value !== 'No alternative titles.'), tags: genres,
        contentRating: nativeRating(age), contentType: type === 'manhwa' ? ContentType.MANHWA : type === 'manga' ? ContentType.MANGA : type === 'manhua' ? ContentType.MANHUA : undefined,
        status: status === 'ongoing' ? PublicationStatus.ONGOING : status === 'completed' ? PublicationStatus.COMPLETED : undefined, recommendedPanelMode: ReadingMode.PAGED_MANGA,
        additionalInfo: [...(people.length ? [staff.section({ id: 'staff', title: 'Staff', hasMore: false, items: people })] : []), ...(age === undefined ? [incompleteRatingInfo()] : [])] }
}
export function chapters(html: string, id: string): Chapter[] {
    detail(html, id)
    const $ = load(html), rows = $('#chapters > a'), seen = new Set<string>(), result: Chapter[] = []
    if (!rows.length || $('#chapters').children().length !== rows.length) throw new Error('Incomplete GenzToons chapter inventory')
    rows.each((_, node) => {
        const row = $(node), chapterId = identity(row.attr('href') ?? '', 'chapter')
        if (seen.has(chapterId)) throw new Error('Repeated GenzToons chapter identity')
        seen.add(chapterId)
        // c is not a price: the provider uses c=1 and c=50 for free chapters too.
        if (row.find('img[alt~="Coin"], img[src*="material-symbols:lock"], .locked, .login-required').length || /upcoming|premium|locked|unlock|members only|sign in|log in/i.test(row.text()) || row.is('.locked, .login-required, [aria-disabled="true"], [data-locked="true"]')) return
        const title = text(row.attr('title') ?? ''), match = title.match(/^Cha(?:p)?ter\s+(\d+(?:\.\d+)?)(?:\s.*)?$/i)
        if (!match) throw new Error('Unknown GenzToons chapter numbering')
        // Relative strings are not stable timestamps. Keep unknown instead of inventing today.
        const dateText = row.attr('d') ?? '', absolute = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(dateText) ? Date.parse(dateText) : NaN
        result.push({ chapterId, title, number: Number(match[1]), index: 0, language: 'en_US', date: new Date(Number.isFinite(absolute) ? absolute : 0), webUrl: chapterURL(chapterId) })
    })
    return result.sort((a, b) => a.number - b.number).map((value, index) => ({ ...value, index }))
}
export function reader(html: string, id: string, chapter: Chapter): ChapterData {
    const $ = load(html), expected = chapterURL(chapter.chapterId), heading = $('h1').first(), owner = heading.find('a').first()
    if ($('link[rel="canonical"]').attr('href') !== expected || identity(owner.attr('href') ?? '', 'series') !== id || text(heading.text()).slice(text(owner.text()).length).trim() !== '- ' + chapter.title) throw new Error('GenzToons reader identity mismatch')
    // Global bulk-unlock/sign-in widgets occur on public readers. Only inspect reader content.
    if ($('#pages.locked, #pages.login-required, #pages_panel.locked, #pages_panel.login-required, #pages_panel .locked, #pages_panel .login-required, #pages_panel img[alt~="Coin"], #pages_panel img[src*="material-symbols:lock"]').length || /unlock|premium|log in|sign in|upcoming/i.test($('#pages').text())) throw new Error('GenzToons reader requires payment or login')
    const loaders = $('script').toArray().filter(node => /let\s+realUrl\s*=\s*`https:\/\/cdn\.meowing\.org\/uploads\/\$\{uid\}`\s*;/.test($(node).text()))
    if (loaders.length !== 1) throw new Error('Unsupported GenzToons image loader')
    const rows = $('#pages > img'), seen = new Set<string>()
    if (!rows.length || rows.length > 1000 || $('#pages').children().not('img, script').length > 0) throw new Error('Incomplete GenzToons image inventory')
    return { pages: rows.toArray().map((node, index) => {
        const row = $(node), uid = row.attr('uid') ?? ''
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(uid)) throw new Error(`Invalid GenzToons page UID at page ${index + 1} (length ${uid.length})`)
        const count = row.attr('count')
        const countDiagnostic = count === undefined ? 'missing' : /^\d{1,6}$/.test(count) ? String(Number(count)) : 'non-numeric or out of range'
        if (count !== String(index)) throw new Error(`Invalid GenzToons page order at page ${index + 1} (expected ${index}, received ${countDiagnostic})`)
        if (seen.has(uid)) throw new Error(`Duplicate GenzToons page UID at page ${index + 1}`)
        seen.add(uid)
        return { url: imageURL('https://cdn.meowing.org/uploads/' + uid) }
    }) }
}
