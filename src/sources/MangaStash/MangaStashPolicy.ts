/* SPDX-License-Identifier: GPL-3.0-or-later */
import {
    ContentRating,
    SourceContext } from '@mana-app/types'
import { assertRatingPolicy,
    nativeRating,
    ratingAllowed } from '../../ContentRatingPolicy'
import { Card,
    chapterId,
    imageURL,
    validId,
    SourceChapter } from './MangaStashParser'

const STORE = 'MangaStash.authorization.v1'
const LIFETIME = 24 * 60 * 60 * 1000
const TITLE_LIMIT = 512, IMAGE_LIMIT = 8192
let queue = Promise.resolve()
type Title = { title: string, rating?: ContentRating, classified: boolean, at: number, chapters?: SourceChapter[] }
type Grant = { id: string, chapter: string, rating?: ContentRating, classified: boolean, at: number, expires: number, revision: number, allowed?: ContentRating[] }
type State = { revision: number, onlySafe: boolean, titles: Array<[string, Title]>, images: Array<[string, Grant]> }
export type Policy = { revision: number, onlySafe: boolean, allowed?: ContentRating[] }
// Serialize within this bundle; ObjectStore does not expose cross-VM transactions.
function serial<T>(run: () => Promise<T>): Promise<T> { const result = queue.then(run); queue = result.then(() => undefined, () => undefined); return result }
async function state(): Promise<State> {
    const value = await ObjectStore.get(STORE) as State | undefined
    if (!value) return { revision: 0, onlySafe: false, titles: [], images: [] }
    if (!Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.onlySafe !== 'boolean' || !Array.isArray(value.titles) || !Array.isArray(value.images) || value.images.length > IMAGE_LIMIT) throw new Error('Invalid saved MangaStash policy')
    return value
}
function snapshot(value: State, context?: SourceContext): Policy { return { revision: value.revision, onlySafe: value.onlySafe, allowed: context?.allowedContentRatings === undefined ? undefined : [...context.allowedContentRatings] } }
function matching(value: State, policy: Policy): void { if (value.revision !== policy.revision || value.onlySafe !== policy.onlySafe) throw new Error('MangaStash settings or native policy changed; refresh to continue') }
function titleMap(value: State): Map<string, Title> {
    const now = Date.now(), entries = new Map<string, Title>()
    for (const entry of value.titles.slice(-TITLE_LIMIT)) {
        if (!Array.isArray(entry) || entry.length !== 2) continue
        const [id, title] = entry
        try {
            validId(id)
            if (!title || typeof title.title !== 'string' || !title.title.trim() || typeof title.classified !== 'boolean' || !Number.isSafeInteger(title.at) || title.at > now || title.at < 0 || title.at + LIFETIME <= now
                || (title.classified ? title.rating === undefined || nativeRating(title.rating) !== title.rating : title.rating !== undefined)) continue
            if (title.chapters !== undefined && (!Array.isArray(title.chapters) || !title.chapters.length || title.chapters.length > 30000 || title.chapters.some((item) => !item || chapterId(`/${item.chapterId}`, id) !== item.chapterId || !Number.isFinite(item.number) || !Number.isSafeInteger(item.index) || typeof item.locked !== 'boolean'))) continue
            entries.set(id, title)
        } catch { /* Unverifiable saved title evidence cannot authorize a callback. */ }
    }
    return entries
}
function imageMap(value: State): Map<string, Grant[]> {
    const now = Date.now(), entries = new Map<string, Grant[]>()
    for (const entry of value.images.slice(-IMAGE_LIMIT)) {
        if (!Array.isArray(entry) || entry.length !== 2) continue
        const [url, grant] = entry
        try {
            if (!grant || typeof grant.chapter !== 'string' || typeof grant.classified !== 'boolean' || !Number.isSafeInteger(grant.at) || grant.at < 0 || grant.at > now || grant.expires !== grant.at + LIFETIME || grant.expires <= now || grant.revision !== value.revision
                || (grant.classified ? grant.rating === undefined || nativeRating(grant.rating) !== grant.rating : grant.rating !== undefined)) continue
            assertRatingPolicy({ allowedContentRatings: grant.allowed })
            if (imageURL(url, grant.id, grant.chapter || undefined) !== url) continue
        } catch { /* Unverifiable saved grants fail closed. */ continue }
        const roles = entries.get(url) ?? []
        if (roles.some((old) => old.id !== grant.id || old.chapter === grant.chapter || (old.chapter && grant.chapter))) throw new Error('MangaStash saved image roles conflict')
        roles.push(grant); entries.set(url, roles)
    }
    return entries
}
function permitted(title: Pick<Title, 'rating' | 'classified'>, policy: Policy): boolean {
    return (!policy.onlySafe || (title.classified && title.rating === ContentRating.SAFE)) && ratingAllowed(title.rating, { allowedContentRatings: policy.allowed })
}
export function allowed(card: Card, policy: Policy): boolean { return permitted(card, policy) }
export function enter(context?: SourceContext): Promise<Policy> {
    assertRatingPolicy(context)
    return serial(async () => {
        const value = await state()
        return snapshot(value, context)
    })
}
export function check(policy: Policy): Promise<void> { return serial(async () => { matching(await state(), policy) }) }
export function changeSetting(onlySafe: boolean): Promise<void> {
    return serial(async () => {
        if (typeof onlySafe !== 'boolean') throw new Error('Invalid MangaStash source setting')
        const value = await state()
        if (value.onlySafe !== onlySafe) {
            if (!Number.isSafeInteger(value.revision + 1)) throw new Error('MangaStash source-setting revision is exhausted')
            value.onlySafe = onlySafe; value.revision += 1; value.images = []
        }
        await ObjectStore.set(STORE, value)
    })
}
export function observe(cards: Card[], policy: Policy, chapters?: SourceChapter[]): Promise<Card[]> {
    return serial(async () => {
        const value = await state(); matching(value, policy)
        const titles = titleMap(value), result: Card[] = []
        for (const card of cards) {
            const old = titles.get(card.id)
            // Unknown browse cards cannot erase explicit metadata or renew its evidence.
            const stronger = old?.classified && (!card.classified || (old.rating ?? 0) > (card.rating ?? 0))
            const next: Title = stronger ? { ...old, chapters: chapters ?? old.chapters } : { title: card.title, rating: card.rating, classified: card.classified, at: Date.now(), chapters: chapters ?? old?.chapters }
            titles.delete(card.id); titles.set(card.id, next)
            result.push({ ...card, rating: next.rating, classified: next.classified })
        }
        while (titles.size > TITLE_LIMIT) titles.delete(titles.keys().next().value as string)
        value.titles = [...titles]; await ObjectStore.set(STORE, value)
        return result
    })
}
export function known(id: string, policy: Policy): Promise<Title | undefined> {
    validId(id)
    return serial(async () => { const value = await state(); matching(value, policy); return titleMap(value).get(id) })
}
export function requireAllowed(title: Pick<Title, 'rating' | 'classified'> | undefined, policy: Policy): void {
    if (!title || !permitted(title, policy)) throw new Error('MangaStash title is excluded by current native/source content policy, or its classification is unavailable')
}
export function issue(cards: Card[], policy: Policy, pages?: { id: string, chapter: string, urls: string[] }): Promise<void> {
    return serial(async () => {
        const value = await state(); matching(value, policy)
        const titles = titleMap(value), images = imageMap(value)
        const inputs = pages ? pages.urls.map((url) => ({ url, id: pages.id, chapter: pages.chapter })) : cards.map((card) => ({ url: card.cover, id: card.id, chapter: '' }))
        for (const item of inputs) {
            const title = titles.get(item.id); requireAllowed(title, policy)
            if (!title) throw new Error('MangaStash title evidence is missing')
            imageURL(item.url, item.id, item.chapter || undefined)
            if (item.chapter && !title.chapters?.some((chapter) => chapter.chapterId === item.chapter && !chapter.locked)) throw new Error('MangaStash image has unknown chapter owner')
            const roles = images.get(item.url) ?? []
            if (roles.some((old) => old.id !== item.id || (old.chapter && item.chapter && old.chapter !== item.chapter))) throw new Error('MangaStash image owner conflict')
            const old = roles.find((grant) => grant.chapter === item.chapter)
            // A public cover and a verified reader may advertise the same URL.
            // Keep their evidence separate; issuing one role never renews the other.
            const at = old?.at ?? title.at
            const grant = old ?? { ...item, rating: title.rating, classified: title.classified, at, expires: at + LIFETIME, revision: policy.revision, allowed: policy.allowed }
            images.set(item.url, [...roles.filter((role) => role.chapter !== item.chapter), grant])
        }
        const stored: State['images'] = [...images].flatMap(([url, roles]) => roles.map((role) => [url, role] as [string, Grant]))
        value.images = stored.slice(-IMAGE_LIMIT); await ObjectStore.set(STORE, value)
    })
}
export function authorizeImage(url: string, policy: Policy): Promise<void> {
    return serial(async () => {
        const value = await state(); matching(value, policy)
        const roles = imageMap(value).get(url)
        if (!roles?.length) throw new Error('MangaStash image was not issued, expired, or its policy changed; refresh the source')
        const titles = titleMap(value)
        for (const grant of roles) {
            imageURL(url, grant.id, grant.chapter || undefined)
            const issuingPolicy = { ...policy, allowed: grant.allowed }, title = titles.get(grant.id)
            if (!title || !permitted(grant, issuingPolicy) || !permitted(title, issuingPolicy)) continue
            if (grant.chapter && !title.chapters?.some((chapter) => chapter.chapterId === grant.chapter && !chapter.locked)) continue
            return
        }
        throw new Error('MangaStash image roles are excluded by current policy or chapter evidence is unavailable')
    })
}
