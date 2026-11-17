// Helpers for the gap-* e2e specs. They reuse tests/seams.ts and tests/accounts.ts and add only what those do not offer.
import type { Browser, Page } from '@playwright/test'
import { expect } from '../tests/fixtures'
import { signUpVerified } from '../tests/accounts'
import { newContext, sql, trpcPost } from '../tests/seams'

export * from '../tests/seams'

/** A real owner (approved, no kos yet) in its own browser context. */
export async function signUpVerifiedOwner(browser: Browser, label: string) {
  const { ctx, page } = await newContext(browser)
  const email = await signUpVerified(page, label)
  const [{ id: userId }] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [email])
  await trpcPost(page, 'owner.becomeOwner', { phone: '081234567890' })
  await sql('UPDATE "OwnerProfile" SET "approvedAt" = now() WHERE "userId" = $1', [userId])
  return { ctx, page, email, userId }
}

/** Every button and link that has no text, aria-label, title or labelled image: a control a screen reader cannot name. */
export async function unnamedControls(page: Page) {
  return page.evaluate(() => {
    const nameOf = (el: Element) => {
      const aria = el.getAttribute('aria-label')?.trim()
      if (aria) return aria
      const labelledby = el.getAttribute('aria-labelledby')
      if (labelledby && labelledby.split(/\s+/).some((id) => document.getElementById(id)?.textContent?.trim())) return 'labelledby'
      if ((el.textContent ?? '').trim()) return 'text'
      if (el.getAttribute('title')?.trim()) return 'title'
      if (el.querySelector('img[alt]:not([alt=""])')) return 'img'
      return ''
    }
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
    }
    return [...document.querySelectorAll('button, a[href], [role="button"]')]
      .filter((el) => visible(el) && !nameOf(el))
      .map((el) => el.outerHTML.slice(0, 160))
  })
}

export { expect }
