// C-09: the real DNS MX resolver (node:dns is mocked; no network).
import { afterEach, describe, expect, it, vi } from 'vitest'

const resolveMx = vi.hoisted(() => vi.fn())
vi.mock('node:dns/promises', () => ({ resolveMx }))

import { defaultMxResolver, dnsMxResolver, fakeMxResolver } from '../../src/campusEmail.ts'

afterEach(() => {
  resolveMx.mockReset()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('dnsMxResolver', () => {
  it('is true when the domain has at least one MX record', async () => {
    resolveMx.mockResolvedValue([{ exchange: 'mx.binus.ac.id', priority: 10 }])
    expect(await dnsMxResolver('binus.ac.id')).toBe(true)
    expect(resolveMx).toHaveBeenCalledWith('binus.ac.id')
  })

  it('is false for no records, NXDOMAIN and any other lookup error', async () => {
    resolveMx.mockResolvedValueOnce([])
    expect(await dnsMxResolver('empty.example')).toBe(false)
    resolveMx.mockRejectedValueOnce(Object.assign(new Error('queryMx ENOTFOUND'), { code: 'ENOTFOUND' }))
    expect(await dnsMxResolver('nxdomain.example')).toBe(false)
    resolveMx.mockRejectedValueOnce(new Error('boom'))
    expect(await dnsMxResolver('broken.example')).toBe(false)
  })

  it('gives up after 3 seconds', async () => {
    vi.useFakeTimers()
    resolveMx.mockReturnValue(new Promise(() => {}))
    const pending = dnsMxResolver('slow.example')
    await vi.advanceTimersByTimeAsync(2999)
    let settled = false
    void pending.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(await pending).toBe(false)
  })

  it('does not leave its timeout timer behind after a fast answer', async () => {
    vi.useFakeTimers()
    resolveMx.mockResolvedValue([{ exchange: 'mx', priority: 1 }])
    await dnsMxResolver('binus.ac.id')
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('defaultMxResolver', () => {
  it('is the offline fake under test and with e2e hooks, and the real lookup otherwise', () => {
    expect(defaultMxResolver()).toBe(fakeMxResolver)
    vi.stubEnv('NODE_ENV', 'production')
    expect(defaultMxResolver()).toBe(dnsMxResolver)
    vi.stubEnv('ALLOW_E2E_HOOKS', '1')
    expect(defaultMxResolver()).toBe(fakeMxResolver)
  })
})
