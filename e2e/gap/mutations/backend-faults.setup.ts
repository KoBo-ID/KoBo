// Vitest setup for the backend mutation probes: with FAULT=<id> one tRPC procedure's behaviour is changed in-process (no product file is touched).
import { appRouter } from '../../../backend/src/trpc/router.ts'

type Change = (orig: (opts: unknown) => Promise<unknown>) => (opts: unknown) => Promise<unknown>
const swallow = (code: string, value: unknown): Change => (orig) => async (opts) => {
  try { return await orig(opts) } catch (e: any) { if (e?.code === code) return value; throw e }
}
const mapResult = (fn: (r: any) => any): Change => (orig) => async (opts) => fn(await orig(opts))

export const BACKEND_FAULTS: Record<string, { what: string; proc: string; change: Change }> = {
  B01: { what: 'application.decide returns APPROVED instead of FORBIDDEN (owner check missing)', proc: 'application.decide', change: swallow('FORBIDDEN', { id: 'x', status: 'APPROVED', tenancyId: null }) },
  B02: { what: 'kos.detail reports every room vacant', proc: 'kos.detail', change: mapResult((d) => ({ ...d, rooms: d.rooms.map((r: any) => ({ ...r, status: 'vacant' })) })) },
  B03: { what: 'owner.board never reports overdue (reports due)', proc: 'owner.board', change: mapResult((d) => ({ ...d, rooms: d.rooms.map((r: any) => (r.status === 'overdue' ? { ...r, status: 'due' } : r)) })) },
  B04: { what: 'kuitansi.get prints month 01 for every receipt', proc: 'kuitansi.get', change: mapResult((d) => ({ ...d, receiptNo: String(d.receiptNo).replace(/^KB\/(\d{4})\/\d{2}\//, 'KB/$1/01/') })) },
  B05: { what: 'auth.setNotifyOptOut does nothing', proc: 'auth.setNotifyOptOut', change: () => async () => ({ ok: true }) },
  B06: { what: 'application.create accepts invalid input (BAD_REQUEST swallowed)', proc: 'application.create', change: swallow('BAD_REQUEST', { id: 'x', status: 'PENDING' }) },
}

const id = process.env.FAULT
if (id) {
  const fault = BACKEND_FAULTS[id]
  if (!fault) throw new Error(`unknown backend FAULT ${id}`)
  const defs = (appRouter as any)._def.procedures as Record<string, any>
  const orig = defs[fault.proc]
  const wrapped: any = fault.change(orig)
  Object.assign(wrapped, orig)
  defs[fault.proc] = wrapped
}
