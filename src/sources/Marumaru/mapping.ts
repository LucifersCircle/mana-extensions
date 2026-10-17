/* SPDX-License-Identifier: GPL-3.0-or-later */
import { ContentRating,
    type Content,
    type Chapter,
    type SourceContext,
    tags,
    staff } from '@mana-app/types'
import { assertRatingPolicy,
    ratingAllowed } from '../../ContentRatingPolicy'
import { DOMAIN,
    type Detail } from './MarumaruParser'
export function allowed(context?: SourceContext, explicitlyAdult=false): boolean {
    assertRatingPolicy(context)
    return ratingAllowed(explicitlyAdult?ContentRating.EXPLICIT:undefined,context)
}
export function chapters(detail: Detail): Chapter[] {
    return [...detail.chapters].reverse().map((chapter,index)=>({chapterId:chapter.id,number:chapter.sourceNumber,title:chapter.title,index,date:chapter.date,language:'ko_KR',webUrl:`${DOMAIN}/manhwa/${detail.id}/${chapter.id}`}))
}
export function content(detail: Detail, context?: SourceContext): Content {
    if(!allowed(context,detail.explicitlyAdult)) throw new Error('Marumaru unclassified title excluded by requested content-rating policy')
    return {title:detail.title,cover:detail.cover,webUrl:`${DOMAIN}/manhwa/${detail.id}`,summary:detail.summary,contentRating:detail.explicitlyAdult?ContentRating.EXPLICIT:ContentRating.SUGGESTIVE,chapters:chapters(detail),tags:detail.genres.map(title=>tags.item({id:encodeURIComponent(title),title})),
        additionalInfo:[tags.section({id:'source-rating',title:'Content rating metadata',items:[tags.item({id:'unknown-rating',title:detail.explicitlyAdult?'Source explicitly marks 19':'Unclassified; Suggestive compatibility fallback, not a source age rating',isNonInteractive:true})]}),
            ...(detail.author?[staff.section({id:'author',title:'Author',hasMore:false,items:[staff.item({id:encodeURIComponent(detail.author),title:detail.author})]})]:[])]}
}
