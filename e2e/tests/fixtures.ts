import { test as base, expect, type Page } from '@playwright/test'

/** Fails any test that logs a console error or throws an uncaught page error. */
export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = []
      page.on('console', (m) => {
        if (m.type() === 'error') problems.push(`console: ${m.text()}`)
      })
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
      await use(problems)
      expect(problems, 'console errors / uncaught exceptions').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }

/** Sign in as a seeded demo account without touching the UI. The session cookie lands in the page's context. */
export async function loginAs(page: Page, persona: 'student' | 'owner') {
  const baseURL = test.info().project.use.baseURL as string
  const res = await page.context().request.post('/api/auth/demo-login', {
    data: { as: persona },
    // A fresh client address per login: better-auth's limiter would otherwise put every parallel test in one bucket.
    headers: { origin: new URL(baseURL).origin, 'cf-connecting-ip': `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` },
  })
  expect(res.ok(), `demo login as ${persona}`).toBe(true)
}
