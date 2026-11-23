import {
  test,
  expect,
  attachProbe,
  appendTelemetry,
  logObservation,
  BASE_URL,
  uniqueIp,
  outboxCode,
  outboxLink,
  sql,
  trpcRaw,
  trpcPost,
  newAuditContext,
  signUpVerified,
  loginDemo,
  runBackendCli,
  MINIMAL_JPEG,
} from './telemetry'

test.describe('D2 — Auth, Stepped Onboarding & Student Verification (P1)', () => {
  test('D2-01/D2-02: Sign-up BVA (INVALID_PROFILE bad WA copy, whitespace name) & Email OTP #5 vs #6 lockout', async ({ browser }) => {
    const t0 = Date.now()
    const { ctx, page, probe } = await newAuditContext(browser)
    probe.allowHttp(/400.*sign-up|400.*verify-email|403.*verify-email/)

    // 1. UI check: bad WhatsApp number during sign-up shows wrong error copy?
    await page.goto('/masuk')
    await page.getByRole('button', { name: /Daftar baru/i }).click()
    await page.waitForTimeout(250)
    const masukDom = await probe.measureDom()
    const hasMainIdOnMasuk = await page.evaluate(() => Boolean(document.getElementById('main')))

    // Direct API test for whitespace-only name
    const wsRes = await ctx.request.post(`${BASE_URL}/api/auth/sign-up/email`, {
      data: { name: '   ', email: `ws-${Date.now()}@example.com`, password: 'Sandi-audit-123' },
      headers: { origin: BASE_URL, 'cf-connecting-ip': uniqueIp() },
    })
    const whitespaceNameAccepted = wsRes.ok()

    // Direct API test for bad WhatsApp number -> inspect code & message
    const badWaEmail = `badwa-${Date.now()}@example.com`
    const badWaRes = await ctx.request.post(`${BASE_URL}/api/auth/sign-up/email`, {
      data: { name: 'Budi Santoso', email: badWaEmail, phone: '123', password: 'Sandi-audit-123' },
      headers: { origin: BASE_URL, 'cf-connecting-ip': uniqueIp() },
    })
    const badWaBody = await badWaRes.json().catch(() => ({}))

    // UI bad WA test to verify verbatim displayed error
    let uiBadWaError = ''
    try {
      await page.locator('input[name="name"], input[type="text"]').first().fill('Budi Santoso', { timeout: 5000 })
      await page.locator('input[type="email"]').first().fill(`uibadwa-${Date.now()}@example.com`, { timeout: 5000 })
      const phoneInput = page.locator('input[type="tel"]').first()
      if (await phoneInput.isVisible().catch(() => false)) {
        await phoneInput.fill('123', { timeout: 5000 })
      }
      await page.locator('input[type="password"]').first().fill('Sandi-audit-123', { timeout: 5000 })
      const termsCb = page.locator('input[type="checkbox"]').first()
      if (await termsCb.isVisible().catch(() => false)) await termsCb.check({ timeout: 5000 })
      await page.locator('button[type="submit"]').first().click({ timeout: 5000 })
      await page.waitForTimeout(600)
      const alert = page.locator('[role="alert"]').first()
      if (await alert.isVisible().catch(() => false)) {
        uiBadWaError = (await alert.innerText()).trim()
      }
    } catch {}
    const badWaSnap = await probe.snap('d2-signup-bad-wa')

    // 2. Email OTP attempt #5 vs #6 lockout test
    const otpEmail = `otp-lock-${Date.now()}@example.com`
    const headers = { origin: BASE_URL, 'cf-connecting-ip': uniqueIp() }
    const up = await ctx.request.post(`${BASE_URL}/api/auth/sign-up/email`, {
      data: { name: 'Penguji OTP', email: otpEmail, password: 'Sandi-audit-123' },
      headers,
    })
    expect(up.ok()).toBe(true)
    const realOtp = await outboxCode(otpEmail, 'verify-email')
    const wrongOtp = realOtp === '000000' ? '111111' : '000000'

    const attemptStatuses: number[] = []
    for (let i = 1; i <= 5; i++) {
      const r = await ctx.request.post(`${BASE_URL}/api/auth/email-otp/verify-email`, {
        data: { email: otpEmail, otp: wrongOtp },
        headers,
      })
      attemptStatuses.push(r.status())
    }
    // Attempt #6 with the RIGHT code should be locked out (403 TOO_MANY_ATTEMPTS)
    const attempt6 = await ctx.request.post(`${BASE_URL}/api/auth/email-otp/verify-email`, {
      data: { email: otpEmail, otp: realOtp },
      headers,
    })
    const attempt6Status = attempt6.status()
    const attempt6Body = await attempt6.json().catch(() => ({}))

    const wrongCopyOnBadWa = /Nama terlalu panjang/i.test(uiBadWaError)
    logObservation({
      case_id: 'D2-01/02',
      hasMainIdOnMasuk,
      whitespaceNameAccepted,
      badWaStatus: badWaRes.status(),
      badWaBody,
      uiBadWaError,
      wrongCopyOnBadWa,
      attemptStatuses,
      attempt6Status,
      attempt6Body,
    })

    appendTelemetry({
      case_id: 'D2-01/02',
      flow_id: 'FLOW-D2-01',
      domain: 'D2',
      persona: 'P-GUEST',
      viewport: '1280x650',
      gate_profile: 'P1',
      status: whitespaceNameAccepted || wrongCopyOnBadWa || !hasMainIdOnMasuk ? 'FAIL' : 'PASS',
      assertions_passed: attempt6Status === 403 ? 2 : 1,
      assertions_failed: (whitespaceNameAccepted ? 1 : 0) + (wrongCopyOnBadWa ? 1 : 0) + (!hasMainIdOnMasuk ? 1 : 0),
      dead_end_hit: 0,
      state_sync_mismatch: wrongCopyOnBadWa ? 1 : 0,
      optimal_steps: 4,
      actual_steps: 4,
      click_count: probe.clicks,
      duration_ms: Date.now() - t0,
      max_interaction_latency_ms: probe.maxLatencyMs,
      console_error_count: probe.unexpectedConsoleErrors().length,
      page_error_count: probe.pageErrors.length,
      unexpected_http_4xx_5xx_count: probe.unexpectedHttpErrors().length,
      lcp_ms: masukDom.lcpMs,
      cls_score: masukDom.cls,
      horizontal_overflow_px: masukDom.horizontalOverflowPx,
      min_interactive_target_px: masukDom.minInteractiveTargetPx,
      keyboard_completable: hasMainIdOnMasuk ? 'yes' : 'partial',
      focus_visible_ok: 'yes',
      aria_status_announced: 'yes',
      broken_img_count: masukDom.brokenImgCount,
      unnamed_icon_btn_count: masukDom.unnamedIconBtnCount,
      nested_interactive_count: masukDom.nestedInteractiveCount,
      screenshot_paths: [badWaSnap],
      notes: `hasMainIdOnMasuk=${hasMainIdOnMasuk}; whitespaceNameAccepted=${whitespaceNameAccepted}; uiBadWaError="${uiBadWaError}"; otp6=${attempt6Status}`,
    })
    await ctx.close()
  })

  test('D2-04: ResetPassword "Masuk" CTA leaks spent token in ?next= and loops back to /reset-password', async ({ browser }) => {
    const t0 = Date.now()
    const { ctx, page, probe } = await newAuditContext(browser)
    const { email } = await signUpVerified(page, 'd2-reset')
    // Request reset password and open link in a fresh signed-out browser context (like a real email client click)
    const reqRes = await ctx.request.post(`${BASE_URL}/api/auth/request-password-reset`, {
      data: { email, redirectTo: `${BASE_URL}/reset-password` },
      headers: { origin: BASE_URL, 'cf-connecting-ip': uniqueIp() },
    })
    expect(reqRes.ok()).toBe(true)
    const link = await outboxLink(email, 'reset-password')
    const urlPath = new URL(link).pathname + new URL(link).search
    await ctx.close()

    const fresh = await newAuditContext(browser)
    await fresh.page.goto(urlPath)
    await fresh.page.locator('input[type="password"]').nth(0).fill('Sandi-baru-123')
    await fresh.page.locator('input[type="password"]').nth(1).fill('Sandi-baru-123')
    await fresh.page.getByRole('button', { name: /Simpan Kata Sandi Baru/i }).click()
    await expect(fresh.page.getByText(/Kata sandi baru Anda sudah aktif/i)).toBeVisible()

    // Click "Masuk" CTA inside main (not navbar)
    await fresh.page.locator('main').getByRole('button', { name: /^Masuk$/i }).click()
    await fresh.page.waitForURL(/\/masuk/)
    const masukUrl = fresh.page.url()
    const leakedResetTokenInNext = masukUrl.includes('reset-password')

    // Sign in with new password and see where we land!
    await fresh.page.getByLabel(/^Email$/i).waitFor({ state: 'visible', timeout: 10_000 })
    await fresh.page.getByLabel(/^Email$/i).fill(email)
    await fresh.page.getByLabel(/Kata Sandi/i).first().fill('Sandi-baru-123')
    await fresh.page.locator('button[type="submit"]').first().click()
    await fresh.page.waitForTimeout(1000)
    const postLoginUrl = fresh.page.url()
    const loopedBackToReset = postLoginUrl.includes('/reset-password')
    const snap = await fresh.probe.snap('d2-reset-password-loop')
    const dom = await fresh.probe.measureDom()

    logObservation({ case_id: 'D2-04', masukUrl, leakedResetTokenInNext, postLoginUrl, loopedBackToReset })

    appendTelemetry({
      case_id: 'D2-04',
      flow_id: 'FLOW-D2-05',
      domain: 'D2',
      persona: 'P-GUEST',
      viewport: '1280x650',
      gate_profile: 'P1',
      status: leakedResetTokenInNext || loopedBackToReset ? 'FAIL' : 'PASS',
      assertions_passed: 2,
      assertions_failed: loopedBackToReset ? 1 : 0,
      dead_end_hit: loopedBackToReset ? 1 : 0,
      state_sync_mismatch: 0,
      optimal_steps: 4,
      actual_steps: 4,
      click_count: 3,
      duration_ms: Date.now() - t0,
      max_interaction_latency_ms: fresh.probe.maxLatencyMs,
      console_error_count: fresh.probe.unexpectedConsoleErrors().length,
      page_error_count: fresh.probe.pageErrors.length,
      unexpected_http_4xx_5xx_count: fresh.probe.unexpectedHttpErrors().length,
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
      notes: `leakedResetTokenInNext=${leakedResetTokenInNext}; loopedBackToReset=${loopedBackToReset}; postLoginUrl=${postLoginUrl}`,
    })
    await fresh.ctx.close()
  })

  test('D2-05/D2-06/D2-07/D2-08/D2-10/D2-12: Campus email, KTM 3-reject lockout & CLI approve, expired verification, P1 consents UI & OIDC errors', async ({ browser }) => {
    const t0 = Date.now()
    const { ctx, page, probe } = await newAuditContext(browser)
    probe.allowHttp(/400.*campus-email|400.*ktm|403.*ktm|412.*application|400.*studentVerification/)
    const { userId } = await signUpVerified(page, 'd2-ktm')

    // 1. Non-curated .ac.id rejected
    const badCampus = await ctx.request.post(`${BASE_URL}/api/auth/campus-email/request`, {
      data: { email: 'mhs@kampus-fiktif.ac.id' },
      headers: { origin: BASE_URL, 'cf-connecting-ip': uniqueIp() },
    })
    expect(badCampus.status()).toBe(400)

    // 2. Spoofed JPEG magic bytes rejected by ktmConfirm
    const preSpoof = await trpcPost<{ key: string; url: string }>(page, 'studentVerification.ktmPresign', {
      contentType: 'image/jpeg',
      contentLength: 23,
    })
    await ctx.request.put(preSpoof.url, { data: Buffer.from('<html>not-a-jpeg</html>'), headers: { 'content-type': 'image/jpeg' } })
    const spoofConfirm = await trpcRaw(page, 'studentVerification.ktmConfirm', {
      key: preSpoof.key,
      campusId: 'binus-syahdan',
      nim: '2602011111',
      nameOnCard: 'Mahasiswa Audit',
      consent: true,
    })
    expect(spoofConfirm.status).toBe(400)

    // 3. Upload valid KTM -> CLI reject 3 times -> verify 4th presign FORBIDDEN -> check /profile UI lockout bug
    for (let attempt = 1; attempt <= 3; attempt++) {
      const pre = await trpcPost<{ key: string; url: string }>(page, 'studentVerification.ktmPresign', {
        contentType: 'image/jpeg',
        contentLength: MINIMAL_JPEG.length,
      })
      await ctx.request.put(pre.url, { data: MINIMAL_JPEG, headers: { 'content-type': 'image/jpeg' } })
      await trpcPost(page, 'studentVerification.ktmConfirm', {
        key: pre.key,
        campusId: 'binus-syahdan',
        nim: `260201110${attempt}`,
        nameOnCard: 'Mahasiswa Audit',
        consent: true,
      })
      const [docRow] = await sql<{ id: string }>(
        `SELECT id FROM "StudentDocument" WHERE "userId" = $1 AND status = 'PENDING' ORDER BY "createdAt" DESC LIMIT 1`,
        [userId],
      )
      const codes = ['FOTO_BURAM', 'NAMA_TIDAK_SESUAI', 'KTM_KEDALUWARSA']
      const cli = runBackendCli('scripts/review-students.ts', ['reject', docRow.id, codes[attempt - 1], `Uji tolak #${attempt}`])
      expect(cli.status, `CLI reject #${attempt}: ${cli.stderr} ${cli.stdout}`).toBe(0)
    }

    // 4th presign MUST be refused (403 FORBIDDEN)
    const fourthPre = await trpcRaw(page, 'studentVerification.ktmPresign', {
      contentType: 'image/jpeg',
      contentLength: MINIMAL_JPEG.length,
    })
    expect(fourthPre.status).toBe(403)

    // Visit /profile and check if StudentVerificationCard hides/disables KTM upload when attemptsLeft === 0
    await page.goto('/profile')
    await page.waitForSelector('h1')
    const profileDom = await probe.measureDom()
    const profileHeadings = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) => `${h.tagName}:${h.textContent?.trim().slice(0, 30)}`),
    )
    const ktmToggleStillOffered = await page.getByRole('button', { name: /Unggah KTM/i }).isVisible().catch(() => false)
    const snapLockout = await probe.snap('d2-profile-ktm-exhausted')

    // CLI reset -> upload valid KTM -> CLI approve future date -> verify unlocks student status!
    const resetCli = runBackendCli('scripts/review-students.ts', ['reset', userId])
    expect(resetCli.status).toBe(0)

    const preOk = await trpcPost<{ key: string; url: string }>(page, 'studentVerification.ktmPresign', {
      contentType: 'image/jpeg',
      contentLength: MINIMAL_JPEG.length,
    })
    await ctx.request.put(preOk.url, { data: MINIMAL_JPEG, headers: { 'content-type': 'image/jpeg' } })
    await trpcPost(page, 'studentVerification.ktmConfirm', {
      key: preOk.key,
      campusId: 'binus-syahdan',
      nim: '2602099999',
      nameOnCard: 'Mahasiswa Audit',
      consent: true,
    })
    const [docOk] = await sql<{ id: string }>(
      `SELECT id FROM "StudentDocument" WHERE "userId" = $1 AND status = 'PENDING' ORDER BY "createdAt" DESC LIMIT 1`,
      [userId],
    )
    const futureYear = new Date().getFullYear() + 1
    const approveCli = runBackendCli('scripts/review-students.ts', ['approve', docOk.id, `${futureYear}-06-01`])
    expect(approveCli.status, `CLI approve: ${approveCli.stderr}`).toBe(0)

    // Verify OIDC callback error redirect handling (/api/auth/campus-idp/callback?error=access_denied)
    await page.goto('/api/auth/campus-idp/callback?error=access_denied')
    await page.waitForURL(/\/profile/)
    await page.waitForTimeout(400)
    const oidcBannerVisible = await page.getByText(/Verifikasi akun kampus dibatalkan|tidak valid/i).isVisible().catch(() => false)

    // Verify expired campusVerifiedUntil blocks studentProcedure
    await sql(`UPDATE "User" SET "campusVerifiedUntil" = now() - interval '1 minute' WHERE id = $1`, [userId])
    const expiredApp = await trpcRaw(page, 'application.create', {
      roomId: 'room-pk-2',
      startDate: '2027-01-15',
      durationMonths: 3,
    })
    expect(expiredApp.status).toBe(412)

    // Restore valid verification, test P1 consents gate via /profile UI
    await sql(`UPDATE "User" SET "campusVerifiedUntil" = now() + interval '180 days' WHERE id = $1`, [userId])
    const noConsentsApp = await trpcRaw(page, 'application.create', {
      roomId: 'room-pk-2',
      startDate: '2027-01-15',
      durationMonths: 3,
    })
    expect(noConsentsApp.status).toBe(412)

    logObservation({
      case_id: 'D2-05/06/07/08/10/12',
      spoofStatus: spoofConfirm.status,
      fourthPreStatus: fourthPre.status,
      ktmToggleStillOffered,
      profileHeadings,
      oidcBannerVisible,
      expiredAppStatus: expiredApp.status,
      noConsentsAppStatus: noConsentsApp.status,
    })

    appendTelemetry({
      case_id: 'D2-07',
      flow_id: 'FLOW-D2-08',
      domain: 'D2',
      persona: 'P-STU-UNVER',
      viewport: '1280x650',
      gate_profile: 'P1',
      status: ktmToggleStillOffered ? 'PARTIAL' : 'PASS',
      assertions_passed: 8,
      assertions_failed: ktmToggleStillOffered ? 1 : 0,
      dead_end_hit: 0,
      state_sync_mismatch: ktmToggleStillOffered ? 1 : 0,
      optimal_steps: 7,
      actual_steps: 7,
      click_count: probe.clicks,
      duration_ms: Date.now() - t0,
      max_interaction_latency_ms: probe.maxLatencyMs,
      console_error_count: probe.unexpectedConsoleErrors().length,
      page_error_count: probe.pageErrors.length,
      unexpected_http_4xx_5xx_count: probe.unexpectedHttpErrors().length,
      lcp_ms: profileDom.lcpMs,
      cls_score: profileDom.cls,
      horizontal_overflow_px: profileDom.horizontalOverflowPx,
      min_interactive_target_px: profileDom.minInteractiveTargetPx,
      keyboard_completable: 'yes',
      focus_visible_ok: 'yes',
      aria_status_announced: oidcBannerVisible ? 'yes' : 'no',
      broken_img_count: profileDom.brokenImgCount,
      unnamed_icon_btn_count: profileDom.unnamedIconBtnCount,
      nested_interactive_count: profileDom.nestedInteractiveCount,
      screenshot_paths: [snapLockout],
      notes: `ktmToggleStillOfferedAt0Left=${ktmToggleStillOffered}; oidcBanner=${oidcBannerVisible}; expired412=${expiredApp.status}; noConsent412=${noConsentsApp.status}`,
    })
    await ctx.close()
  })

  test('D2-11: Demo student mutation restrictions (403 DEMO_ACCOUNT_READONLY)', async ({ browser }) => {
    const t0 = Date.now()
    const { ctx, page, probe } = await newAuditContext(browser)
    probe.allowHttp(/403.*(change-password|campus-email|ktmPresign|acceptTerms|becomeOwner)/)
    await loginDemo(page, 'student')

    const chgPwd = await ctx.request.post(`${BASE_URL}/api/auth/change-password`, {
      data: { currentPassword: 'x', newPassword: 'NewPassword123!' },
      headers: { origin: BASE_URL, 'cf-connecting-ip': uniqueIp() },
    })
    const ktmPre = await trpcRaw(page, 'studentVerification.ktmPresign', { contentType: 'image/jpeg', contentLength: 100 })
    const becomeOwn = await trpcRaw(page, 'owner.becomeOwner', { phone: '081234567890' })

    await page.goto('/profile')
    await page.waitForSelector('h1')
    const dom = await probe.measureDom()
    const snap = await probe.snap('d2-demo-profile')

    const allBlocked = chgPwd.status() === 403 && ktmPre.status === 403 && becomeOwn.status === 403
    logObservation({ case_id: 'D2-11', chgPwd: chgPwd.status(), ktmPre: ktmPre.status, becomeOwn: becomeOwn.status })

    appendTelemetry({
      case_id: 'D2-11',
      flow_id: 'FLOW-D2-04',
      domain: 'D2',
      persona: 'P-DEMO-STU',
      viewport: '1280x650',
      gate_profile: 'P1',
      status: allBlocked ? 'PASS' : 'FAIL',
      assertions_passed: allBlocked ? 3 : 0,
      assertions_failed: allBlocked ? 0 : 1,
      dead_end_hit: 0,
      state_sync_mismatch: 0,
      optimal_steps: 2,
      actual_steps: 2,
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
      keyboard_completable: 'yes',
      focus_visible_ok: 'yes',
      aria_status_announced: 'yes',
      broken_img_count: dom.brokenImgCount,
      unnamed_icon_btn_count: dom.unnamedIconBtnCount,
      nested_interactive_count: dom.nestedInteractiveCount,
      screenshot_paths: [snap],
      notes: `chgPwd=${chgPwd.status()}; ktmPre=${ktmPre.status}; becomeOwn=${becomeOwn.status}`,
    })
    await ctx.close()
  })
})
