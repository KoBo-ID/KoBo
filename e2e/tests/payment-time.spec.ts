import type { BrowserContext, Page } from '@playwright/test'
import { test, expect } from './fixtures'
import {
  expectHttpErrors, expireHold, heldRoom, latestPayment, newStudent, refundEvent, refundOf, sessionCompleted, shiftDueDates, sql, stubXenditCheckout,
  tick, trpcPost, trpcRaw, watch, webhook, xendit, type HeldRoom,
} from './seams'

// Things that happen because time passes: the 24 hour hold lapses, money arrives too late, monthly invoices fall due, the owner ends a lease.
// Time travel is by data (expireHold, shiftDueDates); worker passes are run on demand with tick(). Ticks are global, so every assertion
// is about this test's own rows, and refund mode PENDING holds a refund in SUBMITTED so the background worker cannot race past it.

test.skip(!!process.env.BASE_URL, 'needs the e2e hooks and database, which only the local e2e server provides')

const bulan = (page: Page, n: number) => page.getByRole('row').filter({ hasText: `Bulan ${n} ·` })
const boardRow = (page: Page, roomNumber: string) => page.getByRole('row').filter({ hasText: `Kamar ${roomNumber}` })
const openBoard = (page: Page, kosId: string) => page.goto(`/owner/dashboard?kos=${kosId}`)
const closeAll = (...ctxs: BrowserContext[]) => Promise.all(ctxs.map((c) => c.close()))
const outboxCount = async (to: string, template: string) => (await sql('SELECT id FROM "EmailOutbox" WHERE "to" = $1 AND template = $2', [to, template])).length
const tenancyStatus = async (id: string) => (await sql<{ status: string }>('SELECT status FROM "Tenancy" WHERE id = $1', [id]))[0].status

/** A demo student pays the first invoice through the API (the UI path is covered by payment-mock.spec.ts). */
async function payFirstInvoice(held: HeldRoom) {
  const start = await trpcPost<{ paymentId: string }>(held.student.ctx, 'payment.start', { invoiceId: held.invoiceId })
  await trpcPost(held.student.ctx, 'payment.simulate', { paymentId: start.paymentId })
}

test('scenario 18: an unpaid hold lapses, the room is free on the board and a queued student is offered it', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'time-hold' })
  const { owner, student } = held
  const room = owner.rooms[0]
  const waiter = await newStudent(browser, { label: 'time-wait' })
  watch(student.page, problems)
  watch(waiter.page, problems)
  watch(owner.page, problems)
  try {
    const entry = await trpcPost<{ id: string; position: number }>(waiter.ctx, 'waitlist.join', { kosId: owner.kosId, roomType: null })
    expect(entry.position).toBe(1)

    await test.step('while the hold is live the room is Dipesan and the waiter keeps waiting', async () => {
      await openBoard(owner.page, owner.kosId)
      await expect(boardRow(owner.page, room.roomNumber).getByText('Dipesan', { exact: true })).toBeVisible()
      await tick(owner.page, 'waitlist')
      const [{ status }] = await sql<{ status: string }>('SELECT status FROM "WaitlistEntry" WHERE id = $1', [entry.id])
      expect(status).toBe('WAITING')
    })

    await test.step('24 hours pass without payment: the owner board shows the room as Kosong', async () => {
      await expireHold(held.tenancyId)
      await owner.page.reload()
      await expect(boardRow(owner.page, room.roomNumber).getByText('Kosong', { exact: true })).toBeVisible()
    })

    await test.step('the waitlist pass offers the room to the waiter and queues the offer email', async () => {
      await expect
        .poll(async () => {
          await tick(owner.page, 'waitlist')
          return (await sql<{ status: string; offeredRoomId: string | null }>('SELECT status, "offeredRoomId" FROM "WaitlistEntry" WHERE id = $1', [entry.id]))[0]
        })
        .toEqual({ status: 'OFFERED', offeredRoomId: room.id })
      await expect.poll(() => outboxCount(waiter.email, 'waitlist-offer')).toBe(1)
      await waiter.page.goto('/my-kos')
      await expect(waiter.page.getByTestId('waitlist-offer')).toContainText(`Kamar ${room.roomNumber} ditawarkan untukmu`)
      await expect(waiter.page.getByRole('button', { name: 'Pesan Sekarang' })).toBeVisible()
    })

    await test.step('the student whose hold lapsed has no rental card; the application says the room was released', async () => {
      await student.page.goto('/my-kos')
      await expect(student.page.getByTestId('tenancy-card')).toHaveCount(0)
      const card = student.page.getByTestId('application-card')
      await expect(card).toContainText('Pengajuan diterima, tetapi tagihan pertama tidak dibayar dalam 24 jam, jadi kamar dilepas. Ajukan lagi bila kamar masih tersedia.')
    })

    await test.step('paying a lapsed invoice is refused in words', async () => {
      const again = await trpcRaw(student.ctx, 'payment.start', { invoiceId: held.invoiceId })
      expect([again.status, again.message]).toEqual([409, 'Masa tahan kamar sudah berakhir. Ajukan sewa kembali.'])
      expect(await sql('SELECT id FROM "Payment" WHERE "invoiceId" = $1', [held.invoiceId])).toHaveLength(0)
    })
    expectHttpErrors(problems, 409)
  } finally {
    await closeAll(owner.ctx, student.ctx, waiter.ctx)
  }
})

/** Real student starts paying (hosted checkout stubbed), then the hold lapses and the provider reports the money. */
async function lateCompletedPayment(held: HeldRoom) {
  const { page, ctx } = held.student
  await stubXenditCheckout(ctx)
  await page.goto('/my-kos')
  await page.getByRole('row').filter({ hasText: 'Bulan 1' }).getByRole('button', { name: 'Bayar Sekarang' }).click()
  await page.waitForURL(/^https:\/\/checkout-staging\.xendit\.co\//)
  const attempt = await latestPayment(held.invoiceId)
  await xendit.refundMode(page, attempt.id, 'PENDING') // hold the refund in SUBMITTED so the 15 s worker cannot move it on
  await expireHold(held.tenancyId)
  const res = await webhook(page.request, sessionCompleted(attempt.id, attempt.amount))
  return { attempt, res }
}

test('scenario 19: money that arrives after the hold lapsed is refunded, never turned into a rental', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'time-late' })
  const { owner, student } = held
  const room = owner.rooms[0]
  watch(student.page, problems)
  watch(owner.page, problems)
  try {
    const { attempt, res } = await lateCompletedPayment(held)

    await test.step('the late completed event queues a refund and settles nothing', async () => {
      expect(res.status).toBe(200)
      await expect.poll(async () => (await refundOf(attempt.id))?.status).toBe('PENDING')
      expect((await latestPayment(held.invoiceId)).status).toBe('REFUND_PENDING')
      const [inv] = await sql<{ status: string }>('SELECT status FROM "Invoice" WHERE id = $1', [held.invoiceId])
      expect(inv.status).toBe('UNPAID')
      expect(await tenancyStatus(held.tenancyId)).not.toBe('ACTIVE')
      expect(await sql('SELECT id FROM "Payment" WHERE "invoiceId" = $1 AND status = $2', [held.invoiceId, 'PAID'])).toHaveLength(0)
      expect(await outboxCount(student.email, 'payment-received')).toBe(0)
      expect(await outboxCount(owner.email, 'payment-received-owner')).toBe(0)
    })

    await test.step('the student is told the money is on its way back', async () => {
      await student.page.goto('/my-kos')
      const card = student.page.getByTestId('tenancy-card')
      await expect(card.getByText('Pembayaran diterima setelah masa tahan berakhir. Dana sedang dikembalikan.')).toBeVisible()
      await expect(card.getByRole('button', { name: /Bayar Sekarang|Lanjutkan Pembayaran/ })).toHaveCount(0)
      await expect(card.getByText('Sewa Aktif')).toHaveCount(0)
      await expect(card.getByText('Selesai', { exact: true })).toBeVisible() // lapsed hold reads as "Selesai"
    })

    await test.step('the owner board shows an empty room and no refund banner: that state is unreachable for a lapsed hold', async () => {
      await openBoard(owner.page, owner.kosId)
      const row = boardRow(owner.page, room.roomNumber)
      await expect(row.getByText('Kosong', { exact: true })).toBeVisible()
      await expect(row.getByTestId('payment-label')).toHaveCount(0)
      await expect(owner.page.getByText('Pengembalian dana gagal, perlu ditinjau')).toHaveCount(0)
    })

    await test.step('the refund worker submits it (provider still pending)', async () => {
      await expect
        .poll(async () => {
          await tick(student.page, 'refunds')
          return (await refundOf(attempt.id))?.status
        })
        .toBe('SUBMITTED')
      await student.page.reload()
      await expect(student.page.getByText('Pembayaran diterima setelah masa tahan berakhir. Dana sedang dikembalikan.')).toBeVisible()
    })

    await test.step('refund.succeeded: the money is back, but the card (and "Dana telah dikembalikan.") disappears', async () => {
      const refund = (await refundOf(attempt.id))!
      const done = await webhook(student.page.request, refundEvent('succeeded', refund))
      expect(done.status).toBe(200)
      await expect.poll(async () => (await refundOf(attempt.id))?.status).toBe('SUCCEEDED')
      expect((await latestPayment(held.invoiceId)).status).toBe('REFUNDED')
      await student.page.reload()
      // Finding: MyKos.tsx filters cards with status.startsWith('REFUND_'), which 'REFUNDED' does not match. The success copy
      // 'Dana telah dikembalikan.' (InvoicePaymentActions.tsx) is therefore never shown; the student only has the application card.
      await expect(student.page.getByTestId('tenancy-card')).toHaveCount(0)
      await expect(student.page.getByText('Dana telah dikembalikan.')).toHaveCount(0)
      await expect(student.page.getByTestId('application-card')).toContainText('kamar dilepas')
      expect(await tenancyStatus(held.tenancyId)).not.toBe('ACTIVE')
    })
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 19: a refund the provider rejects leaves "Pengembalian dana tertunda. Hubungi KoBo."', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'time-refundfail' })
  const { owner, student } = held
  watch(student.page, problems)
  watch(owner.page, problems)
  try {
    const { attempt } = await lateCompletedPayment(held)
    await expect
      .poll(async () => {
        await tick(student.page, 'refunds')
        return (await refundOf(attempt.id))?.status
      })
      .toBe('SUBMITTED')

    const refund = (await refundOf(attempt.id))!
    expect((await webhook(student.page.request, refundEvent('failed', refund))).status).toBe(200)
    await expect.poll(async () => (await refundOf(attempt.id))?.status).toBe('FAILED')
    expect((await latestPayment(held.invoiceId)).status).toBe('REFUND_FAILED')

    await student.page.goto('/my-kos')
    await expect(student.page.getByTestId('tenancy-card').getByText('Pengembalian dana tertunda. Hubungi KoBo.')).toBeVisible()
    expect(await tenancyStatus(held.tenancyId)).not.toBe('ACTIVE')

    // The owner's "Pengembalian dana gagal, perlu ditinjau" only reads a live tenancy's oldest unpaid invoice, which a lapsed hold is not.
    await openBoard(owner.page, owner.kosId)
    await expect(owner.page.getByText('Pengembalian dana gagal, perlu ditinjau')).toHaveCount(0)
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 20: after month 1 the months are in order, fall due, turn overdue, and month 2 can be paid', async ({ browser, problems }) => {
  test.setTimeout(60_000)
  const held = await heldRoom(browser, { label: 'time-months', demo: true })
  const { owner, student } = held
  const room = owner.rooms[0]
  watch(student.page, problems)
  watch(owner.page, problems)
  try {
    await payFirstInvoice(held)
    await student.page.goto('/my-kos')
    const card = student.page.getByTestId('tenancy-card')

    await test.step('three invoices in order: month 1 Lunas, months 2 and 3 not yet paid', async () => {
      const rows = card.getByRole('row')
      await expect(rows).toHaveCount(3)
      await expect(rows.nth(0)).toContainText('Bulan 1 ·')
      await expect(rows.nth(0)).toContainText('Lunas')
      await expect(rows.nth(1)).toContainText('Bulan 2 ·')
      await expect(rows.nth(1)).toContainText('Rp 1.500.000')
      await expect(rows.nth(1)).toContainText('Belum dibayar')
      await expect(rows.nth(2)).toContainText('Bulan 3 ·')
      await expect(card.getByText('Sewa Aktif', { exact: true })).toBeVisible()
    })

    await test.step('three days before month 2 is due: Segera Jatuh Tempo / Jatuh tempo', async () => {
      // Months are numbered by due date, so month 1 (paid) has to stay the oldest when the clock is moved on.
      await sql('UPDATE "Invoice" SET "dueDate" = "dueDate" - 60, "periodStart" = "periodStart" - 60 WHERE "tenancyId" = $1 AND status = $2', [held.tenancyId, 'PAID'])
      const [{ days }] = await sql<{ days: number }>(`SELECT ("dueDate"::date - (now() AT TIME ZONE 'Asia/Jakarta')::date) AS days FROM "Invoice" WHERE "tenancyId" = $1 AND status = 'UNPAID' ORDER BY "dueDate" LIMIT 1`, [held.tenancyId])
      await shiftDueDates(held.tenancyId, days - 2)
      await student.page.reload()
      await expect(card.getByText('Sewa Aktif · Segera Jatuh Tempo')).toBeVisible()
      await openBoard(owner.page, owner.kosId)
      await expect(boardRow(owner.page, room.roomNumber).getByText('Jatuh tempo', { exact: true })).toBeVisible()
    })

    await test.step('five days later: Menunggak and Telat 3 hari', async () => {
      await shiftDueDates(held.tenancyId, 5)
      await student.page.reload()
      await expect(card.getByText('Menunggak', { exact: true })).toBeVisible()
      await owner.page.reload()
      const row = boardRow(owner.page, room.roomNumber)
      await expect(row.getByText('Menunggak', { exact: true })).toBeVisible()
      await expect(row.getByText('Telat 3 hari')).toBeVisible()
    })

    await test.step('the student pays month 2 with the simulator; month 3 stays open', async () => {
      const m2 = bulan(student.page, 2)
      await m2.getByRole('button', { name: 'Bayar Sekarang' }).click()
      await m2.getByRole('button', { name: 'Simulasikan Pembayaran' }).click()
      await expect(m2).toContainText('Lunas')
      await expect(m2.getByRole('link', { name: /^KB\/\d{4}\/\d{2}\/\d{4}$/ })).toBeVisible()
      await expect(bulan(student.page, 3)).toContainText('Belum dibayar')
      await expect(card.getByText('Menunggak', { exact: true })).toHaveCount(0)
      const paid = await sql<{ status: string }>('SELECT status FROM "Invoice" WHERE "tenancyId" = $1 ORDER BY "periodStart"', [held.tenancyId])
      expect(paid.map((r) => r.status)).toEqual(['PAID', 'PAID', 'UNPAID'])
    })
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 21: the owner ends an active lease: ENDED, unpaid months are not billed, the room frees and the waitlist advances', async ({ browser, problems }) => {
  const held = await heldRoom(browser, { label: 'time-end', demo: true })
  const { owner, student } = held
  const room = owner.rooms[0]
  const waiter = await newStudent(browser, { label: 'time-endwait' })
  watch(student.page, problems)
  watch(owner.page, problems)
  try {
    await payFirstInvoice(held)
    const entry = await trpcPost<{ id: string }>(waiter.ctx, 'waitlist.join', { kosId: owner.kosId, roomType: null })

    await test.step('the owner asks to end the lease and has to confirm', async () => {
      await openBoard(owner.page, owner.kosId)
      const row = boardRow(owner.page, room.roomNumber)
      await expect(row.getByText('Lunas', { exact: true })).toBeVisible()
      await row.getByRole('button', { name: `Aksi lainnya Kamar ${room.roomNumber}` }).click()
      await owner.page.getByRole('menuitem', { name: 'Akhiri Sewa' }).click()
      const confirm = owner.page.getByRole('alertdialog', { name: `Akhiri sewa Kamar ${room.roomNumber}` })
      await expect(confirm).toContainText(`Akhiri sewa Kamar ${room.roomNumber}`)
      expect(await tenancyStatus(held.tenancyId)).toBe('ACTIVE') // nothing happens before confirming
      await confirm.getByRole('button', { name: 'Batal' }).click()
      await expect(confirm).toHaveCount(0)
      expect(await tenancyStatus(held.tenancyId)).toBe('ACTIVE')
      await row.getByRole('button', { name: `Aksi lainnya Kamar ${room.roomNumber}` }).click()
      await owner.page.getByRole('menuitem', { name: 'Akhiri Sewa' }).click()
      await owner.page.getByRole('alertdialog').getByRole('button', { name: 'Akhiri sewa' }).click()
      await expect(boardRow(owner.page, room.roomNumber).getByText('Kosong', { exact: true })).toBeVisible()
    })

    await test.step('the tenancy is ENDED and the room VACANT', async () => {
      expect(await tenancyStatus(held.tenancyId)).toBe('ENDED')
      const [r] = await sql<{ occupancy: string }>('SELECT occupancy FROM "Room" WHERE id = $1', [room.id])
      expect(r.occupancy).toBe('VACANT')
    })

    await test.step('the student sees an ended rental: unpaid months are not billed, and a review can be written', async () => {
      await student.page.goto('/my-kos')
      const card = student.page.getByTestId('tenancy-card')
      await expect(card).toHaveAttribute('data-status', 'ENDED')
      await expect(card.getByText(/^Sewa berakhir pada /)).toBeVisible()
      await expect(bulan(student.page, 1)).toContainText('Lunas')
      await expect(bulan(student.page, 2)).toContainText('Tidak ditagih, sewa berakhir')
      await expect(bulan(student.page, 3)).toContainText('Tidak ditagih, sewa berakhir')
      await expect(card.getByRole('button', { name: 'Bayar Sekarang' })).toHaveCount(0)
      await expect(card.getByRole('link', { name: 'Lihat Kuitansi Resmi' })).toBeVisible()
      await card.getByRole('button', { name: 'Tulis Ulasan' }).click()
      await student.page.getByRole('button', { name: 'Rating keseluruhan: 4 bintang' }).click()
      await student.page.getByLabel('Ceritakan pengalaman tinggal Anda').fill(`Sewa selesai dengan baik ${Date.now()}`)
      await student.page.getByRole('button', { name: 'Kirim Ulasan' }).click()
      await expect(card.getByRole('button', { name: 'Ubah Ulasan' })).toBeVisible()
    })

    await test.step('the waiter was offered the freed room right away (the end itself advances the queue)', async () => {
      await expect
        .poll(async () => {
          await tick(owner.page, 'waitlist')
          return (await sql<{ status: string; offeredRoomId: string | null }>('SELECT status, "offeredRoomId" FROM "WaitlistEntry" WHERE id = $1', [entry.id]))[0]
        })
        .toEqual({ status: 'OFFERED', offeredRoomId: room.id })
      await expect.poll(() => outboxCount(waiter.email, 'waitlist-offer')).toBe(1)
    })
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx, waiter.ctx)
  }
})
