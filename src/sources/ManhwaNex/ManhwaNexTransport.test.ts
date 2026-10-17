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
