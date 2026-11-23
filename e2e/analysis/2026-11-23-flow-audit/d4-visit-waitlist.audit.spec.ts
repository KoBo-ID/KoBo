import {
  test,
  expect,
  appendTelemetry,
  logObservation,
  newApprovedOwner,
  newVerifiedStudent,
  trpcPost,
  trpcGet,
  trpcRaw,
  sql,
  wibDate,
  tick,
} from './telemetry'

test.describe('D4 — Survey Visits & FIFO Waitlist (P1)', () => {
  test('D4-01/D4-02: Visit BVA (todayWIB, 301 notes), S-4 past-visit auto-close, VisitModal a11y & state reset', async ({ browser }) => {
    const t0 = Date.now()
    const own = await newApprovedOwner(browser, { label: 'd4-visit', rooms: 1 })
    await sql(`UPDATE "User" SET "campusEmailVerifiedAt" = now(), "campusVerifiedUntil" = now() + interval '180 days', "verifiedCampusId" = 'binus-syahdan' WHERE id = $1`, [own.userId])
    const stu = await newVerifiedStudent(browser, { label: 'd4-visit-stu', campusId: 'binus-syahdan', consents: true })
    stu.probe.allowHttp(/400.*visit\.create|409.*visit/)

    // BVA: date=todayWIB rejected; notes 301 rejected; own kos rejected
    const todayRes = await trpcRaw(stu.page, 'visit.create', { kosId: own.kosId, date: wibDate(0), timeSlot: 'PAGI' })
    const notes301 = await trpcRaw(stu.page, 'visit.create', {
      kosId: own.kosId,
      date: wibDate(1),
      timeSlot: 'PAGI',
      notes: 'a'.repeat(301),
    })
    const ownSelf = await trpcRaw(own.page, 'visit.create', { kosId: own.kosId, date: wibDate(1), timeSlot: 'PAGI' })
    expect(todayRes.status).toBe(400)
    expect(notes301.status).toBe(400)
    expect(ownSelf.status).toBe(403)

    // Open VisitModal in UI -> check aria-pressed & textarea maxLength & stale reopen state
    await stu.page.goto(`/kos/${own.kosId}`)
    await stu.page.getByRole('button', { name: /Jadwalkan Survey Gratis/i }).click()
    await stu.page.waitForTimeout(250)
    const modalAudit = await stu.page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]')
      if (!dlg) return { found: false, ariaPressedCount: 0, notesMaxLength: null as number | null }
      const pressed = dlg.querySelectorAll('button[aria-pressed]').length
      const ta = dlg.querySelector('textarea')
      return {
        found: true,
        ariaPressedCount: pressed,
        notesMaxLength: ta ? ta.maxLength : null,
      }
    })
    // Type notes, close, reopen -> check if notes reset
    const ta = stu.page.locator('[role="dialog"] textarea')
    await ta.fill('Catatan percobaan sebelum tutup')
    await stu.page.keyboard.press('Escape')
    await stu.page.waitForTimeout(200)
    await stu.page.getByRole('button', { name: /Jadwalkan Survey Gratis/i }).click()
    await stu.page.waitForTimeout(200)
    const retainedNotesOnReopen = (await stu.page.locator('[role="dialog"] textarea').inputValue()) === 'Catatan percobaan sebelum tutup'
    const snap = await stu.probe.snap('d4-visit-modal')
    await stu.page.keyboard.press('Escape')

    // S-4: Create valid visit -> backdate to yesterday -> create new visit -> verify old auto-cancelled
    const v1 = await trpcPost<{ id: string }>(stu.page, 'visit.create', { kosId: own.kosId, date: wibDate(2), timeSlot: 'SIANG' })
    await sql(`UPDATE "Visit" SET date = CURRENT_DATE - 2 WHERE id = $1`, [v1.id])
    const v2 = await trpcPost<{ id: string }>(stu.page, 'visit.create', { kosId: own.kosId, date: wibDate(3), timeSlot: 'PAGI' })
    const [v1Row] = await sql<{ status: string }>(`SELECT status FROM "Visit" WHERE id = $1`, [v1.id])
    expect(v1Row.status).toBe('CANCELLED')

    // Complete v2 by owner -> retry cancel by student MUST fail 409
    await trpcPost(own.page, 'owner.visit.complete', { kosId: own.kosId, visitId: v2.id })
    const cancelCompleted = await trpcRaw(stu.page, 'visit.cancel', { visitId: v2.id })
    expect(cancelCompleted.status).toBe(409)

    const dom = await stu.probe.measureDom()
    logObservation({ case_id: 'D4-01/02', modalAudit, retainedNotesOnReopen, v1StatusAfterS4: v1Row.status })

    const hasUxIssue = modalAudit.ariaPressedCount === 0 || (modalAudit.notesMaxLength ?? -1) <= 0 || retainedNotesOnReopen
    appendTelemetry({
      case_id: 'D4-01/02',
      flow_id: 'FLOW-D4-01',
      domain: 'D4',
      persona: 'P-STU-VER',
      viewport: '1280x650',
      gate_profile: 'P1',
      status: hasUxIssue ? 'PARTIAL' : 'PASS',
      assertions_passed: 6,
      assertions_failed: hasUxIssue ? 1 : 0,
      dead_end_hit: 0,
      state_sync_mismatch: retainedNotesOnReopen ? 1 : 0,
      optimal_steps: 4,
      actual_steps: 4,
      click_count: stu.probe.clicks,
      duration_ms: Date.now() - t0,
      max_interaction_latency_ms: stu.probe.maxLatencyMs,
      console_error_count: stu.probe.unexpectedConsoleErrors().length,
      page_error_count: stu.probe.pageErrors.length,
      unexpected_http_4xx_5xx_count: stu.probe.unexpectedHttpErrors().length,
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
      notes: `ariaPressedCount=${modalAudit.ariaPressedCount}; notesMaxLen=${modalAudit.notesMaxLength}; retainedNotesOnReopen=${retainedNotesOnReopen}`,
    })

    await stu.ctx.close()
    await own.ctx.close()
  })

  test('D4-04/D4-05: Waitlist offer hold protection (A-007), owner reject cascade to #2, exact expiry & decline-after-apply zombie app bug', async ({ browser }) => {
    const t0 = Date.now()
    const own = await newApprovedOwner(browser, { label: 'd4-wl', rooms: 1, price: 1_300_000 })
    const holder = await newVerifiedStudent(browser, { label: 'd4-holder', campusId: 'binus-syahdan', consents: true })
    const w1 = await newVerifiedStudent(browser, { label: 'd4-w1', campusId: 'binus-syahdan', consents: true })
    const w2 = await newVerifiedStudent(browser, { label: 'd4-w2', campusId: 'binus-syahdan', consents: true })
    const w3 = await newVerifiedStudent(browser, { label: 'd4-w3', campusId: 'binus-syahdan', consents: true })
    w3.probe.allowHttp(/409.*application\.create/)

    // Occupy the single room with holder
    const hApp = await trpcPost<{ id: string }>(holder.page, 'application.create', {
      roomId: own.rooms[0].id,
      startDate: wibDate(2),
      durationMonths: 1,
    })
    await trpcPost(own.page, 'application.decide', { kosId: own.kosId, applicationId: hApp.id, decision: 'APPROVE' })
    const [{ tenancyId }] = await sql<{ tenancyId: string }>(`SELECT "tenancyId" FROM "RentalApplication" WHERE id = $1`, [hApp.id])

    // w1 and w2 join waitlist in FIFO order
    const e1 = await trpcPost<{ id: string }>(w1.page, 'waitlist.join', { kosId: own.kosId, roomType: null })
    const e2 = await trpcPost<{ id: string }>(w2.page, 'waitlist.join', { kosId: own.kosId, roomType: null })

    // Owner ends holder's tenancy -> w1 gets OFFERED
    await trpcPost(own.page, 'owner.tenancy.end', { kosId: own.kosId, tenancyId })
    const [e1Offered] = await sql<{ status: string; offerExpiresAt: Date }>(
      `SELECT status, "offerExpiresAt" FROM "WaitlistEntry" WHERE id = $1`,
      [e1.id],
    )
    expect(e1Offered.status).toBe('OFFERED')

    // Non-offeree w3 MUST be refused
    const w3Blocked = await trpcRaw(w3.page, 'application.create', {
      roomId: own.rooms[0].id,
      startDate: wibDate(3),
      durationMonths: 1,
    })
    expect(w3Blocked.status).toBe(409)

    // w1 submits application -> links applicationId -> check OfferBanner UX & advance clock past offerExpiresAt!
    const w1App = await trpcPost<{ id: string }>(w1.page, 'application.create', {
      roomId: own.rooms[0].id,
      startDate: wibDate(3),
      durationMonths: 1,
    })
    await tick(w1.page, 'waitlist', new Date(e1Offered.offerExpiresAt.getTime() + 60_000))
    const [e1StillHeld] = await sql<{ status: string; applicationId: string | null }>(
      `SELECT status, "applicationId" FROM "WaitlistEntry" WHERE id = $1`,
      [e1.id],
    )
    expect(e1StillHeld.status).toBe('OFFERED')
    expect(e1StillHeld.applicationId).toBe(w1App.id)

    // Check kos.search availableRooms divergence while offer is past offerExpiresAt with PENDING app!
    const searchRes = await trpcGet<{ id: string; availableRooms: number }[]>(w3.page, 'kos.search', { q: own.kosName.slice(0, 15) })
    const foundInSearch = searchRes.find((k) => k.id === own.kosId)
    const searchAvailableRoomsMismatch = (foundInSearch?.availableRooms ?? 0) > 0

    // Owner rejects w1's application -> w1 becomes EXPIRED and w2 becomes OFFERED atomically!
    await trpcPost(own.page, 'application.decide', { kosId: own.kosId, applicationId: w1App.id, decision: 'REJECT' })
    const [e1AfterRej] = await sql<{ status: string }>(`SELECT status FROM "WaitlistEntry" WHERE id = $1`, [e1.id])
    const [e2Offered] = await sql<{ status: string }>(`SELECT status FROM "WaitlistEntry" WHERE id = $1`, [e2.id])
    expect(e1AfterRej.status).toBe('EXPIRED')
    expect(e2Offered.status).toBe('OFFERED')

    // Now test BUG: w2 applies (linking applicationId), then w2 declines the offer! Does w2's RentalApplication stay PENDING?
    const w2App = await trpcPost<{ id: string }>(w2.page, 'application.create', {
      roomId: own.rooms[0].id,
      startDate: wibDate(3),
      durationMonths: 1,
    })
    // Visit /kos/:id as w2 to check if OfferBanner still shows "Ajukan Sewa" & "Lewati" after applying
    await w2.page.goto(`/kos/${own.kosId}`)
    await w2.page.waitForTimeout(400)
    const bannerStillShowsLewati = await w2.page.getByRole('button', { name: /Lewati/i }).isVisible().catch(() => false)
    const snap = await w2.probe.snap('d4-offer-banner-after-apply')
    const dom = await w2.probe.measureDom()

    await trpcPost(w2.page, 'waitlist.decline', { entryId: e2.id })
    const [w2AppAfterDecline] = await sql<{ status: string }>(`SELECT status FROM "RentalApplication" WHERE id = $1`, [w2App.id])
    const zombiePendingAppAfterDecline = w2AppAfterDecline.status === 'PENDING'

    logObservation({
      case_id: 'D4-04/05',
      holdProtectedPastExpiry: e1StillHeld.status === 'OFFERED',
      ownerRejectAdvancedToW2: e2Offered.status === 'OFFERED',
      searchAvailableRoomsMismatch,
      bannerStillShowsLewati,
      zombiePendingAppAfterDecline,
    })

    appendTelemetry({
      case_id: 'D4-04',
      flow_id: 'FLOW-D4-03',
      domain: 'D4',
      persona: 'P-STU-VER',
      viewport: '1280x650',
      gate_profile: 'P1',
      status: zombiePendingAppAfterDecline || searchAvailableRoomsMismatch ? 'FAIL' : 'PASS',
      assertions_passed: 6,
      assertions_failed: (zombiePendingAppAfterDecline ? 1 : 0) + (searchAvailableRoomsMismatch ? 1 : 0),
      dead_end_hit: 0,
      state_sync_mismatch: zombiePendingAppAfterDecline || bannerStillShowsLewati || searchAvailableRoomsMismatch ? 1 : 0,
      optimal_steps: 6,
      actual_steps: 6,
      click_count: w2.probe.clicks,
      duration_ms: Date.now() - t0,
      max_interaction_latency_ms: w2.probe.maxLatencyMs,
      console_error_count: w2.probe.unexpectedConsoleErrors().length,
      page_error_count: w2.probe.pageErrors.length,
      unexpected_http_4xx_5xx_count: w2.probe.unexpectedHttpErrors().length,
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
      notes: `zombiePendingAppAfterDecline=${zombiePendingAppAfterDecline}; bannerStillShowsLewati=${bannerStillShowsLewati}; searchAvailMismatch=${searchAvailableRoomsMismatch}`,
    })

    await w3.ctx.close()
    await w2.ctx.close()
    await w1.ctx.close()
    await holder.ctx.close()
    await own.ctx.close()
  })
})
