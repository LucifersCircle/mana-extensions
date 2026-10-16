/* SPDX-License-Identifier: GPL-3.0-or-later */
import { Option,
    SearchRequest,
    SortOption } from '@mana-app/types'

export const FILTERS: Record<string, { title: string, options: Option[] }> = {
    'status': {
        'title': 'Status',
        'options': [
            {
                'id': 'ongoing',
                'title': 'Ongoing'
            },
            {
                'id': 'completed',
                'title': 'Completed'
            },
            {
                'id': 'hiatus',
                'title': 'Hiatus'
            },
            {
                'id': 'cancelled',
                'title': 'Cancelled'
            }
        ]
    },
    'genres': {
        'title': 'Genres',
        'options': [
            {
                'id': 'action',
                'title': 'Action'
            },
            {
                'id': 'adventure',
                'title': 'Adventure'
            },
            {
                'id': 'comedy',
                'title': 'Comedy'
            },
            {
                'id': 'drama',
                'title': 'Drama'
            },
            {
                'id': 'fantasy',
                'title': 'Fantasy'
            },
            {
                'id': 'horror',
                'title': 'Horror'
            },
            {
                'id': 'isekai',
                'title': 'Isekai'
            },
            {
                'id': 'mystery',
                'title': 'Mystery'
            },
            {
                'id': 'romance',
                'title': 'Romance'
            },
            {
                'id': 'school-life',
                'title': 'School Life'
            },
            {
                'id': 'sci-fi',
                'title': 'Sci-Fi'
            },
            {
                'id': 'slice-of-life',
                'title': 'Slice of Life'
            },
            {
                'id': 'sports',
                'title': 'Sports'
            },
            {
                'id': 'thriller',
                'title': 'Thriller'
            }
        ]
    },
    'theme': {
        'title': 'Themes',
        'options': [
            {
                'id': 'coming-of-age',
                'title': 'Coming of Age'
            },
            {
                'id': 'cooking',
                'title': 'Cooking'
            },
            {
                'id': 'first-love',
                'title': 'First Love'
            },
            {
                'id': 'military',
                'title': 'Military'
            },
            {
                'id': 'politics',
                'title': 'Politics'
            },
            {
                'id': 'revenge',
                'title': 'Revenge'
            },
            {
                'id': 'superpowers',
                'title': 'Superpowers'
            },
            {
                'id': 'survival',
                'title': 'Survival'
            }
        ]
    },
    'mood': {
        'title': 'Moods',
        'options': [
            {
                'id': 'bittersweet',
                'title': 'Bittersweet'
            },
            {
                'id': 'chill',
                'title': 'Chill'
            },
            {
                'id': 'cozy',
                'title': 'Cozy'
            },
            {
                'id': 'dark',
                'title': 'Dark'
            },
            {
                'id': 'dramatic',
                'title': 'Dramatic'
            },
            {
                'id': 'eerie',
                'title': 'Eerie'
            },
            {
                'id': 'emotional',
                'title': 'Emotional'
            },
            {
                'id': 'grim',
                'title': 'Grim'
            },
            {
                'id': 'heartwarming',
                'title': 'Heartwarming'
            },
            {
                'id': 'hopeful',
                'title': 'Hopeful'
            },
            {
                'id': 'humorous',
                'title': 'Humorous'
            },
            {
                'id': 'intense',
                'title': 'Intense'
            },
            {
                'id': 'melancholy',
                'title': 'Melancholy'
            },
            {
                'id': 'mysterious',
                'title': 'Mysterious'
            },
            {
                'id': 'nostalgic',
                'title': 'Nostalgic'
            },
            {
                'id': 'playful',
                'title': 'Playful'
            },
            {
                'id': 'relaxing',
                'title': 'Relaxing'
            },
            {
                'id': 'serene',
                'title': 'Serene'
            },
            {
                'id': 'suspenseful',
                'title': 'Suspenseful'
            },
            {
                'id': 'tense',
                'title': 'Tense'
            },
            {
                'id': 'triumphant',
                'title': 'Triumphant'
            },
            {
                'id': 'uplifting',
                'title': 'Uplifting'
            },
            {
                'id': 'whimsical',
                'title': 'Whimsical'
            },
            {
                'id': 'wholesome',
                'title': 'Wholesome'
            }
        ]
    },
    'format': {
        'title': 'Formats',
        'options': [
            {
                'id': '4-koma',
                'title': '4-Koma'
            },
            {
                'id': 'manga',
                'title': 'Manga'
            },
            {
                'id': 'manhua',
                'title': 'Manhua'
            },
            {
                'id': 'manhwa',
                'title': 'Manhwa'
            },
            {
                'id': 'one-shot',
                'title': 'One-shot'
            },
            {
                'id': 'webtoon',
                'title': 'Webtoon'
            }
        ]
    },
    'demographic': {
        'title': 'Demographic',
        'options': [
            {
                'id': 'josei',
                'title': 'Josei'
            },
            {
                'id': 'seinen',
                'title': 'Seinen'
            },
            {
                'id': 'shoujo',
                'title': 'Shoujo'
            },
            {
                'id': 'shounen',
                'title': 'Shounen'
            }
        ]
    },
    'language': {
        'title': 'Language',
        'options': [
            {
                'id': 'EN',
                'title': 'English'
            }
        ]
    },
    'rating': {
        'title': 'Rating',
        'options': [
            {
                'id': '',
                'title': 'Any'
            },
            {
                'id': 'safe',
                'title': 'Safe'
            },
            {
                'id': 'suggestive',
                'title': 'Suggestive'
            },
            {
                'id': 'mature',
                'title': 'Mature'
            }
        ]
    }
}
export const SORTS: SortOption[] = [{ id: 'latest', title: 'Latest Update', isDefault: true }, { id: 'popular-month', title: 'Popular This Month' }, { id: 'popular-year', title: 'Popular This Year' }, { id: 'title', title: 'Title A-Z' }]
export type Filters = Record<string, Option | Option[]>

function option(value: unknown, group: string): string {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !('id' in value) || typeof value.id !== 'string'
        || !FILTERS[group]?.options.some((item) => item.id === value.id)) throw new Error('Invalid MangaStash filter value')
    return value.id
}
export function searchURL(request: SearchRequest<Filters>): string {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Invalid MangaStash search request')
    const page = request.page ?? 1
    if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new Error('Invalid MangaStash page')
    if (request.query !== undefined && typeof request.query !== 'string') throw new Error('Invalid MangaStash query')
    const query = request.query?.trim() ?? ''
    if (query.length > 300) throw new Error('MangaStash query is too long')
    if (request.sort !== undefined && (!request.sort || typeof request.sort !== 'object' || Array.isArray(request.sort)
        || !SORTS.some((sort) => sort.id === request.sort?.id))) throw new Error('Invalid MangaStash sort')
    if (request.filters !== undefined && (!request.filters || typeof request.filters !== 'object' || Array.isArray(request.filters))) throw new Error('Invalid MangaStash filters')
    const params = new URLSearchParams()
    for (const [group, value] of Object.entries(request.filters ?? {})) {
        if (!FILTERS[group]) throw new Error('Unknown MangaStash filter')
        if (group === 'rating') { const id = option(value, group); if (id) params.set(group, id) }
        else {
            if (!Array.isArray(value) || value.length > (FILTERS[group]?.options.length ?? 0)) throw new Error('Invalid MangaStash filter shape')
            const ids = Array.from(value, (item) => option(item, group))
            if (new Set(ids).size !== ids.length) throw new Error('Duplicate MangaStash filter')
            for (const id of ids) params.append(`${group === 'genres' ? 'genre' : group}[]`, id)
        }
    }
    if (query) {
        if (params.toString() || request.sort !== undefined || request.listId !== undefined) throw new Error('MangaStash text search supports q only; clear browse filters and sort')
        params.set('q', query)
    } else if (request.sort) params.set('sort', request.sort.id)
    if (page > 1) params.set('page', String(page))
    return `https://mangastash.org/${query ? 'search' : 'browse/'}${params.toString() ? `?${params}` : ''}`
}

export function scope(url: string): string {
    const target = new URL(url), fields: Array<[string, string]> = []
    for (const [key, value] of target.searchParams) {
        if (key === 'page') continue
        const normalized = key.replace(/\[(?:\d*)\]$/, '[]')
        fields.push([normalized, value])
    }
    fields.sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
    return `${target.origin}${target.pathname}:${JSON.stringify(fields)}`
}
