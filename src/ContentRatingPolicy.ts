import { AdditionalInfoSection,
    ContentRating,
    SourceContext,
    tags } from '@mana-app/types'

// The native SDK has no UNKNOWN rating. This is a compatibility policy, not a
// claim that the source explicitly rated incomplete metadata as Mature.
export function nativeRating(value: ContentRating | undefined): ContentRating {
    return value !== undefined && [ContentRating.SAFE, ContentRating.SUGGESTIVE, ContentRating.MATURE, ContentRating.EXPLICIT].includes(value)
        ? value : ContentRating.MATURE
}

export function ratingAllowed(value: ContentRating | undefined, context?: SourceContext): boolean {
    return context?.allowedContentRatings === undefined || context.allowedContentRatings.includes(nativeRating(value))
}

export function incompleteRatingInfo(): AdditionalInfoSection {
    return tags.section({ id: 'content-rating-metadata', title: 'Content rating metadata', items: [
        tags.item({ id: 'incomplete-content-rating', title: 'Incomplete metadata — Mature compatibility fallback', isNonInteractive: true })
    ] })
}
