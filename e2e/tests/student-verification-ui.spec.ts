import { test, expect, loginAs } from './fixtures'
import { signUpVerified } from './accounts'

// F-11: the student-verification UI follows the server. Owners never get the student card, and VerifyPrompt only
// appears when auth.me says the gate applies (this e2e server runs with REQUIRE_STUDENT_VERIFICATION off;
// e2e/gap/student covers the gate-on side).

test('[F-11] an owner\'s /profile has no student-verification card', async ({ page }) => {
  await loginAs(page, 'owner')
  await page.goto('/profile')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByTestId('student-verification')).toHaveCount(0)
})

test('[F-11] with the gate off, an unverified student sees no VerifyPrompt on a kos page', async ({ page }) => {
  await signUpVerified(page, 'f11')
  // Other specs rent kos-1's rooms and the DB is shared across the run, so the "Ajukan" CTA depends on run order.
  // Make every room of the real response vacant: the assertion is about the gate (no VerifyPrompt beside a live CTA), not seed state.
  await page.route('**/api/trpc/kos.detail*', async (route) => {
    const res = await route.fetch()
    const body = await res.json()
    const data = body?.result?.data
    if (data?.rooms) for (const r of data.rooms) { r.status = 'vacant'; r.reservedForWaitlist = false }
    await route.fulfill({ response: res, json: body })
  })
  await page.goto('/kos/kos-1')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ajukan' }).first()).toBeVisible()
  await expect(page.getByTestId('verify-prompt')).toHaveCount(0)
})
