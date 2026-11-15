import {test,expect} from '@playwright/test'
import {writeFileSync} from 'node:fs'
test('F3 slow local search feedback',async({page})=>{
 await page.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.fulfill({status:204,body:''}))
 await page.goto('/search');await expect(page.locator('.search-cards-grid[aria-busy="false"]')).toBeVisible()
 await page.route('**/api/trpc/kos.search*',async r=>{const response=await r.fetch();await new Promise(resolve=>setTimeout(resolve,1500));await r.fulfill({response})})
 await page.getByRole('combobox',{name:'Cari lokasi'}).fill('audit-slow-absent')
 const response=page.waitForResponse(r=>r.url().includes('/api/trpc/kos.search')&&r.status()===200)
 await page.getByRole('button',{name:'Cari',exact:true}).click()
 await page.waitForTimeout(500)
 const during={url:new URL(page.url()).pathname+new URL(page.url()).search,loadingVisible:await page.getByText('Memuat daftar kos').isVisible(),alertCount:await page.getByRole('alert').count(),firstCardVisible:await page.locator('.search-cards-grid h3').first().isVisible()}
 await response;await expect(page.getByText('Tidak ada kos yang cocok')).toBeVisible()
 writeFileSync('notes/analysis/2026-10-27-workflow/artifacts/slow-search.json',JSON.stringify({delay_ms:1500,observed_after_ms:500,during,outcome:'Tidak ada kos yang cocok'},null,2))
})
