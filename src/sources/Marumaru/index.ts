/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Lucifers Circle */
import { PageLink,
    PageLinkResolver,
    PageSection,
    ResolvedPageSection,
    SectionStyle,
    CatalogRating,
    Chapter,
    ChapterData,
    ChapterSource,
    Content,
    ImageRequestHandler,
    NetworkRequest,
    PagedSearchResult,
    SearchRequest,
    SourceContext,
    SourceInfo } from '@mana-app/types'
import { MarumaruService } from './MarumaruService'
import { DOMAIN,
    Detail,
    id } from './MarumaruParser'
import { renderedHTML } from './renderedTransport'
import { chapters,
    content } from './mapping'
import { accessPolicy,
    grant,
    revoke,
    authorize,
    check,
    enter,
    issue,
    observe,
    Policy,
    rating,
    visible } from './MarumaruPolicy'
export class Target implements ChapterSource, ImageRequestHandler, PageLinkResolver {
    readonly info:SourceInfo={id:'Marumaru',name:'Marumaru',version:'0.0.1-alpha.3',website:DOMAIN,rating:CatalogRating.MIXED,supportedLanguages:['ko_KR'],badges:['Manga'],developers:[{name:'Lucifers Circle',github:'https://github.com/LucifersCircle'}],description:'Korean manga catalog and reader through ordinary rendered website pages. Unclassified titles use a Suggestive compatibility fallback, not a source age rating. Explicit 19 labels are preserved. WebView device validation is required before release.'};
    readonly config={owningLinks:['marumaru105.com']};
    private readonly service=new MarumaruService(renderedHTML);
    private revision=-1;
    private async policy(context?:SourceContext){const policy=await enter(context);if(this.revision!==policy.revision){this.service.clear();this.revision=policy.revision}return policy}
    private async detail(work:string,policy:Policy):Promise<Detail>{
        id(work);await check(policy)
        if(policy.allowed?.length===0)throw new Error('Marumaru title excluded by native content policy')
        const detail=await this.service.detail(work);await check(policy)
        const explicitlyAdult=await observe(work,detail.explicitlyAdult,policy)
        if(!visible(explicitlyAdult,policy))throw new Error('Marumaru title excluded by requested content policy')
        await issue(work,[detail.cover],policy);await check(policy);return {...detail,explicitlyAdult}
    }
    async getSectionsForPage(link:PageLink):Promise<PageSection[]>{
        const policy=await this.policy(link.context)
        if(link.id!=='home')throw new Error('Unsupported Marumaru page')
        return policy.allowed?.length===0?[]:[{id:'catalog',title:'Manga',style:SectionStyle.SimpleSingleRow}]
    }
    async resolvePageSection(link:PageLink,sectionId:string):Promise<ResolvedPageSection>{
        await this.policy(link.context)
        if(link.id!=='home'||sectionId!=='catalog')throw new Error('Unsupported Marumaru section')
        const result=await this.search({page:1,context:link.context})
        return {items:result.results}
    }
    async search(request:SearchRequest):Promise<PagedSearchResult>{
        if(!request||typeof request!=='object'||request.sort||request.listId||Object.keys(request.filters??{}).length||!Number.isSafeInteger(request.page)||request.page<1||request.page>100||(request.query!==undefined&&typeof request.query!=='string'))throw new Error('Unsupported Marumaru search request')
        const policy=await this.policy(request.context)
        if(policy.allowed?.length===0)return {results:[],isLastPage:true}
        const query=request.query?.trim();const listing=query?await this.service.search(query,request.page):await this.service.catalog(request.page)
        await check(policy);const results=[]
        for(const card of listing.items){const adult=await observe(card.id,false,policy);if(!visible(adult,policy))continue;await issue(card.id,[card.cover],policy);results.push({id:card.id,title:card.title,cover:card.cover,webUrl:`${DOMAIN}/manhwa/${card.id}`,contentRating:rating(adult),context:request.context})}
        await check(policy)
        if(listing.items.length&&!results.length)throw new Error('Marumaru catalog is excluded by requested content policy; unclassified titles use Suggestive compatibility')
        return {results,isLastPage:!listing.next}
    }
    async getContent(work:string,context?:SourceContext):Promise<Content>{const policy=await this.policy(context);try{const detail=await this.detail(work,policy);await check(policy);const result=content(detail,{allowedContentRatings:policy.allowed});await grant(work,policy);return result}catch(error){await revoke(work);throw error}}
    async getChapters(work:string):Promise<Chapter[]>{const policy=await accessPolicy(work);const detail=await this.detail(work,policy);await accessPolicy(work);await check(policy);return chapters(detail)}
    async getChapterData(work:string,episode:string,chapter?:Chapter):Promise<ChapterData>{
        id(work);id(episode);const policy=await accessPolicy(work);const detail=await this.detail(work,policy)
        const selected=detail.chapters.find(item=>item.id===episode)
        if(!selected||(chapter&&(chapter.chapterId!==episode||chapter.number!==selected.sourceNumber)))throw new Error('Marumaru chapter identity does not match title inventory')
        const urls=await this.service.reader(work,episode);await check(policy);await issue(work,urls,policy,episode);await accessPolicy(work);await check(policy)
        return {pages:urls.map(url=>({url}))}
    }
    async willRequestImage(url:string):Promise<NetworkRequest>{
        const policy=await this.policy();await authorize(url,policy);await check(policy)
        // Covers are embedded by the source page; preserve its origin referrer.
        return /^https:\/\/peer\.storagewebtoon\.store\/(?:manhwa|webtoon)\//.test(url)?{url,headers:{Referer:DOMAIN+'/'}}:{url}
    }
}
