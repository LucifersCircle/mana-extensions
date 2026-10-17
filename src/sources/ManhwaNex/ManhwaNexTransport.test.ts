/* SPDX-License-Identifier: GPL-3.0-or-later */
import { BridgeOperation,
    HttpBridge,
    imageDispatch,
    RequestOrigin } from '@mana-app/types'
import { Target } from './index'

const globals = globalThis as unknown as Record<string, unknown>
const url = 'https://manhwanex.com/wp-content/uploads/transport-control.webp'

// Official SDK dispatch with a no-network bridge. Control bytes are never a
// claim about a provider response or a substitute for the live image checks.
describe('ManhwaNex image authorization commit ordering', () => {
    let priorBridge: unknown, priorStore: unknown

    beforeEach(() => {
        priorBridge = globals.__manaHTTPBridge
        priorStore = globals.ObjectStore
    })
    afterEach(() => {
        globals.__manaHTTPBridge = priorBridge
        globals.ObjectStore = priorStore
    })

    test.each(['request', 'response'] as const)('same-value setting revision during the final %s store read fails closed', async (stage) => {
        const values = new Map<string, unknown>([['ManhwaNex.issuedImages', [[url, 'transport-control']]]])
        let reads = 0, transfers = 0, armed = false, changed = false
        let change: (value: boolean) => Promise<void> = async () => undefined
        globals.ObjectStore = {
            get: async (key: string) => values.get(key),
            set: async (key: string, value: unknown) => { values.set(key, value) },
            boolean: async (key: string) => {
                const value = values.get(key)
                if (armed) {
                    reads += 1
                    if (!changed && ((stage === 'request' && reads === 2) || (stage === 'response' && transfers === 1))) {
                        changed = true
                        // Keep the persisted boolean false, but invalidate the
                        // in-flight generation while this exact read is awaited.
                        await change(false)
                    }
                }
                return value
            }
        }
        const bridge: HttpBridge = {
            now: () => Date.now(),
            send: async (message) => {
                if (message.operation === BridgeOperation.Release || message.operation === BridgeOperation.Cancel) return {}
                if (message.operation !== BridgeOperation.Fetch) throw new Error('Unexpected transport-control operation')
                transfers += 1
                return { bodyID: 'control', sessionID: 'control', url: message.url, status: 200, headers: {}, text: 'This body must not escape revoked policy' }
            }
        }
        globals.__manaHTTPBridge = bridge
        const source = new Target()
        const menu = await source.getPreferenceMenu() as unknown as { sections: Array<{ children: Array<{ didChange(value: boolean): Promise<void> }> }> }
        const toggle = menu.sections[0]?.children[0]
        if (!toggle) throw new Error('Missing source preference callback')
        change = (value) => toggle.didChange(value)
        armed = true
        const image = { url, origin: RequestOrigin.Page as const }
        await expect(source.getPageTransport(image)[imageDispatch](image)).rejects.toThrow(/settings changed/)
        expect(changed).toBe(true)
        expect(values.get('ManhwaNex.excludeNSFW')).toBe(false)
        expect(transfers).toBe(stage === 'request' ? 0 : 1)
    })
})

type GrantAccess = {
    checkImage(value: string): void
    issuedImage(value: string): Promise<string | undefined>
    withIssued<T>(operation: (issued: Map<string, string>) => T): Promise<T>
    recordImages(images: Array<{ url: string, id: string }>): Promise<void>
}

// These controls exercise persisted grant semantics through the real SDK. They
// do not model site content or replace the native live image-byte checks.
describe('ManhwaNex bounded persisted image lookup', () => {
    let priorBridge: unknown, priorStore: unknown
    let stored: unknown, reads: number, transfers: number
    let onFetch: () => Promise<void> | void

    beforeEach(() => {
        priorBridge = globals.__manaHTTPBridge
        priorStore = globals.ObjectStore
        stored = [[url, 'transport-control']]
        reads = 0
        transfers = 0
        onFetch = () => undefined
        globals.ObjectStore = {
            get: async () => { reads += 1; return stored },
            set: async (_key: string, value: unknown) => { stored = value },
            boolean: async () => false
        }
        const bridge: HttpBridge = {
            now: () => Date.now(),
            send: async (message) => {
                if (message.operation === BridgeOperation.Release || message.operation === BridgeOperation.Cancel) return {}
                if (message.operation !== BridgeOperation.Fetch) throw new Error('Unexpected transport-control operation')
                transfers += 1
                await onFetch()
                return { bodyID: 'control', sessionID: 'control', url: message.url, status: 200, headers: {}, text: 'no-network-control' }
            }
        }
        globals.__manaHTTPBridge = bridge
    })
    afterEach(() => {
        globals.__manaHTTPBridge = priorBridge
        globals.ObjectStore = priorStore
        jest.restoreAllMocks()
    })

    const access = (source = new Target()): GrantAccess => source as unknown as GrantAccess
    const dispatch = async (source = new Target(), value = url): Promise<void> => {
        const image = { url: value, origin: RequestOrigin.Page as const }
        const response = await source.getPageTransport(image)[imageDispatch](image)
        response.releaseNative()
    }

    test('lookup matches the bounded map for malformed, duplicate, invalid and expired-tail records', async () => {
        const other = `${url}.other`, invalid = 'https://untrusted.test/image.webp'
        const malformed = [null, {}, 1, [url], [url, 'ignored-extra', true], [url, 1], [url, '../invalid'], [invalid, 'valid-id']]
        const cases: unknown[] = [null, {}, [], malformed,
            [[url, 'first'], ...malformed, [url, 'last'], [url, 'invalid/id'], [other, 'another']],
            [[url, 'outside-tail'], ...Array.from({ length: 8192 }, () => [other, 'in-tail'])],
            [[url, 'outside-tail'], [url, 'at-boundary'], ...Array.from({ length: 8191 }, () => [other, 'in-tail'])]]
        const source = access()
        for (const value of cases) {
            stored = value
            for (const target of [url, other, invalid]) {
                expect(await source.issuedImage(target)).toBe(await source.withIssued((issued) => issued.get(target)))
            }
        }
    })

    test('two fresh reads validate only the matching grant in a populated ledger', async () => {
        stored = Array.from({ length: 8191 }, (_, index) => [`https://manhwanex.com/wp-content/uploads/control-${index}.webp`, `control-${index}`])
        ;(stored as unknown[]).push([url, 'transport-control'])
        const source = new Target(), checks = jest.spyOn(access(source), 'checkImage')
        await dispatch(source)
        expect(reads).toBe(2)
        expect(checks).toHaveBeenCalledTimes(3)
        expect(transfers).toBe(1)
    })

    test.each(['remove', 'reassign', 'invalidate', 'evict'] as const)('fresh response lookup rejects %s of the outgoing grant', async (mutation) => {
        onFetch = () => {
            if (mutation === 'remove') stored = []
            if (mutation === 'reassign') stored = [[url, 'another-title']]
            if (mutation === 'invalidate') stored = [[url, '../invalid']]
            if (mutation === 'evict') stored = [[url, 'transport-control'], ...Array.from({ length: 8192 }, () => [`${url}.other`, 'another-title'])]
        }
        await expect(dispatch()).rejects.toThrow(/was not issued/)
        expect(reads).toBe(2)
        expect(transfers).toBe(1)
    })

    test('a second instance cannot reuse a removed grant or bypass exact URL validation', async () => {
        await dispatch()
        stored = []
        await expect(dispatch()).rejects.toThrow(/was not issued/)
        stored = [['https://untrusted.test/image.webp', 'transport-control']]
        await expect(dispatch(new Target(), 'https://untrusted.test/image.webp')).rejects.toThrow(/Unsupported/)
        expect(transfers).toBe(1)
    })

    test('lookup waits for another instance to finish its serialized write', async () => {
        let arrive: () => void = () => undefined, release: () => void = () => undefined
        const arrived = new Promise<void>((resolve) => { arrive = resolve })
        const gate = new Promise<void>((resolve) => { release = resolve })
        globals.ObjectStore = {
            get: async () => { reads += 1; return stored },
            set: async (_key: string, value: unknown) => { arrive(); await gate; stored = value }
        }
        const writer = access(), reader = access()
        const pendingWrite = writer.recordImages([{ url, id: 'updated-title' }])
        await arrived
        const pendingRead = reader.issuedImage(url)
        await Promise.resolve()
        expect(reads).toBe(1)
        release()
        await pendingWrite
        await expect(pendingRead).resolves.toBe('updated-title')
        expect(reads).toBe(2)
    })

    test('failed store reads reject their request without poisoning later lookups or writes', async () => {
        let fail = true
        globals.ObjectStore = {
            get: async () => { if (fail) { fail = false; throw new Error('read failed') } return stored },
            set: async (_key: string, value: unknown) => { stored = value }
        }
        const source = access()
        await expect(source.issuedImage(url)).rejects.toThrow('read failed')
        await source.recordImages([{ url, id: 'after-recovery' }])
        await expect(source.issuedImage(url)).resolves.toBe('after-recovery')
    })
})
