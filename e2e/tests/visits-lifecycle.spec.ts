import type { BrowserContext } from '@playwright/test'
import { test, expect } from './fixtures'
import { expectHttpErrors, newOwnerWorld, newStudent, sql, trpcPost, trpcRaw, watch } from './seams'

// Free survey visits, beyond visits.spec.ts (demo accounts, happy path): what the modal allows, the one-scheduled-visit rule,
// cancelling, and the owner's view of a completed or cancelled visit. Every test has its own kos and student.

test.skip(!!process.env.BASE_URL, 'needs the e2e hooks and database, which only the local e2e server provides')

const closeAll = (...ctxs: BrowserContext[]) => Promise.all(ctxs.map((c) => c.close()))
const wibDay = (offsetDays: number) => new Date(Date.now() + 7 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10)
const visitRows = (kosId: string, userId: string) => sql<{ id: string; status: string; timeSlot: string; date: Date }>('SELECT id, status, "timeSlot", date FROM "Visit" WHERE "kosId" = $1 AND "userId" = $2 ORDER BY "createdAt"', [kosId, userId])

test('scenario 26: the modal offers only the next five days and refuses a bad phone number', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'visit-modal', rooms: 1 })
  const student = await newStudent(browser, { label: 'visit-modal-s' })
  watch(student.page, problems)
  try {
    await student.page.goto(`/kos/${owner.kosId}`)
    await student.page.getByRole('button', { name: 'Jadwalkan Survey Gratis' }).first().click()
    const dialog = student.page.getByRole('dialog')
    await expect(dialog).toContainText('Jadwalkan Survey Gratis')

    await test.step('five day buttons, starting tomorrow', async () => {
      const days = dialog.locator('button.interactive-tap').filter({ hasText: /^(Sen|Sel|Rab|Kam|Jum|Sab|Min)/ })
      await expect(days).toHaveCount(5)
      const tomorrow = Number(wibDay(1).slice(8))
      await expect(days.first()).toContainText(String(tomorrow))
    })

    await test.step('the WhatsApp number is required before anything is sent', async () => {
      const phone = dialog.getByLabel('Nomor WhatsApp')
      await expect(phone).toBeVisible()
      await expect(phone).toHaveAttribute('required', '')
      await dialog.getByRole('button', { name: 'Konfirmasi Jadwal Survey Gratis' }).click()
      expect(await visitRows(owner.kosId, student.userId)).toHaveLength(0)
      await expect(dialog).toBeVisible()
    })

    await test.step('a malformed number is rejected by the server and nothing is scheduled', async () => {
      await dialog.getByLabel('Nomor WhatsApp').fill('abc')
      await dialog.getByRole('button', { name: 'Konfirmasi Jadwal Survey Gratis' }).click()
      await expect(dialog.getByRole('alert')).toHaveText('Data yang dikirim tidak valid. Periksa kembali isian Anda.') // generic: the field is not named (finding)
      expect(await visitRows(owner.kosId, student.userId)).toHaveLength(0)
    })
    expectHttpErrors(problems, 400)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 26: today and past dates are refused by the server', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'visit-past', rooms: 1 })
  const student = await newStudent(browser, { label: 'visit-past-s' })
  try {
    for (const offset of [-3, -1, 0]) {
      const res = await trpcRaw(student.ctx, 'visit.create', { kosId: owner.kosId, date: wibDay(offset), timeSlot: 'PAGI' })
      expect([res.status, res.message], `date offset ${offset}`).toEqual([400, 'Tanggal survey harus setelah hari ini.'])
    }
    expect(await visitRows(owner.kosId, student.userId)).toHaveLength(0)
    const ok = await trpcRaw(student.ctx, 'visit.create', { kosId: owner.kosId, date: wibDay(1), timeSlot: 'PAGI' })
    expect(ok.status).toBe(200)
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 26: one scheduled visit per kos; the owner sees it and completes it', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'visit-one', rooms: 1 })
  const student = await newStudent(browser, { label: 'visit-one-s' })
  watch(student.page, problems)
  watch(owner.page, problems)
  try {
    const openModal = async () => {
      await student.page.goto(`/kos/${owner.kosId}`)
      await student.page.getByRole('button', { name: 'Jadwalkan Survey Gratis' }).first().click()
      return student.page.getByRole('dialog')
    }

    await test.step('scheduling for the morning slot with a note confirms with a toast', async () => {
      const dialog = await openModal()
      await dialog.getByRole('button', { name: /Sesi Pagi/ }).click()
      await dialog.getByLabel('Nomor WhatsApp').fill('081234567890')
      await dialog.getByRole('textbox').last().fill('Datang bersama orang tua')
      await dialog.getByRole('button', { name: 'Konfirmasi Jadwal Survey Gratis' }).click()
      await expect(student.page.getByText(`Jadwal survey ke ${owner.kosName} berhasil dikonfirmasi!`)).toBeVisible()
      const rows = await visitRows(owner.kosId, student.userId)
      expect(rows.map((r) => [r.status, r.timeSlot])).toEqual([['SCHEDULED', 'PAGI']])
    })

    await test.step('a second visit to the same kos is refused in words', async () => {
      const dialog = await openModal()
      await dialog.getByRole('button', { name: 'Konfirmasi Jadwal Survey Gratis' }).click()
      await expect(dialog.getByRole('alert')).toHaveText('Anda sudah punya jadwal survey aktif di kos ini.')
      expect(await visitRows(owner.kosId, student.userId)).toHaveLength(1)
    })

    await test.step('the student sees it as Terjadwal with a cancel button', async () => {
      await student.page.goto('/my-kos')
      await student.page.getByRole('tab', { name: /Jadwal Survey Gratis/ }).click()
      await expect(student.page.getByText('Terjadwal')).toBeVisible()
      await expect(student.page.getByRole('button', { name: 'Batalkan Survey' })).toBeVisible()
    })

    await test.step('the owner sees the student and the contact number, and marks it done', async () => {
      await owner.page.goto(`/owner/dashboard?kos=${owner.kosId}`)
      const row = owner.page.getByTestId('owner-visit')
      await expect(row).toHaveCount(1)
      await expect(row).toContainText('Penguji E2E')
      await expect(row).toContainText('081234567890')
      await expect(row).toContainText('Pagi (09.00 - 12.00)')
      await expect(row).toContainText('Datang bersama orang tua')
      await row.getByRole('button', { name: 'Tandai selesai' }).click()
      await expect(owner.page.getByText('Survey ditandai selesai.')).toBeVisible()
      await expect(owner.page.getByTestId('owner-visit')).toContainText('Selesai')
      await expect(owner.page.getByTestId('owner-visit').getByRole('button', { name: 'Tandai selesai' })).toHaveCount(0)
    })

    await test.step('the student sees Selesai and can no longer cancel; the server says so', async () => {
      await student.page.reload()
      await student.page.getByRole('tab', { name: /Jadwal Survey Gratis/ }).click()
      await expect(student.page.getByText('Selesai', { exact: true })).toBeVisible()
      await expect(student.page.getByRole('button', { name: 'Batalkan Survey' })).toHaveCount(0)
      const [{ id }] = await visitRows(owner.kosId, student.userId)
      const cancel = await trpcRaw(student.ctx, 'visit.cancel', { visitId: id })
      expect([cancel.status, cancel.message]).toEqual([409, 'Survey ini sudah selesai atau dibatalkan.'])
      const again = await trpcRaw(owner.ctx, 'owner.visit.complete', { kosId: owner.kosId, visitId: id })
      expect([again.status, again.message]).toEqual([409, 'Survey ini sudah selesai atau dibatalkan.'])
    })
    expectHttpErrors(problems, 409)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 26: the student cancels, the owner cannot complete it, and a new visit can be booked', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'visit-cancel', rooms: 1 })
  const student = await newStudent(browser, { label: 'visit-cancel-s' })
  const other = await newStudent(browser, { label: 'visit-cancel-o' })
  watch(student.page, problems)
  watch(owner.page, problems)
  try {
    await sql('UPDATE "User" SET phone = $2 WHERE id = $1', [student.userId, '081200000001'])
    const { id } = await trpcPost<{ id: string }>(student.ctx, 'visit.create', { kosId: owner.kosId, date: wibDay(2), timeSlot: 'SIANG' })

    await test.step('cancelling from /my-kos toasts and flips the status', async () => {
      await student.page.goto('/my-kos')
      await student.page.getByRole('tab', { name: /Jadwal Survey Gratis/ }).click()
      await student.page.getByRole('button', { name: 'Batalkan Survey' }).click()
      await expect(student.page.getByText('Jadwal survey telah dibatalkan.')).toBeVisible()
      await expect(student.page.getByText('Dibatalkan', { exact: true })).toBeVisible()
      await expect(student.page.getByRole('button', { name: 'Batalkan Survey' })).toHaveCount(0)
      expect((await visitRows(owner.kosId, student.userId))[0].status).toBe('CANCELLED')
    })

    await test.step('the owner cannot complete a cancelled visit', async () => {
      const res = await trpcRaw(owner.ctx, 'owner.visit.complete', { kosId: owner.kosId, visitId: id })
      expect([res.status, res.message]).toEqual([409, 'Survey ini sudah selesai atau dibatalkan.'])
    })

    await test.step('somebody else cannot cancel it either, and the student can book again', async () => {
      const foreign = await trpcRaw(other.ctx, 'visit.cancel', { visitId: id })
      expect([foreign.status, foreign.message]).toEqual([403, 'Anda hanya dapat membatalkan survey Anda sendiri.'])
      const again = await trpcRaw(student.ctx, 'visit.create', { kosId: owner.kosId, date: wibDay(3), timeSlot: 'PAGI' })
      expect(again.status).toBe(200)
      expect((await visitRows(owner.kosId, student.userId)).map((r) => r.status)).toEqual(['CANCELLED', 'SCHEDULED'])
    })
    expectHttpErrors(problems, 409, 403)
  } finally {
    await closeAll(owner.ctx, student.ctx, other.ctx)
  }
})
