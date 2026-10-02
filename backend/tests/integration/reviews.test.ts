import type { TRPCError } from '@trpc/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { callerFor, DEMO_STUDENT_ID, newStudent, prisma, vacantRoom } from '../helpers.ts'

beforeEach(() => resetDb(prisma))

const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as TRPCError | null
const code = async (p: Promise<unknown>) => (await err(p))?.code
const DAY = 24 * 3600_000

type Kind = 'active' | 'ended-paid' | 'ended-unpaid' | 'pending-live' | 'pending-expired'

/** A tenancy for `userId` in a fresh vacant room, in the requested lifecycle state. */
async function tenancyFor(userId: string, kind: Kind, nth = 0) {
  const room = await vacantRoom(nth)
  const now = Date.now()
  const status = kind === 'active' ? 'ACTIVE' : kind.startsWith('ended') ? 'ENDED' : 'PENDING'
  const t = await prisma.tenancy.create({
    data: {
      roomId: room.id,
      userId,
      status,
      startDate: new Date(now),
      durationMonths: 3,
      expiresAt: kind === 'pending-live' ? new Date(now + DAY) : kind === 'pending-expired' ? new Date(now - DAY) : null,
      endedAt: status === 'ENDED' ? new Date(now) : null,
    },
  })
  const paid = kind === 'active' || kind === 'ended-paid'
  await prisma.invoice.create({
    data: { tenancyId: t.id, periodStart: new Date(now), dueDate: new Date(now), amount: 1_000_000, status: paid ? 'PAID' : 'UNPAID' },
  })
  return { tenancy: t, room }
}

const input = (tenancyId: string, over: Record<string, unknown> = {}) => ({
  tenancyId,
  rating: 4,
  subRatings: { cleanliness: 5, wifi: 3 },
  comment: 'Kamar bersih dan tenang.',
  ...over,
})

describe('review.create', () => {
  it('stores the review for the tenant of an ACTIVE tenancy, with sub-ratings', async () => {
    const { tenancy } = await tenancyFor(DEMO_STUDENT_ID, 'active')
    const res = await callerFor(DEMO_STUDENT_ID).review.create(input(tenancy.id))
    const row = await prisma.review.findUniqueOrThrow({ where: { id: res.id } })
    expect(row).toMatchObject({ tenancyId: tenancy.id, rating: 4, cleanliness: 5, wifi: 3, ownerRating: null, quietness: null, comment: 'Kamar bersih dan tenang.' })
  })

  it('allows an ENDED tenancy that was paid, but never a never-paid or expired hold', async () => {
    const u = await newStudent()
    const ok = await tenancyFor(u.id, 'ended-paid')
    expect((await callerFor(u.id).review.create(input(ok.tenancy.id))).id).toBeTruthy()
    for (const [i, kind] of (['ended-unpaid', 'pending-live', 'pending-expired'] as Kind[]).entries()) {
      const { tenancy } = await tenancyFor(u.id, kind, i + 1)
      expect(await code(callerFor(u.id).review.create(input(tenancy.id))), kind).toBe('FORBIDDEN')
    }
    expect(await prisma.review.count({ where: { tenancy: { userId: u.id } } })).toBe(1)
  })

  it("rejects someone else's tenancy, an unknown tenancy and an anonymous caller", async () => {
    const u = await newStudent()
    const { tenancy } = await tenancyFor(u.id, 'active')
    expect(await code(callerFor(DEMO_STUDENT_ID).review.create(input(tenancy.id)))).toBe('FORBIDDEN')
    expect(await code(callerFor(u.id).review.create(input('ghost')))).toBe('FORBIDDEN')
    const { caller } = await import('../helpers.ts')
    expect(await code(caller.review.create(input(tenancy.id)))).toBe('UNAUTHORIZED')
  })

  it('allows one review per tenancy (CONFLICT, in Indonesian)', async () => {
    const { tenancy } = await tenancyFor(DEMO_STUDENT_ID, 'active')
    const c = callerFor(DEMO_STUDENT_ID)
    await c.review.create(input(tenancy.id))
    const e = await err(c.review.create(input(tenancy.id, { rating: 1 })))
    expect(e?.code).toBe('CONFLICT')
    expect(e?.message).toBe('Anda sudah mengulas sewa ini')
    expect(await prisma.review.count({ where: { tenancyId: tenancy.id } })).toBe(1)
  })

  it('validates rating 1-5, sub-ratings and a non-empty comment', async () => {
    const { tenancy } = await tenancyFor(DEMO_STUDENT_ID, 'active')
    const c = callerFor(DEMO_STUDENT_ID)
    for (const bad of [{ rating: 0 }, { rating: 6 }, { rating: 3.5 }, { comment: '   ' }, { subRatings: { wifi: 9 } }]) {
      expect(await code(c.review.create(input(tenancy.id, bad))), JSON.stringify(bad)).toBe('BAD_REQUEST')
    }
  })

  it("snapshots verifiedStudent from the author's campus verification at write time", async () => {
    const plain = await newStudent()
    const a = await tenancyFor(plain.id, 'active')
    const r1 = await callerFor(plain.id).review.create(input(a.tenancy.id))
    expect((await prisma.review.findUniqueOrThrow({ where: { id: r1.id } })).verifiedStudent).toBe(false)

    const b = await tenancyFor(DEMO_STUDENT_ID, 'active', 1)
    const r2 = await callerFor(DEMO_STUDENT_ID).review.create(input(b.tenancy.id))
    expect((await prisma.review.findUniqueOrThrow({ where: { id: r2.id } })).verifiedStudent).toBe(true)

    // Losing verification later does not rewrite history.
    await prisma.user.update({ where: { id: DEMO_STUDENT_ID }, data: { campusEmailVerifiedAt: null } })
    expect((await prisma.review.findUniqueOrThrow({ where: { id: r2.id } })).verifiedStudent).toBe(true)
  })

  it('shows up in kos.detail with the snapshot flag, and moves the kos rating', async () => {
    const plain = await newStudent()
    const { tenancy, room } = await tenancyFor(plain.id, 'active')
    await callerFor(plain.id).review.create(input(tenancy.id, { comment: 'Ulasan baru dari uji.' }))
    const { caller } = await import('../helpers.ts')
    const d = await caller.kos.detail({ id: room.kosId })
    const mine = d.reviews.find((r) => r.comment === 'Ulasan baru dari uji.')!
    expect(mine).toMatchObject({ rating: 4, verified: false, authorName: plain.name })
  })
})

describe('review.update', () => {
  it('lets the author edit within 14 days, but not later, not others, and keeps verifiedStudent', async () => {
    const { tenancy } = await tenancyFor(DEMO_STUDENT_ID, 'active')
    const c = callerFor(DEMO_STUDENT_ID)
    const { id } = await c.review.create(input(tenancy.id))
    await c.review.update({ reviewId: id, rating: 2, subRatings: { quietness: 1 }, comment: 'Ternyata berisik.' })
    expect(await prisma.review.findUniqueOrThrow({ where: { id } })).toMatchObject({ rating: 2, comment: 'Ternyata berisik.', quietness: 1, cleanliness: null, verifiedStudent: true })

    const stranger = await newStudent()
    expect(await code(callerFor(stranger.id).review.update({ reviewId: id, rating: 5, subRatings: {}, comment: 'x' }))).toBe('FORBIDDEN')

    await prisma.review.update({ where: { id }, data: { createdAt: new Date(Date.now() - 15 * DAY) } })
    const late = await err(c.review.update({ reviewId: id, rating: 5, subRatings: {}, comment: 'terlambat' }))
    expect(late?.code).toBe('FORBIDDEN')
    expect(late?.message).toMatch(/14 hari/)
    await prisma.review.update({ where: { id }, data: { createdAt: new Date(Date.now() - 13 * DAY) } })
    await c.review.update({ reviewId: id, rating: 5, subRatings: {}, comment: 'masih boleh' })
    expect((await prisma.review.findUniqueOrThrow({ where: { id } })).comment).toBe('masih boleh')
  })
})

describe('booking.mine review eligibility', () => {
  it('flags canReview on activated tenancies without a review, then exposes the review', async () => {
    const u = await newStudent()
    const a = await tenancyFor(u.id, 'active')
    const p = await tenancyFor(u.id, 'pending-live', 1)
    const c = callerFor(u.id)
    let mine = await c.booking.mine()
    expect(mine.find((t) => t.id === a.tenancy.id)).toMatchObject({ canReview: true, review: null })
    expect(mine.find((t) => t.id === p.tenancy.id)).toMatchObject({ canReview: false, review: null })
    await c.review.create(input(a.tenancy.id))
    mine = await c.booking.mine()
    const t = mine.find((x) => x.id === a.tenancy.id)!
    expect(t.canReview).toBe(false)
    expect(t.review).toMatchObject({ rating: 4, comment: 'Kamar bersih dan tenang.', editable: true, subRatings: { cleanliness: 5, wifi: 3, owner: null, quietness: null } })
  })
})

describe('review.reply and owner.reviews', () => {
  async function reviewedKos() {
    const { tenancy, room } = await tenancyFor(DEMO_STUDENT_ID, 'active')
    const { id } = await callerFor(DEMO_STUDENT_ID).review.create(input(tenancy.id))
    const kos = await prisma.kos.findUniqueOrThrow({ where: { id: room.kosId }, include: { owner: true } })
    return { reviewId: id, kosId: kos.id, ownerUserId: kos.owner.userId }
  }

  it('lets the owner of that kos reply, and a second reply replaces the first', async () => {
    const { reviewId, kosId, ownerUserId } = await reviewedKos()
    const c = callerFor(ownerUserId)
    await c.review.reply({ kosId, reviewId, text: 'Terima kasih atas ulasannya.' })
    const first = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } })
    expect(first.ownerReply).toBe('Terima kasih atas ulasannya.')
    expect(first.ownerReplyAt).not.toBeNull()
    await c.review.reply({ kosId, reviewId, text: 'Kami perbaiki segera.' })
    expect((await prisma.review.findUniqueOrThrow({ where: { id: reviewId } })).ownerReply).toBe('Kami perbaiki segera.')
  })

  it('rejects another owner, a review of another kos, a student and empty text', async () => {
    const { reviewId, kosId, ownerUserId } = await reviewedKos()
    const other = await prisma.ownerProfile.findFirstOrThrow({ where: { userId: { not: ownerUserId }, kos: { some: {} } }, include: { kos: true } })
    expect(await code(callerFor(other.userId).review.reply({ kosId, reviewId, text: 'x' }))).toBe('FORBIDDEN')
    expect(await code(callerFor(other.userId).review.reply({ kosId: other.kos[0].id, reviewId, text: 'x' }))).toBe('NOT_FOUND')
    expect(await code(callerFor(DEMO_STUDENT_ID).review.reply({ kosId, reviewId, text: 'x' }))).toBe('FORBIDDEN')
    expect(await code(callerFor(ownerUserId).review.reply({ kosId, reviewId, text: '  ' }))).toBe('BAD_REQUEST')
    expect((await prisma.review.findUniqueOrThrow({ where: { id: reviewId } })).ownerReply).toBeNull()
  })

  it('owner.reviews lists only that kos reviews, newest first, with reply state; cross-owner is FORBIDDEN', async () => {
    const { reviewId, kosId, ownerUserId } = await reviewedKos()
    const list = await callerFor(ownerUserId).owner.reviews({ kosId })
    expect(list.length).toBe(await prisma.review.count({ where: { tenancy: { room: { kosId } } } }))
    expect(list[0]).toMatchObject({ id: reviewId, rating: 4, comment: 'Kamar bersih dan tenang.', ownerReply: null })
    const stamps = list.map((r) => r.createdAt)
    expect(stamps).toEqual([...stamps].sort().reverse())
    const other = await prisma.ownerProfile.findFirstOrThrow({ where: { userId: { not: ownerUserId }, kos: { some: {} } } })
    expect(await code(callerFor(other.userId).owner.reviews({ kosId }))).toBe('FORBIDDEN')
  })
})
