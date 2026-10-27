import { test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
test('priority anonymous navigation samples', async ({browser}) => {
  test.setTimeout(120000)
  const samples: object[] = []
  for (const profile of ['local','slow4g-4xcpu']) for (const route of ['/','/search','/masuk']) for (let n=0;n<3;n++) {
    const context=await browser.newContext({viewport:{width:1280,height:650},reducedMotion:'reduce'})
    await context.route('**/*', r => ['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname) ? r.continue() : r.abort())
    const page=await context.newPage()
    if(profile !== 'local') {
      const cdp=await context.newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750})
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:4})
    }
    await page.addInitScript(() => {
      ;(window as any).__lcp = null
      new PerformanceObserver(list => {for(const e of list.getEntries()) (window as any).__lcp = e.startTime}).observe({type:'largest-contentful-paint',buffered:true})
    })
    await page.goto(`http://localhost:3100${route}`,{waitUntil:'load'})
    await page.waitForTimeout(3000) // Fixed observation window for LCP; not a readiness oracle.
    const data=await page.evaluate(() => { const nav=performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming; return {lcp:(window as any).__lcp, load:nav?.loadEventEnd, fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null} })
    samples.push({profile,route,n:n+1,viewport:'1280x650',cache:'fresh context',...data})
    await context.close()
  }
  writeFileSync('notes/analysis/2026-10-27-workflow/artifacts/perf-samples.json',JSON.stringify(samples,null,2))
})
