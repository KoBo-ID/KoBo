import { test, expect } from '../fixtures'
import { expectHttpErrors, newOwnerWorld, newStudent, sql, trpcRaw, watch } from '../helpers'

// Needs the server that e2e/gap/student/playwright.config.ts starts with REQUIRE_STUDENT_VERIFICATION=1 (the main e2e server turns it off).

/** The 6-digit code of the latest campus-email mail for an address, read from the outbox (polls briefly). */
async function outboxCode(to: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const [row] = await sql<{ payload: { code?: string } }>('SELECT payload FROM "EmailOutbox" WHERE "to" = $1 AND template = $2 ORDER BY "createdAt" DESC LIMIT 1', [to, 'campus-email'])
    if (row?.payload.code) return row.payload.code
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`no campus-email code queued for ${to}`)
}

test('an unverified student is guided to verify, is refused by the server, then verifies by email code and applies', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'stu-own', rooms: 1 })
  const student = await newStudent(browser, { label: 'stu-code' })
  const { page } = student
  watch(page, problems)
  const room = owner.rooms[0]
  const applications = () => sql('SELECT id FROM "RentalApplication" WHERE "userId" = $1', [student.userId])
  try {
    await page.goto(`/checkout/${owner.kosId}?room=${room.id}`)
    await expect(page.getByTestId('verify-prompt')).toContainText('Verifikasi status mahasiswa dulu')
    await expect(page.getByRole('button', { name: 'Kirim Pengajuan' })).toBeVisible()

    await page.getByRole('button', { name: 'Kirim Pengajuan' }).click()
    await expect(page.getByRole('alert')).toContainText('Verifikasi status mahasiswa dulu')
    const direct = await trpcRaw(student.ctx, 'application.create', { roomId: room.id, startDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), durationMonths: 3 })
    expect(direct.status).toBe(412)
    expect(direct.message).toMatch(/^Verifikasi status mahasiswa/)
    expect(await applications()).toHaveLength(0)
    expectHttpErrors(problems, 412)

    await page.goto('/profile')
    const campusEmail = `mhs-${Date.now()}@binus.ac.id`
    await page.getByLabel('Email Kampus').fill(campusEmail)
    await page.getByRole('button', { name: 'Kirim kode' }).click()
    await expect(page.getByText(`Kode dikirim ke ${campusEmail}`)).toBeVisible()
    await expect(page.getByText(/Kode berlaku 10 menit/)).toBeVisible()
    await page.getByLabel('Kode 6 digit').fill(await outboxCode(campusEmail))
    await page.getByRole('button', { name: 'Verifikasi', exact: true }).click()
    await expect(page.getByTestId('student-verification').getByText(/Terverifikasi lewat email kampus/)).toBeVisible()

    await page.goto(`/checkout/${owner.kosId}?room=${room.id}`)
    await expect(page.getByTestId('verify-prompt')).toHaveCount(0)
    await page.getByRole('button', { name: 'Kirim Pengajuan' }).click()
    await expect(page.getByRole('heading', { name: 'Pengajuan Terkirim' })).toBeVisible()
    expect(await applications()).toHaveLength(1)
  } finally {
    await Promise.all([owner.ctx.close(), student.ctx.close()])
  }
})

test('a KTM upload reaches "KTM sedang ditinjau" and can be withdrawn', async ({ browser, problems }) => {
  const student = await newStudent(browser, { label: 'stu-ktm' })
  const { page } = student
  watch(page, problems)
  try {
    await page.goto('/profile')
    await page.getByRole('button', { name: /Unggah KTM/ }).click()
    await page.getByLabel('Kampus', { exact: true }).fill('Binus')
    await page.getByRole('option').first().click()
    await page.getByLabel('NIM').fill('2501234567')
    await page.getByLabel('Nama di KTM').fill('Mahasiswa Penguji')
    // A JPEG signature is all the server checks; the bytes are not decoded.
    await page.getByLabel(/Foto KTM/).setInputFiles({ name: 'ktm.jpg', mimeType: 'image/jpeg', buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 1)]) })
    await page.getByLabel(/Saya setuju foto KTM disimpan secara privat/).check()
    await page.getByRole('button', { name: 'Kirim KTM' }).click()
    await expect(page.getByTestId('student-verification').getByText('KTM sedang ditinjau')).toBeVisible()
    const docs = await sql('SELECT id FROM "StudentDocument" WHERE "userId" = $1 AND status = $2', [student.userId, 'PENDING'])
    expect(docs).toHaveLength(1)

    await page.getByRole('button', { name: 'Tarik pengajuan' }).click()
    await expect(page.getByText('KTM sedang ditinjau')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Unggah KTM/ })).toBeVisible()
  } finally {
    await student.ctx.close()
  }
})
