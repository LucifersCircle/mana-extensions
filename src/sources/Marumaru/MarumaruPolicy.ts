/* SPDX-License-Identifier: GPL-3.0-or-later */
import { ContentRating,
    SourceContext } from '@mana-app/types'
import { assertRatingPolicy,
    nativeRating,
    ratingAllowed } from '../../ContentRatingPolicy'
import { id } from './MarumaruParser'
const KEY='Marumaru.authorization.v1',ACCESS='Marumaru.access.v2.',EPOCH='Marumaru.access-epoch.v2.',REVOKED='Marumaru.revoked.v2.',ADULT='Marumaru.adult.v2.',TTL=3600000
type Title={id:string;explicitlyAdult:boolean;at:number};
type Access={id:string;at:number;allowed?:ContentRating[]};
type SavedAccess=Access&{revision:number;explicitlyAdult:boolean;epoch:string};
type State={revision:number;titles:Title[];access:Access[]};
export type Policy={revision:number;allowed?:ContentRating[];access?:{work:string;epoch:string}};
let queue:Promise<unknown>=Promise.resolve()
function serial<T>(work:()=>Promise<T>):Promise<T>{const result=queue.then(work);queue=result.then(()=>undefined,()=>undefined);return result}
async function read():Promise<State>{
    const state=await ObjectStore.get(KEY) as State|undefined
    if(!state)return {revision:0,titles:[],access:[]}
    if(!Number.isSafeInteger(state.revision)||state.revision<0||!Array.isArray(state.titles)||state.titles.length>512||!Array.isArray(state.access)||state.access.length>512)throw new Error('Invalid Marumaru policy state')
    const now=Date.now()
    for(const title of state.titles){id(title.id);if(typeof title.explicitlyAdult!=='boolean'||!Number.isSafeInteger(title.at)||title.at<0||title.at>now)throw new Error('Invalid saved Marumaru title evidence')}
    for(const entry of state.access){id(entry.id);assertRatingPolicy({allowedContentRatings:entry.allowed});if(!Number.isSafeInteger(entry.at)||entry.at<0||entry.at>now)throw new Error('Invalid saved Marumaru access evidence')}
    // Project only metadata fields; obsolete image evidence is ignored, even if malformed.
    return {revision:state.revision,titles:state.titles,access:state.access}
}
function match(state:State,policy:Policy){if(state.revision!==policy.revision)throw new Error('Marumaru content policy changed; refresh to continue')}
async function readEpoch(work:string):Promise<string>{
    const value=await ObjectStore.get(EPOCH+work)
    if(value===undefined||value===null)return ''
    if(typeof value!=='string'||!/^\d+:[a-z0-9]+$/.test(value))throw new Error('Invalid saved Marumaru access generation')
    return value
}
async function advanceEpoch(work:string):Promise<string>{
    const value=Date.now()+':'+(Math.random().toString(36).slice(2)||'0')
    await ObjectStore.set(EPOCH+work,value);return value
}
async function revoked(work:string,epoch:string):Promise<boolean>{
    const value=await ObjectStore.get(REVOKED+work+'.'+epoch)
    if(value!==undefined&&value!==null&&value!==true)throw new Error('Invalid saved Marumaru revocation')
    return value===true
}
async function adultEvidence(work:string):Promise<boolean>{
    const at=await ObjectStore.get(ADULT+work),now=Date.now()
    if(at===undefined||at===null)return false
    if(typeof at!=='number'||!Number.isSafeInteger(at)||at<0||at>now)throw new Error('Invalid saved Marumaru adult evidence')
    return at+TTL>now
}
async function matchingAccess(policy:Policy):Promise<void>{
    if(policy.access&&(await readEpoch(policy.access.work)!==policy.access.epoch||await revoked(policy.access.work,policy.access.epoch)))throw new Error('Marumaru content policy changed; refresh to continue')
}
export function beginAccess(work:string,policy:Policy):Promise<Policy>{id(work);return serial(async()=>{
    match(await read(),policy)
    // Bind before metadata I/O. An older in-flight request may not replace a
    // newer native rating scope or resurrect access after revocation.
    return {...policy,access:{work,epoch:await advanceEpoch(work)}}
})}
// ObjectStore is persistent, but its read/modify/write operations are not a
// cross-runtime transaction. Catalog snapshots must not overwrite a grant.
async function readAccess(work:string,state:State):Promise<SavedAccess|undefined>{
    const value=await ObjectStore.get(ACCESS+work) as SavedAccess|undefined|null
    const now=Date.now(),epoch=await readEpoch(work)
    if(value!==undefined&&value!==null){
        if(!value||typeof value!=='object'||value.id!==work)throw new Error('Invalid saved Marumaru access evidence')
        assertRatingPolicy({allowedContentRatings:value.allowed})
        if(!Number.isSafeInteger(value.at)||value.at<0||value.at>now||!Number.isSafeInteger(value.revision)||value.revision<0||typeof value.explicitlyAdult!=='boolean'||typeof value.epoch!=='string')throw new Error('Invalid saved Marumaru access evidence')
        return value.revision===state.revision&&value.epoch===epoch&&value.at+TTL>now&&!await revoked(work,epoch)?value:undefined
    }
    // Existing alpha.6 evidence remains usable only within its original lifetime.
    const entry=state.access.find(a=>a.id===work&&a.at<=now&&a.at+TTL>now)
    const title=state.titles.find(t=>t.id===work&&t.at<=now&&t.at+TTL>now)
    return !epoch&&entry&&title&&!await revoked(work,epoch)?{...entry,revision:state.revision,explicitlyAdult:title.explicitlyAdult,epoch}:undefined
}
export function rating(explicitlyAdult:boolean){return explicitlyAdult?ContentRating.EXPLICIT:nativeRating(undefined)}
export function visible(explicitlyAdult:boolean,policy:Policy){return ratingAllowed(rating(explicitlyAdult),{allowedContentRatings:policy.allowed})}
// Native rating context applies to this request, not a global setting.
// Contextless chapter callbacks require a separate, unexpired detail-access grant.
export function enter(context?:SourceContext):Promise<Policy>{
    assertRatingPolicy(context);return serial(async()=>{
        const state=await read()
        return {revision:state.revision,allowed:context?.allowedContentRatings===undefined?undefined:[...context.allowedContentRatings]}
    })
}
export function check(policy:Policy){return serial(async()=>{match(await read(),policy);await matchingAccess(policy)})}
export function observe(work:string,explicitlyAdult:boolean,policy:Policy):Promise<boolean>{
    id(work);return serial(async()=>{const state=await read();match(state,policy);const now=Date.now()
        // Positive classification is independent of catalog snapshots and pending grants.
        // Nonadult observations never erase or extend this evidence.
        if(explicitlyAdult)await ObjectStore.set(ADULT+work,now)
        const old=state.titles.find(t=>t.id===work&&t.at<=now&&t.at+TTL>now)
        const adult=explicitlyAdult||old?.explicitlyAdult===true||await adultEvidence(work)
        state.titles=state.titles.filter(t=>t.id!==work&&t.at<=now&&t.at+TTL>now)
        state.titles.push(old?.explicitlyAdult&&!explicitlyAdult?old:{id:work,explicitlyAdult:adult,at:now});state.titles=state.titles.slice(-512);await ObjectStore.set(KEY,state);return adult
    })
}
export function checkTitle(work:string,policy:Policy):Promise<boolean>{
    id(work);return serial(async()=>{
        const state=await read();match(state,policy)
        if(policy.access&&policy.access.work!==work)throw new Error('Marumaru access title identity mismatch')
        await matchingAccess(policy)
        const now=Date.now(),title=state.titles.find(t=>t.id===work&&t.at<=now&&t.at+TTL>now)
        const explicitlyAdult=title?.explicitlyAdult===true||await adultEvidence(work)
        if(!title||!visible(explicitlyAdult,policy))throw new Error('Marumaru title has no allowed fresh metadata evidence')
        return explicitlyAdult
    })
}

export function grant(work:string,policy:Policy):Promise<void>{return serial(async()=>{
    const access=policy.access??{work,epoch:await readEpoch(work)}
    if(access.work!==work)throw new Error('Marumaru access title identity mismatch')
    await matchingAccess({...policy,access})
    const state=await read();match(state,policy);const now=Date.now(),title=state.titles.find(t=>t.id===work&&t.at<=now&&t.at+TTL>now)
    const explicitlyAdult=title?.explicitlyAdult===true||await adultEvidence(work)
    if(!title||!visible(explicitlyAdult,policy))throw new Error('Marumaru title has no allowed access evidence')
    state.access=state.access.filter(a=>a.id!==work&&a.at<=now&&a.at+TTL>now);state.access.push({id:work,at:title.at,allowed:policy.allowed});state.access=state.access.slice(-512);await ObjectStore.set(KEY,state)
    await ObjectStore.set(ACCESS+work,{id:work,at:title.at,allowed:policy.allowed,revision:policy.revision,explicitlyAdult,epoch:access.epoch})
    await matchingAccess({...policy,access})
})}
export function revoke(work:string,policy?:Policy):Promise<void>{id(work);return serial(async()=>{
    if(policy?.access&&policy.access.work!==work)throw new Error('Marumaru access title identity mismatch')
    const epoch=policy?.access?.epoch??await readEpoch(work)
    // Revocation is immutable and generation-scoped: a delayed old failure must
    // neither resurrect its grant nor invalidate a newer successful native scope.
    await ObjectStore.set(REVOKED+work+'.'+epoch,true)
    if(await readEpoch(work)!==epoch)return
    const state=await read();state.access=state.access.filter(a=>a.id!==work);await ObjectStore.set(KEY,state)
})}
export function accessPolicy(work:string):Promise<Policy>{id(work);return serial(async()=>{
    const state=await read(),now=Date.now(),entry=await readAccess(work,state),title=state.titles.find(t=>t.id===work&&t.at<=now&&t.at+TTL>now)
    const policy:Policy={revision:state.revision,allowed:entry?.allowed,access:entry?{work,epoch:entry.epoch}:undefined}
    if(!entry||!visible(entry.explicitlyAdult||title?.explicitlyAdult===true||await adultEvidence(work),policy))throw new Error('Refresh Marumaru title details under the current content policy before loading chapters')
    return policy
})}
