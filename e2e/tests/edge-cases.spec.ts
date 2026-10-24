import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { outboxLink, uniqueIp } from './accounts'
import { expireSession, hold, newContext, newOwnerWorld, newStudent, sql, trpcPost, trpcRaw, watch, expectHttpErrors } from './seams'

// Edge cases around the booking flow: signed-out visitors, a session that dies mid-form, read-only demo accounts,
// an unverified e-mail address, and whether the prices on screen are the prices the server bills.

test.skip(!!process.env.BASE_URL, 'needs the e2e hooks and database, which only the local e2e server provides')

const digits = (text: string | null) => Number((text ?? '').replace(/\D/g, ''))
const origin = () => ({ origin: new URL(test.info().project.use.baseURL as string).origin })
const sidebarTotal = (page: Page) => page.getByText('Total Estimasi', { exact: true }).locator('xpath=..')
const checkoutTotal = (page: Page) => page.getByText('Total perkiraan', { exact: true }).locator('xpath=../..')

test('scenario 27: signed-out visitors are asked to sign in on /my-kos, /checkout and /kuitansi', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'out', rooms: 1 })
  const visitor = await newContext(browser)
  const { page } = visitor
  watch(page, problems)
  try {
    await test.step('/my-kos', async () => {
      await page.goto('/my-kos')
      await expect(page.getByRole('heading', { name: 'Masuk untuk Melihat Kos Anda' })).toBeVisible()
      await page.getByRole('tab', { name: /Pengajuan Sewa/ }).click()
      await expect(page.getByRole('heading', { name: 'Masuk untuk melihat pengajuan Anda' })).toBeVisible()
      await page.getByRole('button', { name: 'Masuk', exact: true }).last().click()
      await expect(page.getByRole('dialog')).toBeVisible()
    })

    await test.step('/checkout shows the form but asks to sign in to send it', async () => {
      await page.goto(`/checkout/${owner.kosId}?room=${owner.rooms[0].id}`)
      await expect(page.getByRole('button', { name: 'Masuk untuk Mengajukan' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Kirim Pengajuan' })).toHaveCount(0)
    })

    await test.step('/kuitansi', async () => {
      await page.goto('/kuitansi/1')
      await expect(page.getByRole('heading', { name: 'Masuk untuk Melihat Kuitansi' })).toBeVisible()
    })

    await test.step('the API says the same', async () => {
      const refused = await trpcRaw(visitor.ctx, 'application.create', { roomId: owner.rooms[0].id, startDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), durationMonths: 3, occupation: 'Mahasiswa' })
      expect([refused.status, refused.message]).toEqual([401, 'Silakan masuk terlebih dahulu.'])
      expect(await sql('SELECT id FROM "RentalApplication" WHERE "roomId" = $1', [owner.rooms[0].id])).toHaveLength(0)
    })
    expectHttpErrors(problems, 401)
  } finally {
    await Promise.all([owner.ctx.close(), visitor.ctx.close()])
  }
})

test('scenario 27: a session that ends while the form is open is refused politely and nothing is sent', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'expire', rooms: 1 })
  const student = await newStudent(browser, { label: 'expire-stu' })
  const { page } = student
  watch(page, problems)
  const room = owner.rooms[0]
  try {
    await page.goto(`/checkout/${owner.kosId}?room=${room.id}`)
    await page.getByLabel('Pekerjaan atau kegiatan utama').fill('Mahasiswa')
    await expect(page.getByRole('button', { name: 'Kirim Pengajuan' })).toBeVisible()

    await expireSession(student.userId)
    await page.getByRole('button', { name: 'Kirim Pengajuan' }).click()
    await expect(page.getByRole('alert')).toContainText('Silakan masuk terlebih dahulu.')
    expect(await sql('SELECT id FROM "RentalApplication" WHERE "userId" = $1', [student.userId])).toHaveLength(0)
    expectHttpErrors(problems, 401)

    await test.step('a reload shows the visitor state', async () => {
      await page.reload()
      await expect(page.getByRole('button', { name: 'Masuk untuk Mengajukan' })).toBeVisible()
    })
  } finally {
    await Promise.all([owner.ctx.close(), student.ctx.close()])
  }
})

test('scenario 27: a demo account cannot change its password or campus e-mail, and says so in Indonesian', async ({ browser, problems }) => {
  const demo = await newStudent(browser, { label: 'demo-ro', demo: true })
  const real = await newStudent(browser, { label: 'real-pw' })
  try {
    const headers = { ...origin(), 'cf-connecting-ip': uniqueIp() }
    const change = { currentPassword: 'Sandi-rahasia-123', newPassword: 'Sandi-baru-45678' }

    await test.step('demo: change-password and campus-email are forbidden', async () => {
      const pw = await demo.ctx.request.post('/api/auth/change-password', { data: change, headers })
      expect(pw.status()).toBe(403)
      expect(await pw.json()).toMatchObject({ code: 'DEMO_ACCOUNT_READONLY', message: 'Akun demo bersifat hanya-baca: kata sandi, email, dan penghapusan akun tidak dapat diubah.' })
      const campus = await demo.ctx.request.post('/api/auth/campus-email/request', { data: { email: 'demo@student.binus.ac.id' }, headers })
      expect(campus.status()).toBe(403)
      expect(await campus.json()).toMatchObject({ code: 'DEMO_ACCOUNT_READONLY' })
    })

    await test.step('control: a real account gets an ordinary password error, not the demo block', async () => {
      const wrong = await real.ctx.request.post('/api/auth/change-password', { data: { ...change, currentPassword: 'bukan-sandi-saya-1' }, headers })
      expect(wrong.status()).toBe(400)
      expect((await wrong.json()).code).toBe('INVALID_PASSWORD')
    })

    await test.step('the demo account keeps its password', async () => {
      const again = await demo.ctx.request.post('/api/auth/sign-in/email', { data: { email: demo.email, password: change.currentPassword }, headers: { ...headers, 'cf-connecting-ip': uniqueIp() } })
      expect(again.ok()).toBe(true)
    })
    void problems
  } finally {
    await Promise.all([demo.ctx.close(), real.ctx.close()])
  }
})

test('scenario 27: an unverified e-mail cannot sign in, can ask for a new link, and can apply once verified', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'unver', rooms: 1 })
  const visitor = await newContext(browser)
  const { page } = visitor
  watch(page, problems)
  const email = `unverified-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
  const password = 'Sandi-rahasia-123'
  try {
    const up = await visitor.ctx.request.post('/api/auth/sign-up/email', { data: { name: 'Belum Verifikasi', email, password }, headers: { ...origin(), 'cf-connecting-ip': uniqueIp() } })
    expect(up.ok(), 'sign-up').toBe(true)

    await test.step('sign-in is stopped with a clear explanation', async () => {
      await page.goto(`/checkout/${owner.kosId}?room=${owner.rooms[0].id}`)
      await page.getByLabel('Pekerjaan atau kegiatan utama').fill('Mahasiswa')
      await page.getByRole('button', { name: 'Masuk untuk Mengajukan' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Email').fill(email)
      await dialog.getByLabel('Kata Sandi').fill(password)
      await dialog.getByRole('button', { name: 'Masuk ke Akun' }).click()
      await expect(dialog).toContainText(`Akun ${email} belum diverifikasi. Buka tautan di email pendaftaran, atau kirim ulang tautannya.`)
      await expect(dialog.getByRole('button', { name: 'Kirim ulang email verifikasi' })).toBeVisible()
      expectHttpErrors(problems, 403)
    })

    await test.step('there is no session, so the API refuses an application', async () => {
      const refused = await trpcRaw(visitor.ctx, 'application.create', { roomId: owner.rooms[0].id, startDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), durationMonths: 3, occupation: 'Mahasiswa' })
      expect(refused.status).toBe(401)
      expectHttpErrors(problems, 401)
    })

    await test.step('asking for a new link says so', async () => {
      await page.getByRole('button', { name: 'Kirim ulang email verifikasi' }).click()
      await expect(page.getByRole('dialog')).toContainText('Tautan verifikasi dikirim ulang. Periksa kotak masuk dan folder spam Anda.')
    })

    await test.step('after following the link the account can apply', async () => {
      const link = await outboxLink(email, 'verify-email')
      const verified = await visitor.ctx.request.get(link, { headers: { 'cf-connecting-ip': uniqueIp() } })
      expect(verified.ok()).toBe(true)
      const [user] = await sql<{ id: string; emailVerified: boolean }>('SELECT id, "emailVerified" FROM "User" WHERE email = $1', [email])
      expect(user.emailVerified).toBe(true)
      const app = await trpcPost<{ id: string; status: string }>(visitor.ctx, 'application.create', { roomId: owner.rooms[0].id, startDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), durationMonths: 3, occupation: 'Mahasiswa' })
      expect(app.status).toBe('PENDING')
    })
  } finally {
    await Promise.all([owner.ctx.close(), visitor.ctx.close()])
  }
})

test('scenario 27: the checkout total and the first invoice agree; the detail sidebar estimate does not for discounted kos', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'prices', rooms: 3, price: 1_500_000, discount: 100_000 })
  const plain = await newStudent(browser, { label: 'prices-plain' })
  const campus = await newStudent(browser, { label: 'prices-campus', campus: true })
  watch(plain.page, problems)
  watch(campus.page, problems)
  try {
    await test.step('one month, no verified campus e-mail', async () => {
      await plain.page.goto(`/kos/${owner.kosId}`)
      // DISCREPANCY: the sidebar subtracts the student discount for everyone, though only a verified campus e-mail gets it.
      expect(digits(await sidebarTotal(plain.page).textContent())).toBe(1_425_000)
      await expect(plain.page.getByText('Diskon aktif otomatis setelah verifikasi email kampus.')).toBeVisible()
      await plain.page.getByRole('button', { name: 'Ajukan Sewa' }).click()
      await expect(checkoutTotal(plain.page)).toBeVisible()
      expect(digits(await checkoutTotal(plain.page).textContent())).toBe(1_525_000)
      const held = await hold(owner, plain, owner.rooms[0].id, { months: 1 })
      const [invoice] = await sql<{ amount: number }>('SELECT amount FROM "Invoice" WHERE id = $1', [held.invoiceId])
      expect(invoice.amount).toBe(1_525_000)
    })

    await test.step('one month, verified campus e-mail: sidebar, checkout and invoice agree', async () => {
      await campus.page.goto(`/kos/${owner.kosId}`)
      expect(digits(await sidebarTotal(campus.page).textContent())).toBe(1_425_000)
      await campus.page.getByRole('button', { name: 'Ajukan Sewa' }).click()
      await expect(checkoutTotal(campus.page)).toBeVisible()
      expect(digits(await checkoutTotal(campus.page).textContent())).toBe(1_425_000)
      const held = await hold(owner, campus, owner.rooms[1].id, { months: 1 })
      const [invoice] = await sql<{ amount: number }>('SELECT amount FROM "Invoice" WHERE id = $1', [held.invoiceId])
      expect(invoice.amount).toBe(1_425_000)
    })

    await test.step('three months: the sidebar discounts every month, the server only the first invoice', async () => {
      await campus.page.goto(`/kos/${owner.kosId}`)
      await campus.page.getByRole('button', { name: '3 Bulan' }).click()
      expect(digits(await sidebarTotal(campus.page).textContent())).toBe(4_225_000)

      const third = await newStudent(browser, { label: 'prices-three', campus: true })
      try {
        const held = await hold(owner, third, owner.rooms[2].id, { months: 3 })
        const paid = await trpcRaw(owner.ctx, 'payment.recordManual', { kosId: owner.kosId, invoiceId: held.invoiceId, method: 'CASH', confirmedAmount: 1_425_000 })
        expect(paid.status).toBe(200)
        const amounts = (await sql<{ amount: number }>('SELECT amount FROM "Invoice" WHERE "tenancyId" = $1 ORDER BY "dueDate"', [held.tenancyId])).map((r) => r.amount)
        // DISCREPANCY: 1.425.000 + 2 x 1.500.000 = 4.425.000 over the lease, 200.000 more than the sidebar's "Total Estimasi".
        expect(amounts).toEqual([1_425_000, 1_500_000, 1_500_000])
      } finally {
        await third.ctx.close()
      }
    })
    expectHttpErrors(problems)
  } finally {
    await Promise.all([owner.ctx.close(), plain.ctx.close(), campus.ctx.close()])
  }
})
