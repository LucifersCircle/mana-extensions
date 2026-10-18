/* SPDX-License-Identifier: GPL-3.0-or-later */
import { ReadingMode } from '@mana-app/types'
import { cards,
    chapters,
    detail,
    imageURL,
    pages,
    pathComponent,
    Reader,
    Series,
    seriesURL,
    slug,
    SourceChapter } from '../../sources/QiScans/QiScansParser'

// Synthetic unit inputs exercise parsing boundaries, not live provider responses.
const series: Series = { slug: 'the-rebel', title: 'The Rebel', type: 'MANHUA', status: 'ONGOING', publishStatus: 'PUBLIC', cover: 'https://media.qimanhwa.com/uploads/cover.webp?quality=original' }
const chapter: SourceChapter = { slug: 'chapter-16', number: 16, createdAt: '2026-10-18T00:00:00Z', publishStatus: 'PUBLIC', price: 0, isFree: true, requiresPurchase: false }

describe('QiScans source identities', () => {
    test.each(['the-rebel', 'the-hero\'s-return', 'café-王者', 'Title (Part 2)!', 'two..dots', '100%?edition#1'])('preserves and escapes the complete source slug: %s', value => {
        expect(slug(value)).toBe(value)
        const path = pathComponent(value)
        expect(decodeURIComponent(path)).toBe(value)
        expect(new URL(seriesURL(value)).pathname).toBe('/series/' + path)
        expect(new URL(seriesURL(value)).search).toBe('')
        expect(new URL(seriesURL(value)).hash).toBe('')
    })

    test.each(['', ' ', '.', '..', '../series', 'series/chapter', 'series\\chapter', 'bad\u0000slug', 'bad\nslug'])('rejects missing, traversal and control identities: %j', value => {
        expect(() => slug(value)).toThrow('Invalid QiScans canonical slug')
    })

    test('uses the same escaped series and chapter links while retaining chapter identities and decimal numbers', () => {
        const owner = 'the-hero\'s-return', row = { ...chapter, slug: 'chapter 16.5', number: 16.5 }
        const result = chapters([row], owner)
        expect(result[0]).toMatchObject({ chapterId: row.slug, number: 16.5, webUrl: 'https://qimanhwa.com/series/the-hero%27s-return/chapter%2016.5' })
        expect(detail({ ...series, slug: owner }, owner).webUrl).toBe(seriesURL(owner))
    })
})

describe('QiScans catalog media and row isolation', () => {
    test.each([
        'https://media.qimanhwa.com/file/qiscans/cover.webp',
        'https://media.qimanhwa.com/uploads/covers/42?format=webp&width=1200',
        'https://cdn.qiscans.org/images/page.avif?quality=original',
        '/uploads/cover.jpg',
        '//media.qimanhwa.com/uploads/cover.jpg'
    ])('accepts public HTTPS media without restricting its CDN path or query: %s', value => {
        expect(imageURL(value)).toBe(new URL(value, 'https://qimanhwa.com').href)
    })

    test.each([
        'http://media.qimanhwa.com/cover.jpg', 'data:image/png;base64,AAAA',
        'https://user:pass@media.qimanhwa.com/cover.jpg', 'https://media.qimanhwa.com:8443/cover.jpg',
        'https://media.qimanhwa.com/cover.jpg#fragment', 'https://localhost/cover.jpg',
        'https://127.0.0.1/cover.jpg', 'https://2130706433/cover.jpg', 'https://[::1]/cover.jpg',
        'https://169.254.169.254/cover.jpg', 'https://cdn.internal/cover.jpg',
        'https://media.qimanhwa.com\\@localhost/cover.jpg'
    ])('continues to reject unsafe image destinations: %s', value => {
        expect(() => imageURL(value)).toThrow()
    })

    test('keeps usable cards when neighboring rows have missing IDs, bad covers, duplicates or promotional data', () => {
        const values = [
            series,
            { ...series, slug: '' },
            { ...series, slug: 'the-hero\'s-return', title: 'The Hero&#39;s Return' },
            { ...series, slug: 'café-王者', cover: 'https://localhost/cover.jpg' },
            { ...series, slug: 'novel', type: 'NOVEL' },
            { ...series, slug: 'redirect', redirectUrl: 'https://other-site.org/' },
            { ...series, slug: 'private', publishStatus: 'PRIVATE' },
            { ...series, slug: 'advert', title: 'https://other-site.org/' },
            { ...series, slug: '../bad' },
            series,
            null
        ] as Series[]
        expect(cards(values)).toEqual([
            { id: series.slug, title: series.title, cover: series.cover, subtitle: 'Manhua • Ongoing' },
            { id: 'the-hero\'s-return', title: 'The Hero\'s Return', cover: series.cover, subtitle: 'Manhua • Ongoing' },
            { id: 'café-王者', title: series.title, cover: '', subtitle: 'Manhua • Ongoing' }
        ])
    })
})

describe('QiScans reader data', () => {
    test.each(['MANHWA', 'MANHUA'])('recommends Webtoon mode for %s titles', type => {
        expect(detail({ ...series, type }, series.slug).recommendedPanelMode).toBe(ReadingMode.WEBTOON)
    })

    test('preserves ordered source page URLs, including media queries, without applying a thumbnail size', () => {
        const urls = ['https://media.qimanhwa.com/uploads/16-1.webp?quality=original', 'https://cdn.qiscans.org/pages/16-2']
        const reader: Reader = { ...chapter, series: { slug: series.slug }, totalImages: 2, images: [{ url: urls[1] as string, order: 2 }, { url: urls[0] as string, order: 1 }] }
        expect(pages(reader, series.slug, chapter)).toEqual(urls.map(url => ({ url })))
        expect(reader.images[0]?.order).toBe(2)
    })

    test('still rejects incomplete, duplicate and restricted page manifests', () => {
        const reader: Reader = { ...chapter, totalImages: 1, images: [{ url: 'https://media.qimanhwa.com/uploads/16-1.webp', order: 1 }] }
        expect(() => pages({ ...reader, totalImages: 2 }, series.slug, chapter)).toThrow('complete page manifest')
        expect(() => pages({ ...reader, totalImages: 2, images: [reader.images[0] as Reader['images'][number], reader.images[0] as Reader['images'][number]] }, series.slug, chapter)).toThrow('complete page manifest')
        expect(() => pages({ ...reader, requiresPurchase: true }, series.slug, chapter)).toThrow('restricted')
    })
})
