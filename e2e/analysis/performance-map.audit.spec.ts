import {test,expect} from './safe-fixtures'
import {writeFileSync} from 'node:fs'
test('F4 phone search map toggle samples',async({browser})=>{
 const data:{profile:string;ms:number;sample:number}[]=[]
 const extra=process.env.AUDIT_MAP_EXTRA==='1'
 for(const profile of (extra?['local']:['local','slow4g-4xcpu'])) for(let n=extra?4:1;n<=(extra?5:3);n++){
  const context=await browser.newContext({baseURL:'http://localhost:3100',viewport:{width:390,height:844},reducedMotion:'reduce'})
  const page=await context.newPage()
  if(profile!=='local'){const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750});await cdp.send('Emulation.setCPUThrottlingRate',{rate:4})}
  await page.goto('/search');const toggle=page.getByRole('button',{name:'Lihat Peta'});await expect(toggle).toBeVisible()
  const t=performance.now();await toggle.click();await expect(page.getByRole('button',{name:'Lihat Daftar'})).toBeVisible();await expect(page.locator('.leaflet-container')).toBeVisible()
  data.push({profile,ms:performance.now()-t,sample:n});writeFileSync(extra?'notes/analysis/2026-10-27-workflow/artifacts/perf-map-extra.json':'notes/analysis/2026-10-27-workflow/artifacts/perf-map.json',JSON.stringify(data,null,2))
  await context.close()
 }
})
