/* SPDX-License-Identifier: GPL-3.0-or-later */
import {
    ContentRating,
    SourceContext } from '@mana-app/types'
import { assertRatingPolicy,
    nativeRating,
    ratingAllowed } from '../../ContentRatingPolicy'
import { Card,
    chapterId,
    validId,
    SourceChapter } from './MangaStashParser'

const STORE = 'MangaStash.authorization.v1'
const LIFETIME = 24 * 60 * 60 * 1000
const TITLE_LIMIT = 512
let queue = Promise.resolve()
type Title = { title: string, rating?: ContentRating, classified: boolean, at: number, chapters?: SourceChapter[] }
type State = { revision: number, onlySafe: boolean, titles: Array<[string, Title]> }
export type Policy = { revision: number, onlySafe: boolean, allowed?: ContentRating[] }
// Serialize within this bundle; ObjectStore does not expose cross-VM transactions.
function serial<T>(run: () => Promise<T>): Promise<T> { const result = queue.then(run); queue = result.then(() => undefined, () => undefined); return result }
async function state(): Promise<State> {
    const value = await ObjectStore.get(STORE) as State | undefined
    if (!value) return { revision: 0, onlySafe: false, titles: [] }
    if (!Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.onlySafe !== 'boolean' || !Array.isArray(value.titles)) throw new Error('Invalid saved MangaStash policy')
    // Keep only metadata/settings. Legacy image grants are no longer read or renewed.
    return { revision: value.revision, onlySafe: value.onlySafe, titles: value.titles }
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
            value.onlySafe = onlySafe; value.revision += 1
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
// Recheck current classification at the metadata callback boundary, not when
// public image bytes are requested. Another response may have supplied a warning.
export function checkTitles(ids: string[], policy: Policy): Promise<void> {
    return serial(async () => {
        const value = await state(); matching(value, policy)
        const titles = titleMap(value)
        for (const id of ids) requireAllowed(titles.get(id), policy)
    })
}
