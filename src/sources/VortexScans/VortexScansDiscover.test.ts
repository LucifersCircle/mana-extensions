import {
    buildVortexHomeSections,
    parseCollectionHighlights,
    parsePopularToday,
    selectPublishedCollections
} from './VortexScansDiscover'

describe('VortexScans discovery', () => {
    test('promotes every API-backed home list into its own section', () => {
        const sections = buildVortexHomeSections({
            collections: [
                { id: 2, slug: 'second', title: 'Second', displayOrder: 2 },
                { id: 1, slug: 'first', title: 'First', displayOrder: 1 }
            ]
        })

        expect(sections.map(({ id, title }) => ({ id, title })))
            .toEqual([
                { id: 'popular-today', title: 'Popular Today' },
                { id: 'latest', title: 'Latest' },
                { id: 'new', title: 'New' },
                { id: 'collection:first', title: 'First' },
                { id: 'collection:second', title: 'Second' },
                { id: 'most-popular', title: 'Most Popular' }
            ])
    })

    test('parses popular titles and resolves their serialized post IDs', () => {
        const html = `
            <script>window.data=[{id:42,slug:"the-series"}]</script>
            <section>
                <h2>Popular Today</h2>
                <a href="/series/the-series" title="The Series">
                    <img src="https://cdn.test/the-series.webp">
                    <img src="/theme/flags/manhwa.svg" alt="MANHWA">
                </a>
            </section>
        `

        expect(parsePopularToday(html)).toEqual([{
            id: '42:the-series',
            title: 'The Series',
            cover: 'https://cdn.test/the-series.webp',
            subtitle: 'Manhwa'
        }])
    })

    test('filters and orders collections, then orders their works', () => {
        const collections = selectPublishedCollections({
            collections: [
                { id: 2, slug: 'second', title: 'Second', displayOrder: 2 },
                { id: 3, slug: 'hidden', title: 'Hidden', isPublished: false },
                { id: 1, slug: 'first', title: 'First', displayOrder: 1 }
            ]
        })
        expect(collections.map((item) => item.title)).toEqual(['First', 'Second'])

        const results = parseCollectionHighlights({
            collection: {
                id: 1,
                slug: 'staff-picks',
                title: 'Staff Picks',
                works: [
                    {
                        id: 2,
                        position: 2,
                        post: {
                            id: 22,
                            slug: 'later',
                            postTitle: 'Later',
                            seriesType: 'MANHUA'
                        }
                    },
                    {
                        id: 1,
                        position: 1,
                        post: {
                            id: 11,
                            slug: 'first',
                            postTitle: 'First',
                            seriesType: 'MANHWA'
                        }
                    }
                ]
            }
        })
        expect(results.map((item) => item.id)).toEqual([
            '11:first',
            '22:later'
        ])
    })
})
