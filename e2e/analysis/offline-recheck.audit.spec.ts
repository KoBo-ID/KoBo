import {test,expect} from '@playwright/test'
import {writeFileSync} from 'node:fs'
test('offline search observations and reconnect',async({page})=>{
 await page.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.fulfill({status:204,body:''}))
 await page.goto('/search')
 await expect(page.locator('.search-cards-grid[aria-busy="false"]')).toBeVisible()
 const initial=await page.locator('.search-cards-grid h3').count()
 await page.getByRole('combobox',{name:'Cari lokasi'}).fill('audit-offline-absent')
 await page.context().setOffline(true)
 await page.getByRole('button',{name:'Cari',exact:true}).click()
 await expect(page).toHaveURL(/q=audit-offline-absent/)
 await page.waitForTimeout(5000) // Observe a sustained offline state, not a readiness assertion.
 const offline={url:new URL(page.url()).pathname+new URL(page.url()).search,domCards:await page.locator('.search-cards-grid h3').count(),firstCardVisible:await page.locator('.search-cards-grid h3').first().isVisible(),alertCount:await page.getByRole('alert').count(),loadingVisible:await page.getByText('Memuat daftar kos').isVisible()}
 await page.screenshot({path:'notes/analysis/2026-10-27-workflow/artifacts/offline-stale-search.png'})
 await page.context().setOffline(false)
 await expect(page.getByText('Tidak ada kos yang cocok')).toBeVisible({timeout:20000})
 writeFileSync('notes/analysis/2026-10-27-workflow/artifacts/offline-recheck.json',JSON.stringify({initialCards:initial,afterFiveSecondsOffline:offline,afterReconnect:'Tidak ada kos yang cocok'},null,2))
 expect(initial).toBeGreaterThan(0);expect(offline.domCards).toBeGreaterThan(0);expect(offline.firstCardVisible).toBe(true);expect(offline.alertCount).toBe(0)
})
