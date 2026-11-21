import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { applyVerification } from '../../src/studentVerification/verifier.ts'
import { approveApplication, newStudent, prisma } from '../helpers.ts'
import { makeKos, verifyAtCampus } from './gap-helpers.ts'

beforeEach(() => resetDb(prisma))

// rent 1,500,000 + fee 100,000 = 1,600,000 ; with the Rp 200,000 mitra discount 1,400,000
const kosWithDiscount = () =>
  makeKos(['M1', 'M2'].map((n) => ({ n, type: 'Standar', price: 1_500_000 })), { applicationFee: 100_000, studentDiscountAmount: 200_000 })

async function invoiceFor(verify: (id: string) => Promise<void>) {
  const k = await kosWithDiscount()
  const s = await newStudent()
  await verify(s.id)
  const { invoice } = await approveApplication(s.id, k.room('M1').id)
  return { invoice, student: s, k }
}

describe('Diskon Kampus Mitra', () => {
  it('seeds BINUS as affiliated and keeps the list through resetDb', async () => {
    const rows = await prisma.campusAffiliation.findMany({ where: { active: true } })
    expect(rows.map((r) => r.campusId)).toEqual(expect.arrayContaining(['binus-syahdan', 'binus-anggrek', 'binus-kijang']))
    const demo = await prisma.user.findUniqueOrThrow({ where: { id: 'user-demo-student' } })
    expect(demo.verifiedCampusId).toBe('binus-syahdan')
  })

  it('gives an affiliated, currently verified student the discount', async () => {
    const { invoice } = await invoiceFor((id) => verifyAtCampus(id, 'binus-anggrek'))
    expect(invoice).toMatchObject({ discountAmount: 200_000, amount: 1_400_000 })
  })

  it('gives 0 to a verified student at a non-affiliated campus', async () => {
    const { invoice } = await invoiceFor((id) => verifyAtCampus(id, 'ui-depok'))
    expect(invoice).toMatchObject({ discountAmount: 0, amount: 1_600_000 })
  })

  it('gives 0 to a verified student with no verified campus recorded', async () => {
    const { invoice } = await invoiceFor(async (id) => {
      await verifyAtCampus(id)
      await prisma.user.update({ where: { id }, data: { verifiedCampusId: null } })
    })
    expect(invoice.discountAmount).toBe(0)
  })

  it('gives 0 when the verification has expired', async () => {
    const { invoice } = await invoiceFor((id) => verifyAtCampus(id, 'binus-syahdan', new Date(Date.now() - 86_400_000)))
    expect(invoice).toMatchObject({ discountAmount: 0, amount: 1_600_000 })
  })

  it('covers a branch whose parent campus is affiliated', async () => {
    const parent = await prisma.campus.findUniqueOrThrow({ where: { id: 'ui-depok' } })
    await prisma.campus.create({
      data: { id: 'ui-branch-test', name: 'UI Cabang', shortName: 'UIC', city: 'Depok', lat: -6.36, lng: 106.83, emailDomains: [], parentId: parent.id },
    })
    await prisma.campusAffiliation.create({ data: { campusId: parent.id, label: 'UI' } })
    const { invoice } = await invoiceFor((id) => verifyAtCampus(id, 'ui-branch-test'))
    expect(invoice).toMatchObject({ discountAmount: 200_000, amount: 1_400_000 })
  })

  it('gives 0 once the affiliation is inactive', async () => {
    await prisma.campusAffiliation.updateMany({ where: { campusId: 'binus-syahdan' }, data: { active: false } })
    const { invoice } = await invoiceFor((id) => verifyAtCampus(id, 'binus-syahdan'))
    expect(invoice.discountAmount).toBe(0)
  })

  it('keeps the invoice of an application approved before the affiliation changed', async () => {
    const { invoice, k } = await invoiceFor((id) => verifyAtCampus(id, 'binus-syahdan'))
    expect(invoice.discountAmount).toBe(200_000)
    await prisma.campusAffiliation.updateMany({ data: { active: false } })
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })
    expect(after).toMatchObject({ discountAmount: 200_000, amount: 1_400_000 })
    // a new approval after the change is priced without it
    const other = await newStudent()
    await verifyAtCampus(other.id, 'binus-syahdan')
    expect((await approveApplication(other.id, k.room('M2').id)).invoice.discountAmount).toBe(0)
  })
})

describe('applyVerification verifiedCampusId', () => {
  const NOW = new Date('2026-11-18T03:00:00Z')
  const DAY = 86_400_000
  const apply = (id: string, via: 'EMAIL' | 'KTM', days: number, campusId?: string) =>
    prisma.$transaction((tx) => applyVerification(tx, id, { via, until: new Date(NOW.getTime() + days * DAY), campusId }, NOW))

  it('latest wins, without shortening the expiry', async () => {
    const s = await newStudent()
    await apply(s.id, 'EMAIL', 300, 'binus-syahdan')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).verifiedCampusId).toBe('binus-syahdan')
    // a shorter verification by another method: via/until kept, campus follows the latest
    await apply(s.id, 'KTM', 30, 'ui-depok')
    const u = await prisma.user.findUniqueOrThrow({ where: { id: s.id } })
    expect(u).toMatchObject({ verifiedCampusId: 'ui-depok', campusVerifiedVia: 'EMAIL', campusVerifiedUntil: new Date(NOW.getTime() + 300 * DAY) })
  })

  it('leaves verifiedCampusId alone when no campus id is given', async () => {
    const s = await newStudent()
    await apply(s.id, 'EMAIL', 300, 'binus-syahdan')
    await apply(s.id, 'EMAIL', 300)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: s.id } })).verifiedCampusId).toBe('binus-syahdan')
  })
})
