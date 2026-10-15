/* SPDX-License-Identifier: GPL-3.0-or-later */
import { ContentRating,
    Option,
    SearchRequest } from '@mana-app/types'
import { Filters,
    RATINGS,
    Rating,
    Selection,
    Settings,
    TagEntry } from './KaganeModels'
import { manaRating } from './KaganeParsers'
import { resolveTypedTags,
    TAG_GROUPS,
    tagFilterId,
    tagIdsOf } from './tag-groups'

export function selectedOptions(filters: Filters | undefined, id: string): string[] {
    const value = filters?.[id]
    return Array.isArray(value) ? value.filter((item): item is Option => !!item && typeof item === 'object' && typeof item.id === 'string').map((item) => item.id) : []
}
function selection(filters: Filters | undefined, id: string): { included: string[], excluded: string[] } {
    const value = filters?.[id]
    const pick = typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Selection : undefined
    return { included: (pick?.included ?? []).map((item) => item.id), excluded: (pick?.excluded ?? []).map((item) => item.id) }
}
function compound(included: string[], excluded: string[], match: boolean): Record<string, unknown> | undefined {
    const values = [...new Set(included)]
    const exclude = [...new Set(excluded)]
    return values.length || exclude.length ? { values, ...(match && values.length ? { match_all: true } : {}), ...(exclude.length ? { exclude } : {}) } : undefined
}
/** One selected visible tag can stand for several spelling/alias IDs. */
export function includedTagGroups(filters: Filters | undefined, tags: TagEntry[]): string[][] {
    const picks = ['tags', ...TAG_GROUPS.map((group) => tagFilterId(group.id))].flatMap((id) => selection(filters, id).included).map(tagIdsOf)
    const names = Object.fromEntries(tags.map((tag) => [tag.id, tag.tag_name]))
    const typed = typeof filters?.tag_query === 'string' ? filters.tag_query.split(',') : []
    for (const name of typed) {
        if (name.trim().startsWith('-')) continue
        const resolved = resolveTypedTags(name, names).included
        if (resolved.length) picks.push(resolved)
    }
    return picks.filter((group) => group.length)
}

export function matchesTagGroups(ids: readonly string[] | undefined, groups: string[][], matchAll: boolean): boolean {
    if (!groups.length) return true
    const present = new Set(ids ?? [])
    return matchAll ? groups.every((group) => group.some((id) => present.has(id))) : groups.some((group) => group.some((id) => present.has(id)))
}

export function selectedRatings(request: SearchRequest<Filters>, settings: Settings): Rating[] {
    const selected = selectedOptions(request.filters, 'content_rating')
    return RATINGS.filter((rating) => settings.contentRatings.includes(rating) && (!selected.length || selected.includes(rating)) && (request.context?.allowedContentRatings === undefined || request.context.allowedContentRatings.includes(manaRating({ content_rating: rating }))))
}
export function searchBody(request: SearchRequest<Filters>, settings: Settings, tags: TagEntry[]): Record<string, unknown> {
    const ratings = selectedRatings(request, settings)
    const body: Record<string, unknown> = {
        content_rating: ratings,
        age_rating: [...new Set(ratings.map((rating) => rating === 'Safe' ? 'Safe' : rating === 'Suggestive' ? 'FifteenPlus' : 'EighteenPlus'))],
        source_type: settings.uploadSource === 'official' ? ['Official'] : settings.uploadSource === 'scanlations' ? ['Unofficial', 'Mixed'] : ['Official', 'Unofficial', 'Mixed']
    }
    if (!ratings.includes('Pornographic')) body.is_pornographic = false
    else if (ratings.length === 1) body.is_pornographic = true
    if (settings.languages.length) body.content_lang = settings.languages
    const query = request.query?.trim()
    if (query) body.title = query
    for (const id of ['format', 'upload_status', 'source_id']) {
        const values = selectedOptions(request.filters, id)
        if (values.length) body[id] = values
    }
    const genres = selection(request.filters, 'genres')
    const genreFilter = compound(genres.included, [...genres.excluded, ...settings.excludedGenres], request.filters?.match_all_genres === true)
    if (genreFilter) body.genres = genreFilter
    const pooled = ['tags', ...TAG_GROUPS.map((group) => tagFilterId(group.id))].map((id) => selection(request.filters, id))
    const typed = resolveTypedTags(typeof request.filters?.tag_query === 'string' ? request.filters.tag_query : '', Object.fromEntries(tags.map((tag) => [tag.id, tag.tag_name])))
    // API cannot express (alias A OR alias B) AND a second conceptual tag.
    // Ask for the broad union in that case, then enforce groups on bulk rows locally.
    const tagFilter = compound(
        [...pooled.flatMap((pick) => pick.included.flatMap(tagIdsOf)), ...typed.included],
        [...pooled.flatMap((pick) => pick.excluded.flatMap(tagIdsOf)), ...typed.excluded, ...settings.excludedTags.flatMap(tagIdsOf)],
        request.filters?.match_all_tags === true && includedTagGroups(request.filters, tags).every((group) => group.length === 1)
    )
    if (tagFilter) body.tags = tagFilter
    return body
}

export function hasHidden(ids: readonly string[] | undefined, excluded: readonly string[]): boolean {
    const hidden = new Set(excluded.flatMap(tagIdsOf))
    return (ids ?? []).some((id) => hidden.has(id))
}

export function hostRatingKey(host: readonly ContentRating[] | undefined): string {
    return host === undefined ? '' : [...host].sort().join(',')
}
