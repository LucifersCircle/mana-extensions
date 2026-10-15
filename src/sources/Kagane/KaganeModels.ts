/* SPDX-License-Identifier: GPL-3.0-or-later */
import { Option,
    SectionStyle,
    SortOption } from '@mana-app/types'

export const DOMAIN = 'https://kagane.org'
export const API = `${DOMAIN}/api/v2`
export const PAGE_SIZE = 50
export const FilterID = { Tags: 'tags' } as const
export const RATINGS = ['Safe', 'Suggestive', 'Erotica', 'Pornographic'] as const
export type Rating = typeof RATINGS[number]
export const options = (values: readonly string[]): Option[] => values.map((value) => ({ id: value, title: value }))
export const FORMATS = options(['Manga', 'Manhwa', 'Manhua', 'Comic', 'Other'])
export const STATUSES: Option[] = [...options(['Ongoing', 'Completed', 'Hiatus']), { id: 'Abandoned', title: 'Cancelled' }]
export const UPLOADS: Option[] = [{ id: 'all', title: 'All uploads' }, { id: 'official', title: 'Official only' }, { id: 'scanlations', title: 'Scanlations only' }]
export const LANGUAGES: Option[] = [['en', 'English'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh-Hans', 'Chinese (Simplified)'], ['zh-Hant', 'Chinese (Traditional)'], ['es', 'Spanish'], ['es-419', 'Spanish (Latin America)'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['pt-BR', 'Portuguese (Brazil)'], ['ru', 'Russian'], ['pl', 'Polish'], ['tr', 'Turkish'], ['ar', 'Arabic'], ['id', 'Indonesian'], ['th', 'Thai'], ['vi', 'Vietnamese'], ['hi', 'Hindi']].map(([id, title]) => ({ id: id ?? '', title: title ?? '' }))
export const SORTS: SortOption[] = [
    { id: 'relevance', title: 'Relevance', isDefault: true },
    ...[['total_views', 'Popular (Total Views)'], ['avg_views', 'Popular (Average Views)'], ['avg_views_today', 'Popular (Today)'], ['avg_views_week', 'Popular (Week)'], ['avg_views_month', 'Popular (Month)'], ['updated_at', 'Latest'], ['current_books', 'Books Count'], ['created_at', 'Created At']].map(([id, title]) => ({ id: id ?? '', title: title ?? '' }))
]
export const SECTIONS = [
    { id: 'popular', title: 'Popular', sort: 'total_views', style: SectionStyle.SimpleHeroPaged },
    { id: 'trending_month', title: 'Popular This Month', sort: 'avg_views_month', style: SectionStyle.DetailedDoubleRowPaged },
    { id: 'trending_week', title: 'Popular This Week', sort: 'avg_views_week', style: SectionStyle.SimpleSingleRow },
    { id: 'trending_today', title: 'Popular Today', sort: 'avg_views_today', style: SectionStyle.SimpleSingleRow },
    { id: 'latest_updates', title: 'Latest Updates', sort: 'updated_at', style: SectionStyle.DetailedVerticalListGrouped },
    { id: 'recently_added', title: 'Recently Added', sort: 'created_at', style: SectionStyle.SimpleSingleRow }
]
export type Classification = { content_rating?: string | null, age_rating?: string | null, is_pornographic?: boolean | null }
export type AlternateTitle = { title: string, label?: string | null }
export type Series = Classification & {
    series_id: string, title: string, title_language?: string | null, source_id?: string | null, edition_info?: string | null,
    cover_image_id?: string | null, current_books?: number, start_year?: number | null,
    format?: string | null, publication_status?: string | null, upload_status?: string | null,
    translated_language?: string | null, genres?: string[], tags?: string[],
    latest_chapters?: { title?: string | null, chapter_no?: string | null, volume_no?: string | null, created_at?: string | null, available_at?: string | null }[]
}
export type Detail = Classification & {
    series_id?: string, title: string, title_language?: string | null, description?: string | null, source_id?: string | null, edition_info?: string | null,
    format?: string | null, publication_status?: string | null, upload_status?: string | null, translated_language?: string | null,
    series_covers?: { image_id: string, is_main?: boolean }[],
    series_staff?: { name: string, role: string }[],
    genres?: { genre_id?: string, genre_name: string, is_spoiler?: boolean }[],
    tags?: { tag_id?: string, tag_name: string, is_spoiler?: boolean, spoiler?: boolean }[],
    series_alternate_titles?: AlternateTitle[], average_rating?: number | null, total_views?: number | null
}
export type Book = {
    book_id: string, series_id?: string | null, title: string, chapter_no?: string | null, volume_no?: string | null,
    sort_no?: number, released_at?: string | null, created_at?: string | null, available_at?: string | null, page_count?: number,
    groups?: { title: string }[], is_locked?: boolean, requires_login?: boolean, is_paid?: boolean
}
export type SearchResponse = { content: Series[], last: boolean, total_elements?: number, total_pages?: number }
export type Genre = { id: string, genre_name: string }
export type TagEntry = { id: string, tag_name: string }
export type UploadSource = { source_id: string, source_type: string, title: string }
export type ManifestPage = { page_no: number, page_id: string, ext?: string | null }
export type Challenge = { access_token: string, expires_at?: number | string, expires_in?: number, cache_url?: string | null, manifest?: { pages?: ManifestPage[] } | null }
export type Settings = {
    contentRatings: Rating[], showSource: boolean, showEdition: boolean, cleanTitle: boolean, showSpoilers: boolean,
    dataSaver: boolean, uploadSource: string, languages: string[], excludedGenres: string[], excludedTags: string[],
    chapterTitle: string
}
export type Selection = { included: Option[], excluded: Option[] }
export type Filters = Record<string, string | boolean | Option | Option[] | Selection>

export function validId(id: string): string {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid Kagane ID')
    return id
}
export const seriesURL = (id: string): string => `${DOMAIN}/series/${validId(id)}`
export const chapterURL = (id: string, chapter: string): string => `${seriesURL(id)}/reader/${validId(chapter)}`
export const imageURL = (id?: string | null): string => id?.trim() ? `${API}/image/${encodeURIComponent(id.trim())}` : ''
