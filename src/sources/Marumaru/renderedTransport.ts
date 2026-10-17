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
                    const hero=document.querySelector('.hero-v2'),rows=[...document.querySelectorAll('a.ep-row-v2-link')]
                    if(!hero?.querySelector('.hero-v2-title')||!rows.length)return null
                    return hero.outerHTML+rows.map(r=>r.outerHTML).join('')+(document.querySelector('.cs-rating-card')?.outerHTML??'')
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
