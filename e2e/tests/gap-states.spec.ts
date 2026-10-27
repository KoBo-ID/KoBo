import { test, expect } from '../gap/fixtures'
import { expectHttpErrors, newOwnerWorld, newStudent, signUpVerifiedOwner, sql } from '../gap/helpers'

// Gap tests for page states the old suite never reaches: a failing API, a slow API and brand-new accounts.
// Route fixtures only change what the browser receives; the assertions are about what the page then shows.

test.skip(!!process.env.BASE_URL, 'needs the e2e hooks and database, which only the local e2e server provides')

const serverError = { status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'x', code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } } }) }

test('[G-045][R-103] /search shows an Indonesian error with a retry, and the retry brings the list back', async ({ page, problems }) => {
  let fail = true
  await page.route('**/api/trpc/kos.search*', (route) => (fail ? route.fulfill(serverError) : route.fallback()))
  await page.goto('/search')
  const alert = page.getByRole('alert').filter({ hasText: 'Gagal memuat daftar kos' })
  await expect(alert).toBeVisible()
  await expect(page.getByText(/Menampilkan \d+ pilihan/)).toHaveCount(0)

  fail = false
  await alert.getByRole('button', { name: 'Coba Lagi' }).click()
  await expect(page.getByText(/Menampilkan \d+ pilihan/)).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'Gagal memuat daftar kos' })).toHaveCount(0)
  await expect(page.locator('.search-cards-grid a[href^="/kos/"]').first()).toBeVisible()
  expectHttpErrors(problems, 500)
})

test('[G-045][R-103] a failing kos.detail and booking.mine are errors, not "not found" and not an empty list', async ({ page, browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'state-detail', rooms: 1 })
  try {
    await page.route('**/api/trpc/kos.detail*', (route) => route.fulfill(serverError))
    await page.goto(`/kos/${owner.kosId}`)
    await expect(page.getByRole('alert').filter({ hasText: 'Gagal memuat detail kos' })).toBeVisible()
    await expect(page.getByText('Kos tidak ditemukan')).toHaveCount(0)

    // A fresh account, not the shared demo student: other specs end demo sessions, which made this check order-dependent.
    const student = await newStudent(browser, { label: 'state-mine' })
    try {
      await student.page.route('**/api/trpc/booking.mine*', (route) => route.fulfill(serverError))
      await student.page.goto('/my-kos')
      await expect(student.page.getByRole('alert').filter({ hasText: 'Gagal memuat daftar sewa Anda' })).toBeVisible()
      await expect(student.page.getByRole('alert').getByRole('button', { name: 'Coba Lagi' })).toBeVisible()
    } finally {
      await student.ctx.close()
    }
    expectHttpErrors(problems, 500)
  } finally {
    await owner.ctx.close()
  }
})

test('[G-048][R-103] a slow kos.search shows the loading state first and never a false empty result', async ({ page, problems }) => {
  await page.route('**/api/trpc/kos.search*', async (route) => {
    await new Promise((r) => setTimeout(r, 2500))
    await route.fallback()
  })
  await page.goto('/search')
  await expect(page.getByText('Memuat daftar kos…')).toBeVisible()
  await expect(page.locator('.search-cards-grid')).toHaveAttribute('aria-busy', 'true')
  await expect(page.getByText(/tidak ditemukan|Tidak ada kos/i)).toHaveCount(0)

  await expect(page.getByText(/Menampilkan \d+ pilihan/)).toBeVisible({ timeout: 8_000 })
  await expect(page.locator('.search-cards-grid')).toHaveAttribute('aria-busy', 'false')
  const hrefs = await page.locator('.search-cards-grid a[href^="/kos/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')))
  expect(new Set(hrefs).size).toBe(hrefs.length)
  expect(problems).toEqual([])
})

test('[G-047][R-103] brand-new accounts see empty states, not spinners or raw errors', async ({ browser, problems }) => {
  const student = await newStudent(browser, { label: 'state-new' })
  const owner = await signUpVerifiedOwner(browser, 'state-newowner')
  try {
    await student.page.goto('/my-kos')
    await expect(student.page.getByText('Memuat kamar Anda')).toHaveCount(0)
    await expect(student.page.getByRole('alert')).toHaveCount(0)
    await student.page.getByRole('tab', { name: /Pengajuan Sewa/ }).click()
    await expect(student.page.getByRole('heading', { name: 'Belum ada pengajuan sewa' })).toBeVisible()

    await owner.page.goto('/owner/dashboard')
    await expect(owner.page.getByRole('heading', { name: 'Belum ada kos' })).toBeVisible()
    await owner.page.goto('/owner/kos')
    await expect(owner.page.getByRole('alert')).toHaveCount(0)
    await expect(owner.page.getByText(/Memuat/)).toHaveCount(0)
    await owner.page.goto('/owner/reviews')
    await expect(owner.page.getByRole('alert')).toHaveCount(0)
    expectHttpErrors(problems)
  } finally {
    await Promise.all([student.ctx.close(), owner.ctx.close()])
  }
})

test('[G-046][R-103] when application.create fails the page says so in Indonesian, keeps what was typed, and the retry stores exactly one application', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'state-apply', rooms: 1 })
  const student = await newStudent(browser, { label: 'state-apply-stu' })
  const { page } = student
  let fail = true
  await page.route('**/api/trpc/application.create*', (route) => (fail ? route.fulfill(serverError) : route.fallback()))
  try {
    await page.goto(`/checkout/${owner.kosId}?room=${owner.rooms[0].id}`)
    const occupation = page.getByLabel('Pekerjaan atau kegiatan utama')
    await occupation.fill('Mahasiswa BINUS')
    await page.getByRole('button', { name: 'Kirim Pengajuan' }).click()

    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    expect(await alert.textContent()).toMatch(/coba lagi|kesalahan|gagal/i)
    await expect(occupation).toHaveValue('Mahasiswa BINUS')
    await expect(page.getByRole('button', { name: 'Kirim Pengajuan' })).toBeEnabled()
    expect(await sql('SELECT id FROM "RentalApplication" WHERE "userId" = $1', [student.userId])).toHaveLength(0)

    fail = false
    await page.getByRole('button', { name: 'Kirim Pengajuan' }).click()
    await expect.poll(() => sql('SELECT id FROM "RentalApplication" WHERE "userId" = $1', [student.userId])).toHaveLength(1)
    await page.reload()
    expect(await sql('SELECT id FROM "RentalApplication" WHERE "userId" = $1', [student.userId])).toHaveLength(1)
    expectHttpErrors(problems, 500)
  } finally {
    await Promise.all([owner.ctx.close(), student.ctx.close()])
  }
})
