import { AdditionalInfoType,
    ContentRating,
    SourceContext } from '@mana-app/types'
import { assertRatingPolicy,
    incompleteRatingInfo,
    nativeRating,
    ratingAllowed } from '../ContentRatingPolicy'

describe('Native content rating policy', () => {
    test('keeps the incomplete-rating explanation informational without changing its metadata', () => {
        expect(incompleteRatingInfo()).toStrictEqual({
            type: AdditionalInfoType.Tags,
            id: 'content-rating-metadata',
            title: 'Content rating metadata',
            items: [{
                type: AdditionalInfoType.Tags,
                id: 'incomplete-content-rating',
                title: 'No verified source age rating — Suggestive compatibility fallback',
                isNonInteractive: true
            }]
        })
    })

    test.each([null, '1', 1, {}, { includes: () => true }, [1, '3'], [1, 99], [1, null], [1, NaN]])('rejects malformed host rating policy %s without coercion', (value) => {
        const context = { allowedContentRatings: value } as unknown as SourceContext
        expect(() => assertRatingPolicy(context)).toThrow(/Invalid Mana/)
        expect(ratingAllowed(undefined, context)).toBe(false)
        expect(ratingAllowed(ContentRating.EXPLICIT, context)).toBe(false)
    })

    test.each([null, 99, 'SAFE', '1', NaN])('uses the fallback rather than inventing Safe for malformed rating %s', (value) => {
        expect(nativeRating(value as unknown as ContentRating)).toBe(ContentRating.SUGGESTIVE)
    })

    test.each([
        [ContentRating.SAFE, ContentRating.SAFE, [true, false, false, false]],
        [ContentRating.SUGGESTIVE, ContentRating.SUGGESTIVE, [false, true, false, false]],
        [ContentRating.MATURE, ContentRating.MATURE, [false, false, true, false]],
        [ContentRating.EXPLICIT, ContentRating.EXPLICIT, [false, false, false, true]],
        [undefined, ContentRating.SUGGESTIVE, [false, true, false, false]]
    ])('preserves rating %s and native allowed-rating behavior', (value, expected, allowed) => {
        expect(nativeRating(value)).toBe(expected)
        expect(ratingAllowed(value)).toBe(true)
        expect(ratingAllowed(value, {})).toBe(true)
        expect(ratingAllowed(value, { allowedContentRatings: [] })).toBe(false)
        expect([
            ContentRating.SAFE,
            ContentRating.SUGGESTIVE,
            ContentRating.MATURE,
            ContentRating.EXPLICIT
        ].map((rating) => ratingAllowed(value, { allowedContentRatings: [rating] }))).toEqual(allowed)
    })
})
