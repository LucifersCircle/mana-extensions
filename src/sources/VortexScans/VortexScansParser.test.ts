import {
    ContentRating,
    ContentType,
    PublicationStatus,
    ReadingMode
} from '@mana-app/types'
import { isVortexChallenge } from './VortexScansApi'
import { VortexPost } from './VortexScansModels'
import {
    VortexScansParser,
    isVortexChapterLocked
} from './VortexScansParser'
import {
    buildVortexApiUrl,
    buildVortexContentId,
    normalizeVortexSearchTerm,
    parseVortexContentId
} from './VortexScansUtils'

const parser = new VortexScansParser()

const post: VortexPost = {
    id: 663,
    slug: 'the-demon-king\'s-friend',
    postTitle: 'The Demon King&#39;s Friend',
    postContent: '<p>A hero &amp; a demon.</p><p>They become allies.</p>',
    alternativeTitles: 'Alternate One, Alternate Two\nThe Demon King\'s Friend',
    featuredImage: 'https://storage.vortexscans.org/cover.jpg',
    seriesStatus: 'ONGOING',
    seriesType: 'MANHWA',
    isNovel: false,
    author: 'Writer',
    artist: 'Artist',
    genres: [
        { id: 1, name: 'Action' },
        { id: 2, name: 'hidden' }
    ],
    chapters: [{
        id: 10,
        number: 7,
        slug: 'chapter-7'
    }]
}

describe('VortexScans identifiers and requests', () => {
    test('round-trips compound identifiers with punctuation', () => {
        const contentId = buildVortexContentId(post.id, post.slug)

        expect(contentId).toBe('663:the-demon-king%27s-friend')
        expect(parseVortexContentId(contentId)).toEqual({
            id: '663',
            slug: post.slug
        })
        expect(parseVortexContentId('663')).toEqual({ id: '663' })
        expect(parseVortexContentId('663/the-demon-king')).toEqual({
            id: '663',
            slug: 'the-demon-king'
        })
        expect(parseVortexContentId('663|the-demon-king')).toEqual({
            id: '663',
            slug: 'the-demon-king'
        })
    })

    test('normalizes smart punctuation and encodes API parameters', () => {
        expect(normalizeVortexSearchTerm('  The  Demon\u2019s \u201cFriend\u201d  '))
            .toBe('The Demon\'s "Friend"')
        expect(buildVortexApiUrl('/query', {
            page: 2,
            searchTerm: 'Demon\'s Friend',
            unused: undefined
        })).toBe(
            'https://api.vortexscans.org/api/query?page=2&searchTerm=Demon%27s%20Friend'
        )
    })
})

describe('VortexScans metadata parsing', () => {
    test('maps API posts into Mana content', () => {
        const content = parser.parseContent(post)

        expect(content).toMatchObject({
            title: 'The Demon King\'s Friend',
            cover: post.featuredImage,
            contentRating: ContentRating.SAFE,
            status: PublicationStatus.ONGOING,
            contentType: ContentType.MANHWA,
            recommendedPanelMode: ReadingMode.WEBTOON,
            summary: 'A hero & a demon.\nThey become allies.',
            additionalTitles: ['Alternate One', 'Alternate Two'],
            tags: [{ id: '1', title: 'Action' }]
        })
        expect(content.additionalInfo?.[0]?.items).toHaveLength(2)
    })

    test('filters novels and creates compound highlight IDs', () => {
        const results = parser.parseHighlights([
            post,
            { ...post, id: 2, slug: 'novel', isNovel: true }
        ])

        expect(results).toHaveLength(1)
        expect(results[0]).toMatchObject({
            id: '663:the-demon-king%27s-friend',
            title: 'The Demon King\'s Friend',
            subtitle: '7 Chapters',
            contentRating: ContentRating.SAFE
        })
    })

    test('classifies mature and suggestive genres for Mana content gating', () => {
        expect(parser.parseHighlights([
            { ...post, genres: [{ id: 12, name: 'Mature' }] }
        ])[0]?.contentRating).toBe(ContentRating.MATURE)
        expect(parser.parseContent({
            ...post,
            genres: [{ id: 49, name: 'Harem' }]
        }).contentRating).toBe(ContentRating.SUGGESTIVE)
    })
})

describe('VortexScans chapter parsing', () => {
    test('filters locked chapters and sorts unlocked chapters oldest first', () => {
        const chapters = parser.parseChapters([
            {
                id: 3,
                number: 3,
                title: '',
                slug: 'chapter-3',
                createdAt: '2026-03-03T00:00:00.000Z',
                isLocked: false,
                mangaPost: { slug: post.slug }
            },
            {
                id: 2,
                number: 2,
                slug: 'chapter-2',
                price: 10,
                isPurchased: false
            },
            {
                id: 1,
                number: 1,
                title: 'Beginning',
                slug: 'chapter-1',
                createdAt: '2026-01-01T00:00:00.000Z',
                isLocked: false
            }
        ], post.slug)

        expect(chapters.map((chapter) => chapter.chapterId)).toEqual(['1', '3'])
        expect(chapters[0]).toMatchObject({
            number: 1,
            index: 0,
            language: 'en_US',
            title: 'Chapter 1 - Beginning',
            webUrl: 'https://vortexscans.org/series/the-demon-king%27s-friend/chapter-1'
        })
        expect(isVortexChapterLocked({
            id: 9,
            number: 9,
            slug: 'chapter-9',
            isPermanentlyLocked: 1
        })).toBe(true)
    })

    test('sorts API page images and percent-encodes spaces', () => {
        const data = parser.parseChapterData({
            images: [
                { url: 'https://cdn.test/page-0002 image.webp', order: 2 },
                { url: 'https://cdn.test/page-0001.webp', order: 1 }
            ]
        })

        expect(data.pages).toEqual([
            { url: 'https://cdn.test/page-0001.webp' },
            { url: 'https://cdn.test/page-0002%20image.webp' }
        ])
    })

    test('extracts the largest chapter image group from page HTML', () => {
        const html = [
            'https://storage.vortexscans.org/upload/series/featured/cover.jpg',
            'https://storage.vortexscans.org/upload/series/title/chapter/page-0002.webp',
            'https://storage.vortexscans.org/upload/series/title/chapter/page-0001.webp',
            'https://storage.vortexscans.org/upload/series/title/chapter/page-0002.webp'
        ].join(' " ')

        expect(parser.parseChapterPage(html).pages).toEqual([
            {
                url: 'https://storage.vortexscans.org/upload/series/title/chapter/page-0001.webp'
            },
            {
                url: 'https://storage.vortexscans.org/upload/series/title/chapter/page-0002.webp'
            }
        ])
    })
})

describe('VortexScans challenge detection', () => {
    test('detects Cloudflare headers and vShield HTML', () => {
        const request = { url: 'https://vortexscans.org/series/title' }

        expect(isVortexChallenge({
            request,
            status: 200,
            headers: { 'CF-Mitigated': 'challenge' },
            data: ''
        })).toBe(true)
        expect(isVortexChallenge({
            request,
            status: 200,
            headers: {},
            data: '<html>vShield verification</html>'
        })).toBe(true)
        expect(isVortexChallenge({
            request,
            status: 200,
            headers: {},
            data: '<html>series page</html>'
        })).toBe(false)
    })
})
