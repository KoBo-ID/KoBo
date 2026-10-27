// Vitest setup file for the coverage measurement only: wraps every tRPC procedure so each call from the existing backend tests
// appends {proc, code} to GAP_BACKEND_LOG. Product code and the tests are untouched.
import { appendFileSync } from 'node:fs'
import { appRouter } from '../../backend/src/trpc/router.ts'

const log = process.env.GAP_BACKEND_LOG
if (log) {
  const defs = (appRouter as any)._def.procedures as Record<string, any>
  for (const [name, orig] of Object.entries(defs)) {
    if (orig.__gapWrapped) continue
    const wrapped: any = async (opts: unknown) => {
      try {
        const out = await orig(opts)
        appendFileSync(log, JSON.stringify({ proc: name, code: 'OK' }) + '\n')
        return out
      } catch (e: any) {
        appendFileSync(log, JSON.stringify({ proc: name, code: e?.code ?? 'ERR', msg: e?.message }) + '\n')
        throw e
      }
    }
    Object.assign(wrapped, orig, { __gapWrapped: true })
    defs[name] = wrapped
  }
}
