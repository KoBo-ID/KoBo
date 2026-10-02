import type { TRPCError } from '@trpc/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { caller, callerFor, DEMO_STUDENT_ID, newStudent, prisma } from '../helpers.ts'

beforeEach(() => resetDb(prisma))
const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as TRPCError | null)?.code

describe('auth.updateProfile', () => {
  it('updates name, phone and campus of the caller only', async () => {
    const s = await newStudent()
    const other = await newStudent()
    await callerFor(s.id).auth.updateProfile({ name: 'Nama Baru', phone: '0812 3456 7890', campus: 'UI Depok' })
    expect(await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ name: 'Nama Baru', phone: '0812 3456 7890', campus: 'UI Depok' })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).name).toBe(other.name)
  })

  it('exposes the phone through auth.me', async () => {
    const s = await newStudent()
    await callerFor(s.id).auth.updateProfile({ name: s.name, phone: '081234567890', campus: null })
    expect((await callerFor(s.id).auth.me())?.user.phone).toBe('081234567890')
  })

  it('accepts clearing phone and campus', async () => {
    await callerFor(DEMO_STUDENT_ID).auth.updateProfile({ name: 'Demo Mahasiswa', phone: null, campus: null })
    expect(await prisma.user.findUniqueOrThrow({ where: { id: DEMO_STUDENT_ID } })).toMatchObject({ phone: null, campus: null })
  })

  it('rejects an empty name, a junk phone number and anonymous callers, and never changes email', async () => {
    const s = await newStudent()
    expect(await code(callerFor(s.id).auth.updateProfile({ name: ' ', phone: null, campus: null }))).toBe('BAD_REQUEST')
    expect(await code(callerFor(s.id).auth.updateProfile({ name: 'A', phone: 'abc', campus: null }))).toBe('BAD_REQUEST')
    expect(await code(caller.auth.updateProfile({ name: 'A', phone: null, campus: null }))).toBe('UNAUTHORIZED')
    await callerFor(s.id).auth.updateProfile({ name: 'B', phone: null, campus: null, email: 'x@evil.test' } as never)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).email).toBe(s.email)
  })
})
