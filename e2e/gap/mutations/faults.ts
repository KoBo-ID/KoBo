// Deliberate faults injected between the browser and the real server (no product code is touched). Each id names what is broken;
// run.mjs runs the gap specs once per id and a probe counts as KILLED when at least one new test fails.
import type { BrowserContext, Route } from '@playwright/test'

type Payload = any

/** Fetch the real response, let `change` rewrite the tRPC payload, and fulfil with the result. */
async function rewrite(route: Route, change: (data: Payload) => Payload) {
  const res = await route.fetch()
  let body: any
  try {
    body = await res.json()
  } catch {
    return route.fulfill({ response: res })
  }
  const holder = body?.result?.data
  if (holder === undefined) return route.fulfill({ response: res })
  if (holder && typeof holder === 'object' && 'json' in holder) holder.json = change(holder.json)
  else body.result.data = change(holder)
  await route.fulfill({ response: res, body: JSON.stringify(body), headers: { ...res.headers(), 'content-length': undefined as never } })
}

const proc = (ctx: BrowserContext, name: string, handler: (route: Route) => Promise<void> | void) => ctx.route((url) => url.pathname === `/api/trpc/${name}`, handler)

export const FAULTS: Record<string, { what: string; apply: (ctx: BrowserContext) => Promise<void> }> = {
  F01: { what: 'kos.search returns an empty list', apply: (c) => proc(c, 'kos.search', (r) => rewrite(r, (d) => (Array.isArray(d) ? [] : d))) },
  F02: { what: 'kos.search answers 8 s late', apply: (c) => proc(c, 'kos.search', async (r) => { await new Promise((x) => setTimeout(x, 8000)); await r.fallback() }) },
  F03: { what: 'booking.mine adds Rp 1,000 to every invoice', apply: (c) => proc(c, 'booking.mine', (r) => rewrite(r, (d) => (Array.isArray(d) ? d.map((t) => ({ ...t, invoices: (t.invoices ?? []).map((i: any) => ({ ...i, amount: i.amount + 1000 })) })) : d))) },
  F04: { what: 'booking.mine returns an empty list', apply: (c) => proc(c, 'booking.mine', (r) => rewrite(r, (d) => (Array.isArray(d) ? [] : d))) },
  F05: { what: 'application.ownerList drops the first application', apply: (c) => proc(c, 'application.ownerList', (r) => rewrite(r, (d) => (Array.isArray(d) ? d.slice(1) : d))) },
  F06: { what: 'owner.visits returns an empty list', apply: (c) => proc(c, 'owner.visits', (r) => rewrite(r, (d) => (Array.isArray(d) ? [] : d))) },
  F07: { what: 'kos.detail adds Rp 1,000 to every room price', apply: (c) => proc(c, 'kos.detail', (r) => rewrite(r, (d) => (d?.rooms ? { ...d, rooms: d.rooms.map((x: any) => ({ ...x, priceMonthly: x.priceMonthly + 1000 })), priceMonthlyStart: (d.priceMonthlyStart ?? 0) + 1000 } : d))) },
  F08: { what: 'owner.myKos returns an empty list', apply: (c) => proc(c, 'owner.myKos', (r) => rewrite(r, (d) => (Array.isArray(d) ? [] : d))) },
  F09: { what: 'owner.board answers 403', apply: (c) => proc(c, 'owner.board', (r) => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Anda tidak memiliki akses ke kos ini.', code: -32003, data: { code: 'FORBIDDEN', httpStatus: 403 } } }) })) },
  F10: { what: 'auth.me answers signed out', apply: (c) => proc(c, 'auth.me', (r) => rewrite(r, () => null)) },
  F11: { what: 'every aria-label is removed from buttons and links', apply: (c) => c.addInitScript(() => { const strip = () => document.querySelectorAll('button[aria-label], a[aria-label]').forEach((e) => e.removeAttribute('aria-label')); new MutationObserver(strip).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label'] }); addEventListener('DOMContentLoaded', strip) }) },
  F12: { what: 'the Escape key is swallowed before the app sees it', apply: (c) => c.addInitScript(() => { addEventListener('keydown', (e) => { if (e.key === 'Escape') e.stopImmediatePropagation() }, true) }) },
  F13: { what: 'kos.search lists every card twice', apply: (c) => proc(c, 'kos.search', (r) => rewrite(r, (d) => (Array.isArray(d) ? [...d, ...d] : d))) },
  F14: { what: 'owner.visits answers 500', apply: (c) => proc(c, 'owner.visits', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'x', code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } } }) })) },
  F15: { what: 'two room numbers are swapped in owner.myKos', apply: (c) => proc(c, 'owner.myKos', (r) => rewrite(r, (d) => (Array.isArray(d) ? d.map((k) => (k.rooms?.length > 1 ? { ...k, rooms: [{ ...k.rooms[0], roomNumber: k.rooms[1].roomNumber }, { ...k.rooms[1], roomNumber: k.rooms[0].roomNumber }, ...k.rooms.slice(2)] } : k)) : d))) },
}

export async function applyFault(ctx: BrowserContext, id: string) {
  const fault = FAULTS[id]
  if (!fault) throw new Error(`unknown FAULT ${id}`)
  await fault.apply(ctx)
}
