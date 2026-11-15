import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { isAutoApproved } from '../../src/ownerApproval.ts'
import { RateLimiter } from '../../src/rateLimit.ts'
import { callerFor, me, prisma, registerAndSignIn, request, caller } from '../helpers.ts'
import type { TRPCError } from '@trpc/server'

beforeEach(() => resetDb(prisma))

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as TRPCError | null)?.code
const userId = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id
const PHONE = { phone: '0812 3456 7890' }

describe('owner.becomeOwner', () => {
  it('rejects an unauthenticated caller', async () => {
    expect(await code(caller.owner.becomeOwner(PHONE))).toBe('UNAUTHORIZED')
  })

  it('creates an OwnerProfile once; the second call returns the same one', async () => {
    await registerAndSignIn('sari@example.com')
    const id = await userId('sari@example.com')
    const first = await callerFor(id).owner.becomeOwner(PHONE)
    const second = await callerFor(id).owner.becomeOwner(PHONE)
    expect(second.ownerProfileId).toBe(first.ownerProfileId)
    expect(await prisma.ownerProfile.count({ where: { userId: id } })).toBe(1)
  })

  it('stores the WhatsApp number and leaves the new owner waiting for approval', async () => {
    await registerAndSignIn('sari@example.com')
    const id = await userId('sari@example.com')
    const res = await callerFor(id).owner.becomeOwner(PHONE)
    expect(res.approved).toBe(false)
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).phone).toBe(PHONE.phone)
    expect((await prisma.ownerProfile.findUniqueOrThrow({ where: { userId: id } })).approvedAt).toBeNull()
  })

  it('requires a valid phone number', async () => {
    await registerAndSignIn('sari@example.com')
    const id = await userId('sari@example.com')
    expect(await code(callerFor(id).owner.becomeOwner({ phone: 'abc' }))).toBe('BAD_REQUEST')
    expect(await prisma.ownerProfile.count({ where: { userId: id } })).toBe(0)
  })

  it('requires a verified email', async () => {
    await registerAndSignIn('sari@example.com')
    const id = await userId('sari@example.com')
    await prisma.user.update({ where: { id }, data: { emailVerified: false } })
    expect(await code(callerFor(id).owner.becomeOwner(PHONE))).toBe('PRECONDITION_FAILED')
    expect(await prisma.ownerProfile.count({ where: { userId: id } })).toBe(0)
  })

  it('makes auth.me report isOwner over HTTP, with the approval state', async () => {
    const cookie = await registerAndSignIn('sari@example.com')
    expect((await me(cookie))?.isOwner).toBe(false)
    const res = await request('/api/trpc/owner.becomeOwner', { cookie, method: 'POST', body: PHONE })
    expect(res.status).toBe(200)
    const after = await me(cookie)
    expect(after?.isOwner).toBe(true)
    expect(after?.ownerProfileId).toBeTruthy()
    expect(after?.ownerApproved).toBe(false)
  })

  it('blocks demo accounts and creates nothing', async () => {
    const demo = await prisma.user.findFirstOrThrow({ where: { isDemo: true, ownerProfile: null } })
    expect(await code(callerFor(demo.id).owner.becomeOwner(PHONE))).toBe('FORBIDDEN')
    expect(await prisma.ownerProfile.count({ where: { userId: demo.id } })).toBe(0)
  })
})

describe('owner approval gates the public listing', () => {
  const kosInput = { name: 'Kos Baru Uji', gender: 'CAMPUR' as const, address: 'Jl. Uji No. 1', district: 'Kebayoran', city: 'Jakarta Selatan', lat: -6.2, lng: 106.8, electricityType: 'INCLUDED' as const, studentDiscountAmount: 0, initialRooms: { count: 2, priceMonthly: 1_500_000 } }

  it('hides a waiting owner\'s kos from list, search and detail, but not from the owner', async () => {
    await registerAndSignIn('sari@example.com')
    const id = await userId('sari@example.com')
    const owner = callerFor(id)
    await owner.owner.becomeOwner(PHONE)
    const { id: kosId } = await owner.owner.kos.create(kosInput)

    expect((await caller.kos.list()).some((k) => k.id === kosId)).toBe(false)
    expect((await caller.kos.search({})).some((k) => k.id === kosId)).toBe(false)
    expect(await code(caller.kos.detail({ id: kosId }))).toBe('NOT_FOUND')
    expect((await owner.kos.detail({ id: kosId })).id).toBe(kosId)
    expect((await owner.owner.myKos()).map((k) => k.id)).toContain(kosId)

    await prisma.ownerProfile.update({ where: { userId: id }, data: { approvedAt: new Date() } })
    expect((await caller.kos.list()).some((k) => k.id === kosId)).toBe(true)
    expect((await caller.kos.detail({ id: kosId })).id).toBe(kosId)
  })
})

describe('abuse limits', () => {
  const kosInput = { name: 'Kos Batas', gender: 'CAMPUR' as const, address: 'Jl. Batas 1', district: 'Kebayoran', city: 'Jakarta Selatan', lat: -6.2, lng: 106.8, electricityType: 'INCLUDED' as const, studentDiscountAmount: 0 }

  it('caps kos per owner and rooms per kos', async () => {
    await registerAndSignIn('sari@example.com')
    const id = await userId('sari@example.com')
    const owner = callerFor(id)
    await owner.owner.becomeOwner(PHONE)
    for (let i = 0; i < 5; i++) await owner.owner.kos.create({ ...kosInput, name: `Kos ${i}` })
    expect(await code(owner.owner.kos.create(kosInput))).toBe('CONFLICT')

    const [first] = await owner.owner.myKos()
    const big = first.id
    await prisma.room.createMany({ data: Array.from({ length: 40 }, (_, n) => ({ kosId: big, roomNumber: `X${n}`, floor: 1, type: 'Standar', size: '3 x 3 m', bedType: 'Single', priceMonthly: 1_000_000 })) })
    expect(await code(owner.owner.room.create({ kosId: big, roomNumber: 'Z9', floor: 1, type: 'Standar', size: '3 x 3 m', bedType: 'Single', priceMonthly: 1_000_000 }))).toBe('CONFLICT')
  })

  it('the limiter blocks after max hits and recovers when the window passes', () => {
    let t = 0
    const l = new RateLimiter({ now: () => t })
    for (let i = 0; i < 3; i++) l.check('k', 3, 1000)
    expect(() => l.check('k', 3, 1000)).toThrow()
    expect(() => l.check('other', 3, 1000)).not.toThrow()
    t = 1500
    expect(() => l.check('k', 3, 1000)).not.toThrow()
  })

  it('auto-approval matches exact emails and @domain suffixes only', () => {
    const env = { OWNER_AUTO_APPROVE: 'tim@kobo.id, @binus.ac.id' } as NodeJS.ProcessEnv
    expect(isAutoApproved('Tim@kobo.id', env)).toBe(true)
    expect(isAutoApproved('dosen@binus.ac.id', env)).toBe(true)
    expect(isAutoApproved('x@evilbinus.ac.id.example.com', env)).toBe(false)
    expect(isAutoApproved('tim@kobo.id.evil.com', env)).toBe(false)
    expect(isAutoApproved('anyone@gmail.com', {} as NodeJS.ProcessEnv)).toBe(false)
  })
})
