import type { Browser } from '@playwright/test'
import { test, expect } from './fixtures'
import { newOwnerWorld, newStudent, sql, trpcPost, trpcRaw, watch, expectHttpErrors } from './seams'

// The owner gate: only a DISETUJUI owner may create a kos. Everyone else sees a banner per status and a disabled
// (aria-disabled, still focusable) "Daftarkan kos" that says why and opens the documents dialog.

test.skip(!!process.env.BASE_URL, 'needs the e2e hooks and database, which only the local e2e server provides')

type Status = 'BELUM_KIRIM' | 'MENUNGGU' | 'DITOLAK' | 'DISETUJUI'

const NEW_KOS = {
  name: 'Kos Gerbang E2E',
  gender: 'CAMPUR',
  address: 'Jl. Gerbang No. 1',
  district: 'Kebayoran Baru',
  city: 'Jakarta Selatan',
  lat: -6.2,
  lng: 106.8,
  electricityType: 'INCLUDED',
  privateAmenities: [],
  sharedAmenities: [],
  studentDiscountAmount: 0,
  initialRooms: { count: 1, priceMonthly: 1_500_000 },
}

/** A signed-in owner with no kos, in the given verification status. */
async function ownerWithStatus(browser: Browser, label: string, status: Status) {
  const owner = await newStudent(browser, { label })
  await trpcPost(owner.page, 'owner.becomeOwner', { phone: '081234567890' })
  await sql(`UPDATE "OwnerProfile" SET "verificationStatus" = $2, "approvedAt" = $3 WHERE "userId" = $1`, [owner.userId, status, status === 'DISETUJUI' ? new Date() : null])
  return owner
}

const BANNER: Record<Exclude<Status, 'DISETUJUI'>, { text: string; reason: RegExp }> = {
  BELUM_KIRIM: { text: 'Lengkapi dokumen untuk mulai mendaftarkan kos', reason: /Lengkapi dokumen dulu untuk mendaftarkan kos\./ },
  MENUNGGU: { text: 'Dokumen sedang diperiksa', reason: /Dokumen Anda sedang diperiksa\. Kos baru bisa dibuat setelah disetujui\./ },
  DITOLAK: { text: 'Dokumen ditolak', reason: /Dokumen Anda ditolak\. Unggah ulang dokumen untuk mendaftarkan kos\./ },
}

for (const status of ['BELUM_KIRIM', 'MENUNGGU', 'DITOLAK'] as const) {
  test(`owner gate: a ${status} owner sees the banner and a disabled "Daftarkan kos" that opens the documents dialog`, async ({ browser, problems }) => {
    const owner = await ownerWithStatus(browser, `gate-${status.toLowerCase()}`, status)
    const { page } = owner
    watch(page, problems)
    try {
      await page.goto('/owner/dashboard')
      await expect(page.getByTestId('owner-status-banner')).toContainText(BANNER[status].text)

      const create = page.getByRole('button', { name: 'Daftarkan kos' })
      await expect(create).toHaveAttribute('aria-disabled', 'true')
      await expect(create).toHaveAccessibleDescription(BANNER[status].reason)

      await test.step('clicking it opens the documents dialog instead of a form', async () => {
        await create.click({ force: true }) // aria-disabled counts as disabled for Playwright's actionability checks
        await expect(page).toHaveURL(/dokumen=1/)
        await expect(page.getByRole('dialog')).toBeVisible()
        await expect(page.getByRole('dialog').getByText('Dokumen (bisa nanti)')).toBeVisible()
      })

      await test.step('the server refuses a kos too', async () => {
        const res = await trpcRaw(page, 'owner.kos.create', NEW_KOS)
        expect(res.code).toBe('FORBIDDEN')
        expect(await sql('SELECT id FROM "Kos" WHERE name = $1', [NEW_KOS.name])).toHaveLength(0)
      })
      expectHttpErrors(problems, 403)
    } finally {
      await owner.ctx.close()
    }
  })
}

test('owner gate: "Tambah kos" on /owner/kos is aria-disabled with a reason and a way to the documents', async ({ browser, problems }) => {
  const owner = await ownerWithStatus(browser, 'gate-manager', 'MENUNGGU')
  const { page } = owner
  watch(page, problems)
  try {
    await page.goto('/owner/kos')
    const add = page.getByRole('button', { name: 'Tambah kos' }).first()
    await expect(add).toHaveAttribute('aria-disabled', 'true')
    await expect(add).toHaveAccessibleDescription(/Dokumen Anda sedang diperiksa/)
    await page.getByRole('button', { name: 'Buka dokumen' }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByLabel('Nama Properti Kos')).toHaveCount(0)
    expectHttpErrors(problems)
  } finally {
    await owner.ctx.close()
  }
})

test('owner gate: a DISETUJUI owner can create a kos', async ({ browser, problems }) => {
  const owner = await ownerWithStatus(browser, 'gate-ok', 'DISETUJUI')
  const { page } = owner
  watch(page, problems)
  try {
    await page.goto('/owner/dashboard')
    await expect(page.getByTestId('owner-status-banner')).toHaveCount(0)
    await page.goto('/owner/kos')
    const add = page.getByRole('button', { name: 'Tambah kos' }).first()
    await expect(add).not.toHaveAttribute('aria-disabled', 'true')
    await add.click()
    await expect(page.getByLabel('Nama Properti Kos')).toBeVisible()
    await page.keyboard.press('Escape')

    const { id } = await trpcPost<{ id: string }>(page, 'owner.kos.create', NEW_KOS)
    expect(id).toBeTruthy()
    await page.goto('/owner/kos')
    await expect(page.getByText(NEW_KOS.name).first()).toBeVisible()
    expectHttpErrors(problems)
  } finally {
    await owner.ctx.close()
  }
})

test('owner gate: an unapproved owner with an existing kos still sees and edits it', async ({ browser, problems }) => {
  const world = await newOwnerWorld(browser, { label: 'gate-existing', rooms: 1 })
  const { page } = world
  watch(page, problems)
  try {
    // Approved at creation, then pushed back to review: the kos they already made must not disappear.
    await sql(`UPDATE "OwnerProfile" SET "verificationStatus" = 'MENUNGGU' WHERE "userId" = $1`, [world.userId])
    await page.goto('/owner/kos')
    await expect(page.getByTestId('owner-status-banner')).toContainText('Dokumen sedang diperiksa')
    await expect(page.getByTestId('owner-status-banner')).toContainText('Kos yang sudah Anda buat tetap tersimpan')
    await expect(page.getByText(world.kosName).first()).toBeVisible()

    await page.getByRole('button', { name: 'Edit kos' }).first().click()
    const name = page.getByLabel('Nama Properti Kos')
    await expect(name).toHaveValue(world.kosName)
    const renamed = `${world.kosName} Baru`
    await name.fill(renamed)
    await page.getByRole('button', { name: 'Simpan Perubahan Kos' }).click()
    await expect(page.getByText(renamed).first()).toBeVisible()
    const [row] = await sql<{ name: string }>('SELECT name FROM "Kos" WHERE id = $1', [world.kosId])
    expect(row.name).toBe(renamed)
    expectHttpErrors(problems)
  } finally {
    await world.ctx.close()
  }
})
