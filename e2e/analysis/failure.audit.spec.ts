import {test,expect} from '@playwright/test'
import {writeFileSync} from 'node:fs'
test('F3 and F5 local failure and browser signals',async({page})=>{
 const events:{kind:string;path:string;status?:number}[]=[]
 await page.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.fulfill({status:204,body:''}))
 page.on('pageerror',()=>events.push({kind:'pageerror',path:'redacted'}))
 page.on('response',r=>{if(r.status()>=400){const u=new URL(r.url());events.push({kind:'http-error',path:u.pathname,status:r.status()})}})
 page.on('requestfailed',r=>{const u=new URL(r.url());events.push({kind:'requestfailed',path:u.hostname==='localhost'?u.pathname:'external-redacted'})})
 for(const path of ['/','/search','/kos/kos-1','/masuk']){
  await page.goto(path)
  await page.waitForFunction(()=>document.body.innerText.trim().length>60&&!document.body.innerText.includes('Memuat halaman…'))
 }
 await page.route('**/api/trpc/kos.search*',r=>r.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:{message:'audit simulated failure',data:{code:'INTERNAL_SERVER_ERROR',httpStatus:500}}})}))
 const failure=page.waitForResponse(r=>r.url().includes('/api/trpc/kos.search')&&r.status()===500)
 await page.goto('/search?q=audit-failure'); await failure
 await expect(page.getByRole('alert')).toBeVisible({timeout:20000})
 const state=await page.evaluate(()=>({alerts:Array.from(document.querySelectorAll('[role=alert]')).map(x=>x.textContent?.trim()),text:document.body.innerText.includes('Tidak ada kos yang cocok')?'empty-results':document.body.innerText.includes('Memuat daftar kos')?'loading':'other',body:document.body.innerText.slice(0,700)}))
 await page.unroute('**/api/trpc/kos.search*')
 await page.getByRole('button',{name:'Coba Lagi'}).click()
 await expect(page.getByText('Tidak ada kos yang cocok')).toBeVisible()
 writeFileSync('notes/analysis/2026-10-27-workflow/artifacts/failure-network.json',JSON.stringify({events,state,retry:'empty results state visible'},null,2))
})
