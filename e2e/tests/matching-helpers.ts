import type { Page } from '@playwright/test'
import { expect } from './fixtures'
import { sql } from './seams'

// Helpers for the Teman Sekamar specs. Students come from newStudent({ campus: true }) in seams.ts (verified, same campus).

export const MATCH = '/teman-sekamar'

/** A date a few weeks ahead as yyyy-mm-dd (the date input rejects the past). */
export function moveInDate(plusDays = 21): string {
  return new Date(Date.now() + plusDays * 86_400_000).toISOString().slice(0, 10)
}

/** Step 1 (core data) of the profile form. Leaves the page on the optional step. */
export async function fillCore(page: Page, name: string, gender: 'Perempuan' | 'Laki-laki' = 'Perempuan') {
  await page.goto(`${MATCH}/profil`)
  const form = page.getByRole('form', { name: 'Data inti profil' })
  await expect(form).toBeVisible()
  await form.getByLabel('Nama tampilan').fill(name)
  await form.getByRole('radio', { name: gender, exact: true }).check()
  await form.getByLabel('Tahun lahir').fill('2004')
  const anchor = form.getByRole('combobox', { name: 'Area pencarian' })
  await anchor.fill('binus')
  await expect(page.getByRole('listbox').getByRole('option').first()).toBeVisible()
  await anchor.press('ArrowDown')
  await anchor.press('Enter')
  await expect(form.getByText(/^Terpilih:/)).toBeVisible()
  await form.getByLabel('Tanggal pindah').fill(moveInDate())
  await form.getByRole('radio', { name: 'Tidak merokok, toleran' }).check()
  await form.getByRole('button', { name: 'Simpan dan aktifkan profil' }).click()
  await expect(page.getByRole('form', { name: 'Preferensi opsional' })).toBeVisible()
}

/** Make a student's matching profile older than 24 h so it may send requests (S1 rule). */
export async function backdateProfile(userId: string, hours = 48) {
  const rows = await sql('UPDATE "MatchingProfile" SET "createdAt" = now() - ($2 || \' hours\')::interval WHERE "userId" = $1 RETURNING id', [userId, String(hours)])
  expect(rows.length, 'matching profile exists for backdating').toBe(1)
}

export async function profileIdOf(userId: string): Promise<string> {
  const [row] = await sql<{ id: string }>('SELECT id FROM "MatchingProfile" WHERE "userId" = $1', [userId])
  return row!.id
}

/** The accessible name of the Navbar's Teman Sekamar link ("Teman Sekamar (2 belum dibaca)"). */
export const navLink = (page: Page) => page.getByRole('link', { name: /^Teman Sekamar/ }).first()
