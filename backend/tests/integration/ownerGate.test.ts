import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { OWNER_UNVERIFIED_MESSAGE } from '../../src/trpc/trpc.ts'
import { callerFor, prisma } from '../helpers.ts'
import { err, kosInput, newOwner } from './gap-helpers.ts'

beforeEach(() => resetDb(prisma))

const MESSAGE = 'Akun pemilik belum terverifikasi. Unggah KTP dan dokumen tanah, lalu tunggu persetujuan tim KoBo sebelum mendaftarkan kos.'
const setStatus = (userId: string, verificationStatus: 'BELUM_KIRIM' | 'MENUNGGU' | 'DISETUJUI' | 'DITOLAK') =>
  prisma.ownerProfile.update({ where: { userId }, data: { verificationStatus, approvedAt: verificationStatus === 'DISETUJUI' ? new Date() : null } })

describe('owner.kos.create is gated on verificationStatus', () => {
  it('exposes the exact message the UI detects', () => {
    expect(OWNER_UNVERIFIED_MESSAGE).toBe(MESSAGE)
  })

  for (const status of ['BELUM_KIRIM', 'MENUNGGU', 'DITOLAK'] as const) {
    it(`refuses ${status} with FORBIDDEN and the exact message, creating nothing`, async () => {
      const o = await newOwner()
      await setStatus(o.userId, status)
      const e = await err(o.c.owner.kos.create(kosInput() as never))
      expect([e?.code, e?.message]).toEqual(['FORBIDDEN', MESSAGE])
      expect(await prisma.kos.count({ where: { ownerId: o.ownerId } })).toBe(0)
    })
  }

  it('lets a DISETUJUI owner create', async () => {
    const o = await newOwner()
    const made = await o.c.owner.kos.create(kosInput() as never)
    expect(await prisma.kos.count({ where: { id: made.id, ownerId: o.ownerId } })).toBe(1)
  })

  it('still lets an owner whose approval was withdrawn edit an existing kos', async () => {
    const o = await newOwner()
    const made = await o.c.owner.kos.create(kosInput() as never)
    await setStatus(o.userId, 'MENUNGGU')
    await o.c.owner.kos.update({ ...(kosInput({ name: 'Nama Baru Uji' }) as object), kosId: made.id } as never)
    expect((await prisma.kos.findUniqueOrThrow({ where: { id: made.id } })).name).toBe('Nama Baru Uji')
    expect((await o.c.owner.myKos()).map((k) => k.id)).toContain(made.id)
  })

  it('the demo owner (seeded DISETUJUI) passes the gate', async () => {
    const demo = await prisma.ownerProfile.findFirstOrThrow({ where: { user: { isDemo: true } } })
    expect(demo.verificationStatus).toBe('DISETUJUI')
    expect(await err(callerFor(demo.userId, { isDemo: true }).owner.kos.create(kosInput() as never))).toBeNull()
  })
})

describe('seed owners and auth.me', () => {
  it('seeds every kos owner DISETUJUI plus one MENUNGGU and one DITOLAK owner with documents but no kos', async () => {
    expect(await prisma.ownerProfile.count({ where: { kos: { some: {} }, verificationStatus: { not: 'DISETUJUI' } } })).toBe(0)
    for (const status of ['MENUNGGU', 'DITOLAK'] as const) {
      const p = await prisma.ownerProfile.findFirstOrThrow({ where: { verificationStatus: status }, include: { _count: { select: { kos: true } } } })
      expect(p._count.kos).toBe(0)
      expect(await prisma.ownerDocument.count({ where: { userId: p.userId } })).toBeGreaterThan(0)
    }
    expect((await prisma.ownerProfile.findFirstOrThrow({ where: { verificationStatus: 'DITOLAK' } })).verificationReason).toBeTruthy()
  })

  it('auth.me reports ownerStatus and keeps ownerApproved = (status === DISETUJUI)', async () => {
    const o = await newOwner()
    expect(await o.c.auth.me()).toMatchObject({ ownerStatus: 'DISETUJUI', ownerApproved: true })
    await setStatus(o.userId, 'DITOLAK')
    expect(await o.c.auth.me()).toMatchObject({ ownerStatus: 'DITOLAK', ownerApproved: false })
    const student = await prisma.user.create({ data: { id: 'gate-student', name: 'Mhs', email: 'gate-student@kobo.test', emailVerified: true } })
    expect(await callerFor(student.id).auth.me()).toMatchObject({ ownerStatus: null, ownerApproved: null })
  })

  it('hides a non-DISETUJUI owner profile from the public but not from themselves', async () => {
    const o = await newOwner()
    await setStatus(o.userId, 'MENUNGGU')
    const stranger = await prisma.user.create({ data: { id: 'gate-stranger', name: 'Orang', email: 'gate-stranger@kobo.test', emailVerified: true } })
    expect((await err(callerFor(stranger.id).owner.publicProfile({ id: o.ownerId })))?.code).toBe('NOT_FOUND')
    expect((await o.c.owner.publicProfile({ id: o.ownerId })).owner.verified).toBe(false)
  })
})
