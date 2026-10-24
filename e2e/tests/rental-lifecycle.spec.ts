import type { BrowserContext, Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { newContext, newOwnerWorld, newStudent, apply, approve, hold, sql, trpcPost, trpcRaw, watch, expectHttpErrors, type OwnerWorld } from './seams'

// From browsing a kos to an approved hold: discovery, application, validation, the owner's decision and its consequences.
// Every test builds its own owner, kos, rooms and students, so nothing here touches the seeded demo rows.
// Not covered because the product has no such path: withdrawing an application (no application.withdraw, WITHDRAWN is never
// set) and a rejection reason (the decision input only carries APPROVE or REJECT).

test.skip(!!process.env.BASE_URL, 'needs the e2e hooks and database, which only the local e2e server provides')

const PASSWORD = 'Sandi-rahasia-123'
const digits = (text: string | null) => Number((text ?? '').replace(/\D/g, ''))
const wibToday = (plusDays = 0) => new Date(Date.now() + 7 * 3_600_000 + plusDays * 86_400_000).toISOString().slice(0, 10)

async function closeAll(...contexts: (BrowserContext | undefined)[]) {
  await Promise.all(contexts.map((c) => c?.close()))
}

const ownerBoard = (owner: OwnerWorld) => owner.page.goto(`/owner/dashboard?kos=${owner.kosId}`)
const ownerRow = (page: Page, text: string) => page.getByTestId('owner-application').filter({ hasText: text })
const boardRow = (page: Page, roomNumber: string) => page.getByRole('row').filter({ hasText: `Kamar ${roomNumber}` })
const checkoutTotal = (page: Page) => page.getByText('Total perkiraan', { exact: true }).locator('xpath=../..')

async function fillApplication(page: Page, occupation: string, note?: string) {
  await page.getByLabel('Pekerjaan atau kegiatan utama').fill(occupation)
  if (note) await page.getByLabel(/Catatan untuk pemilik/).fill(note)
}

test('scenario 1: the room picker shows vacant, held, full, reserved-for-queue and offered-to-me rooms', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'avail', rooms: 2 })
  const viewer = await newStudent(browser, { label: 'avail-view' })
  const holderA = await newStudent(browser, { label: 'avail-a' })
  const holderB = await newStudent(browser, { label: 'avail-b' })
  const waiter = await newStudent(browser, { label: 'avail-wait' })
  watch(viewer.page, problems)
  watch(waiter.page, problems)
  const [room0, room1] = owner.rooms
  const tile = viewer.page.locator('.room-picker__option')
  try {
    await test.step('both rooms vacant: the tile counts them and Ajukan Sewa is open', async () => {
      await viewer.page.goto(`/kos/${owner.kosId}`)
      await expect(tile).toHaveCount(1)
      await expect(tile).toContainText('2 dari 2 kamar tersedia')
      await expect(viewer.page.getByRole('button', { name: 'Ajukan Sewa' })).toBeEnabled()
    })

    await test.step('one room approved: the owner board says Dipesan and the tile counts one vacant', async () => {
      const a = await hold(owner, holderA, room0.id)
      await viewer.page.reload()
      await expect(tile).toContainText('1 dari 2 kamar tersedia')
      await ownerBoard(owner)
      await expect(boardRow(owner.page, room0.roomNumber).getByText('Dipesan', { exact: true })).toBeVisible()
      await expect(boardRow(owner.page, room1.roomNumber).getByText('Kosong', { exact: true })).toBeVisible()
      expect(a.tenancyId).toBeTruthy()
    })

    let tenancyA = ''
    await test.step('both rooms held: tile is full and the sidebar offers the waiting list', async () => {
      await hold(owner, holderB, room1.id)
      ;[{ id: tenancyA }] = await sql<{ id: string }>('SELECT id FROM "Tenancy" WHERE "roomId" = $1', [room0.id])
      await viewer.page.reload()
      await expect(tile).toContainText('0 dari 2 kamar tersedia')
      await expect(tile).toContainText('Ikut daftar tunggu')
      await expect(viewer.page.getByTestId('waitlist-join')).toContainText('Kamar Penuh')
    })

    await test.step('a freed room goes to the queue: the waiting student sees the offer, everyone else sees it reserved', async () => {
      await trpcPost(waiter.ctx, 'waitlist.join', { kosId: owner.kosId, roomType: null })
      await trpcPost(owner.ctx, 'owner.tenancy.end', { kosId: owner.kosId, tenancyId: tenancyA })

      await waiter.page.goto(`/kos/${owner.kosId}`)
      await expect(waiter.page.getByTestId('waitlist-offer')).toContainText(`Kamar ${room0.roomNumber} ditawarkan untukmu`)
      await expect(waiter.page.getByRole('button', { name: 'Pesan Sekarang' })).toBeVisible()

      await viewer.page.reload()
      await expect(tile).toContainText('Dipesan antrean')
      await expect(tile).toContainText('0 dari 2 kamar tersedia')
      await expect(viewer.page.getByTestId('waitlist-offer')).toHaveCount(0)
    })
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, viewer.ctx, holderA.ctx, holderB.ctx, waiter.ctx)
  }
})

test('scenario 1: checkout total equals the first invoice, with and without a verified campus email', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'price', rooms: 2, price: 1_500_000, discount: 100_000 })
  const plain = await newStudent(browser, { label: 'price-plain' })
  const campus = await newStudent(browser, { label: 'price-campus', campus: true })
  watch(plain.page, problems)
  watch(campus.page, problems)
  try {
    const cases = [
      { who: plain, room: owner.rooms[0], total: 1_525_000, discount: false },
      { who: campus, room: owner.rooms[1], total: 1_425_000, discount: true },
    ]
    for (const c of cases) {
      await test.step(`${c.discount ? 'verified campus email' : 'no campus email'}: total ${c.total}`, async () => {
        await c.who.page.goto(`/checkout/${owner.kosId}?room=${c.room.id}`)
        const total = checkoutTotal(c.who.page)
        await expect(total).toBeVisible()
        expect(digits(await total.textContent())).toBe(c.total)
        if (c.discount) await expect(c.who.page.locator('aside').getByText('Diskon mahasiswa', { exact: true })).toBeVisible()
        else await expect(c.who.page.locator('aside').getByText('Diskon mahasiswa', { exact: true })).toHaveCount(0)

        // What the page promised is what the owner's approval bills.
        const applicationId = await apply(c.who, c.room.id)
        await approve(owner, owner.kosId, applicationId)
        const invoice = await sql<{ amount: number }>(
          'SELECT i.amount FROM "Invoice" i JOIN "RentalApplication" a ON a."tenancyId" = i."tenancyId" WHERE a.id = $1',
          [applicationId],
        )
        expect(invoice).toHaveLength(1)
        expect(invoice[0].amount).toBe(c.total)
      })
    }
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, plain.ctx, campus.ctx)
  }
})

test('scenario 2: a signed-out visitor signs in from the checkout and can apply for the same room', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'login', rooms: 2 })
  const account = await newStudent(browser, { label: 'login-user' })
  const visitor = await newContext(browser)
  watch(visitor.page, problems)
  const { page } = visitor
  const room = owner.rooms[1]
  try {
    await page.goto(`/checkout/${owner.kosId}?room=${room.id}`)
    await expect(page.getByText(`Kamar ${room.roomNumber}`).first()).toBeVisible()
    // The form validates first, so a signed-out visitor fills it in before being asked to sign in.
    await fillApplication(page, 'Mahasiswa BINUS')
    await page.getByRole('button', { name: 'Masuk untuk Mengajukan' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Email').fill(account.email)
    await dialog.getByLabel('Kata Sandi').fill(PASSWORD)
    await dialog.getByRole('button', { name: 'Masuk ke Akun' }).click()
    await expect(dialog).toHaveCount(0)

    // KNOWN DEFECT (audit): signing in with a password sends the browser to the e-mail verification landing page
    // (AuthModal.tsx passes callbackURL '/verifikasi-email'), so the visitor leaves the checkout and is told "Email berhasil
    // diverifikasi" although nothing was verified. The room is only kept because it lives in the checkout URL.
    await test.step('password sign-in leaves the checkout for the verification page (current behaviour)', async () => {
      await expect(page).toHaveURL(/\/verifikasi-email/)
      await expect(page.getByRole('heading', { name: 'Email berhasil diverifikasi' })).toBeVisible()
    })

    await test.step('opening the same checkout address again keeps the room and lets the signed-in student submit', async () => {
      await page.goto(`/checkout/${owner.kosId}?room=${room.id}`)
      await expect(page.getByText(`Kamar ${room.roomNumber}`).first()).toBeVisible()
      await expect(page.getByText(account.email)).toBeVisible()
      await fillApplication(page, 'Mahasiswa BINUS')
      await page.getByRole('button', { name: 'Kirim Pengajuan' }).click()
      await expect(page.getByRole('heading', { name: 'Pengajuan Terkirim' })).toBeVisible()
    })

    const rows = await sql<{ roomId: string; status: string; userId: string }>(
      'SELECT "roomId", status, "userId" FROM "RentalApplication" WHERE "userId" = $1', [account.userId])
    expect(rows).toEqual([{ roomId: room.id, status: 'PENDING', userId: account.userId }])
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, account.ctx, visitor.ctx)
  }
})

test('scenario 3: form limits stop bad input in the browser and the server refuses what slips through', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'valid', rooms: 1 })
  const student = await newStudent(browser, { label: 'valid-stu' })
  const { page } = student
  watch(page, problems)
  const room = owner.rooms[0]
  const created: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('application.create')) created.push(r.url())
  })
  try {
    await page.goto(`/checkout/${owner.kosId}?room=${room.id}`)
    const submit = page.getByRole('button', { name: 'Kirim Pengajuan' })
    const date = page.getByLabel('Tanggal Mulai Sewa')

    await test.step('occupation is required: no request is sent', async () => {
      await submit.click()
      expect(await page.getByLabel('Pekerjaan atau kegiatan utama').evaluate((el) => (el as HTMLInputElement).validity.valueMissing)).toBe(true)
      expect(created).toHaveLength(0)
    })

    await test.step('a past start date is blocked by the date field', async () => {
      await fillApplication(page, 'Mahasiswa')
      await date.fill(wibToday(-2))
      await submit.click()
      expect(await date.evaluate((el) => (el as HTMLInputElement).validity.rangeUnderflow)).toBe(true)
      expect(created).toHaveLength(0)
    })

    await test.step('a start date beyond 120 days is blocked by the date field', async () => {
      await date.fill(wibToday(130))
      await submit.click()
      expect(await date.evaluate((el) => (el as HTMLInputElement).validity.rangeOverflow)).toBe(true)
      expect(created).toHaveLength(0)
      await date.fill(wibToday(3))
    })

    await test.step('duration offers 1 to 12 months and the note stops at 500 characters', async () => {
      await expect(page.getByLabel('Durasi Sewa').locator('option')).toHaveCount(12)
      await page.getByLabel(/Catatan untuk pemilik/).fill('x'.repeat(600))
      expect((await page.getByLabel(/Catatan untuk pemilik/).inputValue()).length).toBe(500)
      await page.getByLabel(/Catatan untuk pemilik/).fill('')
    })

    await test.step('a one-character occupation passes the browser and the server answers with the generic copy', async () => {
      await fillApplication(page, 'A')
      await submit.click()
      await expect(page.getByRole('alert')).toContainText('Data yang dikirim tidak valid. Periksa kembali isian Anda.')
      expect(created).toHaveLength(1)
      expectHttpErrors(problems, 400)
    })

    await test.step('the server itself refuses past, far, long and out-of-range input', async () => {
      const base = { roomId: room.id, startDate: wibToday(3), durationMonths: 3, occupation: 'Mahasiswa' }
      const past = await trpcRaw(student.ctx, 'application.create', { ...base, startDate: wibToday(-2) })
      expect([past.status, past.message]).toEqual([400, 'Tanggal mulai tidak boleh di masa lalu.'])
      const far = await trpcRaw(student.ctx, 'application.create', { ...base, startDate: wibToday(400) })
      expect([far.status, far.message]).toEqual([400, 'Tanggal mulai terlalu jauh dari hari ini.'])
      expect((await trpcRaw(student.ctx, 'application.create', { ...base, durationMonths: 13 })).status).toBe(400)
      expect((await trpcRaw(student.ctx, 'application.create', { ...base, durationMonths: 0 })).status).toBe(400)
      expect((await trpcRaw(student.ctx, 'application.create', { ...base, note: 'x'.repeat(501) })).status).toBe(400)
      expect((await trpcRaw(student.ctx, 'application.create', { ...base, occupation: ' ' })).status).toBe(400)
      expect((await trpcRaw(student.ctx, 'application.create', { ...base, roomId: 'tidak-ada' })).message).toBe('Kamar tidak ditemukan.')
      expect(await sql('SELECT id FROM "RentalApplication" WHERE "userId" = $1', [student.userId])).toHaveLength(0)
    })
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 3: a room approved for someone else meanwhile is refused with a clear message', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'race', rooms: 1 })
  const first = await newStudent(browser, { label: 'race-first' })
  const late = await newStudent(browser, { label: 'race-late' })
  watch(late.page, problems)
  const room = owner.rooms[0]
  try {
    // The late student opens the form while the room is still free...
    await late.page.goto(`/checkout/${owner.kosId}?room=${room.id}`)
    await fillApplication(late.page, 'Mahasiswa')
    await expect(late.page.getByRole('button', { name: 'Kirim Pengajuan' })).toBeVisible()

    // ...and loses the room to an approved application before submitting.
    await hold(owner, first, room.id)
    await late.page.getByRole('button', { name: 'Kirim Pengajuan' }).click()
    await expect(late.page.getByRole('alert')).toContainText('Kamar ini sudah tidak tersedia untuk pengajuan.')
    expectHttpErrors(problems, 409)

    await test.step('opening the form for the held room shows the unavailable state', async () => {
      await late.page.reload()
      await expect(late.page.getByRole('heading', { name: 'Kamar ini sudah tidak tersedia' })).toBeVisible()
      await expect(late.page.getByRole('link', { name: 'Pilih Kamar Lain' })).toBeVisible()
    })
    expect(await sql('SELECT id FROM "RentalApplication" WHERE "userId" = $1', [late.userId])).toHaveLength(0)
  } finally {
    await closeAll(owner.ctx, first.ctx, late.ctx)
  }
})

test('scenario 3: a second application for the same room by the same student is refused', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'dup', rooms: 1 })
  const student = await newStudent(browser, { label: 'dup-stu' })
  watch(student.page, problems)
  const room = owner.rooms[0]
  try {
    await apply(student, room.id)
    await student.page.goto(`/checkout/${owner.kosId}?room=${room.id}`)
    await fillApplication(student.page, 'Mahasiswa')
    await student.page.getByRole('button', { name: 'Kirim Pengajuan' }).click()
    await expect(student.page.getByRole('alert')).toContainText('Anda sudah memiliki pengajuan aktif untuk kamar ini.')
    expectHttpErrors(problems, 409)
    expect(await sql('SELECT id FROM "RentalApplication" WHERE "userId" = $1', [student.userId])).toHaveLength(1)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 4: a submitted application reads "Menunggu Pemilik" for the student and is listed for the owner', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'peng', rooms: 1 })
  const student = await newStudent(browser, { label: 'peng-stu' })
  watch(student.page, problems)
  const room = owner.rooms[0]
  const note = `Saya mahasiswa semester 3 (${Date.now()})`
  try {
    await test.step('the student submits through the form', async () => {
      await student.page.goto(`/kos/${owner.kosId}`)
      await student.page.getByRole('button', { name: 'Ajukan Sewa' }).click()
      await expect(student.page).toHaveURL(new RegExp(`/checkout/${owner.kosId}\\?room=${room.id}`))
      await fillApplication(student.page, 'Mahasiswa BINUS', note)
      await student.page.getByRole('button', { name: 'Kirim Pengajuan' }).click()
      await expect(student.page.getByRole('heading', { name: 'Pengajuan Terkirim' })).toBeVisible()
      await expect(student.page.getByText('Kamar belum ditahan dan Anda belum perlu membayar sebelum pengajuan diterima.')).toBeVisible()
    })

    await test.step('the student sees it as waiting, with no room held and nothing to pay', async () => {
      await student.page.getByRole('link', { name: 'Pantau Pengajuan' }).click()
      await expect(student.page.getByRole('tab', { name: 'Pengajuan Sewa (1)' })).toBeVisible()
      await student.page.getByRole('tab', { name: /Pengajuan Sewa/ }).click()
      const card = student.page.getByTestId('application-card').filter({ hasText: owner.kosName })
      await expect(card).toContainText('Menunggu Pemilik')
      await expect(card).toContainText(`Kamar ${room.roomNumber}`)
      await expect(card).toContainText('Kamar belum ditahan. Pemilik sedang meninjau pengajuan.')
      await student.page.getByRole('tab', { name: /Kamar yang Disewa/ }).click()
      await expect(student.page.getByTestId('tenancy-card')).toHaveCount(0)
      await expect(student.page.getByRole('button', { name: 'Bayar Sekarang' })).toHaveCount(0)
    })

    await test.step('the owner sees who applied, for which room, and can decide', async () => {
      await ownerBoard(owner)
      const row = ownerRow(owner.page, 'Mahasiswa BINUS')
      await expect(row).toContainText('Penguji E2E')
      await expect(row).toContainText(`Kamar ${room.roomNumber}, Standar`)
      await expect(row).toContainText('1 bulan, Mahasiswa BINUS')
      await expect(row).toContainText(note)
      await expect(row.getByRole('button', { name: 'Terima' })).toBeEnabled()
      await expect(row.getByRole('button', { name: 'Tolak' })).toBeEnabled()
    })

    await test.step('nothing was held or billed', async () => {
      expect(await sql('SELECT id FROM "Tenancy" WHERE "roomId" = $1', [room.id])).toHaveLength(0)
      expect(await sql('SELECT i.id FROM "Invoice" i JOIN "Tenancy" t ON t.id = i."tenancyId" WHERE t."roomId" = $1', [room.id])).toHaveLength(0)
    })
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 6: approving holds the room for 24 hours with an unpaid first invoice and no payment', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'appr', rooms: 1 })
  const student = await newStudent(browser, { label: 'appr-stu' })
  watch(student.page, problems)
  const room = owner.rooms[0]
  try {
    const applicationId = await apply(student, room.id, { months: 3 })

    await test.step('the owner confirms the approval', async () => {
      await ownerBoard(owner)
      await ownerRow(owner.page, 'Mahasiswa').getByRole('button', { name: 'Terima' }).click()
      const dialog = owner.page.getByRole('dialog')
      await expect(dialog).toContainText('Terima pengajuan?')
      await expect(dialog).toContainText('Kamar akan ditahan 24 jam untuk pembayaran Penguji E2E.')
      await dialog.getByRole('button', { name: 'Terima Pengajuan' }).click()
      await expect(ownerRow(owner.page, 'Mahasiswa')).toHaveCount(0)
      await expect(boardRow(owner.page, room.roomNumber).getByText('Dipesan', { exact: true })).toBeVisible()
    })

    await test.step('the database holds a PENDING tenancy for 24 hours, one UNPAID invoice and no payment', async () => {
      await expect.poll(async () => (await sql<{ status: string }>('SELECT status FROM "RentalApplication" WHERE id = $1', [applicationId]))[0].status).toBe('APPROVED')
      const [tenancy] = await sql<{ id: string; status: string; hours: number }>(
        `SELECT t.id, t.status, extract(epoch FROM (t."expiresAt" - now())) / 3600 AS hours
           FROM "Tenancy" t JOIN "RentalApplication" a ON a."tenancyId" = t.id WHERE a.id = $1`, [applicationId])
      expect(tenancy.status).toBe('PENDING')
      expect(Number(tenancy.hours)).toBeGreaterThan(23.5)
      expect(Number(tenancy.hours)).toBeLessThanOrEqual(24)
      const invoices = await sql<{ status: string; amount: number }>('SELECT status, amount FROM "Invoice" WHERE "tenancyId" = $1', [tenancy.id])
      expect(invoices).toEqual([{ status: 'UNPAID', amount: 1_525_000 }])
      expect(await sql('SELECT p.id FROM "Payment" p JOIN "Invoice" i ON i.id = p."invoiceId" WHERE i."tenancyId" = $1', [tenancy.id])).toHaveLength(0)
    })

    await test.step('the student sees what to pay and until when', async () => {
      await student.page.goto('/my-kos')
      const card = student.page.getByTestId('tenancy-card').filter({ hasText: owner.kosName })
      await expect(card).toHaveAttribute('data-status', 'PENDING')
      await expect(card).toContainText('Menunggu Pembayaran')
      await expect(card).toContainText('Kamar ditahan sampai')
      const invoiceRow = card.getByRole('row').filter({ hasText: 'Bulan 1' })
      await expect(invoiceRow).toContainText('Belum dibayar')
      await expect(invoiceRow).toContainText('1.525.000')
      await expect(invoiceRow.getByRole('button', { name: 'Bayar Sekarang' })).toBeEnabled()

      await student.page.getByRole('tab', { name: /Pengajuan Sewa/ }).click()
      const application = student.page.getByTestId('application-card').filter({ hasText: owner.kosName })
      await expect(application).toContainText('Diterima')
      await expect(application).toContainText('Pengajuan diterima. Bayar tagihan pertama di tab Kamar yang Disewa sebelum batas waktunya.')
    })
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('scenario 7: rejecting creates nothing, frees the room for others and tells the student "Tidak Diterima"', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'rej', rooms: 1 })
  const student = await newStudent(browser, { label: 'rej-stu' })
  const other = await newStudent(browser, { label: 'rej-other' })
  watch(student.page, problems)
  const room = owner.rooms[0]
  try {
    const applicationId = await apply(student, room.id)

    await test.step('the owner confirms the rejection', async () => {
      await ownerBoard(owner)
      await ownerRow(owner.page, 'Mahasiswa').getByRole('button', { name: 'Tolak' }).click()
      const dialog = owner.page.getByRole('dialog')
      await expect(dialog).toContainText('Tolak pengajuan?')
      await expect(dialog).toContainText('Pengajuan Penguji E2E akan ditolak dan tidak menahan kamar.')
      await dialog.getByRole('button', { name: 'Tolak Pengajuan' }).click()
      await expect(ownerRow(owner.page, 'Mahasiswa')).toHaveCount(0)
    })

    await test.step('no tenancy, invoice or payment exists; the room stays vacant', async () => {
      await expect.poll(async () => (await sql<{ status: string }>('SELECT status FROM "RentalApplication" WHERE id = $1', [applicationId]))[0].status).toBe('REJECTED')
      const [app] = await sql<{ tenancyId: string | null }>('SELECT "tenancyId" FROM "RentalApplication" WHERE id = $1', [applicationId])
      expect(app.tenancyId).toBeNull()
      expect(await sql('SELECT id FROM "Tenancy" WHERE "roomId" = $1', [room.id])).toHaveLength(0)
      await ownerBoard(owner)
      await expect(boardRow(owner.page, room.roomNumber).getByText('Kosong', { exact: true })).toBeVisible()
    })

    await test.step('the student sees the outcome without any rental or payment', async () => {
      await student.page.goto('/my-kos')
      await student.page.getByRole('tab', { name: /Pengajuan Sewa/ }).click()
      const card = student.page.getByTestId('application-card').filter({ hasText: owner.kosName })
      await expect(card).toContainText('Tidak Diterima')
      await expect(card).not.toContainText('Menunggu Pemilik')
      await student.page.getByRole('tab', { name: /Kamar yang Disewa/ }).click()
      await expect(student.page.getByTestId('tenancy-card')).toHaveCount(0)
    })

    await test.step('the room can still be applied for', async () => {
      await expect(apply(other, room.id)).resolves.toBeTruthy()
    })
    expectHttpErrors(problems)
  } finally {
    await closeAll(owner.ctx, student.ctx, other.ctx)
  }
})

test('scenario 8: approving one of two applicants rejects the other, and a stale second approval is refused', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'two', rooms: 1 })
  const a = await newStudent(browser, { label: 'two-a' })
  const b = await newStudent(browser, { label: 'two-b' })
  watch(b.page, problems)
  const stale = await owner.ctx.newPage()
  watch(stale, problems)
  const room = owner.rooms[0]
  try {
    const appA = await apply(a, room.id, { occupation: 'Pelamar Pertama' })
    const appB = await apply(b, room.id, { occupation: 'Pelamar Kedua' })

    await test.step('the owner sees both and keeps a second window open on the same list', async () => {
      await ownerBoard(owner)
      await expect(owner.page.getByTestId('owner-application')).toHaveCount(2)
      await stale.goto(`/owner/dashboard?kos=${owner.kosId}`)
      await expect(stale.getByTestId('owner-application')).toHaveCount(2)
    })

    await test.step('approving the first removes both from the list', async () => {
      await ownerRow(owner.page, 'Pelamar Pertama').getByRole('button', { name: 'Terima' }).click()
      await owner.page.getByRole('dialog').getByRole('button', { name: 'Terima Pengajuan' }).click()
      await expect(owner.page.getByTestId('owner-application')).toHaveCount(0)
      await expect.poll(async () => (await sql<{ id: string; status: string }>('SELECT id, status FROM "RentalApplication" WHERE id = ANY($1)', [[appA, appB]])).map((r) => `${r.id === appA ? 'A' : 'B'}:${r.status}`).sort()).toEqual(['A:APPROVED', 'B:REJECTED'])
      expect(await sql(`SELECT id FROM "Tenancy" WHERE "roomId" = $1 AND status IN ('PENDING','ACTIVE')`, [room.id])).toHaveLength(1)
    })

    await test.step('the second applicant is told "Tidak Diterima" and cannot take the room', async () => {
      await b.page.goto('/my-kos')
      await expect(b.page.getByTestId('application-card').filter({ hasText: owner.kosName })).toContainText('Tidak Diterima')
      await b.page.goto(`/checkout/${owner.kosId}?room=${room.id}`)
      await expect(b.page.getByRole('heading', { name: 'Kamar ini sudah tidak tersedia' })).toBeVisible()
    })

    await test.step('the stale window cannot approve the applicant who is already rejected', async () => {
      await ownerRow(stale, 'Pelamar Kedua').getByRole('button', { name: 'Terima' }).click()
      await stale.getByRole('dialog').getByRole('button', { name: 'Terima Pengajuan' }).click()
      await expect(stale.getByRole('alert')).toContainText('Pengajuan ini sudah diputuskan.')
      expectHttpErrors(problems, 409)
      expect(await sql(`SELECT id FROM "Tenancy" WHERE "roomId" = $1 AND status IN ('PENDING','ACTIVE')`, [room.id])).toHaveLength(1)
    })
  } finally {
    await closeAll(owner.ctx, a.ctx, b.ctx)
  }
})

test('scenario 8: two approvals fired at once leave exactly one live tenancy', async ({ browser }) => {
  const owner = await newOwnerWorld(browser, { label: 'race2', rooms: 1 })
  const a = await newStudent(browser, { label: 'race2-a' })
  const b = await newStudent(browser, { label: 'race2-b' })
  const room = owner.rooms[0]
  try {
    const appA = await apply(a, room.id)
    const appB = await apply(b, room.id)
    const results = await Promise.all(
      [appA, appB].map((applicationId) => trpcRaw(owner.ctx, 'application.decide', { kosId: owner.kosId, applicationId, decision: 'APPROVE' })),
    )
    expect(results.map((r) => r.status).sort(), JSON.stringify(results.map((r) => r.message))).toEqual([200, 409])
    expect(await sql(`SELECT id FROM "Tenancy" WHERE "roomId" = $1 AND status IN ('PENDING','ACTIVE')`, [room.id])).toHaveLength(1)
    const statuses = (await sql<{ status: string }>('SELECT status FROM "RentalApplication" WHERE id = ANY($1)', [[appA, appB]])).map((r) => r.status).sort()
    expect(statuses).toEqual(['APPROVED', 'REJECTED'])
  } finally {
    await closeAll(owner.ctx, a.ctx, b.ctx)
  }
})

test('scenario 9: approving an application for a room already offered to a queued student is refused', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'offer', rooms: 1 })
  const applicant = await newStudent(browser, { label: 'offer-app' })
  const queued = await newStudent(browser, { label: 'offer-queue' })
  const stale = owner.page
  watch(stale, problems)
  const room = owner.rooms[0]
  try {
    const applicationId = await apply(applicant, room.id, { occupation: 'Pelamar Awal' })
    // The room is vacant with a pending application when the queue is handed it (the only way to reach this state: an offer
    // needs a freed room, and a freed room cannot be applied for first).
    await sql(
      `INSERT INTO "WaitlistEntry" (id, "kosId", "userId", "roomType", status, "offeredRoomId", "offerExpiresAt")
       VALUES (gen_random_uuid()::text, $1, $2, NULL, 'OFFERED', $3, now() + interval '1 day')`,
      [owner.kosId, queued.userId, room.id],
    )
    await ownerBoard(owner)
    await ownerRow(stale, 'Pelamar Awal').getByRole('button', { name: 'Terima' }).click()
    await stale.getByRole('dialog').getByRole('button', { name: 'Terima Pengajuan' }).click()
    await expect(stale.getByRole('alert')).toContainText('Kamar ini sedang ditawarkan ke pengantre lain.')
    expectHttpErrors(problems, 409)

    const [app] = await sql<{ status: string; tenancyId: string | null }>('SELECT status, "tenancyId" FROM "RentalApplication" WHERE id = $1', [applicationId])
    expect(app).toEqual({ status: 'PENDING', tenancyId: null })
    expect(await sql('SELECT id FROM "Tenancy" WHERE "roomId" = $1', [room.id])).toHaveLength(0)
    await expect(ownerRow(stale, 'Pelamar Awal')).toHaveCount(1)
  } finally {
    await closeAll(owner.ctx, applicant.ctx, queued.ctx)
  }
})
