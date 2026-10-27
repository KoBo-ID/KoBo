import { test, expect } from '@playwright/test'
import { writeFileSync } from 'node:fs'
const root = 'notes/analysis/2026-10-27-workflow/artifacts'
test('anonymous routes and representative viewports', async ({ browser }) => {
  const observations: object[] = []
  for (const viewport of [{width:390,height:844},{width:768,height:1024},{width:1280,height:650},{width:1600,height:900}]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce' })
    const page = await context.newPage()
    let externalBlocked = 0
    await page.route('**/*', route => {
      const u = new URL(route.request().url())
      if (['localhost','127.0.0.1'].includes(u.hostname)) return route.continue()
      externalBlocked++; return route.abort()
    })
    for (const path of ['/', '/search', '/masuk', '/masuk?google=gagal', '/syarat', '/privasi', '/kontak', '/audit-no-such-page', '/kuitansi/invalid']) {
      const res = await page.goto(`http://localhost:3100${path}`, {waitUntil:'domcontentloaded'})
      await page.waitForFunction(() => document.body.innerText.trim().length > 60 && !document.body.innerText.includes('Memuat halaman?'), null, {timeout: 15000})
      const item = await page.evaluate(() => ({title: document.title, url: location.pathname + location.search, heading: document.querySelector('h1')?.textContent?.trim() || '', body: document.body.innerText.slice(0, 1600), scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth}))
      observations.push({viewport, requested:path, status:res?.status(), externalBlocked, ...item})
      if (viewport.width === 390 && ['/', '/search', '/masuk'].includes(path)) await page.screenshot({path:`${root}/F1-${path === '/' ? 'home' : path.slice(1)}-phone.png`})
    }
    await context.close()
  }
  writeFileSync(`${root}/anonymous-sweep.json`, JSON.stringify(observations,null,2))
})
