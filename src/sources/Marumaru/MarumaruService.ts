/* SPDX-License-Identifier: GPL-3.0-or-later */
import { DOMAIN,
    id,
    parseCatalog,
    parseSearch,
    parseDetail,
    parseReader,
    type Detail } from './MarumaruParser'
import { documentParts } from './MarumaruURLs'
export type HTMLTransport = (url: string) => Promise<string>;
/** Transport-independent source operations. Ordinary native HTML compatibility is NOT proven. */
export class MarumaruService {
    private cache = new Map<string,{at:number;detail:Detail}>();
    private continuations=new Map<string,{at:number;url:string|undefined}>()
    constructor(private readonly fetchHTML: HTMLTransport) {}
    async catalog(page=1) {
        if(!Number.isSafeInteger(page)||page<1||page>10000) throw new Error('Invalid Marumaru catalog page')
        const url=`${DOMAIN}/manhwa${page>1?`?page=${page}`:''}`
        return parseCatalog(await this.fetchHTML(url),url)
    }
    clear(){this.cache.clear();this.continuations.clear()}
    async search(query:string,page=1){
        if(typeof query!=='string'||!query.trim()||query.length>300||!Number.isSafeInteger(page)||page<1||page>100)throw new Error('Invalid Marumaru search')
        const key=JSON.stringify([query.trim(),page]),cursor=this.continuations.get(key)
        if(page>1&&(!cursor||cursor.at+600000<Date.now()))throw new Error('Marumaru search continuation expired or was not observed; restart search')
        if(page>1&&!cursor?.url)return {items:[],next:undefined}
        const url=page===1?`${DOMAIN}/search?q=${encodeURIComponent(query.trim())}&kind=manhwa`:cursor?.url as string
        const result=parseSearch(await this.fetchHTML(url),url)
        this.continuations.set(JSON.stringify([query.trim(),page+1]),{at:Date.now(),url:result.next})
        while(this.continuations.size>100)this.continuations.delete(this.continuations.keys().next().value as string)
        return result
    }
    async detail(workId:string):Promise<Detail> {
        id(workId);const cached=this.cache.get(workId)
        if(cached&&Date.now()-cached.at<60000) return cached.detail
        const detail=parseDetail(await this.fetchHTML(`${DOMAIN}/manhwa/${workId}`),workId)
        this.cache.set(workId,{at:Date.now(),detail})
        while(this.cache.size>16)this.cache.delete(this.cache.keys().next().value as string)
        return detail
    }
    async reader(workId:string,episodeId:string) {
        id(workId);id(episodeId)
        const detail=await this.detail(workId)
        if(!detail.chapters.some(chapter=>chapter.id===episodeId))throw new Error('Marumaru selected chapter is absent from title inventory')
        return parseReader(await this.fetchHTML(`${DOMAIN}/manhwa/${workId}/${episodeId}`),episodeId)
    }
}
export function validateDocumentURL(value:string):void {
    const url=documentParts(value)
    if(url.path==='/search'){if(!url.query.q||url.query.q.length>300||url.query.kind!=='manhwa'||Object.keys(url.query).some(k=>!['q','kind','page'].includes(k))||(url.query.page!==undefined&&!/^[1-9]\d*$/.test(url.query.page)))throw new Error('Unsupported Marumaru search query');return}
    if(!/^\/manhwa(?:\/[1-9]\d*(?:\/[1-9]\d*)?)?$/.test(url.path))throw new Error('Unsupported Marumaru document URL')
    const keys=Object.keys(url.query)
    if(keys.length && (url.path!=='/manhwa'||keys.length!==1||keys[0]!=='page'||!/^[1-9]\d*$/.test(url.query.page??'')))throw new Error('Unsupported Marumaru query')
}
