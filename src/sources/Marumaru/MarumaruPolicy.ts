/* SPDX-License-Identifier: GPL-3.0-or-later */
import { ContentRating,
    SourceContext } from '@mana-app/types'
import { assertRatingPolicy,
    nativeRating,
    ratingAllowed } from '../../ContentRatingPolicy'
import { id } from './MarumaruParser'
const KEY='Marumaru.authorization.v1',TTL=3600000
type Title={id:string;explicitlyAdult:boolean;at:number};
type Image={url:string;id:string;episode?:string;at:number;revision:number;allowed?:ContentRating[]};
type Access={id:string;at:number;allowed?:ContentRating[]};
type State={revision:number;titles:Title[];images:Image[];access:Access[]};
export type Policy={revision:number;allowed?:ContentRating[]};
let queue:Promise<unknown>=Promise.resolve()
function serial<T>(work:()=>Promise<T>):Promise<T>{const result=queue.then(work);queue=result.then(()=>undefined,()=>undefined);return result}
async function read():Promise<State>{
    const state=await ObjectStore.get(KEY) as State|undefined
    if(!state)return {revision:0,titles:[],images:[],access:[]}
    if(!Number.isSafeInteger(state.revision)||state.revision<0||!Array.isArray(state.titles)||!Array.isArray(state.images)||state.titles.length>512||state.images.length>8192||!Array.isArray(state.access)||state.access.length>512)throw new Error('Invalid Marumaru policy state')
    const now=Date.now()
    for(const title of state.titles){id(title.id);if(typeof title.explicitlyAdult!=='boolean'||!Number.isSafeInteger(title.at)||title.at<0||title.at>now)throw new Error('Invalid saved Marumaru title evidence')}
    for(const entry of state.access){id(entry.id);assertRatingPolicy({allowedContentRatings:entry.allowed});if(!Number.isSafeInteger(entry.at)||entry.at<0||entry.at>now)throw new Error('Invalid saved Marumaru access evidence')}
    for(const image of state.images){id(image.id);validateImage(image.url,image.id,image.episode);assertRatingPolicy({allowedContentRatings:image.allowed});if(!Number.isSafeInteger(image.at)||image.at<0||image.at>now||image.revision!==state.revision)throw new Error('Invalid saved Marumaru image evidence')}
    return state
}
function match(state:State,policy:Policy){if(state.revision!==policy.revision)throw new Error('Marumaru content policy changed; refresh to continue')}
export function rating(explicitlyAdult:boolean){return explicitlyAdult?ContentRating.EXPLICIT:nativeRating(undefined)}
export function visible(explicitlyAdult:boolean,policy:Policy){return ratingAllowed(rating(explicitlyAdult),{allowedContentRatings:policy.allowed})}
// Native rating context applies to this request, not a global setting.
// Contextless image callbacks use the policy captured when a URL was issued.
export function enter(context?:SourceContext):Promise<Policy>{
    assertRatingPolicy(context);return serial(async()=>{
        const state=await read()
        return {revision:state.revision,allowed:context?.allowedContentRatings===undefined?undefined:[...context.allowedContentRatings]}
    })
}
export function check(policy:Policy){return serial(async()=>{match(await read(),policy)})}
export function observe(work:string,explicitlyAdult:boolean,policy:Policy):Promise<boolean>{
    id(work);return serial(async()=>{const state=await read();match(state,policy);const now=Date.now()
        const old=state.titles.find(t=>t.id===work&&t.at<=now&&t.at+TTL>now)
        const adult=explicitlyAdult||old?.explicitlyAdult===true
        state.titles=state.titles.filter(t=>t.id!==work&&t.at<=now&&t.at+TTL>now)
        state.titles.push(old?.explicitlyAdult&&!explicitlyAdult?old:{id:work,explicitlyAdult:adult,at:now});state.titles=state.titles.slice(-512);await ObjectStore.set(KEY,state);return adult
    })
}
export function issue(work:string,urls:string[],policy:Policy,episode?:string):Promise<void>{
    id(work);if(episode)id(episode)
    return serial(async()=>{const state=await read();match(state,policy);const now=Date.now();const title=state.titles.find(t=>t.id===work&&t.at<=now&&t.at+TTL>now)
        if(!title||!visible(title.explicitlyAdult,policy))throw new Error('Marumaru images excluded by content policy')
        for(const url of urls){validateImage(url,work,episode);const scope=JSON.stringify(policy.allowed);state.images=state.images.filter(i=>i.at<=now&&i.at+TTL>now)
            if(!state.images.some(i=>i.url===url&&JSON.stringify(i.allowed)===scope))state.images.push({url,id:work,episode,at:title.at,revision:policy.revision,allowed:policy.allowed})}
        state.images=state.images.slice(-8192);await ObjectStore.set(KEY,state)
    })
}
function validateImage(url:string,work:string,episode?:string){
    const pattern=episode?'^https://peer\\.storagewebtoon\\.store/api/media/episode/'+id(episode)+'/[1-9]\\d*\\.webp$':'^https://peer\\.storagewebtoon\\.store/manhwa/'+id(work)+'/[A-Za-z0-9._-]+$'
    if(/\/(?:\.|\.\.)$/.test(url)||!new RegExp(pattern).test(url))throw new Error('Invalid Marumaru issued image identity')
}
export function authorize(url:string,policy:Policy):Promise<void>{return serial(async()=>{
    const state=await read();match(state,policy);const now=Date.now(),images=state.images.filter(i=>i.url===url&&i.revision===policy.revision&&i.at<=now&&i.at+TTL>now)
    for(const image of images){
        validateImage(url,image.id,image.episode)
        const title=state.titles.find(t=>t.id===image.id&&t.at<=now&&t.at+TTL>now)
        if(image.episode&&!state.access.some(a=>a.id===image.id&&a.at<=now&&a.at+TTL>now&&visible(title?.explicitlyAdult??true,{revision:policy.revision,allowed:a.allowed})))continue
        if(title&&visible(title.explicitlyAdult,{revision:policy.revision,allowed:image.allowed}))return
    }
    throw new Error('Marumaru image was not issued, expired, or excluded by issuing policy')
})}

export function grant(work:string,policy:Policy):Promise<void>{return serial(async()=>{
    const state=await read();match(state,policy);const now=Date.now(),title=state.titles.find(t=>t.id===work&&t.at<=now&&t.at+TTL>now)
    if(!title||!visible(title.explicitlyAdult,policy))throw new Error('Marumaru title has no allowed access evidence')
    state.access=state.access.filter(a=>a.id!==work&&a.at<=now&&a.at+TTL>now);state.access.push({id:work,at:title.at,allowed:policy.allowed});state.access=state.access.slice(-512);await ObjectStore.set(KEY,state)
})}
export function revoke(work:string):Promise<void>{id(work);return serial(async()=>{const state=await read();state.access=state.access.filter(a=>a.id!==work);state.images=state.images.filter(i=>i.id!==work);await ObjectStore.set(KEY,state)})}
export function accessPolicy(work:string):Promise<Policy>{id(work);return serial(async()=>{
    const state=await read(),now=Date.now(),entry=state.access.find(a=>a.id===work&&a.at<=now&&a.at+TTL>now),title=state.titles.find(t=>t.id===work&&t.at<=now&&t.at+TTL>now)
    const policy={revision:state.revision,allowed:entry?.allowed}
    if(!entry||!title||!visible(title.explicitlyAdult,policy))throw new Error('Refresh Marumaru title details under the current content policy before loading chapters')
    return policy
})}
