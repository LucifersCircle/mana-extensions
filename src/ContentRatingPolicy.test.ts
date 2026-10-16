import { AdditionalInfoType,
    ContentRating } from '@mana-app/types'
import { incompleteRatingInfo,
    nativeRating,
    ratingAllowed } from './ContentRatingPolicy'

describe('Native content rating policy', () => {
    test('keeps the incomplete-rating explanation informational without changing its metadata', () => {
        expect(incompleteRatingInfo()).toStrictEqual({
            type: AdditionalInfoType.Tags,
            id: 'content-rating-metadata',
            title: 'Content rating metadata',
            items: [{
                type: AdditionalInfoType.Tags,
                id: 'incomplete-content-rating',
                title: 'Incomplete metadata — Mature compatibility fallback',
                isNonInteractive: true
            }]
        })
    })

    test.each([
        [ContentRating.SAFE, ContentRating.SAFE, [true, false, false, false]],
        [ContentRating.SUGGESTIVE, ContentRating.SUGGESTIVE, [false, true, false, false]],
        [ContentRating.MATURE, ContentRating.MATURE, [false, false, true, false]],
        [ContentRating.EXPLICIT, ContentRating.EXPLICIT, [false, false, false, true]],
        [undefined, ContentRating.MATURE, [false, false, true, false]]
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
