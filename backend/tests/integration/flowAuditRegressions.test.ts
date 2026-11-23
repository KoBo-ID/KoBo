import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { addDays, todayWIB } from '@kobo/shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { actionReport } from '../../src/matching/safety.ts'
import { approveApplication, caller, callerFor, cash, newStudent, prisma, request, storage, vacantRoom } from '../helpers.ts'
import { err, newOwner, startIn, verifyAtCampus } from './gap-helpers.ts'

const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DAY = 86_400_000
const HOUR = 3_600_000
const LAT = -6.2017
const LNG = 106.7819
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

beforeEach(() => resetDb(prisma))

const codeOf = async (p: Promise<unknown>) => (await err(p))?.code

async function clearMatchingTables() {
  await prisma.partnerMessage.deleteMany()
  await prisma.connectionReadState.deleteMany()
  await prisma.sharedShortlistItem.deleteMany()
  await prisma.userReport.deleteMany()
  await prisma.userBlock.deleteMany()
  await prisma.partnerConnection.deleteMany()
  await prisma.partnerRequest.deleteMany()
  await prisma.matchingProfile.deleteMany()
}

let matchSeq = 0
async function createMatchUser(
  profileOverrides: Record<string, unknown> = {},
  opts: { isDemo?: boolean; verified?: boolean; withAccount?: boolean; ageDays?: number } = {},
) {
  const n = ++matchSeq
  const u = await newStudent()
  if (opts.verified !== false) await verifyAtCampus(u.id)
  if (opts.isDemo) await prisma.user.update({ where: { id: u.id }, data: { isDemo: true } })
  if (opts.withAccount) {
    await prisma.account.create({ data: { userId: u.id, accountId: u.email, providerId: 'credential' } })
  }
  const c = callerFor(u.id, { isDemo: opts.isDemo }).matching
  const p = await c.profile.upsert({
    displayName: `Peserta ${n}`,
    gender: 'PEREMPUAN',
    birthYear: new Date().getUTCFullYear() - 22,
    budgetMin: 1_000_000,
    budgetMax: 2_000_000,
    anchorLat: LAT,
    anchorLng: LNG,
    anchorLabel: 'BINUS Anggrek',
    moveInDate: startIn(30),
    smoking: 'TIDAK_MEROKOK_TOLERAN',
    ...profileOverrides,
  })
  const ageDays = opts.ageDays ?? 3
  if (ageDays > 0) {
    await prisma.matchingProfile.update({ where: { id: p.id }, data: { createdAt: new Date(Date.now() - ageDays * DAY) } })
  }
  return { id: u.id, profileId: p.id, c }
}

async function connectPair(a: string, b: string) {
  const req = await prisma.partnerRequest.create({
    data: { fromUserId: a, toUserId: b, status: 'ACCEPTED', expiresAt: new Date(Date.now() + 14 * DAY), decidedAt: new Date() },
  })
  const [lo, hi] = [a, b].sort() as [string, string]
  return prisma.partnerConnection.create({ data: { userAId: lo, userBId: hi, requestId: req.id } })
}

function pendingRequest(fromUserId: string, toUserId: string) {
  return prisma.partnerRequest.create({
    data: { fromUserId, toUserId, status: 'PENDING', expiresAt: new Date(Date.now() + 14 * DAY) },
  })
}

async function makeFullOneRoomKos(district = 'Kemanggisan') {
  const o = await newOwner()
  const kos = await prisma.kos.create({
    data: {
      slug: `fl-kos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: 'Kos Regresi',
      gender: 'CAMPUR',
      address: 'Jl. Regresi No. 1',
      district,
      city: 'Jakarta Barat',
      lat: LAT,
      lng: LNG,
      electricityType: 'INCLUDED',
      ownerId: o.ownerId,
      rooms: { create: [{ roomNumber: 'R1', floor: 1, type: 'Standar', size: '3 x 3 m', bedType: 'Single Bed', priceMonthly: 1_500_000 }] },
    },
    include: { rooms: true },
  })
  const room = kos.rooms[0]!
  const tenant = await newStudent()
  const tenancy = await prisma.tenancy.create({
    data: { roomId: room.id, userId: tenant.id, status: 'ACTIVE', startDate: new Date(), durationMonths: 6 },
  })
  await prisma.room.update({ where: { id: room.id }, data: { occupancy: 'OCCUPIED' } })
  return { kos, room, tenancy, ownerUserId: o.userId, ownerId: o.ownerId, ownerCaller: o.c }
}

describe('FL-02: hidden/actioned matching user lock', () => {
  beforeEach(clearMatchingTables)

  it('blocks setActive(true), request.send (FORBIDDEN), and request.accept (NOT_FOUND) when hiddenByReportsAt is set', async () => {
    const hidden = await createMatchUser()
    const peer = await createMatchUser()
    const incoming = await pendingRequest(peer.id, hidden.id)

    await prisma.matchingProfile.update({
      where: { id: hidden.profileId },
      data: { hiddenByReportsAt: new Date(), active: false },
    })

    expect(await codeOf(hidden.c.profile.setActive({ active: true }))).toBe('FORBIDDEN')

    const sendErr = await err(hidden.c.request.send({ profileId: peer.profileId }))
    expect(sendErr?.code).toBe('FORBIDDEN')
    expect(sendErr?.message).toContain('disembunyikan karena laporan')

    expect(await codeOf(hidden.c.request.accept({ requestId: incoming.id }))).toBe('NOT_FOUND')
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: incoming.id } })).status).toBe('PENDING')
  })

  it('3-report auto-hide cancels existing PENDING requests both ways', async () => {
    const target = await createMatchUser()
    const reporters = [await createMatchUser(), await createMatchUser(), await createMatchUser()]
    const bystanderIn = await createMatchUser()
    const bystanderOut = await createMatchUser()

    for (const r of reporters) await connectPair(r.id, target.id)
    const reqIn = await pendingRequest(bystanderIn.id, target.id)
    const reqOut = await pendingRequest(target.id, bystanderOut.id)

    for (const r of reporters) {
      await r.c.safety.report({ profileId: target.profileId, reason: 'PROFIL_PALSU' })
    }

    const targetProfile = await prisma.matchingProfile.findUniqueOrThrow({ where: { id: target.profileId } })
    expect(targetProfile.active).toBe(false)
    expect(targetProfile.hiddenByReportsAt).not.toBeNull()
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: reqIn.id } })).status).toBe('CANCELLED')
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: reqOut.id } })).status).toBe('CANCELLED')
  })

  it('actionReport cancels PENDING requests and ends live connections with endReason BLOCKED', async () => {
    const target = await createMatchUser()
    const reporter = await createMatchUser()
    const partner = await createMatchUser()
    const bystanderIn = await createMatchUser()
    const bystanderOut = await createMatchUser()

    const conn1 = await connectPair(reporter.id, target.id)
    const conn2 = await connectPair(partner.id, target.id)
    const reqIn = await pendingRequest(bystanderIn.id, target.id)
    const reqOut = await pendingRequest(target.id, bystanderOut.id)

    await reporter.c.safety.report({ profileId: target.profileId, reason: 'KONTEN_TIDAK_PANTAS', detail: 'Pesan tidak pantas' })
    const report = await prisma.userReport.findFirstOrThrow({ where: { reporterId: reporter.id, reportedId: target.id } })

    const res = await actionReport(prisma, report.id, { reviewer: 'qa', note: 'terbukti' })
    expect(res.closed).toBe(1)

    const targetProfile = await prisma.matchingProfile.findUniqueOrThrow({ where: { id: target.profileId } })
    expect(targetProfile.active).toBe(false)
    expect(targetProfile.hiddenByReportsAt).not.toBeNull()
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: reqIn.id } })).status).toBe('CANCELLED')
    expect((await prisma.partnerRequest.findUniqueOrThrow({ where: { id: reqOut.id } })).status).toBe('CANCELLED')
    expect(await prisma.partnerConnection.findUniqueOrThrow({ where: { id: conn1.id } })).toMatchObject({
      endedAt: expect.any(Date),
      endedById: null,
      endReason: 'BLOCKED',
    })
    expect(await prisma.partnerConnection.findUniqueOrThrow({ where: { id: conn2.id } })).toMatchObject({
      endedAt: expect.any(Date),
      endedById: null,
      endReason: 'BLOCKED',
    })
  })
})

describe('FL-03: real<->demo isolation and hardFilter in matching', () => {
  beforeEach(clearMatchingTables)

  it('returns NOT_FOUND when a real verified student targets a demo matching profile', async () => {
    const real = await createMatchUser()
    const demo = await createMatchUser({}, { isDemo: true })

    expect(await codeOf(real.c.detail({ profileId: demo.profileId }))).toBe('NOT_FOUND')
    expect(await codeOf(real.c.request.send({ profileId: demo.profileId }))).toBe('NOT_FOUND')
  })

  it('hides real signed-up users (with Account row) from demo viewers under DEMO_ISOLATION=1', async () => {
    const prev = process.env.DEMO_ISOLATION
    process.env.DEMO_ISOLATION = '1'
    try {
      const demoViewer = await createMatchUser({}, { isDemo: true })
      const realSignedUp = await createMatchUser({}, { withAccount: true })

      const disc = await demoViewer.c.discover()
      expect(disc.items.some((i) => i.profileId === realSignedUp.profileId)).toBe(false)
      expect(await codeOf(demoViewer.c.detail({ profileId: realSignedUp.profileId }))).toBe('NOT_FOUND')
      expect(await codeOf(demoViewer.c.request.send({ profileId: realSignedUp.profileId }))).toBe('NOT_FOUND')
    } finally {
      if (prev === undefined) delete process.env.DEMO_ISOLATION
      else process.env.DEMO_ISOLATION = prev
    }
  })

  it('returns NOT_FOUND on detail and request.send when smoking, budget, or distance (> other.radiusKm) violates hardFilter', async () => {
    const me = await createMatchUser({
      smoking: 'MEROKOK',
      budgetMin: 1_000_000,
      budgetMax: 1_500_000,
      radiusKm: 10,
    })
    const badSmoking = await createMatchUser({ smoking: 'TIDAK_MAU_PEROKOK' })
    const badBudget = await createMatchUser({ smoking: 'MEROKOK', budgetMin: 2_000_000, budgetMax: 3_000_000 })
    // ~3.34 km north of LAT, outside other.radiusKm (2) though within MAX_RADIUS_KM (15).
    const badDistance = await createMatchUser({ smoking: 'MEROKOK', anchorLat: LAT + 0.03, radiusKm: 2 })

    for (const target of [badSmoking, badBudget, badDistance]) {
      expect(await codeOf(me.c.detail({ profileId: target.profileId }))).toBe('NOT_FOUND')
      expect(await codeOf(me.c.request.send({ profileId: target.profileId }))).toBe('NOT_FOUND')
    }
  })
})

describe('FL-04: sign-up whitespace name and invalid WhatsApp', () => {
  it('rejects whitespace-only name and invalid WhatsApp with 400 INVALID_PROFILE', async () => {
    const resName = await request('/api/auth/sign-up/email', {
      body: { name: '   ', email: 'ws-name@example.com', password: 'Sandi-rahasia-123' },
    })
    expect(resName.status).toBe(400)
    expect((await resName.json()) as { code?: string }).toMatchObject({ code: 'INVALID_PROFILE' })

    const resPhone = await request('/api/auth/sign-up/email', {
      body: { name: 'Sari', email: 'bad-wa@example.com', password: 'Sandi-rahasia-123', phone: '123' },
    })
    expect(resPhone.status).toBe(400)
    const phoneBody = (await resPhone.json()) as { code?: string; message?: string }
    expect(phoneBody.code).toBe('INVALID_PROFILE')
    expect(phoneBody.message).toContain('Nomor WhatsApp tidak valid')

    expect(await prisma.user.count({ where: { email: { in: ['ws-name@example.com', 'bad-wa@example.com'] } } })).toBe(0)
  })
})

describe('FL-06: discover radius widen', () => {
  beforeEach(clearMatchingTables)

  it('returns TOO_NARROW with widenHint { radiusKm: 3, extra: 1 } and finds candidate when maxDistanceKm=3', async () => {
    const me = await createMatchUser({ radiusKm: 1 })
    // 0.02 deg latitude ~ 2.22 km: outside radiusKm=1, inside widened radiusKm=3.
    const candidate = await createMatchUser({ anchorLat: LAT + 0.02, radiusKm: 5 })

    const narrow = await me.c.discover()
    expect(narrow).toMatchObject({
      items: [],
      nextCursor: null,
      emptyReason: 'TOO_NARROW',
      widenHint: { radiusKm: 3, extra: 1 },
    })

    const widened = await me.c.discover({ maxDistanceKm: 3 })
    expect(widened.emptyReason).toBeNull()
    expect(widened.items.map((i) => i.profileId)).toEqual([candidate.profileId])
  })
})

describe('FL-09: owner revoke clears APPROVED documents', () => {
  it('resets status to BELUM_KIRIM, attempts to 0, and marks APPROVED OwnerDocuments REJECTED', async () => {
    const o = await newOwner()
    const user = await prisma.user.findUniqueOrThrow({ where: { id: o.userId } })
    await prisma.ownerProfile.update({ where: { userId: o.userId }, data: { verificationAttempts: 2 } })
    await prisma.ownerDocument.createMany({
      data: [
        {
          userId: o.userId,
          kind: 'KTP',
          key: `private/owner-docs/${o.userId}/ktp.jpg`,
          contentType: 'image/jpeg',
          status: 'APPROVED',
          consentAt: new Date(),
          decidedAt: new Date(),
          reviewer: 'qa',
        },
        {
          userId: o.userId,
          kind: 'SHM',
          key: `private/owner-docs/${o.userId}/shm.pdf`,
          contentType: 'application/pdf',
          status: 'APPROVED',
          consentAt: new Date(),
          decidedAt: new Date(),
          reviewer: 'qa',
        },
      ],
    })

    const out = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/approve-owner.ts', 'revoke', user.email], {
      cwd: BACKEND_DIR,
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://kobo:kobo@127.0.0.1:5433/kobo_test' },
      encoding: 'utf8',
      timeout: 60_000,
    })
    expect(out).toContain(`Hidden: ${user.email}`)

    const profile = await prisma.ownerProfile.findUniqueOrThrow({ where: { userId: o.userId } })
    expect(profile.verificationStatus).toBe('BELUM_KIRIM')
    expect(profile.verificationAttempts).toBe(0)
    expect(profile.approvedAt).toBeNull()

    const docs = await prisma.ownerDocument.findMany({ where: { userId: o.userId } })
    expect(docs).toHaveLength(2)
    expect(docs.every((d) => d.status === 'REJECTED')).toBe(true)
  })
})

describe('FL-10: waitlist decline/leave/remove withdraws linked PENDING application and kosQueries live offer SQL', () => {
  it('holds availableRooms=0 past offerExpiresAt while application is PENDING, and withdraws application on decline/remove/leave', async () => {
    const uniqueDistrict = 'KemanggisanWaitlistAudit'
    const f = await makeFullOneRoomKos(uniqueDistrict)
    const s1 = await newStudent()
    const s2 = await newStudent()
    const s3 = await newStudent()
    const s4 = await newStudent()

    const e1 = await callerFor(s1.id).waitlist.join({ kosId: f.kos.id, roomType: null })
    const e2 = await callerFor(s2.id).waitlist.join({ kosId: f.kos.id, roomType: null })
    const e3 = await callerFor(s3.id).waitlist.join({ kosId: f.kos.id, roomType: null })
    const e4 = await callerFor(s4.id).waitlist.join({ kosId: f.kos.id, roomType: null })

    await f.ownerCaller.owner.tenancy.end({ kosId: f.kos.id, tenancyId: f.tenancy.id })

    // Offeree #1 applies -> waitlist.status exposes mine.applicationStatus === 'PENDING'
    const app1 = await callerFor(s1.id).application.create({ roomId: f.room.id, startDate: startIn(3), durationMonths: 3 })
    const status1 = await callerFor(s1.id).waitlist.status({ kosId: f.kos.id })
    expect(status1.mine).toMatchObject({ id: e1.id, status: 'OFFERED', applicationId: app1.id, applicationStatus: 'PENDING' })

    // Backdate offerExpiresAt into the past while app1 is still PENDING -> kos.search still reports availableRooms === 0
    await prisma.waitlistEntry.update({ where: { id: e1.id }, data: { offerExpiresAt: new Date(Date.now() - HOUR) } })
    const cards = await caller.kos.search({ q: uniqueDistrict })
    expect(cards.find((k) => k.id === f.kos.id)?.availableRooms).toBe(0)

    // Decline withdraws app1 and promotes #2 atomically
    await callerFor(s1.id).waitlist.decline({ entryId: e1.id })
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: e1.id } })).status).toBe('DECLINED')
    expect((await prisma.rentalApplication.findUniqueOrThrow({ where: { id: app1.id } })).status).toBe('WITHDRAWN')
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: e2.id } })).status).toBe('OFFERED')

    // owner.waitlist.remove withdraws linked PENDING application on #2 and promotes #3
    const app2 = await callerFor(s2.id).application.create({ roomId: f.room.id, startDate: startIn(3), durationMonths: 3 })
    await f.ownerCaller.owner.waitlist.remove({ kosId: f.kos.id, entryId: e2.id })
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: e2.id } })).status).toBe('REMOVED')
    expect((await prisma.rentalApplication.findUniqueOrThrow({ where: { id: app2.id } })).status).toBe('WITHDRAWN')
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: e3.id } })).status).toBe('OFFERED')

    // waitlist.leave withdraws linked PENDING application on #3 and promotes #4
    const app3 = await callerFor(s3.id).application.create({ roomId: f.room.id, startDate: startIn(3), durationMonths: 3 })
    await callerFor(s3.id).waitlist.leave({ entryId: e3.id })
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: e3.id } })).status).toBe('LEFT')
    expect((await prisma.rentalApplication.findUniqueOrThrow({ where: { id: app3.id } })).status).toBe('WITHDRAWN')
    expect((await prisma.waitlistEntry.findUniqueOrThrow({ where: { id: e4.id } })).status).toBe('OFFERED')
  })
})

describe('FL-14: booking.mine returns agreedMonthlyRent', () => {
  it('preserves agreedMonthlyRent after room.priceMonthly increases', async () => {
    const o = await newOwner()
    const kos = await prisma.kos.create({
      data: {
        slug: `fl14-${Date.now()}`,
        name: 'Kos Harga Terkunci',
        gender: 'CAMPUR',
        address: 'Jl. Harga',
        district: 'Palmerah',
        city: 'Jakarta Barat',
        lat: LAT,
        lng: LNG,
        electricityType: 'INCLUDED',
        ownerId: o.ownerId,
        rooms: { create: [{ roomNumber: 'H1', floor: 1, type: 'Standar', size: '3 x 3 m', bedType: 'Single Bed', priceMonthly: 1_500_000 }] },
      },
      include: { rooms: true },
    })
    const room = kos.rooms[0]!
    const student = await newStudent()
    await approveApplication(student.id, room.id, { startDate: startIn(3), durationMonths: 3 })

    await prisma.room.update({ where: { id: room.id }, data: { priceMonthly: 2_200_000 } })

    const bookings = await callerFor(student.id).booking.mine()
    expect(bookings).toHaveLength(1)
    expect(bookings[0]!.room.priceMonthly).toBe(1_500_000)
  })
})

describe('FL-15: owner.tenant.tenantProfile ignores lapsed holds', () => {
  it('ignores UNPAID past-due invoices on ENDED holds and counts ACTIVE overdue invoices', async () => {
    const room1 = await vacantRoom(0)
    const room2 = await vacantRoom(1)
    const kos1Owner = await prisma.ownerProfile.findFirstOrThrow({ where: { kos: { some: { id: room1.kosId } } } })
    const kos2Owner = await prisma.ownerProfile.findFirstOrThrow({ where: { kos: { some: { id: room2.kosId } } } })
    const student = await newStudent()
    const pastDue = new Date(`${addDays(todayWIB(new Date()), -3)}T00:00:00Z`)

    const lapsed = await prisma.tenancy.create({
      data: {
        roomId: room1.id,
        userId: student.id,
        status: 'ENDED',
        startDate: new Date(),
        durationMonths: 3,
        expiresAt: new Date(Date.now() - 2 * HOUR),
        endedAt: new Date(Date.now() - HOUR),
      },
    })
    await prisma.invoice.create({
      data: {
        tenancyId: lapsed.id,
        periodStart: pastDue,
        dueDate: pastDue,
        amount: 1_500_000,
        rentAmount: 1_500_000,
        discountAmount: 0,
        applicationFeeAmount: 0,
        ownerReceivableAmount: 1_500_000,
        gatewayFeeBearer: 'PLATFORM',
        status: 'UNPAID',
      },
    })

    const profileBefore = await callerFor(kos1Owner.userId).owner.tenant.tenantProfile({ kosId: room1.kosId, tenancyId: lapsed.id })
    expect(profileBefore.payments.overdue).toBe(0)

    const active = await prisma.tenancy.create({
      data: { roomId: room2.id, userId: student.id, status: 'ACTIVE', startDate: new Date(), durationMonths: 3 },
    })
    await prisma.invoice.create({
      data: {
        tenancyId: active.id,
        periodStart: pastDue,
        dueDate: pastDue,
        amount: 1_500_000,
        rentAmount: 1_500_000,
        discountAmount: 0,
        applicationFeeAmount: 0,
        ownerReceivableAmount: 1_500_000,
        gatewayFeeBearer: 'PLATFORM',
        status: 'UNPAID',
      },
    })

    const profileAfter = await callerFor(kos2Owner.userId).owner.tenant.tenantProfile({ kosId: room2.kosId, tenancyId: active.id })
    expect(profileAfter.payments.overdue).toBe(1)
  })
})

describe('FL-18: waitlist.status hides unapproved and archived kos', () => {
  it('throws NOT_FOUND to public/students for unapproved owner kos while allowing its owner, and hides archived kos', async () => {
    const f = await makeFullOneRoomKos()
    const student = await newStudent()

    await prisma.ownerProfile.update({ where: { id: f.ownerId }, data: { verificationStatus: 'BELUM_KIRIM', approvedAt: null } })
    expect(await codeOf(caller.waitlist.status({ kosId: f.kos.id }))).toBe('NOT_FOUND')
    expect(await codeOf(callerFor(student.id).waitlist.status({ kosId: f.kos.id }))).toBe('NOT_FOUND')
    expect((await f.ownerCaller.waitlist.status({ kosId: f.kos.id })).full).toBe(true)

    await prisma.ownerProfile.update({ where: { id: f.ownerId }, data: { verificationStatus: 'DISETUJUI', approvedAt: new Date() } })
    await prisma.kos.update({ where: { id: f.kos.id }, data: { archivedAt: new Date() } })
    expect(await codeOf(caller.waitlist.status({ kosId: f.kos.id }))).toBe('NOT_FOUND')
    expect(await codeOf(callerFor(student.id).waitlist.status({ kosId: f.kos.id }))).toBe('NOT_FOUND')
    expect(await codeOf(f.ownerCaller.waitlist.status({ kosId: f.kos.id }))).toBe('NOT_FOUND')
  })
})

describe('FL-21: ktmConfirm deletes unowned private file on bad campus', () => {
  it('throws BAD_REQUEST and removes the private object when campusId does not exist', async () => {
    const s = await newStudent()
    const c = callerFor(s.id).studentVerification
    const presign = await c.ktmPresign({ contentType: 'image/jpeg', contentLength: JPEG.byteLength })
    storage.putPrivate(presign.key, JPEG, 'image/jpeg')
    expect(await storage.headPrivate(presign.key)).not.toBeNull()

    expect(
      await codeOf(
        c.ktmConfirm({
          key: presign.key,
          campusId: 'nope',
          nim: '2501234567',
          nameOnCard: 'Tester',
          consent: true,
        }),
      ),
    ).toBe('BAD_REQUEST')

    expect(await storage.headPrivate(presign.key)).toBeNull()
  })
})

describe('FL-24: kuitansi.get returns viewerRole', () => {
  it('returns TENANT to the paying tenant and OWNER to the kos owner', async () => {
    const room = await vacantRoom()
    const student = await newStudent()
    const booked = await approveApplication(student.id, room.id, { startDate: startIn(2), durationMonths: 3 })
    const owner = await prisma.ownerProfile.findFirstOrThrow({ where: { kos: { some: { id: room.kosId } } } })
    const paid = await callerFor(owner.userId).payment.recordManual(await cash(room.kosId, booked.invoiceId))

    const tenantView = await callerFor(student.id).kuitansi.get({ receiptNo: paid.receiptNumber })
    expect(tenantView.viewerRole).toBe('TENANT')

    const ownerView = await callerFor(owner.userId).kuitansi.get({ receiptNo: paid.receiptNumber })
    expect(ownerView.viewerRole).toBe('OWNER')
  })
})
