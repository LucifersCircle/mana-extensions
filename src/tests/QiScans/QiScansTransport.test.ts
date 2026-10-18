/* SPDX-License-Identifier: GPL-3.0-or-later */
import { BridgeOperation,
    HttpBridge,
    HttpClient,
    imageDispatch,
    ImageRequest,
    RequestOrigin } from '@mana-app/types'
import { QiScansApi } from '../../sources/QiScans/QiScansApi'
import { Series } from '../../sources/QiScans/QiScansParser'
import { Target } from '../../sources/QiScans/index'

const globals = globalThis as unknown as Record<string, unknown>
const owner = 'the-hero\'s-café', route = '/series/the-hero%27s-caf%C3%A9'
const series: Series = { slug: owner, title: 'The Hero\'s Café', type: 'MANHWA', status: 'ONGOING', cover: 'https://media.qimanhwa.com/uploads/cover.webp?quality=original' }

describe('QiScans catalog operations with synthetic unit data', () => {
    afterEach(() => jest.restoreAllMocks())

    test('all discovery sections and search retain usable rows with escaped source identities', async () => {
        const rows = [{ ...series, slug: '' }, series, { ...series, slug: 'another', cover: 'bad:cover' }]
        const json = jest.spyOn(QiScansApi.prototype, 'json').mockImplementation(async path => {
            if (path === '/home') return { banners: rows, popular: rows, pinned: rows, newSeries: rows, editorsPick: rows }
            if (path === '/series?page=1&perPage=20&sort=latest') return { data: rows }
            throw new Error('Unexpected unit request: ' + path)
        })
        const source = new Target(), link = { id: 'home' }
        for (const section of await source.getSectionsForPage(link)) {
            const result = await source.resolvePageSection(link, section.id)
            expect(result.items?.map(item => item.id)).toEqual([owner, 'another'])
            expect(result.items?.[0]?.webUrl).toBe('https://qimanhwa.com' + route)
            expect(result.items?.[0]?.cover).toBe(series.cover)
        }
        expect((await source.search({ page: 1 })).results.map(item => item.id)).toEqual([owner, 'another'])
        expect(json.mock.calls.filter(([path]) => path === '/home')).toHaveLength(1)
    })

    test('encoded deep links, metadata and complete chapter traversal use the same raw source identity', async () => {
        const chapter = { slug: 'chapter 16.5', number: 16.5, createdAt: '2026-10-18T00:00:00Z', publishStatus: 'PUBLIC', price: 0, isFree: true, requiresPurchase: false }
        const json = jest.spyOn(QiScansApi.prototype, 'json').mockImplementation(async path => {
            if (path === route) return series
            if (path === route + '/chapters?page=1&perPage=30&sort=desc') return { data: [chapter], totalItems: 1, totalPages: 1, current: 1, next: null }
            if (path === route + '/chapters/chapter%2016.5') return { ...chapter, series: { slug: owner }, totalImages: 1, images: [{ url: 'https://media.qimanhwa.com/uploads/page.webp?quality=original', order: 1 }] }
            throw new Error('Unexpected unit request: ' + path)
        })
        const source = new Target()
        expect((await source.handleURL('https://qimanhwa.com' + route))?.content?.id).toBe(owner)
        const chapters = await source.getChapters(owner)
        expect(chapters[0]).toMatchObject({ chapterId: chapter.slug, number: 16.5, webUrl: 'https://qimanhwa.com' + route + '/chapter%2016.5' })
        expect((await source.getChapterData(owner, chapter.slug, chapters[0])).pages).toHaveLength(1)
        expect(json.mock.calls.filter(([path]) => path.includes('/chapters?page='))).toHaveLength(1)
        for (const url of ['https://qimanhwa.com/series/%2e%2e', 'https://qimanhwa.com/series/a%2Fb', 'https://qimanhwa.com/series/%ZZ', 'https://other-site.org' + route]) {
            expect(await source.handleURL(url)).toBeNull()
        }
    })
})

// Exercise the installed SDK against a local bridge; no provider requests are made.
describe('QiScans image transports', () => {
    let previous: unknown, sent: Record<string, unknown>[]
    beforeEach(() => {
        previous = globals.__manaHTTPBridge; sent = []
        const bridge: HttpBridge = { now: () => Date.now(), send: async message => {
            if (message.operation === BridgeOperation.Release) return {}
            if (message.operation !== BridgeOperation.Fetch) throw new Error('Unexpected bridge operation')
            sent.push(message)
            return { bodyID: 'unit-' + sent.length, sessionID: 'unit', url: message.url, status: 200, text: message.url }
        } }
        globals.__manaHTTPBridge = bridge
    })
    afterEach(() => { globals.__manaHTTPBridge = previous })

    async function dispatch(client: HttpClient, image: ImageRequest): Promise<string> {
        const response = await client[imageDispatch](image)
        try { return await response.text() } finally { response.releaseNative() }
    }

    test('cover and page clients preserve API-provided media queries with their correct request origins', async () => {
        const source = new Target()
        const cover = { url: series.cover as string, origin: RequestOrigin.Cover as const }
        const page = { url: 'https://cdn.qiscans.org/pages/16-1?quality=original', origin: RequestOrigin.Page as const }
        const coverClient = source.getCoverTransport(cover), pageClient = source.getPageTransport(page)
        expect(coverClient).not.toBe(pageClient)
        await expect(dispatch(coverClient, cover)).resolves.toBe(cover.url)
        await expect(dispatch(pageClient, page)).resolves.toBe(page.url)
        expect(sent.map(message => [message.url, message.origin])).toEqual([[cover.url, RequestOrigin.Cover], [page.url, RequestOrigin.Page]])
        await expect(dispatch(coverClient, page)).rejects.toThrow('origin')
        await expect(pageClient.get(page.url)).rejects.toThrow('origin')
        expect(sent).toHaveLength(2)
    })
})
