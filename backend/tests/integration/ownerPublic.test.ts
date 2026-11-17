import type { TRPCError } from '@trpc/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { caller, prisma } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

describe('owner.publicProfile', () => {
  it('returns NOT_FOUND for an unknown owner', async () => {
    const err = (await caller.owner.publicProfile({ id: 'nope' }).then(() => null, (e: unknown) => e)) as TRPCError
    expect(err.code).toBe('NOT_FOUND')
  })

  it('returns the owner and only their kos as cards', async () => {
    const owner = await prisma.ownerProfile.findFirstOrThrow({
      where: { kos: { some: {} } },
      include: { user: true, kos: { orderBy: { createdAt: 'asc' } } },
    })
    const res = await caller.owner.publicProfile({ id: owner.id })
    expect(res.owner).toMatchObject({
      id: owner.id,
      name: owner.user.name,
      avatar: owner.user.image,
      phone: owner.user.phone,
      bio: owner.bio,
      responseRate: owner.responseRate,
      verified: owner.verified,
    })
    expect(res.kos.map((k) => k.id)).toEqual(owner.kos.map((k) => k.id))
    expect(res.kos[0].images.length).toBeGreaterThan(0)
    expect(res.owner.totalProperties).toBe(owner.kos.length)
    const listed = (await caller.kos.list()).find((k) => k.id === owner.kos[0].id)
    expect(res.kos[0]).toEqual(listed)
  })

  it('works for an owner with no kos', async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { ownerProfile: null } })
    const o = await prisma.ownerProfile.create({ data: { userId: user.id } })
    const res = await caller.owner.publicProfile({ id: o.id })
    expect(res.kos).toEqual([])
    expect(res.owner.totalProperties).toBe(0)
  })
})
