import type { TRPCError } from '@trpc/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { callerFor, DEMO_STUDENT_ID, prisma } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as TRPCError | null)?.code

async function twoOwners() {
  const owners = await prisma.ownerProfile.findMany({ include: { kos: { orderBy: { createdAt: 'asc' } } }, orderBy: { id: 'asc' } })
  const [a, b] = owners.filter((o) => o.kos.length > 0)
  return { a, b }
}

const group = (over: Record<string, unknown> = {}) => ({ categoryTitle: 'Jam malam', rules: ['Pintu dikunci pukul 23.00'], ...over })

describe('owner.rules.set', () => {
  it('stores the groups in submitted order and keeps an omitted fine null', async () => {
    const { a } = await twoOwners()
    const kosId = a.kos[0].id
    await callerFor(a.userId).owner.rules.set({
      kosId,
      groups: [group({ categoryTitle: 'Kedua dulu', rules: ['A', 'B'], penaltyAmount: 50_000, penaltyClause: 'Per pelanggaran' }), group({ categoryTitle: 'Ketiga' })],
    })
    const detail = await callerFor(a.userId).kos.detail({ id: kosId })
    expect(detail.rules.map((r) => r.categoryTitle)).toEqual(['Kedua dulu', 'Ketiga'])
    expect(detail.rules[0]).toMatchObject({ rules: ['A', 'B'], penaltyAmount: 50_000, penaltyClause: 'Per pelanggaran' })
    expect(detail.rules[1]).toMatchObject({ penaltyAmount: null, penaltyClause: null })
  })

  it('replaces earlier groups and clears them with an empty list', async () => {
    const { a } = await twoOwners()
    const kosId = a.kos[0].id
    const caller = callerFor(a.userId)
    await caller.owner.rules.set({ kosId, groups: [group({ categoryTitle: 'Lama' })] })
    await caller.owner.rules.set({ kosId, groups: [group({ categoryTitle: 'Baru' })] })
    expect((await caller.kos.detail({ id: kosId })).rules.map((r) => r.categoryTitle)).toEqual(['Baru'])
    await caller.owner.rules.set({ kosId, groups: [] })
    expect((await caller.kos.detail({ id: kosId })).rules).toEqual([])
  })

  it("leaves other kos' rules untouched", async () => {
    const { a, b } = await twoOwners()
    const before = await prisma.houseRule.count({ where: { kosId: b.kos[0].id } })
    await callerFor(a.userId).owner.rules.set({ kosId: a.kos[0].id, groups: [group()] })
    expect(await prisma.houseRule.count({ where: { kosId: b.kos[0].id } })).toBe(before)
  })

  it("refuses another owner and a student on someone else's kos", async () => {
    const { a, b } = await twoOwners()
    const kosId = a.kos[0].id
    const before = await prisma.houseRule.count({ where: { kosId } })
    expect(await code(callerFor(b.userId).owner.rules.set({ kosId, groups: [group()] }))).toBe('FORBIDDEN')
    expect(await code(callerFor(DEMO_STUDENT_ID).owner.rules.set({ kosId, groups: [group()] }))).toBe('FORBIDDEN')
    expect(await prisma.houseRule.count({ where: { kosId } })).toBe(before)
  })

  it('rejects invalid groups', async () => {
    const { a } = await twoOwners()
    const kosId = a.kos[0].id
    const set = (groups: unknown[]) => callerFor(a.userId).owner.rules.set({ kosId, groups } as never)
    expect(await code(set([group({ rules: [] })]))).toBe('BAD_REQUEST')
    expect(await code(set([group({ rules: Array.from({ length: 16 }, (_, i) => `Aturan ${i}`) })]))).toBe('BAD_REQUEST')
    expect(await code(set([group({ rules: ['x'.repeat(141)] })]))).toBe('BAD_REQUEST')
    expect(await code(set(Array.from({ length: 11 }, () => group())))).toBe('BAD_REQUEST')
    expect(await code(set([group({ penaltyAmount: -1 })]))).toBe('BAD_REQUEST')
  })
})
