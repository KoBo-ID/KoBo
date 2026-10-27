import { test as base } from '../tests/fixtures'
export { expect, loginAs } from '../tests/fixtures'
export const test = base.extend({
  browser: [async ({ browser }, use) => {
    const original=browser.newContext.bind(browser)
    browser.newContext=async options => {
      const context=await original(options)
      await context.route('**/*', route => ['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.fulfill({ status: 204, body: '' }))
      return context
    }
    await use(browser)
    browser.newContext=original
  }, {scope:'worker'}],
})
