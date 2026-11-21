import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { actionReport, dismissReport, listOpenReports, ReportReviewError, showReport } from '../../src/matching/safety.ts'
import { callerFor, newStudent, prisma } from '../helpers.ts'
import { err, startIn, verifyAtCampus } from './gap-helpers.ts'

const DAY = 86_400_000

beforeEach(async () => {
  await resetDb(prisma)
  // The seed has a demo chat and requests; these tests count rows globally, so start from empty matching tables.
  await prisma.partnerMessage.deleteMany()
  await prisma.connectionReadState.deleteMany()
  await prisma.sharedShortlistItem.deleteMany()
  await prisma.userReport.deleteMany()
  await prisma.userBlock.deleteMany()
  await prisma.partnerConnection.deleteMany()
  await prisma.partnerRequest.deleteMany()
  await prisma.matchingProfile.deleteMany()
})

let seq = 0
async function person() {
  const u = await newStudent()
  await verifyAtCampus(u.id)
  const c = callerFor(u.id).matching
  const p = await c.profile.upsert({
    displayName: `Teman ${++seq}`,
    gender: 'PEREMPUAN',
    birthYear: 2004,
    budgetMin: 1_000_000,
    budgetMax: 2_000_000,
    anchorLat: -6.2017,
    anchorLng: 106.7819,
    anchorLabel: 'BINUS Anggrek',
    moveInDate: startIn(30),
    smoking: 'TIDAK_MEROKOK_TOLERAN',
  })
  return { id: u.id, profileId: p.id, c }
}
type P = Awaited<ReturnType<typeof person>>

async function connect(a: string, b: string) {
  const req = await prisma.partnerRequest.create({ data: { fromUserId: a, toUserId: b, status: 'ACCEPTED', expiresAt: new Date(Date.now() + 14 * DAY) } })
  const [lo, hi] = [a, b].sort() as [string, string]
  return prisma.partnerConnection.create({ data: { userAId: lo, userBId: hi, requestId: req.id } })
}
const pending = (from: string, to: string) => prisma.partnerRequest.create({ data: { fromUserId: from, toUserId: to, expiresAt: new Date(Date.now() + DAY) } })
const profileOf = (p: P) => prisma.matchingProfile.findUniqueOrThrow({ where: { id: p.profileId } })

describe('block', () => {
  it('blocks in one step: ends the live connection, cancels pending requests both ways, and unblock removes only the block', async () => {
    const a = await person()
    const b = await person()
    const c = await person()
    const conn = await connect(a.id, b.id)
    await pending(a.id, c.id)
    await pending(c.id, a.id).catch(() => null) // the pending-pair unique index may refuse the reverse; fine either way

    await a.c.safety.block({ profileId: b.profileId })
    expect(await prisma.partnerConnection.findUniqueOrThrow({ where: { id: conn.id } })).toMatchObject({ endReason: 'BLOCKED', endedById: a.id })
    await a.c.safety.block({ profileId: c.profileId })
    expect(await prisma.partnerRequest.count({ where: { status: 'PENDING' } })).toBe(0)
    await a.c.safety.block({ profileId: c.profileId }) // idempotent
    expect(await prisma.userBlock.count({ where: { blockerId: a.id } })).toBe(2)

    const list = await a.c.safety.blocks()
    expect(list.map((x) => x.profileId).sort()).toEqual([b.profileId, c.profileId].sort())
    expect(JSON.stringify(list)).not.toContain(b.id)

    await a.c.safety.unblock({ blockId: list[0]!.id })
    expect(await prisma.userBlock.count()).toBe(1)
    expect((await err(b.c.safety.unblock({ blockId: list[1]!.id })))?.code).toBe('NOT_FOUND')
    expect((await err(a.c.safety.block({ profileId: a.profileId })))?.code).toBe('BAD_REQUEST')
    expect((await err(a.c.safety.block({ profileId: 'nope' })))?.code).toBe('NOT_FOUND')
  })

  it('shows a deleted profile as "Pengguna KoBo"', async () => {
    const a = await person()
    const b = await person()
    await a.c.safety.block({ profileId: b.profileId })
    await prisma.matchingProfile.delete({ where: { id: b.profileId } })
    expect(await a.c.safety.blocks()).toMatchObject([{ profileId: null, displayName: 'Pengguna KoBo' }])
  })
})

describe('report', () => {
  it('validates self, unknown target and foreign context ids', async () => {
    const a = await person()
    const b = await person()
    const x = await person()
    const conn = await connect(a.id, b.id)
    const msg = await prisma.partnerMessage.create({ data: { connectionId: conn.id, senderId: b.id, body: 'halo' } })

    expect((await err(a.c.safety.report({ profileId: a.profileId, reason: 'SPAM_PENIPUAN' })))?.code).toBe('BAD_REQUEST')
    expect((await err(a.c.safety.report({ profileId: 'nope', reason: 'SPAM_PENIPUAN' })))?.code).toBe('NOT_FOUND')
    // x is not in the connection; the connection is not x's target's.
    expect((await err(x.c.safety.report({ profileId: b.profileId, reason: 'LAINNYA', connectionId: conn.id })))?.code).toBe('NOT_FOUND')
    expect((await err(x.c.safety.report({ profileId: b.profileId, reason: 'LAINNYA', messageId: msg.id })))?.code).toBe('NOT_FOUND')
    expect((await err(a.c.safety.report({ profileId: x.profileId, reason: 'LAINNYA', connectionId: conn.id })))?.code).toBe('NOT_FOUND')
    expect(await prisma.userReport.count()).toBe(0)

    await a.c.safety.report({ profileId: b.profileId, reason: 'KONTEN_TIDAK_PANTAS', detail: 'pesan kasar', messageId: msg.id })
    const row = await prisma.userReport.findFirstOrThrow()
    expect(row).toMatchObject({ connectionId: conn.id, messageId: msg.id, countsForHide: true, status: 'OPEN' })
    expect(row.snapshot).toMatchObject([{ body: 'halo', from: 'terlapor' }])
  })

  it('refuses a second OPEN report by the same reporter, but allows it after closing', async () => {
    const a = await person()
    const b = await person()
    await a.c.safety.report({ profileId: b.profileId, reason: 'SPAM_PENIPUAN' })
    expect((await err(a.c.safety.report({ profileId: b.profileId, reason: 'LAINNYA' })))?.code).toBe('CONFLICT')
    await dismissReport(prisma, (await prisma.userReport.findFirstOrThrow()).id, { reviewer: 'qa' })
    await a.c.safety.report({ profileId: b.profileId, reason: 'LAINNYA' })
    expect(await prisma.userReport.count()).toBe(2)
  })

  it('PELECEHAN from a connected person also blocks the target for them', async () => {
    const a = await person()
    const b = await person()
    const conn = await connect(a.id, b.id)
    await a.c.safety.report({ profileId: b.profileId, reason: 'PELECEHAN' })
    expect(await prisma.userBlock.count({ where: { blockerId: a.id, blockedId: b.id } })).toBe(1)
    expect((await prisma.partnerConnection.findUniqueOrThrow({ where: { id: conn.id } })).endReason).toBe('BLOCKED')
  })

  it('hides a profile at 3 distinct reporters who dealt with it, not before and not for strangers', async () => {
    const target = await person()
    const r = [await person(), await person(), await person(), await person()]
    const stranger = r[3]!
    for (const x of r.slice(0, 2)) {
      await connect(x.id, target.id)
      await x.c.safety.report({ profileId: target.profileId, reason: 'PROFIL_PALSU', detail: 'Gender tidak sesuai' })
    }
    await stranger.c.safety.report({ profileId: target.profileId, reason: 'LAINNYA' }) // no relation: does not count
    expect((await profileOf(target)).hiddenByReportsAt).toBeNull()

    await connect(r[2]!.id, target.id)
    await r[2]!.c.safety.report({ profileId: target.profileId, reason: 'SPAM_PENIPUAN' })
    expect(await profileOf(target)).toMatchObject({ active: false, hiddenByReportsAt: expect.any(Date) })
  })
})

describe('reports CLI functions', () => {
  async function hidden() {
    const target = await person()
    const reporters = [await person(), await person(), await person()]
    for (const x of reporters) {
      await connect(x.id, target.id)
      await x.c.safety.report({ profileId: target.profileId, reason: 'PROFIL_PALSU' })
    }
    return { target, reporters }
  }

  it('lists and shows open reports', async () => {
    const { target } = await hidden()
    const rows = await listOpenReports(prisma)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ reason: 'PROFIL_PALSU', openAgainstReported: 3 })
    const detail = await showReport(prisma, rows[0]!.id)
    expect(detail.reported.matchingProfile).toMatchObject({ id: target.profileId, gender: 'PEREMPUAN' })
    await expect(showReport(prisma, 'nope')).rejects.toBeInstanceOf(ReportReviewError)
  })

  it('action closes every OPEN report against the profile and keeps it deactivated and hidden', async () => {
    const { target } = await hidden()
    const first = (await listOpenReports(prisma))[0]!
    expect(await actionReport(prisma, first.id, { reviewer: 'qa', note: 'terbukti' })).toEqual({ closed: 3 })
    expect(await prisma.userReport.count({ where: { status: 'ACTIONED' } })).toBe(3)
    expect(await profileOf(target)).toMatchObject({ active: false, hiddenByReportsAt: expect.any(Date) })
    await expect(actionReport(prisma, first.id, { reviewer: 'qa', note: 'lagi' })).rejects.toBeInstanceOf(ReportReviewError)
  })

  it('dismiss clears the hide once fewer than 3 remain, without reactivating', async () => {
    const { target } = await hidden()
    expect((await profileOf(target)).hiddenByReportsAt).not.toBeNull()
    const rows = await listOpenReports(prisma)
    expect(await dismissReport(prisma, rows[0]!.id, { reviewer: 'qa' })).toEqual({ cleared: true })
    expect(await profileOf(target)).toMatchObject({ active: false, hiddenByReportsAt: null })
    expect(await prisma.userReport.count({ where: { status: 'DISMISSED' } })).toBe(1)
    expect(await prisma.userReport.count({ where: { status: 'OPEN' } })).toBe(2)
  })

  it('dismiss with 3 other counting reports left keeps the profile hidden', async () => {
    const { target } = await hidden()
    const extra = await person()
    await connect(extra.id, target.id)
    await extra.c.safety.report({ profileId: target.profileId, reason: 'LAINNYA' })
    const rows = await listOpenReports(prisma)
    expect(await dismissReport(prisma, rows[0]!.id, { reviewer: 'qa' })).toEqual({ cleared: false })
    expect((await profileOf(target)).hiddenByReportsAt).not.toBeNull()
  })
})
