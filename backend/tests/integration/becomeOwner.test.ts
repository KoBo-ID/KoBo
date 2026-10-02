import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { callerFor, me, prisma, registerAndSignIn, request, caller } from '../helpers.ts'
import type { TRPCError } from '@trpc/server'

beforeEach(() => resetDb(prisma))

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as TRPCError | null)?.code
const userId = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id

describe('owner.becomeOwner', () => {
  it('rejects an unauthenticated caller', async () => {
    expect(await code(caller.owner.becomeOwner())).toBe('UNAUTHORIZED')
  })

  it('creates an OwnerProfile once; the second call returns the same one', async () => {
    await registerAndSignIn('sari@example.com')
    const id = await userId('sari@example.com')
    const first = await callerFor(id).owner.becomeOwner()
    const second = await callerFor(id).owner.becomeOwner()
    expect(second.ownerProfileId).toBe(first.ownerProfileId)
    expect(await prisma.ownerProfile.count({ where: { userId: id } })).toBe(1)
  })

  it('makes auth.me report isOwner over HTTP', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    expect((await me(cookie))?.isOwner).toBe(false)
    const res = await request('/api/trpc/owner.becomeOwner', { cookie, method: 'POST', headers: { 'content-type': 'application/json' } })
    expect(res.status).toBe(200)
    const after = await me(cookie)
    expect(after?.isOwner).toBe(true)
    expect(after?.ownerProfileId).toBeTruthy()
  })

  it('blocks demo accounts and creates nothing', async () => {
    const demo = await prisma.user.findFirstOrThrow({ where: { isDemo: true, ownerProfile: null } })
    expect(await code(callerFor(demo.id).owner.becomeOwner())).toBe('FORBIDDEN')
    expect(await prisma.ownerProfile.count({ where: { userId: demo.id } })).toBe(0)
  })
})
