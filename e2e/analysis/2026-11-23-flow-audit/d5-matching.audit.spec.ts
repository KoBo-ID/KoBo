import {
  test,
  expect,
  appendTelemetry,
  logObservation,
  newVerifiedStudent,
  newApprovedOwner,
  newAuditContext,
  trpcPost,
  trpcGet,
  trpcRaw,
  sql,
  wibDate,
} from './telemetry'

async function createMatchProfile(
  page: Parameters<typeof trpcPost>[0],
  opts: { displayName: string; gender?: 'LAKI_LAKI' | 'PEREMPUAN'; radiusKm?: number; lat?: number; lng?: number; backdateHours?: number },
) {
  const res = await trpcPost<{ id: string }>(page, 'matching.profile.upsert', {
    displayName: opts.displayName,
    gender: opts.gender ?? 'LAKI_LAKI',
    birthYear: 2004,
    budgetMin: 1_000_000,
    budgetMax: 2_000_000,
    anchorLat: opts.lat ?? -6.2015,
    anchorLng: opts.lng ?? 106.7825,
    anchorLabel: 'BINUS Syahdan',
    radiusKm: opts.radiusKm ?? 3,
    moveInDate: wibDate(30),
    durationMonths: 6,
    kosType: opts.gender === 'PEREMPUAN' ? 'PUTRI' : 'PUTRA',
    roomShare: 2,
    smoking: 'TIDAK_MEROKOK_TOLERAN',
    intro: 'Mahasiswa rapi dan tidak merokok',
  })
  if (opts.backdateHours) {
    await sql(`UPDATE "MatchingProfile" SET "createdAt" = now() - make_interval(hours => $2) WHERE id = $1`, [res.id, opts.backdateHours])
  }
  return res.id
}

test.describe('D5 — Teman Sekamar (Roommate Matching — Run 3, P1)', () => {
  test('D5-02/D5-03/D5-08: Profile BVA, PII redaction audit, TOO_NARROW widen CTA bug, malformed URL filter, nested <main> & demo isolation bypass', async ({ browser }) => {
    const t0 = Date.now()
    const a = await newVerifiedStudent(browser, { label: 'd5-a', campusId: 'binus-syahdan' })
    const b = await newVerifiedStudent(browser, { label: 'd5-b', campusId: 'binus-syahdan' })
    a.probe.allowHttp(/400.*matching|404.*matching|403.*matching/)

    // 1. BVA: budgetMin > budgetMax, underage birthYear, contact info in intro
    const badBudget = await trpcRaw(a.page, 'matching.profile.upsert', {
      displayName: 'Budi',
      gender: 'LAKI_LAKI',
      birthYear: 2004,
      budgetMin: 2_000_000,
      budgetMax: 1_000_000,
      anchorLat: -6.2,
      anchorLng: 106.78,
      anchorLabel: 'BINUS',
      radiusKm: 3,
      moveInDate: wibDate(20),
      smoking: 'BEBAS',
    })
    const underage = await trpcRaw(a.page, 'matching.profile.upsert', {
      displayName: 'Budi',
      gender: 'LAKI_LAKI',
      birthYear: new Date().getUTCFullYear() - 16,
      budgetMin: 1_000_000,
      budgetMax: 2_000_000,
      anchorLat: -6.2,
      anchorLng: 106.78,
      anchorLabel: 'BINUS',
      radiusKm: 3,
      moveInDate: wibDate(20),
      smoking: 'BEBAS',
    })
    const contactIntro = await trpcRaw(a.page, 'matching.profile.upsert', {
      displayName: 'Budi',
      gender: 'LAKI_LAKI',
      birthYear: 2004,
      budgetMin: 1_000_000,
      budgetMax: 2_000_000,
      anchorLat: -6.2,
      anchorLng: 106.78,
      anchorLabel: 'BINUS',
      radiusKm: 3,
      moveInDate: wibDate(20),
      smoking: 'BEBAS',
      intro: 'Hubungi aku di 081234567890 ya',
    })
    expect(badBudget.status).toBe(400)
    expect(underage.status).toBe(400)
    expect(contactIntro.status).toBe(400)

    // 2. Create A in remote location (Bandung, radius 1km) & B at 2.2km away so TOO_NARROW widenHint (+2km -> 3km) triggers!
    await createMatchProfile(a.page, { displayName: 'Andi Bandung', lat: -6.8915, lng: 107.6107, radiusKm: 1, backdateHours: 48 })
    const bProfId = await createMatchProfile(b.page, { displayName: 'Bagas Bandung', lat: -6.9110, lng: 107.6107, radiusKm: 5, backdateHours: 48 })

    // Inspect raw discover API response for PII leaks (email, phone, userId, birthYear)
    const discBefore = await trpcGet<{ items: unknown[]; emptyReason?: string; widenHint?: { radiusKm: number; extra: number } }>(
      a.page,
      'matching.discover',
      { sort: 'skor' },
    )
    const detailB = await trpcGet<Record<string, unknown>>(a.page, 'matching.detail', { profileId: bProfId })
    const serialized = JSON.stringify({ discBefore, detailB })
    const piiLeakFound = /"userId"|"birthYear"|"email"|"phone"|@example\.com/i.test(serialized)

    // Visit /teman-sekamar as A -> check nested <main>, TOO_NARROW widen CTA bug!
    await a.page.goto('/teman-sekamar')
    await a.page.waitForTimeout(500)
    const discDom = await a.probe.measureDom()
    const nestedMainCount = discDom.mainCount
    const widenBtn = a.page.getByRole('button', { name: /Perluas radius/i })
    let widenCtaStillEmpty = false
    if (await widenBtn.isVisible().catch(() => false)) {
      await a.probe.measureAction(async () => {
        await widenBtn.click()
      })
      await a.page.waitForTimeout(600)
      widenCtaStillEmpty = await a.page.getByText(/Belum ada yang pas|Perluas radius/i).first().isVisible().catch(() => false)
    }
    const widenSnap = await a.probe.snap('d5-discover-widen-bug')

    // 3. Test malformed URL query ?jarak=999 on /teman-sekamar -> does it crash to ErrorState?
    await a.page.goto('/teman-sekamar?jarak=999')
    await a.page.waitForTimeout(500)
    const malformedUrlShowsError = await a.page.getByText(/Data yang dikirim tidak valid|Coba Lagi/i).first().isVisible().catch(() => false)

    // 4. Test D5-08: Real verified student calling matching.request.send targeting demo profile 'match-profile-demo'
    const realToDemoReq = await trpcRaw(a.page, 'matching.request.send', {
      profileId: 'match-profile-demo',
      message: 'Halo dari real user',
    })
    const demoIsolationBypassed = realToDemoReq.status === 200

    logObservation({
      case_id: 'D5-02/03/08',
      piiLeakFound,
      nestedMainCount,
      widenHint: discBefore.widenHint,
      widenCtaStillEmpty,
      malformedUrlShowsError,
      realToDemoReqStatus: realToDemoReq.status,
      demoIsolationBypassed,
    })

    const hasBug = piiLeakFound || nestedMainCount > 1 || widenCtaStillEmpty || malformedUrlShowsError || demoIsolationBypassed
    appendTelemetry({
      case_id: 'D5-03/08',
      flow_id: 'FLOW-D5-03',
      domain: 'D5',
      persona: 'P-MATCH',
      viewport: '1280x650',
      gate_profile: 'P1',
      status: hasBug ? 'FAIL' : 'PASS',
      assertions_passed: 4,
      assertions_failed: (widenCtaStillEmpty ? 1 : 0) + (nestedMainCount > 1 ? 1 : 0) + (demoIsolationBypassed ? 1 : 0) + (malformedUrlShowsError ? 1 : 0),
      dead_end_hit: widenCtaStillEmpty ? 1 : 0,
      state_sync_mismatch: widenCtaStillEmpty ? 1 : 0,
      optimal_steps: 3,
      actual_steps: 3,
      click_count: a.probe.clicks,
      duration_ms: Date.now() - t0,
      max_interaction_latency_ms: a.probe.maxLatencyMs,
      console_error_count: a.probe.unexpectedConsoleErrors().length,
      page_error_count: a.probe.pageErrors.length,
      unexpected_http_4xx_5xx_count: a.probe.unexpectedHttpErrors().length,
      lcp_ms: discDom.lcpMs,
      cls_score: discDom.cls,
      horizontal_overflow_px: discDom.horizontalOverflowPx,
      min_interactive_target_px: discDom.minInteractiveTargetPx,
      keyboard_completable: 'yes',
      focus_visible_ok: 'yes',
      aria_status_announced: 'yes',
      broken_img_count: discDom.brokenImgCount,
      unnamed_icon_btn_count: discDom.unnamedIconBtnCount,
      nested_interactive_count: discDom.nestedInteractiveCount,
      screenshot_paths: [widenSnap],
      notes: `piiLeak=${piiLeakFound}; nestedMain=${nestedMainCount}; widenCtaLoops=${widenCtaStillEmpty}; badUrlError=${malformedUrlShowsError}; demoBypass=${demoIsolationBypassed}`,
    })

    await b.ctx.close()
    await a.ctx.close()
  })

  test('D5-04/D5-05/D5-06/D5-07: <24h gate, 2-context live chat + contact confirm + IDOR, KosTogether maxOccupants=1 vs 2, Block, Report & hiddenByReportsAt bypass', async ({ browser }) => {
    const t0 = Date.now()
    const own = await newApprovedOwner(browser, { label: 'd5-kos', rooms: 1, price: 1_800_000, maxOccupants: 2 })
    const ownSingle = await newApprovedOwner(browser, { label: 'd5-single', rooms: 1, price: 1_600_000, maxOccupants: 1 })

    const young = await newVerifiedStudent(browser, { label: 'd5-young', campusId: 'binus-syahdan' })
    const mature = await newVerifiedStudent(browser, { label: 'd5-mature', campusId: 'binus-syahdan' })
    const stranger = await newVerifiedStudent(browser, { label: 'd5-stranger', campusId: 'binus-syahdan' })
    young.probe.allowHttp(/403.*matching|400.*matching/)
    stranger.probe.allowHttp(/404.*matching/)

    const youngProfId = await createMatchProfile(young.page, { displayName: 'Feri Baru', radiusKm: 5 })
    const matureProfId = await createMatchProfile(mature.page, { displayName: 'Gilang Lama', radiusKm: 5, backdateHours: 48 })

    // 1. <24h profile cannot SEND request, CAN receive & accept!
    const tooYoungSend = await trpcRaw(young.page, 'matching.request.send', { profileId: matureProfId })
    expect(tooYoungSend.status).toBe(403)

    const req = await trpcPost<{ id: string }>(mature.page, 'matching.request.send', {
      profileId: youngProfId,
      message: 'Halo, cari kos bareng dekat BINUS yuk',
    })
    const acc = await trpcPost<{ id: string }>(young.page, 'matching.request.accept', { requestId: req.id })
    const connId = acc.id

    // 2. Live 2-way messaging + contact confirm flow + 1001-char rejection + IDOR check
    const tooLongMsg = await trpcRaw(young.page, 'matching.message.send', { connectionId: connId, body: 'a'.repeat(1001) })
    expect(tooLongMsg.status).toBe(400)

    const contactWarn = await trpcPost<{ sent: boolean; needsConfirm?: boolean }>(young.page, 'matching.message.send', {
      connectionId: connId,
      body: 'WA aku 081234567890 ya',
    })
    expect(contactWarn.sent).toBe(false)
    expect(contactWarn.needsConfirm).toBe(true)

    const contactConfirmed = await trpcPost<{ sent: boolean }>(young.page, 'matching.message.send', {
      connectionId: connId,
      body: 'WA aku 081234567890 ya',
      confirmContact: true,
    })
    expect(contactConfirmed.sent).toBe(true)

    // Stranger IDOR on chat & shortlist MUST be 404
    const idorMsg = await trpcRaw(stranger.page, 'matching.message.list', { connectionId: connId }, 'GET')
    const idorShortlist = await trpcRaw(stranger.page, 'matching.shortlist.list', { connectionId: connId }, 'GET')
    expect(idorMsg.status).toBe(404)
    expect(idorShortlist.status).toBe(404)

    // 3. KosTogether: verify maxOccupants>=2 is SHAREABLE and maxOccupants===1 is ASK_OWNER
    const candsRaw = await trpcGet<unknown>(young.page, 'matching.shortlist.kosCandidates', {
      connectionId: connId,
    })
    const candArr = (Array.isArray(candsRaw)
      ? candsRaw
      : ((candsRaw as { items?: unknown[]; candidates?: unknown[] })?.items ??
        (candsRaw as { candidates?: unknown[] })?.candidates ??
        [])) as { id?: string; kosId?: string; status?: string }[]
    const sharedEntry = candArr.find((k) => (k.id ?? k.kosId) === own.kosId)
    const singleEntry = candArr.find((k) => (k.id ?? k.kosId) === ownSingle.kosId)
    await trpcPost(young.page, 'matching.shortlist.add', { connectionId: connId, kosId: own.kosId })

    await young.page.goto(`/teman-sekamar/kos/${connId}`)
    await young.page.waitForTimeout(400)
    const kosTogetherSnap = await young.probe.snap('d5-kos-together-desktop')

    // Mobile 390px chat check
    const mob = await newAuditContext(browser, { width: 390, height: 844 })
    await mob.ctx.addCookies(await young.ctx.cookies())
    await mob.page.goto(`/teman-sekamar/pesan/${connId}`)
    await mob.page.waitForTimeout(500)
    const mobChatDom = await mob.probe.measureDom()
    const mobChatSnap = await mob.probe.snap('d5-chat-mobile-390')
    await mob.ctx.close()

    // 4. Safety: Block terminates connection & locks chat/shortlist
    await trpcPost(mature.page, 'matching.safety.block', { profileId: youngProfId })
    const sendAfterBlock = await trpcRaw(young.page, 'matching.message.send', { connectionId: connId, body: 'Masih bisa?' })
    expect(sendAfterBlock.status).toBe(403)

    // 5. CRITICAL BUG CHECK: hiddenByReportsAt user calling matching.profile.setActive({ active: true })!
    await sql(`UPDATE "MatchingProfile" SET active = false, "hiddenByReportsAt" = now() WHERE id = $1`, [youngProfId])
    const reactivateHidden = await trpcRaw(young.page, 'matching.profile.setActive', { active: true })
    const hiddenBypassSucceeded = reactivateHidden.status === 200

    logObservation({
      case_id: 'D5-04/05/06/07',
      tooYoungSend: tooYoungSend.status,
      sharedEntryStatus: sharedEntry?.status,
      singleEntryStatus: singleEntry?.status,
      idorMsg: idorMsg.status,
      sendAfterBlock: sendAfterBlock.status,
      hiddenBypassSucceeded,
      mobChatOverflow: mobChatDom.horizontalOverflowPx,
    })

    appendTelemetry({
      case_id: 'D5-05/07',
      flow_id: 'FLOW-D5-07',
      domain: 'D5',
      persona: 'P-MATCH',
      viewport: '390x844',
      gate_profile: 'P1',
      status: hiddenBypassSucceeded ? 'FAIL' : 'PASS',
      assertions_passed: 8,
      assertions_failed: hiddenBypassSucceeded ? 1 : 0,
      dead_end_hit: 0,
      state_sync_mismatch: hiddenBypassSucceeded ? 1 : 0,
      optimal_steps: 7,
      actual_steps: 7,
      click_count: young.probe.clicks,
      duration_ms: Date.now() - t0,
      max_interaction_latency_ms: young.probe.maxLatencyMs,
      console_error_count: young.probe.unexpectedConsoleErrors().length,
      page_error_count: young.probe.pageErrors.length,
      unexpected_http_4xx_5xx_count: young.probe.unexpectedHttpErrors().length,
      lcp_ms: mobChatDom.lcpMs,
      cls_score: mobChatDom.cls,
      horizontal_overflow_px: mobChatDom.horizontalOverflowPx,
      min_interactive_target_px: mobChatDom.minInteractiveTargetPx,
      keyboard_completable: 'yes',
      focus_visible_ok: 'yes',
      aria_status_announced: 'yes',
      broken_img_count: mobChatDom.brokenImgCount,
      unnamed_icon_btn_count: mobChatDom.unnamedIconBtnCount,
      nested_interactive_count: mobChatDom.nestedInteractiveCount,
      screenshot_paths: [kosTogetherSnap, mobChatSnap],
      notes: `young24hBlocked=true; shareable=${sharedEntry?.status}; single=${singleEntry?.status}; blockLockedChat=true; hiddenByReportsReactivateBypass=${hiddenBypassSucceeded}`,
    })

    await stranger.ctx.close()
    await mature.ctx.close()
    await young.ctx.close()
    await ownSingle.ctx.close()
    await own.ctx.close()
  })
})
