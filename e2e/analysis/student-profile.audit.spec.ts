import type { BrowserContext } from '@playwright/test'
import { test, expect } from './safe-fixtures'
import { apply, approve, hook, newOwnerWorld, newStudent, sql, tick, trpcGet, watch } from '../tests/seams'

async function closeAll(...contexts: (BrowserContext | undefined)[]) {
  await Promise.all(contexts.map((c) => c?.close().catch(() => undefined)))
}

// Items 2, 3 and 4: emergency contact with consent, the owner's tenant profile, and the payment reminder worker.
// The server runs with REQUIRE_PROFILE_CONSENTS=0 (see start-server.mjs); the gate itself is covered by integration tests.

test('a student saves an emergency contact with consent, keeps it after a reload, and can withdraw it', async ({ browser, problems }) => {
  const student = await newStudent(browser, { label: 'ec-student' })
  watch(student.page, problems)
  try {
    const { page } = student
    await page.goto('/profile')
    const card = page.getByTestId('emergency-contact-card')
    await card.getByRole('button', { name: 'Isi kontak darurat' }).click()
    await card.getByLabel('Nama', { exact: true }).fill('Ibu Sari')
    await card.getByLabel('Hubungan').fill('Ibu')
    await card.getByLabel('Nomor WhatsApp').fill('0812 3456 7890')
    await card.getByRole('button', { name: 'Simpan' }).click()
    await expect(card.getByText('Centang persetujuan')).toBeVisible()
    await card.getByLabel(/Saya sudah memberi tahu orang ini/).check()
    await card.getByRole('button', { name: 'Simpan' }).click()
    await expect(card).toContainText('Ibu Sari')

    await page.reload()
    await expect(page.getByTestId('emergency-contact-card')).toContainText('0812 3456 7890')
    const [row] = await sql<{ consent: Date | null }>('SELECT "emergencyContactConsentAt" AS consent FROM "User" WHERE id = $1', [student.userId])
    expect(row.consent).not.toBeNull()

    await page.getByTestId('emergency-contact-card').getByRole('button', { name: /Hapus dan cabut izin/ }).click()
    await expect(page.getByTestId('emergency-contact-card').getByRole('button', { name: 'Isi kontak darurat' })).toBeVisible()
    const [gone] = await sql<{ name: string | null; consent: Date | null }>('SELECT "emergencyContactName" AS name, "emergencyContactConsentAt" AS consent FROM "User" WHERE id = $1', [student.userId])
    expect([gone.name, gone.consent]).toEqual([null, null])
    expectNoProblems(problems)
  } finally {
    await closeAll(student.ctx)
  }
})

const expectNoProblems = (problems: string[]) => expect(problems.filter((p) => !p.includes('401'))).toEqual([])

test('the owner opens the tenant profile: phone and emergency contact appear only after approval', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'tp-owner', rooms: 1 })
  const student = await newStudent(browser, { label: 'tp-student', campus: true })
  watch(owner.page, problems)
  try {
    await sql(
      `UPDATE "User" SET phone = '081200000011', "emergencyContactName" = 'Pak Budi', "emergencyContactRelation" = 'Ayah', "emergencyContactPhone" = '081200000012', "emergencyContactConsentAt" = now() WHERE id = $1`,
      [student.userId],
    )
    const applicationId = await apply(student, owner.rooms[0].id)
    await owner.page.goto(`/owner/dashboard?kos=${owner.kosId}&tab=tindakan`)
    await owner.page.getByRole('button', { name: /^Profil Penguji E2E/ }).click()
    const dialog = owner.page.getByTestId('tenant-profile')
    await expect(dialog).toContainText('Email kampus terverifikasi')
    await expect(dialog).toContainText('Terbuka setelah disetujui')
    await expect(dialog).not.toContainText('081200000011')
    await expect(dialog).not.toContainText('Pak Budi')
    await owner.page.keyboard.press('Escape')
    await expect(owner.page.getByTestId('tenant-profile')).toHaveCount(0)

    await approve(owner, owner.kosId, applicationId)
    const [view] = await sql<{ n: string }>('SELECT count(*)::text AS n FROM "TenantProfileView" WHERE "tenantUserId" = $1', [student.userId])
    expect(Number(view.n)).toBe(1)
    // Approved: the same call the modal makes now returns the number and the contact the student consented to share.
    const again = await trpcGet<{ phone: string | null; emergencyContact: { name: string } | null; accepted: boolean }>(owner.ctx, `owner.tenant.tenantProfile?input=${encodeURIComponent(JSON.stringify({ kosId: owner.kosId, applicationId }))}`)
    expect(again).toMatchObject({ accepted: true, phone: '081200000011', emergencyContact: { name: 'Pak Budi' } })
  } finally {
    await closeAll(owner.ctx, student.ctx)
  }
})

test('the reminder worker sends H-1 once, tells the owner, and never touches a student who opted out', async ({ browser, problems }) => {
  const owner = await newOwnerWorld(browser, { label: 'nt-owner', rooms: 2 })
  const student = await newStudent(browser, { label: 'nt-student' })
  const quiet = await newStudent(browser, { label: 'nt-quiet' })
  watch(owner.page, problems)
  try {
    const ids: { invoiceId: string; tenancyId: string }[] = []
    for (const [s, room] of [[student, owner.rooms[0]], [quiet, owner.rooms[1]]] as const) {
      await sql(`UPDATE "User" SET phone = '0812000000${s === student ? '21' : '22'}' WHERE id = $1`, [s.userId])
      const applicationId = await apply(s, room.id)
      await approve(owner, owner.kosId, applicationId)
      const [t] = await sql<{ tenancyId: string }>('SELECT "tenancyId" FROM "RentalApplication" WHERE id = $1', [applicationId])
      await sql(`UPDATE "Tenancy" SET status = 'ACTIVE' WHERE id = $1`, [t.tenancyId])
      const [inv] = await sql<{ id: string }>(`UPDATE "Invoice" SET "dueDate" = (now() AT TIME ZONE 'Asia/Jakarta')::date + 1 WHERE "tenancyId" = $1 RETURNING id`, [t.tenancyId])
      ids.push({ invoiceId: inv.id, tenancyId: t.tenancyId })
    }
    await sql('UPDATE "User" SET "notifyOptOut" = true WHERE id = $1', [quiet.userId])

    // 10:00 WIB today, so the quiet hours never decide this test.
    const [{ d }] = await sql<{ d: string }>(`SELECT to_char((now() AT TIME ZONE 'Asia/Jakarta')::date, 'YYYY-MM-DD') AS d`)
    const at = new Date(`${d}T10:00:00+07:00`)
    await tick(owner.ctx, 'notify', at)
    await tick(owner.ctx, 'notify', new Date(at.getTime() + 3_600_000))

    const logs = await sql<{ invoiceId: string; kind: string; channel: string }>('SELECT "invoiceId", kind, channel FROM "NotificationLog" WHERE "invoiceId" = ANY($1) ORDER BY channel', [ids.map((i) => i.invoiceId)])
    expect(logs.map((l) => `${l.kind}/${l.channel}`)).toEqual(['REMINDER_H1/EMAIL', 'REMINDER_H1/WHATSAPP'])
    expect(new Set(logs.map((l) => l.invoiceId))).toEqual(new Set([ids[0].invoiceId]))
    const sent = await hook<{ to: string; kind: string }[]>(owner.ctx, 'whatsapp', {})
    expect(sent.filter((m) => m.to === '081200000021' && 'text' in m && String(m.text).includes(owner.kosName))).toHaveLength(1)

    await owner.page.goto(`/owner/dashboard?kos=${owner.kosId}&tab=tindakan`)
    const log = owner.page.getByTestId('reminders-log')
    await expect(owner.page.getByRole('heading', { name: /Pengingat yang dikirim/ })).toBeVisible()
    await log.getByText('Lihat riwayat pengingat').click()
    await expect(log).toContainText('Pengingat 1 hari lewat WhatsApp')
    await expect(log).toContainText('Terkirim')
  } finally {
    await closeAll(owner.ctx, student.ctx, quiet.ctx)
  }
})
