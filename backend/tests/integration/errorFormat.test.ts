import { describe, expect, it } from 'vitest'
import { GENERIC_ERROR, GENERIC_VALIDATION, formatTrpcError } from '../../src/trpc/trpc.ts'
import { request } from '../helpers.ts'

describe('tRPC error formatter (spec section 10)', () => {
  it('replaces a validation failure with one generic Indonesian message over HTTP', async () => {
    const input = encodeURIComponent(JSON.stringify({ id: '' }))
    const res = await request(`/api/trpc/owner.publicProfile?input=${input}`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: { message: string; data: { code: string } } }
    expect(body.error.data.code).toBe('BAD_REQUEST')
    expect(body.error.message).toBe(GENERIC_VALIDATION)
  })

  it('keeps the specific message of a deliberate domain error', async () => {
    const res = await request(`/api/trpc/owner.publicProfile?input=${encodeURIComponent(JSON.stringify({ id: 'nope' }))}`)
    const body = (await res.json()) as { error: { message: string } }
    expect(body.error.message).toBe('Pemilik tidak ditemukan.')
  })

  it('hides unknown internal errors behind a generic message', () => {
    const shape = { message: 'connect ECONNREFUSED 10.0.0.1:5432', code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500, stack: 'secret' } }
    const out = formatTrpcError({ shape, error: { code: 'INTERNAL_SERVER_ERROR', cause: new Error('x') } })
    expect(out.message).toBe(GENERIC_ERROR)
    expect(JSON.stringify(out)).not.toContain('ECONNREFUSED')
    expect((out.data as { stack?: string }).stack).toBeUndefined()
  })
})
