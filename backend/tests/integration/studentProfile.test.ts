import type { TRPCError } from '@trpc/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addDays, TERMS_VERSION, todayWIB } from '@kobo/shared/domain'
import { resetDb } from '../../src/db/seed.ts'
import { approveApplication, callerFor, newStudent, prisma, vacantRoom } from '../helpers.ts'

beforeEach(() => resetDb(prisma))
afterEach(() => {
  delete process.env.REQUIRE_PROFILE_CONSENTS
})

const code = async (p: Promise<unknown>) => ((await p.then(() => null, (e: unknown) => e)) as TRPCError | null)?.code
const contact = { name: 'Ibu Sari', relation: 'Ibu', phone: '0812 3456 7890', consent: true as const }
const apply = (userId: string, roomId: string) =>
  callerFor(userId).application.create({ roomId, startDate: addDays(todayWIB(new Date()), 3), durationMonths: 3, occupation: 'Mahasiswa' })

describe('emergency contact and terms', () => {
  it('stores the contact only with consent, shows it in auth.me, and can withdraw it', async () => {
    const s = await newStudent()
    const c = callerFor(s.id)
    expect((await c.auth.me())?.emergencyContact).toBeNull()
    expect(await code(c.auth.updateEmergencyContact({ ...contact, consent: false as never }))).toBe('BAD_REQUEST')
    await c.auth.updateEmergencyContact(contact)
    expect((await c.auth.me())?.emergencyContact).toEqual({ name: 'Ibu Sari', relation: 'Ibu', phone: '0812 3456 7890' })
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).emergencyContactConsentAt).not.toBeNull()
    await c.auth.clearEmergencyContact()
    const gone = await prisma.user.findUniqueOrThrow({ where: { id: s.id } })
    expect([gone.emergencyContactName, gone.emergencyContactPhone, gone.emergencyContactConsentAt]).toEqual([null, null, null])
  })

  it('refuses a stale terms version and records the current one', async () => {
    const s = await newStudent()
    const c = callerFor(s.id)
    expect((await c.auth.me())?.termsCurrent).toBe(false)
    expect(await code(c.auth.acceptTerms({ version: 'lama' }))).toBe('CONFLICT')
    await c.auth.acceptTerms({ version: TERMS_VERSION })
    expect((await c.auth.me())?.termsCurrent).toBe(true)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).termsAcceptedAt).not.toBeNull()
  })

  it('application.create needs the contact and the current terms when consents are required', async () => {
    process.env.REQUIRE_PROFILE_CONSENTS = '1'
    const s = await newStudent()
    const room = await vacantRoom()
    expect(await code(apply(s.id, room.id))).toBe('PRECONDITION_FAILED')
    await callerFor(s.id).auth.updateEmergencyContact(contact)
    expect(await code(apply(s.id, room.id))).toBe('PRECONDITION_FAILED') // terms still missing
    await callerFor(s.id).auth.acceptTerms({ version: TERMS_VERSION })
    expect((await apply(s.id, room.id)).status).toBe('PENDING')
    // Without the flag nothing is enforced (dev and test default).
    delete process.env.REQUIRE_PROFILE_CONSENTS
    const other = await newStudent()
    expect((await apply(other.id, (await vacantRoom(1)).id)).status).toBe('PENDING')
  })

  it('becomeOwner stores a self-declared ownership type', async () => {
    const s = await newStudent()
    await callerFor(s.id).owner.becomeOwner({ phone: '081234567890', ownershipType: 'PENGELOLA_KUASA' })
    const p = await prisma.ownerProfile.findUniqueOrThrow({ where: { userId: s.id } })
    expect(p.ownershipType).toBe('PENGELOLA_KUASA')
    expect(p.ownershipDeclaredAt).not.toBeNull()
  })
})

describe('owner.tenant.tenantProfile', () => {
  async function world() {
    const room = await vacantRoom()
    const kos = await prisma.kos.findUniqueOrThrow({ where: { id: room.kosId }, include: { owner: true } })
    const student = await newStudent()
    await prisma.user.update({
      where: { id: student.id },
      data: { phone: '081200000001', campus: 'BINUS', emergencyContactName: 'Pak Budi', emergencyContactRelation: 'Ayah', emergencyContactPhone: '081200000002', emergencyContactConsentAt: new Date() },
    })
    const application = await apply(student.id, room.id)
    const stranger = await prisma.ownerProfile.findFirstOrThrow({ where: { id: { not: kos.ownerId } } })
    return { room, kos, student, application, ownerUserId: kos.owner.userId, strangerUserId: stranger.userId }
  }

  it('hides phone and emergency contact until the application is approved, and audits each view', async () => {
    const w = await world()
    const owner = callerFor(w.ownerUserId)
    const pending = await owner.owner.tenant.tenantProfile({ kosId: w.kos.id, applicationId: w.application.id })
    expect(pending).toMatchObject({ name: w.student.name, campus: 'BINUS', phone: null, emergencyContact: null, accepted: false, basis: 'APPLICATION' })
    await owner.application.decide({ kosId: w.kos.id, applicationId: w.application.id, decision: 'APPROVE' })
    const approved = await owner.owner.tenant.tenantProfile({ kosId: w.kos.id, applicationId: w.application.id })
    expect(approved).toMatchObject({ phone: '081200000001', accepted: true, emergencyContact: { name: 'Pak Budi', relation: 'Ayah', phone: '081200000002' } })
    expect(await prisma.tenantProfileView.count({ where: { ownerUserId: w.ownerUserId, tenantUserId: w.student.id } })).toBe(2)
  })

  it('hides a contact the student never consented to', async () => {
    const w = await world()
    await prisma.user.update({ where: { id: w.student.id }, data: { emergencyContactConsentAt: null } })
    const owner = callerFor(w.ownerUserId)
    await owner.application.decide({ kosId: w.kos.id, applicationId: w.application.id, decision: 'APPROVE' })
    expect((await owner.owner.tenant.tenantProfile({ kosId: w.kos.id, applicationId: w.application.id })).emergencyContact).toBeNull()
  })

  it('refuses the owner of another kos and a foreign application id', async () => {
    const w = await world()
    expect(await code(callerFor(w.strangerUserId).owner.tenant.tenantProfile({ kosId: w.kos.id, applicationId: w.application.id }))).toBe('FORBIDDEN')
    const otherKos = await prisma.kos.findFirstOrThrow({ where: { ownerId: { not: w.kos.ownerId } } })
    expect(await code(callerFor(w.strangerUserId).owner.tenant.tenantProfile({ kosId: otherKos.id, applicationId: w.application.id }))).toBe('NOT_FOUND')
    expect(await prisma.tenantProfileView.count()).toBe(0)
  })

  it('counts payment punctuality across the tenant history', async () => {
    const s = await newStudent()
    const room = await vacantRoom()
    const a = await approveApplication(s.id, room.id)
    const kos = await prisma.kos.findUniqueOrThrow({ where: { id: room.kosId }, include: { owner: true } })
    const owner = callerFor(kos.owner.userId)
    const profile = await owner.owner.tenant.tenantProfile({ kosId: kos.id, tenancyId: a.tenancyId })
    expect(profile.basis).toBe('TENANCY')
    expect(profile.payments).toEqual({ onTime: 0, late: 0, overdue: 0 })
    await prisma.invoice.update({ where: { id: a.invoiceId }, data: { dueDate: new Date(`${addDays(todayWIB(new Date()), -3)}T00:00:00Z`) } })
    expect((await owner.owner.tenant.tenantProfile({ kosId: kos.id, tenancyId: a.tenancyId })).payments.overdue).toBe(1)
  })
})
