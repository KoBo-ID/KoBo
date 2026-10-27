import { test, expect } from '../fixtures'
import { expectHttpErrors, newOwnerWorld, newStudent, sql, trpcPost, trpcRaw, watch } from '../helpers'

// Needs the server that e2e/gap/consents/playwright.config.ts starts with REQUIRE_PROFILE_CONSENTS=1.

test('[G-058][R-091][R-092] without an emergency contact and the current terms the form says why and the server refuses; with both the application is stored', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'consent-own', rooms: 1 })
  const student = await newStudent(browser, { label: 'consent-stu' })
  const { page } = student
  watch(page, problems)
  const room = owner.rooms[0]
  const applications = () => sql('SELECT id FROM "RentalApplication" WHERE "userId" = $1', [student.userId])
  const openForm = async () => {
    await page.goto(`/checkout/${owner.kosId}?room=${room.id}`)
    await page.getByLabel('Pekerjaan atau kegiatan utama').fill('Mahasiswa BINUS')
  }
  const direct = () => trpcRaw(student.ctx, 'application.create', { roomId: room.id, startDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), durationMonths: 3, occupation: 'Mahasiswa' })
  try {
    await openForm()
    await expect(page.getByRole('alert')).toContainText('kontak darurat dan persetujuan syarat')
    await expect(page.getByRole('button', { name: 'Kirim Pengajuan' })).toBeDisabled()
    const bypass = await direct()
    expect([bypass.status, bypass.message]).toEqual([412, 'Lengkapi kontak darurat Anda di halaman Profil sebelum mengajukan sewa.'])
    expect(await applications()).toHaveLength(0)

    await trpcPost(page, 'auth.updateEmergencyContact', { name: 'Bu Sari', relation: 'Ibu', phone: '081200000009', consent: true })
    await openForm()
    await expect(page.getByRole('alert')).toContainText('persetujuan syarat')
    await expect(page.getByRole('alert')).not.toContainText('kontak darurat')
    await expect(page.getByRole('button', { name: 'Kirim Pengajuan' })).toBeDisabled()
    const stale = await direct()
    expect([stale.status, stale.message]).toEqual([412, 'Setujui Syarat Penggunaan dan Kebijakan Privasi terbaru sebelum mengajukan sewa.'])
    expect(await applications()).toHaveLength(0)

    await page.goto('/syarat')
    const version = (await page.locator('main').textContent())?.match(/\d{4}-\d{2}-\d{2}-[a-z]+/)?.[0]
    expect(version, 'the Syarat page shows its version').toBeTruthy()
    await trpcPost(page, 'auth.acceptTerms', { version })
    await openForm()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: 'Kirim Pengajuan' }).click()
    await expect.poll(applications).toHaveLength(1)
    await page.reload()
    expect(await applications()).toHaveLength(1)
    expectHttpErrors(problems, 412)
  } finally {
    await Promise.all([owner.ctx.close(), student.ctx.close()])
  }
})
