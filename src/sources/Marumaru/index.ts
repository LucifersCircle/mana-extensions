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
    CoverRequestHandler,
    PageRequestHandler,
    ImageRequest,
    RequestOrigin,
    HttpClient,
    HttpMethod,
    CloudflareError,
    PagedSearchResult,
    SearchRequest,
    SourceContext,
    SourceInfo } from '@mana-app/types'
import { MarumaruAPI,
    MarumaruService } from './MarumaruService'
import { DOMAIN,
    Detail,
    id } from './MarumaruParser'
import { chapters,
    content } from './mapping'
import { accessPolicy,
    beginAccess,
    grant,
    revoke,
    check,
    enter,
    checkTitle,
    observe,
    Policy,
    rating,
    visible } from './MarumaruPolicy'
export class Target implements ChapterSource, CoverRequestHandler, PageRequestHandler, PageLinkResolver {
    readonly info:SourceInfo={id:'Marumaru',name:'Marumaru',version:'0.0.1-alpha.10',thumbnail:'Marumaru.png',website:DOMAIN,rating:CatalogRating.MIXED,supportedLanguages:['ko_KR'],badges:['Manga'],developers:[{name:'Lucifers Circle',github:'https://github.com/LucifersCircle'}],description:'Korean manga catalog and reader through the site’s ordinary public APIs. Unclassified titles use a Suggestive compatibility fallback, not a source age rating. Explicit 19 labels are preserved.'};
    readonly config={owningLinks:['marumaru105.com']};
    private readonly api = new MarumaruAPI()
    private readonly service = new MarumaruService(url => this.api.json(url))
    private readonly coverClient = this.imageClient(RequestOrigin.Cover)
    private readonly pageClient = this.imageClient(RequestOrigin.Page)
    private revision=-1;
    private async policy(context?:SourceContext){const policy=await enter(context);if(this.revision!==policy.revision){this.service.clear();this.revision=policy.revision}return policy}
    private async detail(work:string,policy:Policy,refresh=false):Promise<Detail>{
        id(work);await check(policy)
        if(policy.allowed?.length===0)throw new Error('Marumaru title excluded by native content policy')
        const detail=await this.service.detail(work,refresh);await check(policy)
        const explicitlyAdult=await observe(work,detail.explicitlyAdult,policy)
        if(!visible(explicitlyAdult,policy))throw new Error('Marumaru title excluded by requested content policy')
        const currentAdult=await checkTitle(work,policy);await check(policy);return {...detail,explicitlyAdult:currentAdult}
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
        if(!request||typeof request!=='object'||request.sort||request.listId||Object.keys(request.filters??{}).length||!Number.isSafeInteger(request.page)||request.page<1||request.page>10000||(request.query!==undefined&&typeof request.query!=='string'))throw new Error('Unsupported Marumaru search request')
        const policy=await this.policy(request.context)
        if(policy.allowed?.length===0)return {results:[],isLastPage:true}
        const query=request.query?.trim();const listing=query?await this.service.search(query,request.page):await this.service.catalog(request.page)
        await check(policy);const results=[]
        for(const card of listing.items){const adult=await observe(card.id,card.explicitlyAdult,policy);if(!visible(adult,policy))continue;const currentAdult=await checkTitle(card.id,policy);results.push({id:card.id,title:card.title,cover:card.cover,webUrl:`${DOMAIN}/manhwa/${card.id}`,contentRating:rating(currentAdult),context:request.context})}
        await check(policy)
        if(listing.items.length&&!results.length)throw new Error('Marumaru catalog is excluded by requested content policy; unclassified titles use Suggestive compatibility')
        return {results,isLastPage:listing.nextPage===undefined}
    }
    async getContent(work:string,context?:SourceContext):Promise<Content>{const policy=await beginAccess(work,await this.policy(context));try{const detail=await this.detail(work,policy,true);await check(policy);const result=content(detail,{allowedContentRatings:policy.allowed});await grant(work,policy);return result}catch(error){await revoke(work,policy);throw error}}
    async getChapters(work:string):Promise<Chapter[]>{const policy=await accessPolicy(work);const detail=await this.detail(work,policy,true);await accessPolicy(work);await check(policy);return chapters(detail)}
    async getChapterData(work:string,episode:string,chapter?:Chapter):Promise<ChapterData>{
        id(work);id(episode);const policy=await accessPolicy(work);const detail=await this.detail(work,policy)
        const selected=detail.chapters.find(item=>item.id===episode)
        if(!selected||(chapter&&(chapter.chapterId!==episode||chapter.number!==selected.sourceNumber)))throw new Error('Marumaru chapter identity does not match title inventory')
        const urls=await this.service.reader(work,episode);await check(policy);await checkTitle(work,policy);await accessPolicy(work);await check(policy)
        return {pages:urls.map(url=>({url}))}
    }
    getCoverTransport(request:ImageRequest):HttpClient { this.validateImage(request, RequestOrigin.Cover); return this.coverClient }
    getPageTransport(request:ImageRequest):HttpClient { this.validateImage(request, RequestOrigin.Page); return this.pageClient }
    private validateImage(image: ImageRequest, origin: RequestOrigin.Cover | RequestOrigin.Page): void {
        const pattern = origin === RequestOrigin.Cover
            ? /^https:\/\/peer\.storagewebtoon\.store\/(?:manhwa|webtoon)\/([1-9]\d*)\/[A-Za-z0-9._-]+$/
            : /^https:\/\/peer\.storagewebtoon\.store\/api\/media\/episode\/([1-9]\d*)\/[1-9]\d*\.webp$/
        const match = typeof image.url === 'string' ? pattern.exec(image.url) : null
        if (image.origin !== origin || !match || /\s|\/(?:\.|\.\.)$/.test(image.url)) throw new Error('Invalid Marumaru image transport identity')
        id(match[1] as string)
    }
    private imageClient(origin: RequestOrigin.Cover | RequestOrigin.Page): HttpClient {
        // Keep the native host's User-Agent and the SDK's CloudflareError flow.
        const client = new HttpClient().setTimeoutMs(30000).addHeader('Referer', DOMAIN + '/')
            .addRequestInterceptor((request, context) => {
                this.validateImage({ url: request.url, origin: context.origin as RequestOrigin.Cover | RequestOrigin.Page }, origin)
                if (request.method !== HttpMethod.Get || request.body !== undefined) throw new Error('Invalid Marumaru image request')
                return request
            }).addResponseInterceptor((response, context) => {
                this.validateImage({ url: response.request.url, origin: context.origin as RequestOrigin.Cover | RequestOrigin.Page }, origin)
                if (response.url !== response.request.url)
                    throw new Error('Marumaru image response identity mismatch')
                if (response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge') throw new CloudflareError(response.request.url)
                return response
            })
        return client
    }
}
