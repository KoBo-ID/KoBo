// `test` for the gap-* specs: the repo fixture plus an optional FAULT=<id> switch (see mutations/faults.ts). Without FAULT it is the repo fixture.
import type { Browser, BrowserContext } from '@playwright/test'
import { test as base, expect, loginAs } from '../tests/fixtures'
import { applyFault } from './mutations/faults'

export { expect, loginAs }

export const test = base.extend<{ faulty: void }>({
  // Every context the test creates, including the extra ones made through browser.newContext (seams.newContext), gets the fault.
  faulty: [
    async ({ browser, context }, use) => {
      const fault = process.env.FAULT
      if (!fault) return use()
      await applyFault(context, fault)
      const original = browser.newContext.bind(browser)
      ;(browser as Browser).newContext = (async (options?: Parameters<Browser['newContext']>[0]) => {
        const ctx: BrowserContext = await original(options)
        await applyFault(ctx, fault)
        return ctx
      }) as Browser['newContext']
      await use()
      browser.newContext = original
    },
    { auto: true },
  ],
})
