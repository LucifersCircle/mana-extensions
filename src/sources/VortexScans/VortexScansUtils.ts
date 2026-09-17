import {
    VORTEX_API_URL,
    VortexQueryValue
} from './VortexScansModels'

export function buildVortexContentId(id: number | string, slug: string): string {
    return `${id}:${encodePathComponent(slug)}`
}

export function parseVortexContentId(contentId: string): {
    id: string
    slug?: string
} {
    const delimiter = contentId.includes(':')
        ? ':'
        : contentId.includes('/')
            ? '/'
            : contentId.includes('|')
                ? '|'
                : undefined
    if (!delimiter) return { id: contentId }

    const separator = contentId.indexOf(delimiter)
    const id = contentId.slice(0, separator)
    const encodedSlug = contentId.slice(separator + 1)

    try {
        return {
            id,
            slug: encodedSlug ? decodeURIComponent(encodedSlug) : undefined
        }
    } catch {
        return {
            id,
            slug: encodedSlug || undefined
        }
    }
}

export function encodePathComponent(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    )
}

export function buildVortexSeriesUrl(slug: string): string {
    return `https://vortexscans.org/series/${encodePathComponent(slug)}`
}

export function buildVortexApiUrl(
    path: string,
    parameters: Record<string, VortexQueryValue> = {}
): string {
    const query = Object.entries(parameters)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) =>
            `${encodePathComponent(key)}=${encodePathComponent(String(value))}`
        )
        .join('&')
    const url = `${VORTEX_API_URL}/${path.replace(/^\//, '')}`
    return query ? `${url}?${query}` : url
}

export function normalizeVortexSearchTerm(value: string | undefined): string {
    return (value ?? '')
        .trim()
        .replace(/[\u2018\u2019]/g, '\'')
        .replace(/[\u201c\u201d]/gi, '"')
        .replace(/\s+/g, ' ')
}
