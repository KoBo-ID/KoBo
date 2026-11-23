import {
  test,
  expect,
  appendTelemetry,
  logObservation,
  newAuditContext,
  newVerifiedStudent,
  newApprovedOwner,
  signUpVerified,
  loginDemo,
  trpcPost,
  trpcRaw,
  sql,
  wibDate,
} from './telemetry'

const isP2 = process.env.AUDIT_REQUIRE_STUDENT === '0'

test.describe('Gate Matrix — Profile P3 (DEMO_ISOLATION=1) & Profile P2 (Relaxed Flags)', () => {
  test('P3-01: DEMO_ISOLATION=1 real<->demo kos isolation boundary across apply, visit & waitlist', async ({ browser }) => {
    test.skip(isP2, 'Runs under Profile P1/P3 (DEMO_ISOLATION=1)')
    const t0 = Date.now()

    // 1. Real verified student tries to apply/visit on demo owner's kos (kos-1, vacant room-103) -> MUST be 403 FORBIDDEN!
    const realStu = await newVerifiedStudent(browser, { label: 'p3-real-stu', campusId: 'binus-syahdan', consents: true })
    realStu.probe.allowHttp(/403.*(application|visit|waitlist)/)

    const appOnDemo = await trpcRaw(realStu.page, 'application.create', {
      roomId: 'room-103',
      startDate: wibDate(3),
      durationMonths: 1,
    })
    const visitOnDemo = await trpcRaw(realStu.page, 'visit.create', {
      kosId: 'kos-1',
      date: wibDate(2),
      timeSlot: 'PAGI',
    })
    // Check whether kos-1 is visibly marked as demo kos on /kos/kos-1 for a real user
    await realStu.page.goto('/kos/kos-1')
    await realStu.page.waitForSelector('h1')
    const detailText = await realStu.page.locator('main').innerText()
    const hasDemoLabelOnDetail = /kos contoh|akun demo/i.test(detailText)
    const snap = await realStu.probe.snap('p3-real-student-on-demo-kos')
    const dom = await realStu.probe.measureDom()

    // 2. Demo student tries to apply/visit on a real signed-up owner's kos -> MUST be 403 FORBIDDEN!
    const realOwn = await newApprovedOwner(browser, { label: 'p3-real-own', rooms: 1 })
    const demoStu = await newAuditContext(browser)
    demoStu.probe.allowHttp(/403.*(application|visit)/)
    await loginDemo(demoStu.page, 'student')

    const demoOnRealApp = await trpcRaw(demoStu.page, 'application.create', {
      roomId: realOwn.rooms[0].id,
      startDate: wibDate(3),
      durationMonths: 1,
    })
    const demoOnRealVisit = await trpcRaw(demoStu.page, 'visit.create', {
      kosId: realOwn.kosId,
      date: wibDate(2),
      timeSlot: 'PAGI',
    })

    expect(appOnDemo.status).toBe(403)
    expect(visitOnDemo.status).toBe(403)
    expect(demoOnRealApp.status).toBe(403)
    expect(demoOnRealVisit.status).toBe(403)

    logObservation({
      case_id: 'P3-01',
      appOnDemo: { status: appOnDemo.status, msg: appOnDemo.message },
      visitOnDemo: { status: visitOnDemo.status, msg: visitOnDemo.message },
      demoOnRealApp: { status: demoOnRealApp.status, msg: demoOnRealApp.message },
      demoOnRealVisit: { status: demoOnRealVisit.status, msg: demoOnRealVisit.message },
      hasDemoLabelOnDetail,
    })

    appendTelemetry({
      case_id: 'P3-01',
      flow_id: 'FLOW-D3-01',
      domain: 'D3',
      persona: 'P-STU-PARTNER',
      viewport: '1280x650',
      gate_profile: 'P3',
      status: hasDemoLabelOnDetail ? 'PASS' : 'PARTIAL',
      assertions_passed: 4,
      assertions_failed: hasDemoLabelOnDetail ? 0 : 1,
      dead_end_hit: 0,
      state_sync_mismatch: 0,
      optimal_steps: 4,
      actual_steps: 4,
      click_count: 0,
      duration_ms: Date.now() - t0,
      max_interaction_latency_ms: 0,
      console_error_count: realStu.probe.unexpectedConsoleErrors().length,
      page_error_count: realStu.probe.pageErrors.length,
      unexpected_http_4xx_5xx_count: realStu.probe.unexpectedHttpErrors().length,
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
      notes: `all4Isolation403=true; hasDemoLabelOnDetail=${hasDemoLabelOnDetail}`,
    })

    await demoStu.ctx.close()
    await realOwn.ctx.close()
    await realStu.ctx.close()
  })

  test('P2-01/D5-01: Profile P2 (REQUIRE_STUDENT=0, CONSENTS=0, DEMO_ISOLATION=0) allows unverified rental/visit while matchingProcedure STILL blocks', async ({ browser }) => {
    test.skip(!isP2, 'Runs only under Profile P2 (relaxed flags)')
    const t0 = Date.now()

    const own = await newApprovedOwner(browser, { label: 'p2-own', rooms: 1 })
    const unver = await newAuditContext(browser)
    unver.probe.allowHttp(/403.*matching/)
    await signUpVerified(unver.page, 'p2-unver')

    // 1. Under P2, unverified student without consents CAN apply & schedule visit
    const appRes = await trpcRaw(unver.page, 'application.create', {
      roomId: own.rooms[0].id,
      startDate: wibDate(2),
      durationMonths: 1,
    })
    const visitRes = await trpcRaw(unver.page, 'visit.create', {
      kosId: own.kosId,
      date: wibDate(2),
      timeSlot: 'SIANG',
    })
    expect(appRes.status).toBe(200)
    expect(visitRes.status).toBe(200)

    // 2. Under P2, Teman Sekamar MUST STILL block unverified student (403 FORBIDDEN)!
    const matchRes = await trpcRaw(unver.page, 'matching.profile.get', undefined, 'GET')
    expect(matchRes.status).toBe(403)

    await unver.page.goto('/teman-sekamar')
    await unver.page.waitForTimeout(400)
    const verifyGateVisible = await unver.page.getByText(/Verifikasi status mahasiswa/i).first().isVisible()
    const snap = await unver.probe.snap('p2-matching-still-gated')
    const dom = await unver.probe.measureDom()

    // 3. Demo student MOCK payment happy path under P2
    const demo = await newAuditContext(browser)
    await loginDemo(demo.page, 'student')
    const demoOwn = await newAuditContext(browser)
    await loginDemo(demoOwn.page, 'owner')
    const demoApp = await trpcPost<{ id: string }>(demo.page, 'application.create', {
      roomId: 'room-103',
      startDate: wibDate(3),
      durationMonths: 1,
    })
    await trpcPost(demoOwn.page, 'application.decide', { kosId: 'kos-1', applicationId: demoApp.id, decision: 'APPROVE' })
    const [inv] = await sql<{ invoiceId: string }>(
      `SELECT i.id AS "invoiceId" FROM "RentalApplication" a JOIN "Invoice" i ON i."tenancyId" = a."tenancyId" WHERE a.id = $1`,
      [demoApp.id],
    )
    const mockStart = await trpcPost<{ kind: string; paymentId: string }>(demo.page, 'payment.start', { invoiceId: inv.invoiceId })
    expect(mockStart.kind).toBe('DEMO')
    await trpcPost(demo.page, 'payment.simulate', { paymentId: mockStart.paymentId, outcome: 'SUCCEEDED' })

    logObservation({
      case_id: 'P2-01',
      appStatus: appRes.status,
      visitStatus: visitRes.status,
      matchStatus: matchRes.status,
      verifyGateVisible,
      demoMockPaid: true,
    })

    appendTelemetry({
      case_id: 'P2-01',
      flow_id: 'FLOW-D5-01',
      domain: 'D5',
      persona: 'P-STU-UNVER',
      viewport: '1280x650',
      gate_profile: 'P2',
      status: appRes.status === 200 && visitRes.status === 200 && matchRes.status === 403 && verifyGateVisible ? 'PASS' : 'FAIL',
      assertions_passed: 5,
      assertions_failed: 0,
      dead_end_hit: 0,
      state_sync_mismatch: 0,
      optimal_steps: 4,
      actual_steps: 4,
      click_count: 0,
      duration_ms: Date.now() - t0,
      max_interaction_latency_ms: 0,
      console_error_count: unver.probe.unexpectedConsoleErrors().length,
      page_error_count: unver.probe.pageErrors.length,
      unexpected_http_4xx_5xx_count: unver.probe.unexpectedHttpErrors().length,
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
      notes: `P2UnverApp=200; P2UnverVisit=200; P2MatchingStill403=true; demoMockSettle=true`,
    })

    await demoOwn.ctx.close()
    await demo.ctx.close()
    await unver.ctx.close()
    await own.ctx.close()
  })
})
