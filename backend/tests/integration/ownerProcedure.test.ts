import { createFakeStorage } from '../../src/storage.ts'
import type { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { authedProcedure, createCallerFactory, ownerProcedure, publicProcedure, router } from '../../src/trpc/trpc.ts'
import { auth, caller, callerFor, prisma } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

// A throwaway router exercising the guards. Real kos mutations land in a later slice and must use ownerProcedure.
const probe = router({
  open: publicProcedure.query(() => 'ok'),
  mine: authedProcedure.query(({ ctx }) => ctx.user.id),
  renameKos: ownerProcedure
    .input(z.object({ kosId: z.string(), name: z.string() }))
    .mutation(({ ctx, input }) => ctx.prisma.kos.update({ where: { id: input.kosId }, data: { name: input.name } })),
})
const probeFor = (userId: string | null) =>
  createCallerFactory(probe)({
    prisma,
    auth,
    storage: createFakeStorage(),
    headers: new Headers(),
    resHeaders: new Headers(),
    getSession: async () => (userId ? ({ user: { id: userId } } as never) : null),
  })

async function twoOwners() {
  const owners = await prisma.ownerProfile.findMany({ include: { kos: { orderBy: { createdAt: 'asc' } } }, orderBy: { id: 'asc' } })
  const [a, b] = owners.filter((o) => o.kos.length > 0)
  return { a, b }
}
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as TRPCError | null)?.code

describe('procedure guards', () => {
  it('publicProcedure needs no session', async () => {
    expect(await probeFor(null).open()).toBe('ok')
  })

  it('authedProcedure rejects anonymous callers and exposes the user', async () => {
    expect(await code(probeFor(null).mine())).toBe('UNAUTHORIZED')
    expect(await probeFor('user-x').mine()).toBe('user-x')
  })

  it('ownerProcedure lets an owner write to their own kos', async () => {
    const { a } = await twoOwners()
    const updated = await probeFor(a.userId).renameKos({ kosId: a.kos[0].id, name: 'Nama Baru' })
    expect(updated.name).toBe('Nama Baru')
  })

  it("rejects an owner writing to another owner's kos and leaves the row untouched", async () => {
    const { a, b } = await twoOwners()
    const before = await prisma.kos.findUniqueOrThrow({ where: { id: b.kos[0].id } })
    expect(await code(probeFor(a.userId).renameKos({ kosId: b.kos[0].id, name: 'Dibajak' }))).toBe('FORBIDDEN')
    expect((await prisma.kos.findUniqueOrThrow({ where: { id: b.kos[0].id } })).name).toBe(before.name)
  })

  it('rejects a user with no owner profile, anonymous callers and unknown kos ids', async () => {
    const { a } = await twoOwners()
    const student = await prisma.user.findUniqueOrThrow({ where: { email: 'demo-student@kobo.test' } })
    const kosId = a.kos[0].id
    expect(await code(probeFor(student.id).renameKos({ kosId, name: 'x' }))).toBe('FORBIDDEN')
    expect(await code(probeFor(null).renameKos({ kosId, name: 'x' }))).toBe('UNAUTHORIZED')
    expect(await code(probeFor(a.userId).renameKos({ kosId: 'no-such-kos', name: 'x' }))).toBe('FORBIDDEN')
  })
})

describe('auth.me over tRPC', () => {
  it('is null for the anonymous caller', async () => {
    expect(await caller.auth.me()).toBeNull()
  })

  it('describes an owner', async () => {
    const { a } = await twoOwners()
    const me = await callerFor(a.userId).auth.me()
    expect(me).toMatchObject({ isOwner: true, ownerProfileId: a.id, campusVerified: false })
    expect(me?.user.id).toBe(a.userId)
  })

  it('describes a campus-verified student', async () => {
    const student = await prisma.user.findUniqueOrThrow({ where: { email: 'demo-student@kobo.test' } })
    expect(await callerFor(student.id).auth.me()).toMatchObject({ isOwner: false, ownerProfileId: null, campusVerified: true })
  })
})
