/* SPDX-License-Identifier: GPL-3.0-or-later */
import { BridgeOperation,
    ContentRating,
    HttpBridge,
    HttpHeaders,
    HttpMethod,
    imageDispatch,
    RequestOrigin } from '@mana-app/types'
import { Target } from './index'
import * as parser from './MangaStashParser'
import { MangaStashApi } from './MangaStashApi'
import { allowed,
    changeSetting,
    check,
    checkTitles,
    enter,
    known,
    observe,
    requireAllowed } from './MangaStashPolicy'

const globals = globalThis as unknown as Record<string, unknown>
const cover = 'https://mangastash.org/content/covers/kagura-bachi.jpg'
const page = 'https://mangastash.org/content/ayashimon/chapter-0025.6/001.jpg'
const key = 'MangaStash.authorization.v1'

describe('MangaStash public images and retained metadata policy', () => {
    let previousStore: unknown, previousBridge: unknown, sent: Record<string, unknown>[]
    let store: { get: jest.Mock, set: jest.Mock }
    let response: (message: Record<string, unknown>) => Promise<string>
    beforeEach(() => {
        previousStore = globals.ObjectStore; previousBridge = globals.__manaHTTPBridge; sent = []
        const unexpected = async () => { throw new Error('Public images must not access ObjectStore') }
        store = { get: jest.fn(unexpected), set: jest.fn(unexpected) }; globals.ObjectStore = store
        response = async message => String(message.url)
        const bridge: HttpBridge = { now: () => Date.now(), send: async message => {
            if (message.operation === BridgeOperation.Release) return {}
            if (message.operation !== BridgeOperation.Fetch) throw new Error('Unexpected bridge operation')
            sent.push(message)
            return { bodyID: String(sent.length), sessionID: 'control', url: message.url, status: 200, text: await response(message) }
        } }
        globals.__manaHTTPBridge = bridge
    })
    afterEach(() => { globals.ObjectStore = previousStore; globals.__manaHTTPBridge = previousBridge; jest.restoreAllMocks() })
    async function read(source: Target, url: string, origin: RequestOrigin.Cover | RequestOrigin.Page): Promise<string> {
        const image = { url, origin }, client = origin === RequestOrigin.Cover ? source.getCoverTransport(image) : source.getPageTransport(image)
        const result = await client[imageDispatch](image)
        try { return await result.text() } finally { result.releaseNative() }
    }

    test('fresh, repeated and page-as-cover requests reuse two clients without image storage', async () => {
        const source = new Target()
        const first = source.getCoverTransport({ url: cover, origin: RequestOrigin.Cover })
        expect(first).toBe(source.getCoverTransport({ url: page, origin: RequestOrigin.Cover }))
        expect(first).not.toBe(source.getPageTransport({ url: page, origin: RequestOrigin.Page }))
        for (const url of [cover, cover.replace('/covers/', '/covers/thumbnails/'), cover.replace('kagura-bachi.jpg', 'AYASHIMON.JPG'), page]) {
            await expect(read(source, url, RequestOrigin.Cover)).resolves.toBe(url)
            await expect(read(new Target(), url, RequestOrigin.Page)).resolves.toBe(url)
        }
        for (const message of sent) {
            const headers = new HttpHeaders(message.headers as Record<string, string>)
            expect(message.method).toBe(HttpMethod.Get)
            expect(headers.get('referer')).toBe('https://mangastash.org/')
            expect(headers.get('accept')).toBe('image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8')
        }
        expect(store.get).not.toHaveBeenCalled(); expect(store.set).not.toHaveBeenCalled()
    })

    test('factories and reusable clients reject unsafe routes and incorrect origins before Fetch', async () => {
        const source = new Target(), image = { url: cover, origin: RequestOrigin.Cover as const }
        const client = source.getCoverTransport(image)
        for (const url of [cover + '?', cover + '#x', cover.replace('https:', 'http:'), cover.replace('.org/', '.org:443/'),
            cover.replace('.org/', '.org.evil/'), cover.replace('/content/', '/x/../content/'), cover.replace('/content/', '/%2e%2e/content/'),
            cover.replace('/content/covers/', '/private/'), page.replace('chapter-0025.6', 'chapter-abc')]) {
            expect(() => source.getCoverTransport({ ...image, url })).toThrow()
            if (!url.includes('#')) await expect(client[imageDispatch]({ ...image, url })).rejects.toThrow()
        }
        expect(() => source.getCoverTransport({ ...image, origin: RequestOrigin.Page })).toThrow()
        await expect(client[imageDispatch]({ ...image, origin: RequestOrigin.Page })).rejects.toThrow()
        await expect(client.get(cover)).rejects.toThrow()
        expect(sent).toHaveLength(0)
    })

    test('concurrent images and a failed transport do not capture another request URL or poison reuse', async () => {
        const source = new Target(), other = page.replace('001', '002')
        let finish!: (value: string) => void, started!: () => void
        const began = new Promise<void>(resolve => { started = resolve })
        response = async message => message.url === page ? (started(), new Promise(resolve => { finish = resolve })) : String(message.url)
        const pending = read(source, page, RequestOrigin.Page); await began
        await expect(read(source, other, RequestOrigin.Page)).resolves.toBe(other)
        response = async () => { throw new Error('controlled failure') }
        await expect(read(source, other, RequestOrigin.Page)).rejects.toThrow('controlled failure')
        finish(page); await expect(pending).resolves.toBe(page)
        response = async () => 'recovered'
        await expect(read(source, other, RequestOrigin.Page)).resolves.toBe('recovered')
        expect(store.get).not.toHaveBeenCalled(); expect(store.set).not.toHaveBeenCalled()
    })

    test('legacy images are ignored while title classification, chapters and setting revisions remain', async () => {
        const chapters = [{ chapterId: 'ayashimon/chapter-25.6', number: 25.6, index: 0, date: new Date(0), language: 'en_US', locked: true }]
        let saved: unknown = { revision: 0, onlySafe: false, titles: [], images: 'obsolete image state' }
        store.get.mockImplementation(async requested => { expect(requested).toBe(key); return saved })
        store.set.mockImplementation(async (requested, value) => { expect(requested).toBe(key); saved = value })
        const policy = await enter({ allowedContentRatings: [ContentRating.SAFE] })
        const card = { id: 'ayashimon', title: 'Ayashimon', cover: page, rating: ContentRating.EXPLICIT, classified: true }
        await observe([card], policy, chapters)
        await expect(checkTitles([card.id], policy)).rejects.toThrow(/excluded/)
        expect(allowed(card, policy)).toBe(false)
        expect(() => requireAllowed(card, policy)).toThrow(/excluded/)
        const metadata = await known(card.id, policy)
        expect(metadata?.chapters).toEqual(chapters)
        expect(saved).not.toHaveProperty('images')
        await changeSetting(true)
        await expect(check(policy)).rejects.toThrow(/changed/)
        const current = await enter()
        expect(allowed(card, current)).toBe(false)
        expect(allowed({ ...card, classified: false, rating: undefined }, current)).toBe(false)
        expect(allowed({ ...card, rating: ContentRating.SAFE }, current)).toBe(true)
    })

    test('reader callback rechecks a chapter that became locked while its response was pending', async () => {
        const chapter = { chapterId: 'ayashimon/chapter-25.6', number: 25.6, index: 0, date: new Date(0), language: 'en_US', locked: false }
        const title = { title: 'Ayashimon', rating: ContentRating.SAFE, classified: true, at: Date.now(), chapters: [chapter] }
        const saved = { revision: 0, onlySafe: false, titles: [['ayashimon', title]] }
        store.get.mockImplementation(async () => structuredClone(saved))
        const source = new Target()
        let finish!: (value: string) => void, started!: () => void
        const began = new Promise<void>(resolve => { started = resolve })
        // Isolate the final access boundary; parser identity and real HTTP are
        // covered separately by native CI, not by this controlled response.
        jest.spyOn(MangaStashApi.prototype, 'text').mockImplementation(async () => {
            started(); return new Promise(resolve => { finish = resolve })
        })
        jest.spyOn(parser, 'parseReader').mockReturnValue({ pages: [{ url: page }] })
        const pending = source.getChapterData('ayashimon', chapter.chapterId)
        await began; chapter.locked = true; finish('controlled reader response')
        await expect(pending).rejects.toThrow(/access changed/)
        expect(sent).toHaveLength(0)
    })

})
