// Bounded title-classification evidence protects metadata callbacks from older
// responses. It is not a public-image permission store. Keep existing keys so
// upgrading does not discard observed warnings or in-flight setting revisions.
const REVISION = 'MangaSushi.imagePolicyRevision'
const SETTING = 'MangaSushi.excludeNSFW'
const LIFETIME = 24 * 60 * 60 * 1000
const LIMIT = 8192
let queue = Promise.resolve()
const EVIDENCE = 'MangaSushi.imageEvidence'
const GENERATION = 'MangaSushi.imageEvidenceGeneration'
// Replaces the former scan of surviving image grants on partial metadata resets.
// This scalar cannot protect lineage if every metadata key is erased.
const HIGH_WATER = 'MangaSushi.classificationHighWater'
let highestGeneration = 0
export type ClassificationEvidence = { generation: number, sequence: number, at: number }
type TitleEvidence = ClassificationEvidence & { allowed: boolean, blockedThrough: number, firstSequence: number }
async function ledger(): Promise<{ highWater: number, generation: number, sequence: number, discardedThrough: number, missing: boolean, titles: Map<string, TitleEvidence> }> {
    const raw = await ObjectStore.get(EVIDENCE) as { generation?: unknown, sequence?: unknown, discardedThrough?: unknown, titles?: unknown } | undefined
    if (raw !== undefined && raw !== null && (!Number.isSafeInteger(raw.sequence) || (raw.sequence as number) < 0 || !Array.isArray(raw.titles) || (raw.discardedThrough !== undefined && (!Number.isSafeInteger(raw.discardedThrough) || (raw.discardedThrough as number) < 0 || (raw.discardedThrough as number) > (raw.sequence as number))))) throw new Error('Invalid saved MangaSushi classification evidence')
    const savedGeneration = await ObjectStore.get(GENERATION)
    const highWater = await ObjectStore.get(HIGH_WATER)
    for (const generation of [savedGeneration, raw?.generation, highWater]) if (generation !== undefined && generation !== null && (!Number.isSafeInteger(generation) || (generation as number) < 1)) throw new Error('Invalid saved MangaSushi evidence generation')
    highestGeneration = Math.max(highestGeneration, (savedGeneration as number | undefined) ?? 0, (raw?.generation as number | undefined) ?? 0, (highWater as number | undefined) ?? 0)
    const generation = savedGeneration === highestGeneration && raw?.generation === highestGeneration ? highestGeneration : 0
    if (!generation) return { highWater: (highWater as number | undefined) ?? 0, generation: 0, sequence: 0, discardedThrough: 0, missing: true, titles: new Map() }
    const sequence = (raw?.sequence as number | undefined) ?? 0, titles = new Map<string, TitleEvidence>()
    const stored = raw?.titles
    let discardedThrough = (raw?.discardedThrough as number | undefined) ?? 0
    if (Array.isArray(stored) && stored.length > LIMIT) discardedThrough = sequence
    for (const entry of Array.isArray(stored) ? stored.slice(-LIMIT) : []) {
        if (!Array.isArray(entry) || entry.length !== 2 || !validId(entry[0])) { discardedThrough = sequence; continue }
        const value = entry[1] as TitleEvidence | undefined
        if (!value || value.generation !== generation || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.sequence > sequence || !Number.isSafeInteger(value.at) || value.at < 0 || value.at > Date.now() || value.at + LIFETIME <= Date.now() || typeof value.allowed !== 'boolean' || !Number.isSafeInteger(value.blockedThrough) || value.blockedThrough < 0 || value.blockedThrough > value.sequence || (value.firstSequence !== undefined && (!Number.isSafeInteger(value.firstSequence) || value.firstSequence < 1 || value.firstSequence > value.sequence))) { discardedThrough = sequence; continue }
        // Older entries conservatively reject earlier metadata snapshots.
        titles.set(entry[0], { ...value, firstSequence: value.firstSequence ?? value.sequence })
    }
    return { highWater: (highWater as number | undefined) ?? 0, generation, sequence, discardedThrough, missing: false, titles }
}
async function saveLedger(value: Awaited<ReturnType<typeof ledger>>): Promise<void> {
    while (value.titles.size > LIMIT) {
        value.discardedThrough = value.sequence
        value.titles.delete(value.titles.keys().next().value as string)
    }
    await ObjectStore.set(EVIDENCE, { generation: value.generation, sequence: value.sequence, discardedThrough: value.discardedThrough, titles: [...value.titles] })
}
async function currentLedger(): Promise<Awaited<ReturnType<typeof ledger>>> {
    const value = await ledger()
    if (value.missing) {
        if (!Number.isSafeInteger(highestGeneration + 1)) throw new Error('MangaSushi evidence generation exhausted')
        value.generation = ++highestGeneration
        await ObjectStore.set(HIGH_WATER, value.generation)
        await ObjectStore.set(GENERATION, value.generation)
        await saveLedger(value)
    } else if (value.highWater !== value.generation) await ObjectStore.set(HIGH_WATER, value.generation)
    return value
}
// Metadata operations initialize lineage; image transport never reads it.
export function ensureClassificationEvidence(): Promise<void> { return serialized(async () => { await currentLedger() }) }
// Allocate before the request. Cache hits never create or renew source evidence.
export function beginClassificationEvidence(): Promise<ClassificationEvidence> {
    return serialized(async () => {
        const value = await currentLedger()
        if (!Number.isSafeInteger(value.sequence + 1)) throw new Error('MangaSushi evidence sequence exhausted')
        value.sequence += 1
        await saveLedger(value)
        return { generation: value.generation, sequence: value.sequence, at: Date.now() }
    })
}
export function observeClassificationEvidence(id: string, allowed: boolean, evidence: ClassificationEvidence): Promise<void> {
    return serialized(async () => {
        const value = await ledger(), previous = value.titles.get(id)
        if (value.missing || evidence.generation !== value.generation) throw new Error('MangaSushi classification evidence belongs to an expired generation')
        if (!validId(id) || evidence.sequence > value.sequence || evidence.at + LIFETIME <= Date.now()) throw new Error('Invalid MangaSushi classification evidence')
        if ((previous && previous.sequence > evidence.sequence) || (!previous && evidence.sequence <= value.discardedThrough)) return
        const blockedThrough = Math.max(previous?.blockedThrough ?? 0, allowed ? 0 : evidence.sequence)
        value.titles.delete(id)
        value.titles.set(id, { ...evidence, allowed: allowed && blockedThrough < evidence.sequence, blockedThrough, firstSequence: previous?.firstSequence ?? value.discardedThrough + 1 })
        await saveLedger(value)
    })
}
function evidenceAllowed(title: TitleEvidence | undefined, evidence?: ClassificationEvidence): boolean {
    return !!title && !!evidence && title.allowed && evidence.generation === title.generation && evidence.sequence >= title.firstSequence && evidence.sequence > title.blockedThrough && evidence.sequence <= title.sequence && evidence.at + LIFETIME > Date.now()
}
export function classificationAllowed(id: string, evidence?: ClassificationEvidence): Promise<boolean> {
    return serialized(async () => evidenceAllowed((await ledger()).titles.get(id), evidence))
}

function validId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[/?#\\]/.test(value) && [...value].every((char) => char.charCodeAt(0) >= 32)
}
// Serialize only within this bundle; ObjectStore has no cross-VM transaction API.
function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation)
    queue = result.then(() => undefined, () => undefined)
    return result
}
export async function policyRevision(): Promise<number> {
    const value = await ObjectStore.get(REVISION)
    if (value === undefined || value === null) return 0
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid saved MangaSushi metadata policy')
    return value
}
export function changeSetting(exclude: boolean): Promise<void> {
    return serialized(async () => {
        const previous = (await ObjectStore.boolean(SETTING)) === true
        if (previous !== exclude) await ObjectStore.set(REVISION, (await policyRevision()) + 1)
        await ObjectStore.set(SETTING, exclude)
    })
}
// One final metadata boundary, independent of image count. No provider fetches,
// image URLs, remembered native scopes or public-image issuance are involved.
export function checkTitles(items: Array<{ id: string, classified: boolean, explicit: boolean, evidence?: ClassificationEvidence }>, exclude: boolean, revision: number): Promise<void> {
    return serialized(async () => {
        if (exclude !== ((await ObjectStore.boolean(SETTING)) === true) || revision !== await policyRevision()) throw new Error('MangaSushi settings changed; refresh to continue')
        const value = await ledger()
        if (value.missing) throw new Error('MangaSushi classification evidence is missing; reload fresh source metadata')
        for (const item of items) {
            if (!validId(item.id)) throw new Error('Invalid MangaSushi title identity')
            if (item.evidence && item.evidence.generation !== value.generation) throw new Error('MangaSushi classification belongs to an expired generation')
            if (exclude && (!item.classified || item.explicit || !evidenceAllowed(value.titles.get(item.id), item.evidence))) throw new Error('MangaSushi source classification is stale, excluded, or unverifiable; reload current source metadata')
        }
    })
}
