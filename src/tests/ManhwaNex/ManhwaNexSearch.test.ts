/* SPDX-License-Identifier: GPL-3.0-or-later */
import { Target } from '../../sources/ManhwaNex/index'

// URL construction only. These controls do not substitute for provider/live evidence.
describe('ManhwaNex title search encoding', () => {
    function url(query?: string, exclude = false): URL {
        const source = new Target()
        return new URL(source['searchURL']({ page: 1, query }, exclude))
    }

    test('searches the displayed typographic apostrophe using the provider-compatible ASCII apostrophe', () => {
        const actual = url('  Otherworld Invasion: I’m Busy Collecting Monsters  ')
        expect(actual.origin).toBe('https://manhwanex.com')
        expect(actual.searchParams.get('s')).toBe('Otherworld Invasion: I\'m Busy Collecting Monsters')
        expect(actual.searchParams.get('post_type')).toBe('wp-manga')
        expect([...actual.searchParams.keys()]).toEqual(['s', 'post_type'])
    })

    test('preserves ASCII, other punctuation, non-Latin text, and empty queries', () => {
        for (const query of ['I\'m Busy', 'Otherworld Invasion: Monsters & Dragons', '魔王', '“Title”', '', undefined]) {
            expect(url(query).searchParams.get('s')).toBe(query ?? '')
        }
    })

    test('retains exclusion and leaves author filter untouched', () => {
        const source = new Target()
        const actual = new URL(source['searchURL']({ page: 1, query: 'I’m Busy', filters: { author: 'O’Author' } }, true))
        expect(actual.searchParams.get('s')).toBe('I\'m Busy')
        expect(actual.searchParams.get('author')).toBe('O’Author')
        expect(actual.searchParams.get('adult')).toBe('0')
    })
})
