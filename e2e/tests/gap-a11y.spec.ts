import { test, expect, loginAs } from '../gap/fixtures'
import { expectHttpErrors, unnamedControls } from '../gap/helpers'

// Accessibility basics on the key routes (CONTEXT.md: icon-only buttons need aria-label; controls are keyboard reachable).

test.skip(!!process.env.BASE_URL, 'uses the shared demo accounts and the seeded kos of the local e2e server')

const VIEWPORTS = [
  { name: '1280x650', width: 1280, height: 650 },
  { name: '390x844', width: 390, height: 844 },
]

for (const vp of VIEWPORTS) {
  test(`[G-053][R-102] every button and link on the key routes has an accessible name @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    const problems: Record<string, string[]> = {}
    const check = async (route: string) => {
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      const bad = await unnamedControls(page)
      if (bad.length) problems[route] = bad
    }

    for (const route of ['/', '/search', '/kos/kos-1', '/masuk']) await check(route)
    await loginAs(page, 'student')
    for (const route of ['/profile', '/my-kos']) await check(route)
    await loginAs(page, 'owner')
    for (const route of ['/owner/dashboard', '/owner/dashboard?tab=tindakan', '/owner/kos', '/owner/reviews']) await check(route)

    expect(problems).toEqual({})
  })
}

test('[G-054][R-102] the sign-in form is usable by keyboard alone: labelled fields, Enter submits', async ({ page, problems }) => {
  await page.goto('/masuk')
  const email = page.getByLabel('Email')
  const password = page.getByLabel('Kata Sandi')
  await expect(email).toBeVisible()
  await expect(password).toBeVisible()

  await email.focus()
  await page.keyboard.type('tidak-ada@example.com')
  await page.keyboard.press('Tab')
  await expect(password).toBeFocused()
  await page.keyboard.type('Sandi-salah-123')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toContainText('Email atau kata sandi salah')
  expectHttpErrors(problems, 401)
})

test('[G-054][R-102] the survey modal closes with Escape and focus returns to the button that opened it', async ({ page }) => {
  await loginAs(page, 'student')
  await page.goto('/kos/kos-1')
  const opener = page.getByRole('button', { name: 'Jadwalkan Survey Gratis' }).first()
  await opener.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Nomor WhatsApp')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
})
