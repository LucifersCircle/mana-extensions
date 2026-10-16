import { checkImageURL } from './MangaSushiParser'

const STORE = 'MangaSushi.issuedImages'
const REVISION = 'MangaSushi.imagePolicyRevision'
const SETTING = 'MangaSushi.excludeNSFW'
const LIFETIME = 24 * 60 * 60 * 1000
const LIMIT = 8192
let queue = Promise.resolve()
const EVIDENCE = 'MangaSushi.imageEvidence'
const GENERATION = 'MangaSushi.imageEvidenceGeneration'
let highestGeneration = 0
export type ImageEvidence = { generation: number, sequence: number, at: number }
type TitleEvidence = ImageEvidence & { allowed: boolean, blockedThrough: number, firstSequence: number }
async function ledger(): Promise<{ generation: number, sequence: number, discardedThrough: number, missing: boolean, titles: Map<string, TitleEvidence> }> {
    const raw = await ObjectStore.get(EVIDENCE) as { generation?: unknown, sequence?: unknown, discardedThrough?: unknown, titles?: unknown } | undefined
    if (raw !== undefined && raw !== null && (!Number.isSafeInteger(raw.sequence) || (raw.sequence as number) < 0 || !Array.isArray(raw.titles) || (raw.discardedThrough !== undefined && (!Number.isSafeInteger(raw.discardedThrough) || (raw.discardedThrough as number) < 0 || (raw.discardedThrough as number) > (raw.sequence as number))))) throw new Error('Invalid saved MangaSushi classification evidence')
    const savedGeneration = await ObjectStore.get(GENERATION)
    for (const generation of [savedGeneration, raw?.generation]) if (generation !== undefined && generation !== null && (!Number.isSafeInteger(generation) || (generation as number) < 1)) throw new Error('Invalid saved MangaSushi evidence generation')
    // Surviving grants retain a bounded high-water mark across partial resets.
    const grants = await ObjectStore.get(STORE)
    for (const entry of Array.isArray(grants) ? grants.slice(-LIMIT) : []) {
        const generation = Array.isArray(entry) ? entry[1]?.generation : undefined
        if (Number.isSafeInteger(generation) && generation > 0) highestGeneration = Math.max(highestGeneration, generation)
    }
    highestGeneration = Math.max(highestGeneration, (savedGeneration as number | undefined) ?? 0, (raw?.generation as number | undefined) ?? 0)
    const generation = savedGeneration === highestGeneration && raw?.generation === highestGeneration ? highestGeneration : 0
    if (!generation) return { generation: 0, sequence: 0, discardedThrough: 0, missing: true, titles: new Map() }
    const sequence = (raw?.sequence as number | undefined) ?? 0, titles = new Map<string, TitleEvidence>()
    const stored = raw?.titles
    let discardedThrough = (raw?.discardedThrough as number | undefined) ?? 0
    if (Array.isArray(stored) && stored.length > LIMIT) discardedThrough = sequence
    for (const entry of Array.isArray(stored) ? stored.slice(-LIMIT) : []) {
        if (!Array.isArray(entry) || entry.length !== 2 || !validId(entry[0])) { discardedThrough = sequence; continue }
        const value = entry[1] as TitleEvidence | undefined
        if (!value || value.generation !== generation || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.sequence > sequence || !Number.isSafeInteger(value.at) || value.at < 0 || value.at > Date.now() || value.at + LIFETIME <= Date.now() || typeof value.allowed !== 'boolean' || !Number.isSafeInteger(value.blockedThrough) || value.blockedThrough < 0 || value.blockedThrough > value.sequence || (value.firstSequence !== undefined && (!Number.isSafeInteger(value.firstSequence) || value.firstSequence < 1 || value.firstSequence > value.sequence))) { discardedThrough = sequence; continue }
        // Older prototype entries conservatively require reissuance of earlier grants.
        titles.set(entry[0], { ...value, firstSequence: value.firstSequence ?? value.sequence })
    }
    return { generation, sequence, discardedThrough, missing: false, titles }
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
        await ObjectStore.set(GENERATION, value.generation)
        await ObjectStore.set(STORE, [])
        await saveLedger(value)
    }
    return value
}
// A source operation may initialize lineage, but callbacks never do so.
export function ensureImageEvidence(): Promise<void> { return serialized(async () => { await currentLedger() }) }
// Allocate before the request. Cache hits never create or renew source evidence.
export function beginImageEvidence(): Promise<ImageEvidence> {
    return serialized(async () => {
        const value = await currentLedger()
        if (!Number.isSafeInteger(value.sequence + 1)) throw new Error('MangaSushi evidence sequence exhausted')
        value.sequence += 1
        await saveLedger(value)
        return { generation: value.generation, sequence: value.sequence, at: Date.now() }
    })
}
export function observeImageEvidence(id: string, allowed: boolean, evidence: ImageEvidence): Promise<void> {
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
async function evidenceAllowed(id: string, evidence?: ImageEvidence): Promise<boolean> {
    const title = (await ledger()).titles.get(id)
    return !!title && !!evidence && title.allowed && evidence.generation === title.generation && evidence.sequence >= title.firstSequence && evidence.sequence > title.blockedThrough && evidence.sequence <= title.sequence && evidence.at + LIFETIME > Date.now()
}
export function imageEvidenceAllowed(id: string, evidence?: ImageEvidence): Promise<boolean> { return serialized(() => evidenceAllowed(id, evidence)) }
type Grant = { generation: number, id: string, chapters: string[], context: string, at: number, expires: number, classified: boolean, explicit: boolean, evidence?: ImageEvidence }

function validId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[/?#\\]/.test(value) && [...value].every((char) => char.charCodeAt(0) >= 32)
}
function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation)
    queue = result.then(() => undefined, () => undefined)
    return result
}
export async function imagePolicyRevision(): Promise<number> {
    const value = await ObjectStore.get(REVISION)
    if (value === undefined || value === null) return 0
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid saved MangaSushi image policy')
    return value
}
export function changeImagePolicy(exclude: boolean): Promise<void> {
    return serialized(async () => {
        const previous = (await ObjectStore.boolean(SETTING)) === true
        if (previous !== exclude) {
            await ObjectStore.set(REVISION, (await imagePolicyRevision()) + 1)
            await ObjectStore.set(STORE, [])
        }
        await ObjectStore.set(SETTING, exclude)
    })
}
function withIssued<T>(operation: (issued: Map<string, Grant>) => Promise<T> | T, write = false): Promise<T> {
    // Reload inside the bundle-wide queue. ObjectStore offers no cross-JS-context
    // transaction. This queue does not claim atomicity across separate JS contexts.
    return serialized(async () => {
        const issued = new Map<string, Grant>(), stored = await ObjectStore.get(STORE), now = Date.now()
        for (const entry of Array.isArray(stored) ? stored.slice(-LIMIT) : []) {
            if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') continue
            const value = entry[1] as Partial<Grant> | undefined
            if (!value || typeof value.generation !== 'number' || !Number.isSafeInteger(value.generation) || value.generation < 1 || !validId(value.id) || !Array.isArray(value.chapters) || !value.chapters.length || value.chapters.length > 128 || !value.chapters.every((id) => id === '' || validId(id))
                || typeof value.context !== 'string' || !/^\[(?:true|false),\d+\]$/.test(value.context)
                || typeof value.at !== 'number' || !Number.isSafeInteger(value.at) || value.at > now || value.at < 0
                || value.expires !== value.at + LIFETIME || value.expires <= now
                || typeof value.classified !== 'boolean' || typeof value.explicit !== 'boolean'
                || (value.evidence !== undefined && (!Number.isSafeInteger(value.evidence.generation) || value.evidence.generation < 1 || !Number.isSafeInteger(value.evidence.sequence) || value.evidence.sequence < 1 || !Number.isSafeInteger(value.evidence.at) || value.evidence.at < 0 || value.evidence.at > now))) continue
            try { checkImageURL(entry[0]); issued.set(entry[0], { ...value, chapters: [...value.chapters] } as Grant) } catch { /* Invalid persisted grants never authorize requests. */ }
        }
        const result = await operation(issued)
        while (issued.size > LIMIT) issued.delete(issued.keys().next().value as string)
        if (write) await ObjectStore.set(STORE, [...issued])
        return result
    })
}
export function issueImages(images: Array<{ url: string, id: string, chapterId?: string, classified: boolean, explicit: boolean, evidence?: ImageEvidence }>, context: string): Promise<void> {
    return withIssued(async (issued) => {
        const current = JSON.stringify([(await ObjectStore.boolean(SETTING)) === true, await imagePolicyRevision()])
        if (context !== current) throw new Error('MangaSushi settings changed; refresh to continue')
        const currentLedger = await ledger()
        if (currentLedger.missing) throw new Error('MangaSushi image evidence is missing; reload fresh source metadata')
        for (const image of images) {
            checkImageURL(image.url)
            if (image.evidence && image.evidence.generation !== currentLedger.generation) throw new Error('MangaSushi image classification belongs to an expired generation')
            if (!validId(image.id) || (image.chapterId !== undefined && !validId(image.chapterId))) throw new Error('Invalid MangaSushi image identity')
            const old = issued.get(image.url), chapterId = image.chapterId ?? ''
            if (old && old.id !== image.id) throw new Error('MangaSushi image has conflicting source identity; refresh the title or reader')
            if (JSON.parse(context)[0] && (!image.classified || image.explicit || !await evidenceAllowed(image.id, image.evidence))) throw new Error('MangaSushi source classification is stale, excluded, or unverifiable; reload current source metadata')
            // Repeated callbacks and cached output do not slide an existing grant.
            if (old?.context === context && old.generation === currentLedger.generation) {
                if (image.evidence && (!old.evidence || image.evidence.sequence > old.evidence.sequence)) {
                    old.explicit = image.explicit
                    old.classified = image.classified
                    old.evidence = image.evidence
                }
                if (!old.chapters.includes(chapterId)) old.chapters = [...old.chapters.slice(-127), chapterId]
                continue
            }
            const at = image.evidence?.at ?? Date.now()
            issued.set(image.url, { generation: currentLedger.generation, id: image.id, chapters: [chapterId], context, at, expires: at + LIFETIME,
                classified: image.classified, explicit: image.explicit, evidence: image.evidence })
        }
    }, true)
}
export function authorizeImage(url: string, context: string, exclude: boolean): Promise<void> {
    checkImageURL(url)
    return withIssued(async (issued) => {
        const current = JSON.stringify([(await ObjectStore.boolean(SETTING)) === true, await imagePolicyRevision()])
        if (current !== context) throw new Error('MangaSushi settings changed; refresh to continue')
        const grant = issued.get(url)
        if (!grant || grant.context !== context || grant.generation !== (await ledger()).generation) throw new Error('MangaSushi image authorization is missing, expired, or settings changed; refresh the title or reader')
        if (exclude && (!grant.classified || grant.explicit || !await evidenceAllowed(grant.id, grant.evidence))) throw new Error('MangaSushi image is excluded or its source classification is stale or unverifiable')
    })
}
