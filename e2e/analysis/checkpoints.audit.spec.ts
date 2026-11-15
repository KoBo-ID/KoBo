import {test,expect,loginAs} from './safe-fixtures'
test('priority visual checkpoints',async({browser})=>{
 for(const viewport of [{width:390,height:844},{width:1280,height:650}]){
  const c=await browser.newContext({baseURL:'http://localhost:3100',viewport,reducedMotion:'reduce'})
  const p=await c.newPage();await loginAs(p,'student')
  await p.goto('/kos/kos-1');await expect(p.getByRole('heading',{level:1})).toBeVisible()
  await p.screenshot({path:`notes/analysis/2026-10-27-workflow/artifacts/detail-${viewport.width}.png`})
  await p.goto('/my-kos');await expect(p.getByRole('tab',{name:/Pengajuan Sewa/})).toBeVisible()
  await p.locator('main').screenshot({path:`notes/analysis/2026-10-27-workflow/artifacts/my-kos-${viewport.width}.png`})
  await p.goto('/kos/kos-1');const button=p.getByRole('button',{name:'Ajukan Sewa'});if(await button.isEnabled()){
   await button.click();await expect(p.getByLabel('Pekerjaan atau kegiatan utama')).toBeVisible()
   await p.evaluate(() => { const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); while(walker.nextNode()){const node=walker.currentNode; node.textContent=node.textContent?.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,'[redacted]') ?? ''} })
   await p.locator('main').screenshot({path:`notes/analysis/2026-10-27-workflow/artifacts/checkout-${viewport.width}.png`})
  }
  await c.close()
 }
})
