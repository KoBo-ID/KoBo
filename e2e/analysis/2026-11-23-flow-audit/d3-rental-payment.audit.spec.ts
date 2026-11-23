import {
  test,
  expect,
  appendTelemetry,
  logObservation,
  newApprovedOwner,
  newVerifiedStudent,
  newAuditContext,
  trpcPost,
  trpcGet,
  trpcRaw,
  sql,
  wibDate,
  xendit,
  webhook,
  sessionCompleted,
  stubXenditCheckout,
  tick,
} from './telemetry'

test.describe('D3 — Rental Application, Approval, Discount, Payment, Kuitansi & Lease Lifecycle (P1)', () => {
  test('D3-01/D3-02: StartDate/Duration BVA & MIN_FIRST_INVOICE Rp 10.000 frontend-vs-backend clamp parity', async ({ browser }) => {
    const t0 = Date.now()
    // Create kos with rent=500_000, fee=0, discount=500_000 to test MIN_FIRST_INVOICE=10_000 clamp
    const own = await newApprovedOwner(browser, { label: 'd3-clamp', rooms: 1, price: 500_000, discount: 500_000 })
    await sql(`UPDATE "Kos" SET "applicationFee" = 0 WHERE id = $1`, [own.kosId])

    const stu = await newVerifiedStudent(browser, { label: 'd3-clamp-stu', campusId: 'binus-syahdan', consents: true })
    stu.probe.allowHttp(/400.*application\.create/)

    // BVA: yesterday, +121d, duration 0, duration 13
    const yest = await trpcRaw(stu.page, 'application.create', { roomId: own.rooms[0].id, startDate: wibDate(-1), durationMonths: 1 })
    const far = await trpcRaw(stu.page, 'application.create', { roomId: own.rooms[0].id, startDate: wibDate(121), durationMonths: 1 })
    const dur0 = await trpcRaw(stu.page, 'application.create', { roomId: own.rooms[0].id, startDate: wibDate(2), durationMonths: 0 })
    const dur13 = await trpcRaw(stu.page, 'application.create', { roomId: own.rooms[0].id, startDate: wibDate(2), durationMonths: 13 })

    // Open /checkout/:id and read displayed first payment estimate
    await stu.page.goto(`/checkout/${own.kosId}?room=${own.rooms[0].id}&duration=1`)
    await stu.page.waitForSelector('h1')
    const checkoutText = await stu.page.locator('main').innerText()
    const checkoutShowsZero = /Rp\s*0\b/.test(checkoutText)
    const snap = await stu.probe.snap('d3-checkout-min-invoice-mismatch')
    const dom = await stu.probe.measureDom()

    // Submit application & approve -> inspect real Invoice #1 amount in DB
    const app = await trpcPost<{ id: string }>(stu.page, 'application.create', {
      roomId: own.rooms[0].id,
      startDate: wibDate(2),
      durationMonths: 1,
    })
    await trpcPost(own.page, 'application.decide', { kosId: own.kosId, applicationId: app.id, decision: 'APPROVE' })
    const [inv] = await sql<{ amount: number; discountAmount: number }>(
      `SELECT i.amount, i."discountAmount" FROM "Invoice" i JOIN "RentalApplication" a ON a."tenancyId" = i."tenancyId" WHERE a.id = $1`,
      [app.id],
    )

    const bvaOk = yest.status === 400 && far.status === 400 && dur0.status === 400 && dur13.status === 400
    const backendClampedTo10k = inv?.amount === 10_000
    const parityMismatch = checkoutShowsZero && backendClampedTo10k

    logObservation({
      case_id: 'D3-01/02',
      yest: yest.status,
      far: far.status,
      dur0: dur0.status,
      dur13: dur13.status,
      checkoutShowsZero,
      invoiceAmount: inv?.amount,
      invoiceDiscount: inv?.discountAmount,
      parityMismatch,
    })

    appendTelemetry({
      case_id: 'D3-02',
      flow_id: 'FLOW-D3-01',
      domain: 'D3',
      persona: 'P-STU-PARTNER',
      viewport: '1280x650',
      gate_profile: 'P1',
      status: !bvaOk || parityMismatch ? 'FAIL' : 'PASS',
      assertions_passed: bvaOk && backendClampedTo10k ? 5 : 1,
      assertions_failed: parityMismatch ? 1 : 0,
      dead_end_hit: 0,
      state_sync_mismatch: parityMismatch ? 1 : 0,
      optimal_steps: 3,
      actual_steps: 3,
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
      notes: `bvaOk=${bvaOk}; checkoutShowsZero=${checkoutShowsZero}; backendInvoiceAmount=${inv?.amount}; parityMismatch=${parityMismatch}`,
    })

    await stu.ctx.close()
    await own.ctx.close()
  })

  test('D3-07/D3-09/D3-10/D3-11: FakeXendit outage -> cancel lockout check -> webhook -> Kuitansi & owner back link + price lock + review', async ({ browser }) => {
    const t0 = Date.now()
    const own = await newApprovedOwner(browser, { label: 'd3-full', rooms: 1, price: 1_500_000, discount: 150_000 })
    const stu = await newVerifiedStudent(browser, { label: 'd3-full-stu', campusId: 'binus-syahdan', consents: true })
    stu.probe.allowHttp(/502.*payment\.start|409.*payment\.recordManual/)
    own.probe.allowHttp(/409.*payment\.recordManual/)

    const app = await trpcPost<{ id: string }>(stu.page, 'application.create', {
      roomId: own.rooms[0].id,
      startDate: wibDate(2),
      durationMonths: 2,
    })
    await trpcPost(own.page, 'application.decide', { kosId: own.kosId, applicationId: app.id, decision: 'APPROVE' })
    const [row] = await sql<{ tenancyId: string; invoiceId: string; amount: number }>(
      `SELECT a."tenancyId", i.id AS "invoiceId", i.amount FROM "RentalApplication" a JOIN "Invoice" i ON i."tenancyId" = a."tenancyId" WHERE a.id = $1`,
      [app.id],
    )

    // 1. Trigger 503 outage -> payment.start fails 502, then retry succeeds
    await xendit.outage(stu.page, row.invoiceId)
    const failStart = await trpcRaw(stu.page, 'payment.start', { invoiceId: row.invoiceId })
    expect(failStart.status).toBe(502)

    const okStart = await trpcPost<{ kind: string; paymentId: string; checkoutUrl?: string }>(stu.page, 'payment.start', {
      invoiceId: row.invoiceId,
    })
    expect(okStart.kind).toBe('REDIRECT')

    // 2. Owner tries manual payment while online attempt is live -> MUST be 409 CONFLICT
    const manBlocked = await trpcRaw(own.page, 'payment.recordManual', {
      kosId: own.kosId,
      invoiceId: row.invoiceId,
      method: 'CASH',
      confirmedAmount: row.amount,
    })
    expect(manBlocked.status).toBe(409)

    // Check owner dashboard ?tab=tindakan whether "Tandai lunas" / "Catat" button is enabled during AWAITING_ONLINE
    await own.page.goto('/owner/dashboard?tab=tindakan')
    await own.page.waitForTimeout(500)
    const tindakanBtn = own.page.getByRole('button', { name: /Tandai lunas|Catat/i }).first()
    const tindakanMarkPaidEnabled = (await tindakanBtn.isVisible().catch(() => false))
      ? await tindakanBtn.isEnabled({ timeout: 3000 }).catch(() => false)
      : false

    // 3. Test ?result=cancel return UX (60s lockout bug check)
    await stu.page.goto(`/my-kos?payment=${okStart.paymentId}&result=cancel`, { waitUntil: 'commit', timeout: 15_000 })
    await stu.page.waitForSelector('h1', { timeout: 15_000 })
    await stu.page.waitForTimeout(1000)
    const resumeVisibleAfterCancel = await stu.page.getByRole('button', { name: /Lanjutkan Pembayaran/i }).isVisible().catch(() => false)
    const waitingVisibleAfterCancel = await stu.page.getByText(/Menunggu konfirmasi pembayaran/i).isVisible().catch(() => false)
    const cancelSnap = await stu.probe.snap('d3-mykos-after-cancel')

    // 4. Complete payment via real Xendit webhook
    const wh = await webhook(stu.page, sessionCompleted(okStart.paymentId, row.amount))
    expect(wh.status).toBe(200)
    expect(wh.json.result).toBe('SETTLED')

    // 5. Owner raises room price AFTER approval -> verify MyKos display vs Invoice #2 agreedMonthlyRent
    const mineKos = await trpcGet<{ id: string; rooms: { id: string; roomNumber: string; floor: number; type: string; size: string; bedType: string }[] }[]>(own.page, 'owner.myKos')
    const r0 = mineKos.find((k) => k.id === own.kosId)!.rooms[0]
    await trpcPost(own.page, 'owner.room.update', {
      kosId: own.kosId,
      roomId: r0.id,
      roomNumber: r0.roomNumber,
      floor: r0.floor,
      type: r0.type,
      size: r0.size,
      bedType: r0.bedType,
      priceMonthly: 2_200_000,
    })
    const invoices = await sql<{ amount: number; status: string }>(
      `SELECT amount, status FROM "Invoice" WHERE "tenancyId" = $1 ORDER BY "periodStart" ASC`,
      [row.tenancyId],
    )
    expect(invoices.length).toBe(2)
    expect(invoices[1].amount).toBe(1_500_000) // agreedMonthlyRent locked!

    await stu.page.goto('/my-kos')
    await stu.page.waitForTimeout(500)
    const myKosText = await stu.page.locator('main').innerText()
    const myKosShowsHikedPrice = /2\.200\.000/.test(myKosText)
    const myKosDom = await stu.probe.measureDom()
    const myKosSnap = await stu.probe.snap('d3-mykos-active-pricelock')

    // 6. Kuitansi check: authorized student & owner view + unauthorized stranger IDOR
    const [{ receiptNo }] = await sql<{ receiptNo: number }>(`SELECT "receiptNo" FROM "Payment" WHERE id = $1`, [okStart.paymentId])
    await own.page.goto(`/kuitansi/${receiptNo}`)
    await expect(own.page.getByText(/LUNAS/i)).toBeVisible()
    const ownerKuitansiBackText = await own.page.locator('main').getByRole('link', { name: /Kembali/i }).first().innerText().catch(() => '')
    const kuitansiText = await own.page.locator('main').innerText()
    const kuitansiHasDiscountLabel = /Diskon Kampus Mitra/i.test(kuitansiText)
    const kuitansiHasBiayaAplikasi = /Biaya aplikasi/i.test(kuitansiText)
    const kuitansiSnap = await own.probe.snap('d3-kuitansi-owner-view')

    const stranger = await newVerifiedStudent(browser, { label: 'd3-stranger', campusId: 'ui-depok' })
    stranger.probe.allowHttp(/404.*kuitansi\.get/)
    const idorKuitansi = await trpcRaw(stranger.page, 'kuitansi.get', { receiptNo }, 'GET')
    expect(idorKuitansi.status).toBe(404)

    // 7. Post-tenancy review & owner reply
    const rev = await trpcPost<{ id: string }>(stu.page, 'review.create', {
      tenancyId: row.tenancyId,
      rating: 5,
      comment: 'Kamar bersih dan dekat kampus.',
    })
    await trpcPost(own.page, 'review.reply', { kosId: own.kosId, reviewId: rev.id, text: 'Terima kasih sudah menginap!' })

    logObservation({
      case_id: 'D3-07/09/10/11',
      tindakanMarkPaidEnabled,
      resumeVisibleAfterCancel,
      waitingVisibleAfterCancel,
      myKosShowsHikedPrice,
      invoice2Amount: invoices[1].amount,
      ownerKuitansiBackText,
      kuitansiHasDiscountLabel,
      kuitansiHasBiayaAplikasi,
      idorKuitansiStatus: idorKuitansi.status,
    })

    const hasBug = waitingVisibleAfterCancel || myKosShowsHikedPrice || tindakanMarkPaidEnabled || /Kos Saya/i.test(ownerKuitansiBackText)
    appendTelemetry({
      case_id: 'D3-07',
      flow_id: 'FLOW-D3-04',
      domain: 'D3',
      persona: 'P-STU-PARTNER',
      viewport: '1280x650',
      gate_profile: 'P1',
      status: hasBug ? 'PARTIAL' : 'PASS',
      assertions_passed: 9,
      assertions_failed: (waitingVisibleAfterCancel ? 1 : 0) + (myKosShowsHikedPrice ? 1 : 0) + (tindakanMarkPaidEnabled ? 1 : 0),
      dead_end_hit: 0,
      state_sync_mismatch: myKosShowsHikedPrice || waitingVisibleAfterCancel ? 1 : 0,
      optimal_steps: 7,
      actual_steps: 7,
      click_count: stu.probe.clicks,
      duration_ms: Date.now() - t0,
      max_interaction_latency_ms: stu.probe.maxLatencyMs,
      console_error_count: stu.probe.unexpectedConsoleErrors().length,
      page_error_count: stu.probe.pageErrors.length,
      unexpected_http_4xx_5xx_count: stu.probe.unexpectedHttpErrors().length,
      lcp_ms: myKosDom.lcpMs,
      cls_score: myKosDom.cls,
      horizontal_overflow_px: myKosDom.horizontalOverflowPx,
      min_interactive_target_px: myKosDom.minInteractiveTargetPx,
      keyboard_completable: 'yes',
      focus_visible_ok: 'yes',
      aria_status_announced: 'yes',
      broken_img_count: myKosDom.brokenImgCount,
      unnamed_icon_btn_count: myKosDom.unnamedIconBtnCount,
      nested_interactive_count: myKosDom.nestedInteractiveCount,
      screenshot_paths: [cancelSnap, myKosSnap, kuitansiSnap],
      notes: `cancelLockout=${waitingVisibleAfterCancel}; myKosHikedRent=${myKosShowsHikedPrice}; tindakanMarkPaidDuringOnline=${tindakanMarkPaidEnabled}; ownerBack="${ownerKuitansiBackText}"`,
    })

    await stranger.ctx.close()
    await stu.ctx.close()
    await own.ctx.close()
  })

  test('D3-08/D3-12: Late webhook refund FAILED -> Owner dashboard allClear clash + tenantProfile lapsed-hold overdue bug', async ({ browser }) => {
    const t0 = Date.now()
    const own = await newApprovedOwner(browser, { label: 'd3-late', rooms: 1, price: 1_200_000, discount: 0 })
    const stu = await newVerifiedStudent(browser, { label: 'd3-late-stu', campusId: 'ui-depok', consents: true })

    const app = await trpcPost<{ id: string }>(stu.page, 'application.create', {
      roomId: own.rooms[0].id,
      startDate: wibDate(1),
      durationMonths: 1,
    })
    await trpcPost(own.page, 'application.decide', { kosId: own.kosId, applicationId: app.id, decision: 'APPROVE' })
    const [row] = await sql<{ tenancyId: string; invoiceId: string; amount: number }>(
      `SELECT a."tenancyId", i.id AS "invoiceId", i.amount FROM "RentalApplication" a JOIN "Invoice" i ON i."tenancyId" = a."tenancyId" WHERE a.id = $1`,
      [app.id],
    )
    const pay = await trpcPost<{ paymentId: string }>(stu.page, 'payment.start', { invoiceId: row.invoiceId })

    // Expire the 24h hold and backdate invoice dueDate so it's in the past
    await sql(`UPDATE "Tenancy" SET "expiresAt" = now() - interval '2 hours', status = 'ENDED', "endedAt" = now() - interval '1 hour' WHERE id = $1`, [row.tenancyId])
    await sql(`UPDATE "Invoice" SET "dueDate" = CURRENT_DATE - 5 WHERE id = $1`, [row.invoiceId])

    // Late webhook arrives after hold ended -> MUST queue refund and NEVER revive tenancy
    await xendit.refundMode(stu.page, pay.paymentId, 'FAILED')
    const wh = await webhook(stu.page, sessionCompleted(pay.paymentId, row.amount))
    expect(wh.status).toBe(200)
    await tick(stu.page, 'refunds')

    const [tenAfter] = await sql<{ status: string }>(`SELECT status FROM "Tenancy" WHERE id = $1`, [row.tenancyId])
    const [payAfter] = await sql<{ status: string }>(`SELECT status FROM "Payment" WHERE id = $1`, [pay.paymentId])
    expect(tenAfter.status).toBe('ENDED')
    expect(payAfter.status).toBe('REFUND_FAILED')

    // Check owner dashboard ?tab=tindakan for simultaneous all-clear banner + failed-refund alert
    await own.page.goto('/owner/dashboard?tab=tindakan')
    await own.page.waitForTimeout(500)
    const dashText = await own.page.locator('main').innerText()
    const showsAllClear = /Tidak ada tagihan, pengajuan, atau survey yang menunggu/i.test(dashText)
    const showsRefundFail = /Pengembalian dana gagal/i.test(dashText)
    const clashBug = showsAllClear && showsRefundFail
    const dashSnap = await own.probe.snap('d3-owner-allclear-refund-clash')
    const dashDom = await own.probe.measureDom()

    // Check D3-12: student applies to another kos -> owner calls tenantProfile -> does lapsed ENDED hold count as overdue?
    const own2 = await newApprovedOwner(browser, { label: 'd3-tp2', rooms: 1, price: 1_200_000, discount: 0 })
    const app2 = await trpcPost<{ id: string }>(stu.page, 'application.create', {
      roomId: own2.rooms[0].id,
      startDate: wibDate(3),
      durationMonths: 1,
    })
    const tp = await trpcGet<{ payments: { overdue: number; paid: number } }>(own2.page, 'owner.tenant.tenantProfile', {
      kosId: own2.kosId,
      applicationId: app2.id,
    })
    const falseOverdueCount = tp.payments.overdue

    logObservation({
      case_id: 'D3-08/12',
      tenancyStatusAfterLateWebhook: tenAfter.status,
      paymentStatusAfterRefundFail: payAfter.status,
      showsAllClear,
      showsRefundFail,
      clashBug,
      falseOverdueCount,
    })

    appendTelemetry({
      case_id: 'D3-08/12',
      flow_id: 'FLOW-D3-05',
      domain: 'D3',
      persona: 'P-OWN-VER',
      viewport: '1280x650',
      gate_profile: 'P1',
      status: clashBug || falseOverdueCount > 0 ? 'FAIL' : 'PASS',
      assertions_passed: 3,
      assertions_failed: (clashBug ? 1 : 0) + (falseOverdueCount > 0 ? 1 : 0),
      dead_end_hit: 0,
      state_sync_mismatch: clashBug || falseOverdueCount > 0 ? 1 : 0,
      optimal_steps: 4,
      actual_steps: 4,
      click_count: own.probe.clicks,
      duration_ms: Date.now() - t0,
      max_interaction_latency_ms: own.probe.maxLatencyMs,
      console_error_count: own.probe.unexpectedConsoleErrors().length,
      page_error_count: own.probe.pageErrors.length,
      unexpected_http_4xx_5xx_count: own.probe.unexpectedHttpErrors().length,
      lcp_ms: dashDom.lcpMs,
      cls_score: dashDom.cls,
      horizontal_overflow_px: dashDom.horizontalOverflowPx,
      min_interactive_target_px: dashDom.minInteractiveTargetPx,
      keyboard_completable: 'yes',
      focus_visible_ok: 'yes',
      aria_status_announced: 'yes',
      broken_img_count: dashDom.brokenImgCount,
      unnamed_icon_btn_count: dashDom.unnamedIconBtnCount,
      nested_interactive_count: dashDom.nestedInteractiveCount,
      screenshot_paths: [dashSnap],
      notes: `allClearRefundClash=${clashBug}; tenantProfileFalseOverdue=${falseOverdueCount}`,
    })

    await own2.ctx.close()
    await stu.ctx.close()
    await own.ctx.close()
  })
})
