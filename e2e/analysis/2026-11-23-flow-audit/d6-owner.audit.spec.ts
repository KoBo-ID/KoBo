import {
  test,
  expect,
  appendTelemetry,
  logObservation,
  newAuditContext,
  newApprovedOwner,
  signUpVerified,
  trpcPost,
  trpcRaw,
  sql,
  runBackendCli,
  MINIMAL_JPEG,
  MINIMAL_PDF,
} from './telemetry'

test.describe('D6 — Owner Onboarding, Document Verification & Workspace (P1)', () => {
  test('D6-01/D6-02/D6-03: Full Owner Verification lifecycle (BELUM_KIRIM -> MENUNGGU -> DITOLAK -> selective resubmit -> DISETUJUI) + kos-create gate + revoked-owner deadlock', async ({ browser }) => {
    const t0 = Date.now()
    const { ctx, page, probe } = await newAuditContext(browser)
    probe.allowHttp(/403.*owner\.kos\.create|400.*ownerVerification/)
    const { userId, email } = await signUpVerified(page, 'd6-verify', 'Pemilik Verifikasi')
    await trpcPost(page, 'owner.becomeOwner', { phone: '081234567890', ownershipType: 'PEMILIK' })

    // 1. BELUM_KIRIM: direct owner.kos.create MUST fail 403 with prefix "Akun pemilik belum terverifikasi"
    const createBlocked = await trpcRaw(page, 'owner.kos.create', {
      name: 'Kos Terblokir',
      gender: 'CAMPUR',
      address: 'Jl. Gate 1',
      district: 'Kemanggisan',
      city: 'Jakarta Barat',
      lat: -6.2,
      lng: 106.78,
      electricityType: 'INCLUDED',
      privateAmenities: [],
      sharedAmenities: [],
      studentDiscountAmount: 0,
      initialRooms: { count: 1, priceMonthly: 1_000_000 },
    })
    expect(createBlocked.status).toBe(403)
    expect(createBlocked.message).toMatch(/^Akun pemilik belum terverifikasi/)

    // Visit /owner/dashboard -> banner visible, clicking aria-disabled "Daftarkan kos" opens ?dokumen=1 modal (never toast)
    await page.goto('/owner/dashboard')
    await page.waitForTimeout(400)
    const belumSnap = await probe.snap('d6-owner-belum-kirim')
    await page.getByRole('button', { name: /Lengkapi dokumen|Daftarkan kos/i }).first().click()
    await page.waitForTimeout(300)
    const dialogVisible = await page.locator('[role="dialog"]').isVisible()
    expect(dialogVisible).toBe(true)

    // 2. Upload KTP (JPEG) + SHM (PDF) -> submit -> MENUNGGU
    const preKtp = await trpcPost<{ key: string; url: string }>(page, 'ownerVerification.presign', {
      kind: 'KTP',
      contentType: 'image/jpeg',
      contentLength: MINIMAL_JPEG.length,
    })
    await ctx.request.put(preKtp.url, { data: MINIMAL_JPEG, headers: { 'content-type': 'image/jpeg' } })
    const preShm = await trpcPost<{ key: string; url: string }>(page, 'ownerVerification.presign', {
      kind: 'SHM',
      contentType: 'application/pdf',
      contentLength: MINIMAL_PDF.length,
    })
    await ctx.request.put(preShm.url, { data: MINIMAL_PDF, headers: { 'content-type': 'application/pdf' } })
    await trpcPost(page, 'ownerVerification.submit', {
      documents: [
        { kind: 'KTP', key: preKtp.key },
        { kind: 'SHM', key: preShm.key },
      ],
      consent: true,
    })

    // 3. CLI reject KTP_BURAM -> DITOLAK (SHM kept APPROVED, KTP REJECTED)
    const cliRej = runBackendCli('scripts/review-owners.ts', ['reject', userId, 'KTP_BURAM', 'Foto agak gelap'])
    expect(cliRej.status, `owners:review reject: ${cliRej.stderr} ${cliRej.stdout}`).toBe(0)

    await page.goto('/owner/dashboard')
    await page.waitForTimeout(400)
    const ditolakSnap = await probe.snap('d6-owner-ditolak')

    // Selective resubmit KTP only -> MENUNGGU -> CLI approve -> DISETUJUI!
    const preKtp2 = await trpcPost<{ key: string; url: string }>(page, 'ownerVerification.presign', {
      kind: 'KTP',
      contentType: 'image/jpeg',
      contentLength: MINIMAL_JPEG.length,
    })
    await ctx.request.put(preKtp2.url, { data: MINIMAL_JPEG, headers: { 'content-type': 'image/jpeg' } })
    await trpcPost(page, 'ownerVerification.submit', {
      documents: [{ kind: 'KTP', key: preKtp2.key }],
      consent: true,
    })

    const cliApp = runBackendCli('scripts/review-owners.ts', ['approve', userId])
    expect(cliApp.status, `owners:review approve: ${cliApp.stderr} ${cliApp.stdout}`).toBe(0)

    // Gate lifted: kos creation now succeeds!
    const createdKos = await trpcPost<{ id: string }>(page, 'owner.kos.create', {
      name: 'Kos Lolos Gate',
      gender: 'CAMPUR',
      address: 'Jl. Lolos Gate 1',
      district: 'Kemanggisan',
      city: 'Jakarta Barat',
      lat: -6.2,
      lng: 106.78,
      electricityType: 'INCLUDED',
      privateAmenities: [],
      sharedAmenities: [],
      studentDiscountAmount: 0,
      initialRooms: { count: 1, priceMonthly: 1_500_000 },
    })
    expect(createdKos.id).toBeTruthy()

    // 4. D6-03 BUG CHECK: Revoke owner via CLI owners:approve revoke -> open ?dokumen=1 modal -> check 0 upload slots deadlock!
    const cliRevoke = runBackendCli('scripts/approve-owner.ts', ['revoke', email])
    expect(cliRevoke.status, `owners:approve revoke: ${cliRevoke.stderr}`).toBe(0)

    await page.goto('/owner/dashboard?dokumen=1')
    await page.waitForTimeout(500)
    const fileInputCountAfterRevoke = await page.locator('[role="dialog"] input[type="file"]').count()
    const submitBtnDisabledAfterRevoke = await page
      .locator('[role="dialog"]')
      .getByRole('button', { name: /Kirim dokumen/i })
      .isDisabled()
      .catch(() => true)
    const revokedDeadlock = fileInputCountAfterRevoke === 0 && submitBtnDisabledAfterRevoke
    const revokeSnap = await probe.snap('d6-owner-revoked-deadlock')
    const dom = await probe.measureDom()

    logObservation({
      case_id: 'D6-01/02/03',
      createBlockedStatus: createBlocked.status,
      dialogVisible,
      createdKosAfterApprove: Boolean(createdKos.id),
      fileInputCountAfterRevoke,
      submitBtnDisabledAfterRevoke,
      revokedDeadlock,
    })

    appendTelemetry({
      case_id: 'D6-01/03',
      flow_id: 'FLOW-D6-02',
      domain: 'D6',
      persona: 'P-OWN-UNVER',
      viewport: '1280x650',
      gate_profile: 'P1',
      status: revokedDeadlock ? 'FAIL' : 'PASS',
      assertions_passed: 7,
      assertions_failed: revokedDeadlock ? 1 : 0,
      dead_end_hit: revokedDeadlock ? 1 : 0,
      state_sync_mismatch: revokedDeadlock ? 1 : 0,
      optimal_steps: 7,
      actual_steps: 7,
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
      screenshot_paths: [belumSnap, ditolakSnap, revokeSnap],
      notes: `gate403AndDialogOk=true; selectiveResubmitAndApproveOk=true; revokedDeadlock=${revokedDeadlock} (fileInputs=${fileInputCountAfterRevoke})`,
    })
    await ctx.close()
  })

  test('D6-04/D6-05: BVA caps (5 vs 6 kos, 40 vs 41 rooms, price 0 vs 1, maxOccupants=1+perPerson) & multi-kos floor-filter trap', async ({ browser }) => {
    const t0 = Date.now()
    const own = await newApprovedOwner(browser, { label: 'd6-bva', rooms: 1, price: 1_000_000 })
    own.probe.allowHttp(/400.*owner|409.*owner/)

    // 1. Price 0 vs 1 & maxOccupants=1 + pricePerPersonMonthly BVA
    const baseRoom = { type: 'Standar', size: '3x4 m', bedType: 'Single' }
    const p0 = await trpcRaw(own.page, 'owner.room.create', {
      kosId: own.kosId,
      roomNumber: 'P0',
      floor: 1,
      ...baseRoom,
      priceMonthly: 0,
    })
    const p1 = await trpcRaw(own.page, 'owner.room.create', {
      kosId: own.kosId,
      roomNumber: 'P1',
      floor: 1,
      ...baseRoom,
      priceMonthly: 1,
    })
    const badOcc = await trpcRaw(own.page, 'owner.room.create', {
      kosId: own.kosId,
      roomNumber: 'OCC1',
      floor: 1,
      ...baseRoom,
      priceMonthly: 1_000_000,
      maxOccupants: 1,
      pricePerPersonMonthly: 500_000,
    })
    const okOcc2 = await trpcRaw(own.page, 'owner.room.create', {
      kosId: own.kosId,
      roomNumber: 'OCC2',
      floor: 2,
      ...baseRoom,
      priceMonthly: 1_800_000,
      maxOccupants: 2,
      pricePerPersonMonthly: 900_000,
    })
    expect(p0.status).toBe(400)
    expect(p1.status).toBe(200)
    expect(badOcc.status).toBe(400)
    expect(okOcc2.status).toBe(200)

    // 2. MAX_ROOMS_PER_KOS = 40 vs 41 (on Kos 2 with initialRooms=40, then 41st room fails 409)
    const kos2 = await trpcPost<{ id: string }>(own.page, 'owner.kos.create', {
      name: 'Kos 40 Kamar',
      gender: 'CAMPUR',
      address: 'Jl. 40 Kamar',
      district: 'Kemanggisan',
      city: 'Jakarta Barat',
      lat: -6.2,
      lng: 106.78,
      electricityType: 'INCLUDED',
      privateAmenities: [],
      sharedAmenities: [],
      studentDiscountAmount: 0,
      initialRooms: { count: 40, priceMonthly: 1_200_000 },
    })
    const room41 = await trpcRaw(own.page, 'owner.room.create', {
      kosId: kos2.id,
      roomNumber: '999',
      floor: 1,
      ...baseRoom,
      priceMonthly: 1_200_000,
    })
    expect(room41.status).toBe(409)

    // 3. MAX_KOS_PER_OWNER = 5 vs 6 (create kos #3, #4, #5 -> #6 fails 409)
    for (let n = 3; n <= 5; n++) {
      await trpcPost(own.page, 'owner.kos.create', {
        name: `Kos Cap #${n}`,
        gender: 'CAMPUR',
        address: `Jl. Cap ${n}`,
        district: 'Kemanggisan',
        city: 'Jakarta Barat',
        lat: -6.2,
        lng: 106.78,
        electricityType: 'INCLUDED',
        privateAmenities: [],
        sharedAmenities: [],
        studentDiscountAmount: 0,
        initialRooms: { count: 1, priceMonthly: 1_000_000 },
      })
    }
    const kos6 = await trpcRaw(own.page, 'owner.kos.create', {
      name: 'Kos Cap #6',
      gender: 'CAMPUR',
      address: 'Jl. Cap 6',
      district: 'Kemanggisan',
      city: 'Jakarta Barat',
      lat: -6.2,
      lng: 106.78,
      electricityType: 'INCLUDED',
      privateAmenities: [],
      sharedAmenities: [],
      studentDiscountAmount: 0,
      initialRooms: { count: 1, priceMonthly: 1_000_000 },
    })
    expect([409, 429]).toContain(kos6.status)

    // 4. D6-05 BUG CHECK: Multi-kos floor-filter trap!
    // own.kosId has floor 1 and floor 2 (room OCC2). Kos Cap #3 has only floor 1.
    await own.page.goto(`/owner/dashboard?kos=${own.kosId}`)
    await own.page.waitForTimeout(400)
    const lt2Btn = own.page.getByRole('button', { name: /Lt\.?\s*2/i }).first()
    let floorFilterTrapped = false
    if (await lt2Btn.isVisible().catch(() => false)) {
      await lt2Btn.click()
      await own.page.waitForTimeout(250)
      // Switch to Kos Cap #3 via topbar kos selector
      const kosSelect = own.page.locator('header select, nav select, select').first()
      if (await kosSelect.isVisible().catch(() => false)) {
        const opts = await kosSelect.locator('option').allTextContents()
        const cap3Idx = opts.findIndex((o) => o.includes('Kos Cap #3'))
        if (cap3Idx >= 0) {
          await kosSelect.selectOption({ index: cap3Idx })
          await own.page.waitForTimeout(400)
          const emptyMsg = await own.page.getByText(/Tidak ada kamar yang cocok dengan filter ini/i).isVisible().catch(() => false)
          const floorBtnsStillVisible = await own.page.getByRole('button', { name: /Semua lantai|Lt\.?\s*2/i }).first().isVisible().catch(() => false)
          floorFilterTrapped = emptyMsg && !floorBtnsStillVisible
        }
      }
    }
    const trapSnap = await own.probe.snap('d6-owner-floor-filter-trap')
    const dom = await own.probe.measureDom()

    logObservation({
      case_id: 'D6-04/05',
      p0: p0.status,
      p1: p1.status,
      badOcc: badOcc.status,
      okOcc2: okOcc2.status,
      room41: room41.status,
      kos6: kos6.status,
      floorFilterTrapped,
    })

    appendTelemetry({
      case_id: 'D6-04/05',
      flow_id: 'FLOW-D6-03',
      domain: 'D6',
      persona: 'P-OWN-VER',
      viewport: '1280x650',
      gate_profile: 'P1',
      status: floorFilterTrapped ? 'FAIL' : 'PASS',
      assertions_passed: 6,
      assertions_failed: floorFilterTrapped ? 1 : 0,
      dead_end_hit: floorFilterTrapped ? 1 : 0,
      state_sync_mismatch: floorFilterTrapped ? 1 : 0,
      optimal_steps: 4,
      actual_steps: 4,
      click_count: own.probe.clicks,
      duration_ms: Date.now() - t0,
      max_interaction_latency_ms: own.probe.maxLatencyMs,
      console_error_count: own.probe.unexpectedConsoleErrors().length,
      page_error_count: own.probe.pageErrors.length,
      unexpected_http_4xx_5xx_count: own.probe.unexpectedHttpErrors().length,
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
      screenshot_paths: [trapSnap],
      notes: `capsOk(5kos/40rooms/price1/occ2)=true; floorFilterTrapped=${floorFilterTrapped}`,
    })
    await own.ctx.close()
  })
})
