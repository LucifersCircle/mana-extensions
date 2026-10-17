/* SPDX-License-Identifier: GPL-3.0-or-later */
import '@mana-app/types'
import { validateDocumentURL } from './MarumaruService'
/** Ordinary app WebView navigation. No cookie extraction, API replay or identity override. */
let queue:Promise<unknown>=Promise.resolve()
export function renderedHTML(url:string):Promise<string>{
    const result=queue.then(()=>render(url));queue=result.then(()=>undefined,()=>undefined);return result
}
async function render(url:string):Promise<string>{
    validateDocumentURL(url)
    const page=await WebViewPage.create({timeout:25})
    try {
        await page.goto(url,{waitUntil:'domcontentloaded',timeout:20})
        return await page.evaluate(async (expected:string)=>{
            if(location.href!==expected)throw new Error('Marumaru WebView navigated away from requested document')
            const isReader=/\/manhwa\/\d+\/\d+$/.test(location.pathname)
            const isDetail=/\/manhwa\/\d+$/.test(location.pathname)
            const chapterRows:string[]=[],chapterIDs=new Set<string>()
            let detailIdentity:string|undefined,detailHero='',detailCount='',expectedPage=1,previousRows=''
            const read=():string|null=>{
                if(location.href!==expected)throw new Error('Marumaru WebView document identity changed')
                if(isReader){
                    const cuts=[...document.querySelectorAll('.vw-cut.theme-viewer-image')]
                    if(!cuts.length)return null
                    if(cuts.length>1000)throw new Error('Marumaru reader exceeds bounded page limit')
                    const pending=cuts.find(c=>{const i=c.querySelector('img');return !i||!i.complete||i.naturalWidth<=0||i.naturalHeight<=0})
                    if(pending){pending.scrollIntoView({block:'center'});return null}
                    return cuts.map(c=>c.outerHTML).join('')
                }
                if(isDetail){
                    const heroes=document.querySelectorAll('.hero-v2'),sections=document.querySelectorAll('.ep-section')
                    const hero=heroes[0],section=sections[0]
                    if(!hero?.querySelector('.hero-v2-title')||!section)return null
                    if(heroes.length!==1||sections.length!==1)throw new Error('Marumaru detail identity is ambiguous')
                    const counts=section.querySelectorAll('.ep-section-count'),count=counts[0]
                    const rows=[...section.querySelectorAll('a.ep-row-v2-link')]
                    if(!count||!rows.length||section.querySelector('.ep-notice-body'))return null
                    const rawCount=count.textContent?.trim()??'',total=Number(rawCount)
                    if(counts.length!==1||!/^[1-9]\d*$/.test(rawCount)||!Number.isSafeInteger(total)||total>10000)throw new Error('Marumaru chapter count is invalid or exceeds its limit')
                    const key=(href:string|null):string=>{
                        const path=href?.startsWith(expected+'/')?href.slice(location.origin.length):href
                        const prefix=location.pathname+'/'
                        if(!path?.startsWith(prefix)||!/^[1-9]\d*$/.test(path.slice(prefix.length)))throw new Error('Marumaru chapter link escaped title identity')
                        return path.slice(prefix.length)
                    }
                    const first=hero.querySelectorAll('.hero-v2-actions-bottom a.cta-ghost'),latest=hero.querySelectorAll('.hero-v2-actions-bottom a.cta-primary')
                    const firstLink=first[0],latestLink=latest[0]
                    if(first.length!==1||latest.length!==1||!firstLink||!latestLink)throw new Error('Marumaru chapter endpoints unavailable')
                    const firstID=key(firstLink.getAttribute('href')),latestID=key(latestLink.getAttribute('href'))
                    const identity=JSON.stringify([total,firstID,latestID,hero.querySelector('.hero-v2-title')?.textContent,hero.querySelector('.hero-v2-thumb img')?.getAttribute('src'),hero.querySelector('.hero-v2-adult')?.textContent??''])
                    if(detailIdentity!==undefined&&detailIdentity!==identity)throw new Error('Marumaru detail changed during chapter pagination')
                    if(detailIdentity===undefined){detailIdentity=identity;detailHero=hero.outerHTML;detailCount=count.outerHTML}
                    const pagers=section.querySelectorAll('.pager'),pager=pagers[0],active=pager?.querySelectorAll('a.pager-num.is-active')
                    if(pagers.length>1||(pager&&active?.length!==1))throw new Error('Marumaru chapter pagination is ambiguous')
                    const pageNumber=pager?Number(active?.[0]?.textContent?.trim()):1
                    if(!Number.isSafeInteger(pageNumber)||pageNumber<1||pageNumber>1000)throw new Error('Marumaru chapter page is invalid')
                    if(pageNumber!==expectedPage){if(previousRows&&pageNumber===expectedPage-1)return null;throw new Error('Marumaru chapter page changed unexpectedly')}
                    const ids=rows.map(row=>key(row.getAttribute('href'))),signature=ids.join(',')
                    // The page badge updates before the asynchronous row replacement.
                    if(previousRows&&signature===previousRows)return null
                    if(new Set(ids).size!==ids.length||ids.some(value=>chapterIDs.has(value)))throw new Error('Marumaru chapter pagination repeats an identity')
                    if(!chapterRows.length&&ids[0]!==latestID)throw new Error('Marumaru chapter list does not begin at the latest episode')
                    rows.forEach(row=>{chapterIDs.add(key(row.getAttribute('href')));chapterRows.push(row.outerHTML)})
                    if(chapterRows.length>total)throw new Error('Marumaru chapter inventory exceeds its advertised count')
                    const next=pager?[...pager.querySelectorAll<HTMLAnchorElement>('a.pager-btn')].filter(link=>link.textContent?.trim()==='›'):[]
                    if(next.length>1)throw new Error('Marumaru chapter continuation is ambiguous')
                    const nextLink=next[0],enabled=!!nextLink&&nextLink.getAttribute('aria-disabled')!=='true'
                    if(chapterRows.length===total){
                        if(enabled||ids[ids.length-1]!==firstID)throw new Error('Marumaru chapter inventory lacks a confirmed ending')
                        return detailHero+detailCount+chapterRows.join('')+(document.querySelector('.cs-rating-card')?.outerHTML??'')
                    }
                    if(!enabled||!nextLink||nextLink.getAttribute('href')!==`#page-${expectedPage+1}`||expectedPage>=1000)throw new Error('Marumaru complete chapter continuation unavailable')
                    previousRows=signature;expectedPage++
                    nextLink.click()
                    return null
                }
                if(location.pathname==='/search'){
                    const grid=document.querySelector('.search-results-grid'),count=document.querySelector('.count'),forms=document.querySelectorAll('form.search-page-form')
                    const form=forms[0]
                    // The header has its own empty q input; only the result-page form identifies this search.
                    if(!count||forms.length!==1||!form||form.querySelectorAll('input[name="q"]').length!==1||!grid?.children.length)return null
                    return grid.outerHTML+count.outerHTML+form.outerHTML+[...document.querySelectorAll('a.pager-btn')].map(a=>a.outerHTML).join('')
                }
                const cards=[...document.querySelectorAll('a[data-work-card]')]
                return cards.length?cards.map(c=>c.outerHTML).join('')+[...document.querySelectorAll('a.pager-btn')].map(a=>a.outerHTML).join(''):null
            }
            const immediate=read();if(immediate!==null)return immediate
            return await new Promise<string>((resolve,reject)=>{
                const started=Date.now()
                const timer=setInterval(()=>{try{
                    const result=read()
                    if(result!==null){clearInterval(timer);resolve(result)}
                    else if(Date.now()-started>15000){clearInterval(timer);reject(new Error('Marumaru rendered content did not become ready'))}
                }catch(error){clearInterval(timer);reject(error)}},150)
            })
        },url)
    } finally {await page.close()}
}
