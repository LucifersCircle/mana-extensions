/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex; Copyright © 2026 Lucifers Circle.
 * Adapted from Popmango's VyManga source at 2ad28cd5155ef23b09fa2b85a9713ad511730bb6. */
import { Chapter,
    Content,
    ContentRating,
    Highlight,
    Option,
    PublicationStatus,
    staff } from '@mana-app/types'
import { load } from 'cheerio'
import { incompleteRatingInfo,
    nativeRating } from '../../ContentRatingPolicy'
export const DOMAIN = 'https://mangavyvy.net'
export const CATALOG_HOSTS = ['mangavyvy.net', 'mangavyvy.com']
export const text = (value: string): string => value.replace(/\s+/g, ' ').trim()
const controls = (value: string): boolean => Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
export function publicURL(value: string, base = DOMAIN): string {
    if (typeof value !== 'string' || !value || value !== value.trim() || value.includes('\\') || controls(value)) throw new Error('Invalid VyManga URL')
    const url = new URL(value, base), host = url.hostname.replace(/\.$/, '')
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash
        || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/i.test(host)
        || /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|example)$/i.test(host)) throw new Error('Unsupported VyManga public HTTPS URL')
    return url.href
}
export function slug(id: string): string {
    if (typeof id !== 'string' || id.length > 300 || !/^[a-zA-Z0-9]+(?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(id)) throw new Error('Invalid VyManga manga identity')
    return id
}
export function catalogURL(value: string): string {
    const url = new URL(publicURL(value))
    if (!CATALOG_HOSTS.includes(url.hostname) || !/^(?:\/(?:search)?\/?|\/manga\/[a-zA-Z0-9-]+\/?)$/.test(url.pathname)) throw new Error('Unsupported VyManga catalog route')
    return url.href
}
export const mangaURL = (id: string): string => `${DOMAIN}/manga/${slug(id)}`
export function mangaID(value: string, base = DOMAIN): string {
    const url = new URL(catalogURL(publicURL(value, base))), match = url.pathname.match(/^\/manga\/([^/]+)\/?$/)
    if (!match?.[1] || url.search) throw new Error('Invalid VyManga manga link')
    return slug(match[1])
}
function image($: ReturnType<typeof load>, node: cheerio.Element | undefined, base: string): string {
    if (!node) throw new Error('Missing VyManga image')
    const el = $(node)
    const value = ['data-src', 'data-lazy-src', 'data-cfsrc', 'src'].map(key => el.attr(key)?.trim()).find(value => value && !value.startsWith('data:'))
    if (!value) throw new Error('Missing VyManga image URL')
    return publicURL(value, base)
}
export function cards(html: string, base: string): { items: Highlight[], ended: boolean } {
    const $ = load(html), items: Highlight[] = [], seen = new Set<string>()
    for (const node of $('.comic-item').toArray()) {
        const row = $(node), anchor = row.find('a').first()
        let id: string
        try { id = mangaID(anchor.attr('href') ?? '', base) } catch { continue }
        const title = text(row.find('.comic-title').first().text() || anchor.attr('title') || '')
        if (!title || seen.has(id)) continue
        let cover = ''
        try {
            const img = row.find('.comic-image img, img.image, img.lozad').first().get(0)
            cover = img ? image($, img, base) : publicURL(row.find('.comic-image').attr('data-background-image') ?? '', base)
        } catch { /* Preserve the source title with a missing-cover placeholder. */ }
        seen.add(id)
        items.push({ id, title, cover, webUrl: `${new URL(base).origin}/manga/${id}`, contentRating: nativeRating(undefined), subtitle: text(row.find('.comic-image > span, .comic-image span').first().text()) || undefined })
    }
    if (!items.length && $('.comic-item').length) throw new Error('VyManga catalog rows are not recognized')
    return { items, ended: $('[rel=next]').length === 0 }
}
export function genres(html: string): Option[] {
    const $ = load(html), result: Option[] = [], seen = new Set<string>()
    for (const node of $('.checkbox-genre[data-value]').toArray()) {
        const el = $(node), id = el.attr('data-value')?.trim() ?? '', title = text(el.parent().find('label').first().text())
        if (!/^\d+$/.test(id) || !title || seen.has(id)) continue
        seen.add(id); result.push({ id, title })
    }
    return result.sort((a, b) => a.title.localeCompare(b.title))
}
function genreID(href: string, title: string): string {
    const url = new URL(href || '/', DOMAIN), last = url.pathname.replace(/\/$/, '').split('/').pop() ?? ''
    return url.searchParams.get('genre[]') ?? url.searchParams.get('genre') ?? (/^\d+$/.test(last) ? last : title.toLowerCase().replace(/\s+/g, '-'))
}
export function detail(html: string, id: string, base: string): Content {
    slug(id)
    const $ = load(html), title = text($('h1').first().text())
    if (!title) throw new Error('VyManga details title is missing')
    const canonical = $('link[rel=canonical]').attr('href')
    if (canonical && mangaID(canonical, base) !== id) throw new Error('VyManga detail identity mismatch')
    const genreTags = $('.pre-title:contains(Genres) ~ a, div.col-md-7 p a[href*=genre]').toArray().map(node => {
        const el = $(node), title = text(el.text())
        return { id: genreID(el.attr('href') ?? '', title), title }
    }).filter((tag, index, all) => tag.title && all.findIndex(value => value.id === tag.id) === index)
    const names = genreTags.map(tag => tag.title.toLowerCase())
    const classification = names.some(name => ['smut', 'hentai', 'erotica', 'pornographic', 'nsfw', '18+'].includes(name)) ? ContentRating.EXPLICIT
        : names.some(name => ['adult', 'mature'].includes(name)) ? ContentRating.MATURE : undefined
    const additionalInfo: NonNullable<Content['additionalInfo']> = classification === undefined ? [incompleteRatingInfo()] : []
    const creators = [['author', 'Author', '.pre-title:contains(Author) ~ a'], ['artist', 'Artist', '.pre-title:contains(Artist) ~ a']].map(([key, role, selector]) => {
        const value = text($(selector as string).text())
        return value && !/^(?:-|n\/a|updating)$/i.test(value) ? staff.item({ id: key as string, title: value, subtitle: role }) : undefined
    }).filter((value): value is ReturnType<typeof staff.item> => !!value)
    if (creators.length) additionalInfo.push(staff.section({ id: 'creators', title: 'Creators', items: creators, hasMore: false }))
    const status = text($('.pre-title:contains(Status) ~ span:not(.space), div.col-md-7 p:contains(Status) span').last().text()).toLowerCase()
    const descriptions = $('.summary > .content, div.summary p.content').toArray().map(node => $(node).text().trim()).filter(Boolean)
    return { title, cover: image($, $('.img-manga img, .content-thumb img').first().get(0), base), webUrl: `${new URL(base).origin}/manga/${id}`, summary: descriptions.join('\n'), additionalTitles: [], tags: genreTags, additionalInfo, contentRating: nativeRating(classification), status: /complet|finish/.test(status) ? PublicationStatus.COMPLETED : /ongoing|on going|updating/.test(status) ? PublicationStatus.ONGOING : /hiatus|pause/.test(status) ? PublicationStatus.HIATUS : /cancel|drop/.test(status) ? PublicationStatus.CANCELLED : undefined }
}
const restricted = '.locked,.paid,.premium,.login-required,.required-login,[data-locked="true"],[data-paid="true"],[data-price],[data-coin],.fa-lock,.fa-user-lock,.ion-locked,.chapter-premium'
export function chapters(html: string, base: string): Chapter[] {
    const $ = load(html), primary = $('a.list-chapter'), rows = primary.length ? primary.toArray() : $('a[id^="chapter-"]').toArray(), result: Chapter[] = [], seen = new Set<string>()
    for (const node of rows) {
        const el = $(node)
        if (el.closest(restricted).length || el.find(restricted).length || /(?:premium|locked|paid|login-required)/i.test(el.attr('class') ?? '')) continue
        const chapterId = publicURL(el.attr('href')?.trim() ?? '', base)
        if (seen.has(chapterId)) continue
        const label = text(el.find('span').first().text() || el.find('p:not(.small)').first().text() || el.clone().children('p.small').remove().end().text())
        const numberMatch = label.match(/chapter[.\s-]*(\d+(?:\.\d+)?)/i) ?? label.match(/(\d+(?:\.\d+)?)/)
        if (!numberMatch) throw new Error('VyManga chapter number is missing')
        const number = Number(numberMatch[1]), title = text(label.replace(/^\s*(?:chapter|ch\.?)\s*[.\s-]*\d+(?:\.\d+)?\s*[:\-–]?\s*/i, '')) || undefined
        const dateText = text(el.find('p.small').first().text()), parsedDate = Date.parse(dateText)
        seen.add(chapterId)
        result.push({ chapterId, number, index: 0, webUrl: chapterId, language: 'en', date: new Date(Number.isFinite(parsedDate) ? parsedDate : 0), title })
    }
    return result.reverse().map((chapter, index) => ({ ...chapter, index }))
}
export function reader(html: string, base: string): string[] {
    const $ = load(html)
    if ($(restricted + ',form[action*=login],.chapter-locked').length) throw new Error('VyManga chapter requires login or payment')
    const primary = $('div.carousel-item[data-page] img')
    const scope = $('#chapter-content, #chapter-reader, #reader-content, #reader, .reading-content, .chapter-content, #reading-content, .chapter-images')
    const nodes = primary.length ? primary.toArray() : scope.find('img.lozad, img.d-block').toArray()
    if (!nodes.length) throw new Error('VyManga reader layout is unrecognized; no pages were verified')
    // Keep DOM order and repeated occurrences. A duplicate image URL can be intentional.
    // Never substitute document-wide logo/advertising images for a missing manifest.
    return nodes.map(node => image($, node, base))
}
