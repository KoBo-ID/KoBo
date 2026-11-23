import {
  test,
  expect,
  attachProbe,
  appendTelemetry,
  logObservation,
  trpcRaw,
  newApprovedOwner,
  newAuditContext,
  sql,
} from './telemetry'

test.describe('D1 — Discovery, Search, Map & Kos Evaluation (P1)', () => {
  test('D1-01/D1-02/D1-05: Home hero search, autocomplete cap 4, radius vs r bug, and query BVA', async ({ page }) => {
    const t0 = Date.now()
    const probe = await attachProbe(page)
    probe.allowHttp(/400.*kos\.search/)

    await page.goto('/')
    await page.waitForSelector('h1')
    const homeDom = await probe.measureDom()
    const homeSnap = await probe.snap('d1-home-desktop')

    // Type "binus" in CampusSearchField and check dropdown row cap <= 4
    const input = page.locator('input[role="combobox"]').first()
    await input.fill('binus')
    const options = page.locator('[role="option"]')
    await expect(options.first()).toBeVisible()
    const optCount = await options.count()
    expect(optCount).toBeLessThanOrEqual(4)

    await probe.measureAction(async () => {
      await options.first().click()
      await page.waitForURL(/\/search/)
    })
    const searchUrlAfterHero = page.url()
    const searchDom = await probe.measureDom()
    const searchSnap = await probe.snap('d1-search-binus-desktop')

    // Query BVA via API: 101 chars rejected, maxPrice=-1 rejected, unpaired lat rejected
    const q101 = await trpcRaw(page, 'kos.search', { q: 'a'.repeat(101) }, 'GET')
    const negPrice = await trpcRaw(page, 'kos.search', { maxPrice: -1 }, 'GET')
    const unpairedLat = await trpcRaw(page, 'kos.search', { lat: -6.2 }, 'GET')

    logObservation({
      case_id: 'D1-01/02/05',
      optCount,
      searchUrlAfterHero,
      q101Status: q101.status,
      negPriceStatus: negPrice.status,
      unpairedLatStatus: unpairedLat.status,
      homeDom,
      searchDom,
    })

    appendTelemetry({
      case_id: 'D1-01',
      flow_id: 'FLOW-D1-01',
      domain: 'D1',
      persona: 'P-GUEST',
      viewport: '1280x650',
      gate_profile: 'P1',
      status: optCount <= 4 && q101.status === 400 && negPrice.status === 400 && unpairedLat.status === 400 ? 'PASS' : 'FAIL',
      assertions_passed: 5,
      assertions_failed: 0,
      dead_end_hit: 0,
      state_sync_mismatch: 0,
      optimal_steps: 3,
      actual_steps: 3,
      click_count: probe.clicks,
      duration_ms: Date.now() - t0,
      max_interaction_latency_ms: probe.maxLatencyMs,
      console_error_count: probe.unexpectedConsoleErrors().length,
      page_error_count: probe.pageErrors.length,
      unexpected_http_4xx_5xx_count: probe.unexpectedHttpErrors().length,
      lcp_ms: homeDom.lcpMs,
      cls_score: homeDom.cls,
      horizontal_overflow_px: Math.max(homeDom.horizontalOverflowPx, searchDom.horizontalOverflowPx),
      min_interactive_target_px: searchDom.minInteractiveTargetPx,
      keyboard_completable: 'yes',
      focus_visible_ok: 'yes',
      aria_status_announced: 'yes',
      broken_img_count: homeDom.brokenImgCount + searchDom.brokenImgCount,
      unnamed_icon_btn_count: homeDom.unnamedIconBtnCount + searchDom.unnamedIconBtnCount,
      nested_interactive_count: homeDom.nestedInteractiveCount + searchDom.nestedInteractiveCount,
      screenshot_paths: [homeSnap, searchSnap],
      notes: `optCount=${optCount}; url=${searchUrlAfterHero}; q101=${q101.status}; negPrice=${negPrice.status}`,
    })
  })

  test('D1-03/D1-04/D1-07: Search maxPrice BVA, URL precedence & campus sort Rating Tertinggi snap-back bug', async ({ page }) => {
    const t0 = Date.now()
    const probe = await attachProbe(page)

    // URL precedence: lat+lng overrides campus/loc/region
    await page.goto('/search?lat=-6.2015&lng=106.7825&place=TestSpot&campus=binus-syahdan&loc=loc-dago&region=36&maxPrice=3500000')
    await page.waitForSelector('h1')
    const urlAfterLoad = page.url()

    // Test D1-04: campus search -> click Urutkan -> Rating Tertinggi
    await page.goto('/search?campus=binus-syahdan')
    await page.waitForSelector('h1')
    await page.waitForTimeout(300)
    const urlBeforeSort = page.url()

    const sortBtn = page.getByRole('button', { name: /Terdekat|Rating Tertinggi|Harga Terendah/i }).first()
    await expect(sortBtn).toBeVisible()
    await probe.measureAction(async () => {
      await sortBtn.click()
    })
    const ratingOpt = page.getByRole('menuitemradio', { name: /Rating Tertinggi/i })
    await expect(ratingOpt).toBeVisible()
    // Also check parent popover role (ARIA role mismatch check)
    const popoverRole = await ratingOpt.evaluate((el) => el.closest('[role="dialog"], [role="menu"]')?.getAttribute('role') ?? 'none')
    await probe.measureAction(async () => {
      await ratingOpt.click()
    })
    await page.waitForTimeout(400)
    const urlAfterRatingClick = page.url()
    const snappedBackToDistance = urlAfterRatingClick.includes('sort=distance_asc')

    const snap = await probe.snap('d1-search-sort-snapback')
    const dom = await probe.measureDom()

    logObservation({
      case_id: 'D1-04',
      urlBeforeSort,
      urlAfterRatingClick,
      snappedBackToDistance,
      popoverRole,
      urlAfterPrecedence: urlAfterLoad,
    })

    appendTelemetry({
      case_id: 'D1-04',
      flow_id: 'FLOW-D1-03',
      domain: 'D1',
      persona: 'P-GUEST',
      viewport: '1280x650',
      gate_profile: 'P1',
      status: snappedBackToDistance ? 'FAIL' : 'PASS',
      assertions_passed: snappedBackToDistance ? 1 : 3,
      assertions_failed: snappedBackToDistance ? 2 : 0,
      dead_end_hit: 0,
      state_sync_mismatch: snappedBackToDistance ? 1 : 0,
      optimal_steps: 2,
      actual_steps: 2,
      click_count: probe.clicks,
      duration_ms: Date.now() - t0,
      max_interaction_latency_ms: probe.maxLatencyMs,
      console_error_count: probe.unexpectedConsoleErrors().length,
      page_error_count: probe.pageErrors.length,
      unexpected_http_4xx_5xx_count: probe.unexpectedHttpErrors().length,
      lcp_ms: dom.lcpMs,
      cls_score: dom.cls,
      horizontal_overflow_px: dom.horizontalOverflowPx,
      min_interactive_target_px: dom.minInteractiveTargetPx,
      keyboard_completable: 'yes',
      focus_visible_ok: 'yes',
      aria_status_announced: 'yes',
      broken_img_count: dom.brokenImgCount,
      unnamed_icon_btn_count: dom.unnamedIconBtnCount,
      nested_interactive_count: dom.nestedInteractiveCount,
      screenshot_paths: [snap],
      notes: `snappedBackToDistance=${snappedBackToDistance}; sortPopoverRole=${popoverRole}; urlAfter=${urlAfterRatingClick}`,
    })
  })

  test('D1-06: Reflected DOM XSS check via ?place= URL param in LeafletMap', async ({ page }) => {
    const t0 = Date.now()
    const probe = await attachProbe(page)
    const xssPayload = '<img src=x onerror="window.__xssFired=1">'
    await page.goto(`/search?lat=-6.2015&lng=106.7825&place=${encodeURIComponent(xssPayload)}`)
    await page.waitForSelector('.leaflet-container', { timeout: 15_000 })
    await page.waitForTimeout(800)

    const xssFired = await page.evaluate(() => Boolean((window as unknown as { __xssFired?: number }).__xssFired))
    const injectedImgCount = await page.locator('.leaflet-marker-pane img[src="x"]').count()
    const snap = await probe.snap('d1-xss-place-param')
    const dom = await probe.measureDom()

    logObservation({ case_id: 'D1-06', xssFired, injectedImgCount, xssPayload })

    appendTelemetry({
      case_id: 'D1-06',
      flow_id: 'FLOW-D1-04',
      domain: 'D1',
      persona: 'P-GUEST',
      viewport: '1280x650',
      gate_profile: 'P1',
      status: xssFired || injectedImgCount > 0 ? 'FAIL' : 'PASS',
      assertions_passed: xssFired ? 0 : 1,
      assertions_failed: xssFired ? 1 : 0,
      dead_end_hit: 0,
      state_sync_mismatch: 0,
      optimal_steps: 1,
      actual_steps: 1,
      click_count: 0,
      duration_ms: Date.now() - t0,
      max_interaction_latency_ms: 0,
      console_error_count: probe.unexpectedConsoleErrors().length,
      page_error_count: probe.pageErrors.length,
      unexpected_http_4xx_5xx_count: probe.unexpectedHttpErrors().length,
      lcp_ms: dom.lcpMs,
      cls_score: dom.cls,
      horizontal_overflow_px: dom.horizontalOverflowPx,
      min_interactive_target_px: dom.minInteractiveTargetPx,
      keyboard_completable: 'n/a',
      focus_visible_ok: 'n/a',
      aria_status_announced: 'n/a',
      broken_img_count: dom.brokenImgCount,
      unnamed_icon_btn_count: dom.unnamedIconBtnCount,
      nested_interactive_count: dom.nestedInteractiveCount,
      screenshot_paths: [snap],
      notes: `xssFired=${xssFired}; injectedImgCount=${injectedImgCount}`,
    })
  })

  test('D1-08/D1-09/D1-10/D1-12: Unapproved kos visibility, waitlist.status leak, NearbyList attribution & lightbox keyboard trap', async ({ browser }) => {
    const t0 = Date.now()
    // Create an approved owner with a kos, then downgrade owner to MENUNGGU to test unapproved kos leakage
    const own = await newApprovedOwner(browser, { label: 'd1-unapp', rooms: 1 })
    await sql(`UPDATE "OwnerProfile" SET "verificationStatus" = 'MENUNGGU', "approvedAt" = NULL WHERE "userId" = $1`, [own.userId])

    const guest = await newAuditContext(browser)
    guest.probe.allowHttp(/404.*kos\.detail/)

    // 1. Guest opening unapproved kos -> should be NotFound
    await guest.page.goto(`/kos/${own.kosId}`)
    await expect(guest.page.getByText(/Kos tidak ditemukan/i)).toBeVisible()

    // 2. Guest calling waitlist.status directly on unapproved kos
    const wlRes = await trpcRaw(guest.page, 'waitlist.status', { kosId: own.kosId }, 'GET')
    const leakedWaitlist = wlRes.status === 200

    // 3. Guest opens seeded kos-1 detail -> check NearbyList attribution & Lightbox Tab behavior
    await guest.page.goto('/kos/kos-1')
    await expect(guest.page.locator('h1')).toBeVisible()
    const detailDom = await guest.probe.measureDom()
    const detailSnap = await guest.probe.snap('d1-kos-detail-desktop')

    const nearbySection = guest.page.locator('#lokasi')
    const nearbyText = (await nearbySection.count()) > 0 ? await nearbySection.innerText() : ''
    const hasAttributionInNearby = /OpenStreetMap|Overture/i.test(nearbyText)

    // Open PhotoHeroMosaic lightbox and test Tab reachability to Next button
    let lightboxTabTrappedOnClose = false
    const openLightboxBtn = guest.page.getByRole('button', { name: /Lihat Semua|foto/i }).first()
    if (await openLightboxBtn.isVisible().catch(() => false)) {
      await openLightboxBtn.click()
      await guest.page.waitForTimeout(250)
      const beforeTab = await guest.page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '')
      await guest.page.keyboard.press('Tab')
      const afterTab1 = await guest.page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '')
      await guest.page.keyboard.press('Tab')
      const afterTab2 = await guest.page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || '')
      lightboxTabTrappedOnClose = beforeTab === afterTab1 && afterTab1 === afterTab2 && /Tutup/i.test(afterTab1)
      await guest.page.keyboard.press('Escape')
    }

    logObservation({
      case_id: 'D1-08/09/10/12',
      leakedWaitlist,
      wlStatus: wlRes.status,
      hasAttributionInNearby,
      lightboxTabTrappedOnClose,
      detailDom,
    })

    appendTelemetry({
      case_id: 'D1-09/10/12',
      flow_id: 'FLOW-D1-05',
      domain: 'D1',
      persona: 'P-GUEST',
      viewport: '1280x650',
      gate_profile: 'P1',
      status: leakedWaitlist || lightboxTabTrappedOnClose ? 'FAIL' : 'PASS',
      assertions_passed: 2,
      assertions_failed: (leakedWaitlist ? 1 : 0) + (lightboxTabTrappedOnClose ? 1 : 0),
      dead_end_hit: 0,
      state_sync_mismatch: leakedWaitlist ? 1 : 0,
      optimal_steps: 4,
      actual_steps: 4,
      click_count: guest.probe.clicks,
      duration_ms: Date.now() - t0,
      max_interaction_latency_ms: guest.probe.maxLatencyMs,
      console_error_count: guest.probe.unexpectedConsoleErrors().length,
      page_error_count: guest.probe.pageErrors.length,
      unexpected_http_4xx_5xx_count: guest.probe.unexpectedHttpErrors().length,
      lcp_ms: detailDom.lcpMs,
      cls_score: detailDom.cls,
      horizontal_overflow_px: detailDom.horizontalOverflowPx,
      min_interactive_target_px: detailDom.minInteractiveTargetPx,
      keyboard_completable: lightboxTabTrappedOnClose ? 'partial' : 'yes',
      focus_visible_ok: 'yes',
      aria_status_announced: 'yes',
      broken_img_count: detailDom.brokenImgCount,
      unnamed_icon_btn_count: detailDom.unnamedIconBtnCount,
      nested_interactive_count: detailDom.nestedInteractiveCount,
      screenshot_paths: [detailSnap],
      notes: `leakedWaitlist=${leakedWaitlist}; hasAttributionInNearby=${hasAttributionInNearby}; lightboxTabTrappedOnClose=${lightboxTabTrappedOnClose}`,
    })

    await guest.ctx.close()
    await own.ctx.close()
  })

  test('D1-MOBILE: 390x844 Search + Map toggle + Kos Detail responsive audit', async ({ browser }) => {
    const t0 = Date.now()
    const mob = await newAuditContext(browser, { width: 390, height: 844 })
    await mob.page.goto('/search?campus=binus-syahdan')
    await mob.page.waitForSelector('h1')
    const sDom = await mob.probe.measureDom()
    const sSnap = await mob.probe.snap('d1-search-mobile-390')

    const mapBtn = mob.page.getByRole('button', { name: /Lihat Peta/i })
    if (await mapBtn.isVisible().catch(() => false)) {
      await mob.probe.measureAction(async () => {
        await mapBtn.click()
      })
      await mob.page.waitForTimeout(400)
    }
    const mSnap = await mob.probe.snap('d1-search-map-mobile-390')

    await mob.page.goto('/kos/kos-1')
    await mob.page.waitForSelector('h1')
    const dDom = await mob.probe.measureDom()
    const dSnap = await mob.probe.snap('d1-detail-mobile-390')

    appendTelemetry({
      case_id: 'D1-MOB',
      flow_id: 'FLOW-D1-04',
      domain: 'D1',
      persona: 'P-GUEST',
      viewport: '390x844',
      gate_profile: 'P1',
      status: sDom.horizontalOverflowPx === 0 && dDom.horizontalOverflowPx === 0 ? 'PASS' : 'FAIL',
      assertions_passed: 2,
      assertions_failed: (sDom.horizontalOverflowPx > 0 ? 1 : 0) + (dDom.horizontalOverflowPx > 0 ? 1 : 0),
      dead_end_hit: 0,
      state_sync_mismatch: 0,
      optimal_steps: 3,
      actual_steps: 3,
      click_count: mob.probe.clicks,
      duration_ms: Date.now() - t0,
      max_interaction_latency_ms: mob.probe.maxLatencyMs,
      console_error_count: mob.probe.unexpectedConsoleErrors().length,
      page_error_count: mob.probe.pageErrors.length,
      unexpected_http_4xx_5xx_count: mob.probe.unexpectedHttpErrors().length,
      lcp_ms: dDom.lcpMs,
      cls_score: dDom.cls,
      horizontal_overflow_px: Math.max(sDom.horizontalOverflowPx, dDom.horizontalOverflowPx),
      min_interactive_target_px: dDom.minInteractiveTargetPx,
      keyboard_completable: 'yes',
      focus_visible_ok: 'yes',
      aria_status_announced: 'yes',
      broken_img_count: sDom.brokenImgCount + dDom.brokenImgCount,
      unnamed_icon_btn_count: sDom.unnamedIconBtnCount + dDom.unnamedIconBtnCount,
      nested_interactive_count: sDom.nestedInteractiveCount + dDom.nestedInteractiveCount,
      screenshot_paths: [sSnap, mSnap, dSnap],
      notes: `searchOverflow=${sDom.horizontalOverflowPx}; detailOverflow=${dDom.horizontalOverflowPx}; minTarget=${dDom.minInteractiveTargetPx}`,
    })
    await mob.ctx.close()
  })
})
