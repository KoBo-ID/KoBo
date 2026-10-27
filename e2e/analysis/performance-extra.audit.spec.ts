import {test} from './safe-fixtures'
import {loginAs} from '../tests/fixtures'
import {writeFileSync} from 'node:fs'

test('F4 additional priority navigation samples',async({browser})=>{
 test.setTimeout(240000)
 const setup=await browser.newContext({baseURL:'http://localhost:3100',reducedMotion:'reduce'})
 const sp=await setup.newPage();await loginAs(sp,'owner')
 const body=await (await sp.request.get('/api/trpc/owner.myKos')).json()
 const list=body.result.data.json??body.result.data
 const kos=list.find((k:any)=>k.rooms.some((r:any)=>r.status==='vacant'))
 if(!kos) throw Error('No vacant fixture room')
 const room=kos.rooms.find((r:any)=>r.status==='vacant')
 await sp.goto(`/owner/dashboard?kos=kos-1`)
 const href=await sp.getByRole('link',{name:/Lihat kuitansi Kamar/}).first().getAttribute('href')
 if(!href) throw Error('No existing owner receipt')
 const paths=[{label:'kos detail',url:`/kos/${kos.id}`,persona:'student'},{label:'checkout',url:`/checkout/${kos.id}?room=${room.id}`,persona:'student'},{label:'my-kos',url:'/my-kos',persona:'student'},{label:'owner dashboard',url:`/owner/dashboard?kos=${kos.id}`,persona:'owner'},{label:'owner kos',url:'/owner/kos',persona:'owner'},{label:'receipt',url:href,persona:'owner'}] as const
 await setup.close()
 const samples:object[]=[]
 for(const profile of ['local','slow4g-4xcpu']) for(const path of paths) for(let n=0;n<3;n++){
  const context=await browser.newContext({baseURL:'http://localhost:3100',viewport:{width:1280,height:650},reducedMotion:'reduce'})
  const page=await context.newPage();await loginAs(page,path.persona)
  if(profile!=='local'){const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4})}
  await page.addInitScript(()=>{(window as any).__lcp=null;new PerformanceObserver(list=>{for(const e of list.getEntries())(window as any).__lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true})})
  await page.goto(path.url,{waitUntil:'load'});await page.waitForTimeout(3000)
  const data=await page.evaluate(()=>{const nav=performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;return {lcp:(window as any).__lcp,load:nav?.loadEventEnd,fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime??null}})
  samples.push({profile,route:path.label,n:n+1,viewport:'1280x650',cache:'fresh browser context after demo login',...data})
  writeFileSync('notes/analysis/2026-10-27-workflow/artifacts/perf-extra-samples.json',JSON.stringify(samples,null,2))
  await context.close()
 }
})
