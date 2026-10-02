import type { TRPCError } from '@trpc/server'
import { addDays, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { callerFor, DEMO_STUDENT_ID, newStudent, prisma } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as TRPCError | null)?.code
const tomorrow = () => addDays(todayWIB(new Date()), 1)

async function ownersWithKos() {
  const owners = await prisma.ownerProfile.findMany({ include: { kos: { orderBy: { createdAt: 'asc' } } }, orderBy: { id: 'asc' } })
  const [a, b] = owners.filter((o) => o.kos.length > 0)
  return { a, b }
}

const input = (kosId: string, over: Record<string, unknown> = {}) => ({ kosId, date: tomorrow(), timeSlot: 'PAGI' as const, notes: 'Mau cek colokan.', ...over })

describe('visit.create', () => {
  it('schedules a visit for the signed-in student and lists it in visit.mine', async () => {
    const { a } = await ownersWithKos()
    const student = await newStudent()
    const res = await callerFor(student.id).visit.create(input(a.kos[0].id))
    const mine = await callerFor(student.id).visit.mine()
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ id: res.id, date: tomorrow(), timeSlot: 'PAGI', status: 'SCHEDULED', notes: 'Mau cek colokan.', kos: { id: a.kos[0].id, name: a.kos[0].name } })
  })

  it('requires a signed-in user', async () => {
    const { a } = await ownersWithKos()
    const { caller } = await import('../helpers.ts')
    expect(await code(caller.visit.create(input(a.kos[0].id)))).toBe('UNAUTHORIZED')
  })

  it('rejects today and past dates (WIB), accepts tomorrow', async () => {
    const { a } = await ownersWithKos()
    const s = await newStudent()
    const c = callerFor(s.id)
    expect(await code(c.visit.create(input(a.kos[0].id, { date: todayWIB(new Date()) })))).toBe('BAD_REQUEST')
    expect(await code(c.visit.create(input(a.kos[0].id, { date: addDays(todayWIB(new Date()), -3) })))).toBe('BAD_REQUEST')
    expect(await code(c.visit.create(input(a.kos[0].id)))).toBeUndefined()
  })

  it('rejects an unknown kos', async () => {
    const s = await newStudent()
    expect(await code(callerFor(s.id).visit.create(input('kos-tidak-ada')))).toBe('NOT_FOUND')
  })

  it('allows one active visit per student per kos, but another kos is fine', async () => {
    const { a, b } = await ownersWithKos()
    const s = await newStudent()
    const c = callerFor(s.id)
    await c.visit.create(input(a.kos[0].id))
    expect(await code(c.visit.create(input(a.kos[0].id, { timeSlot: 'SIANG' })))).toBe('CONFLICT')
    expect(await code(c.visit.create(input(b.kos[0].id)))).toBeUndefined()
  })

  it('allows a new visit after the previous one was cancelled', async () => {
    const { a } = await ownersWithKos()
    const s = await newStudent()
    const c = callerFor(s.id)
    const first = await c.visit.create(input(a.kos[0].id))
    await c.visit.cancel({ visitId: first.id })
    expect(await code(c.visit.create(input(a.kos[0].id)))).toBeUndefined()
  })

  it('two simultaneous requests create exactly one visit', async () => {
    const { a } = await ownersWithKos()
    const s = await newStudent()
    const c = callerFor(s.id)
    const results = await Promise.allSettled([c.visit.create(input(a.kos[0].id)), c.visit.create(input(a.kos[0].id))])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await prisma.visit.count({ where: { userId: s.id } })).toBe(1)
  })
})

describe('visit.cancel', () => {
  it('lets the student cancel their own visit', async () => {
    const { a } = await ownersWithKos()
    const s = await newStudent()
    const v = await callerFor(s.id).visit.create(input(a.kos[0].id))
    await callerFor(s.id).visit.cancel({ visitId: v.id })
    expect((await prisma.visit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('CANCELLED')
  })

  it("rejects cancelling another student's visit", async () => {
    const { a } = await ownersWithKos()
    const s = await newStudent()
    const other = await newStudent()
    const v = await callerFor(s.id).visit.create(input(a.kos[0].id))
    expect(await code(callerFor(other.id).visit.cancel({ visitId: v.id }))).toBe('FORBIDDEN')
    expect((await prisma.visit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('SCHEDULED')
  })

  it('refuses to cancel a completed visit', async () => {
    const { a } = await ownersWithKos()
    const s = await newStudent()
    const v = await callerFor(s.id).visit.create(input(a.kos[0].id))
    await prisma.visit.update({ where: { id: v.id }, data: { status: 'COMPLETED' } })
    expect(await code(callerFor(s.id).visit.cancel({ visitId: v.id }))).toBe('CONFLICT')
  })
})

describe('owner.visits and owner.visit.complete', () => {
  it("lists a kos's visits with the student's contact for its owner", async () => {
    const { a } = await ownersWithKos()
    const s = await newStudent()
    await prisma.user.update({ where: { id: s.id }, data: { phone: '0812000111', campus: 'Binus Syahdan' } })
    await callerFor(s.id).visit.create(input(a.kos[0].id))
    const rows = await callerFor(a.userId).owner.visits({ kosId: a.kos[0].id })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ date: tomorrow(), timeSlot: 'PAGI', status: 'SCHEDULED', student: { name: s.name, phone: '0812000111', campus: 'Binus Syahdan' } })
  })

  it("rejects another owner reading or completing a kos's visits", async () => {
    const { a, b } = await ownersWithKos()
    const s = await newStudent()
    const v = await callerFor(s.id).visit.create(input(a.kos[0].id))
    expect(await code(callerFor(b.userId).owner.visits({ kosId: a.kos[0].id }))).toBe('FORBIDDEN')
    expect(await code(callerFor(b.userId).owner.visit.complete({ kosId: a.kos[0].id, visitId: v.id }))).toBe('FORBIDDEN')
    expect((await prisma.visit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('SCHEDULED')
  })

  it("looks the visit up inside the given kos (a visit of someone else's kos is NOT_FOUND)", async () => {
    const { a, b } = await ownersWithKos()
    const s = await newStudent()
    const v = await callerFor(s.id).visit.create(input(b.kos[0].id))
    // a owns a.kos[0], but the visit belongs to b's kos: the visit must be looked up inside the given kos.
    expect(await code(callerFor(a.userId).owner.visit.complete({ kosId: a.kos[0].id, visitId: v.id }))).toBe('NOT_FOUND')
  })

  it('marks a scheduled visit completed, once', async () => {
    const { a } = await ownersWithKos()
    const s = await newStudent()
    const v = await callerFor(s.id).visit.create(input(a.kos[0].id))
    const o = callerFor(a.userId)
    await o.owner.visit.complete({ kosId: a.kos[0].id, visitId: v.id })
    expect((await prisma.visit.findUniqueOrThrow({ where: { id: v.id } })).status).toBe('COMPLETED')
    expect(await code(o.owner.visit.complete({ kosId: a.kos[0].id, visitId: v.id }))).toBe('CONFLICT')
  })

  it('the demo student can book a visit too', async () => {
    const { a } = await ownersWithKos()
    await callerFor(DEMO_STUDENT_ID).visit.create(input(a.kos[0].id))
    expect(await prisma.visit.count({ where: { userId: DEMO_STUDENT_ID } })).toBe(1)
  })
})
