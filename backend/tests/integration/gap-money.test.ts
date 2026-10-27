import { beforeEach, describe, expect, it } from 'vitest'
import { resetDb } from '../../src/db/seed.ts'
import { approveApplication, callerFor, newStudent, prisma, settleMock } from '../helpers.ts'
import { makeKos } from './gap-helpers.ts'

beforeEach(() => resetDb(prisma))

const verified = async () => {
  const s = await newStudent()
  await prisma.user.update({ where: { id: s.id }, data: { campusEmailVerifiedAt: new Date(), campusEmail: `${s.id}@binus.ac.id` } })
  return s
}

/** Pays the first invoice through the real payment.start -> settlement path. */
async function payFirst(userId: string, invoiceId: string) {
  const started = await callerFor(userId).payment.start({ invoiceId })
  await settleMock(started.paymentId)
}

describe('[G-030][R-016][R-031][R-037] a discounted 3-month lease, in hand-derived rupiah', () => {
  it('prices invoice 1 at rent + fee - discount for a campus-verified student, and at rent + fee otherwise', async () => {
    // rent 1,500,000 + application fee 100,000 - student discount 200,000 = 1,400,000 ; without the discount 1,600,000
    const k = await makeKos([{ n: 'M1', type: 'Standar', price: 1_500_000 }, { n: 'M2', type: 'Standar', price: 1_500_000 }], { applicationFee: 100_000, studentDiscountAmount: 200_000 })
    const campus = await verified()
    const plain = await newStudent()

    const withDiscount = await approveApplication(campus.id, k.room('M1').id, { durationMonths: 3 })
    const without = await approveApplication(plain.id, k.room('M2').id, { durationMonths: 3 })

    expect(withDiscount.invoice.amount).toBe(1_400_000)
    expect(without.invoice.amount).toBe(1_600_000)
    expect(withDiscount.invoice).toMatchObject({ rentAmount: 1_500_000, discountAmount: 200_000, applicationFeeAmount: 100_000, ownerReceivableAmount: 1_300_000 })
    expect(without.invoice).toMatchObject({ rentAmount: 1_500_000, discountAmount: 0, applicationFeeAmount: 100_000, ownerReceivableAmount: 1_500_000 })
    // nothing is billed before a payment exists: the lease has one invoice until the first one is paid
    expect(await prisma.invoice.count({ where: { tenancyId: withDiscount.tenancyId } })).toBe(1)

    await payFirst(campus.id, withDiscount.invoiceId)
    const invoices = await prisma.invoice.findMany({ where: { tenancyId: withDiscount.tenancyId }, orderBy: { dueDate: 'asc' } })
    expect(invoices).toHaveLength(3)
    expect(invoices[0]).toMatchObject({ status: 'PAID', amount: 1_400_000 })
    expect(invoices.slice(1).every((i) => i.status === 'UNPAID')).toBe(true)
    const due = invoices.map((i) => i.dueDate.getTime())
    expect(due[0]! < due[1]! && due[1]! < due[2]!).toBe(true)
    // UNSPECIFIED (spec section 3/6 does not state it): amounts of invoices 2..N are only checked to be whole rupiah.
    expect(invoices.slice(1).every((i) => Number.isInteger(i.amount) && i.amount > 0)).toBe(true)
  })
})

describe('[G-031][R-016][R-077] editing price, discount and fee after approval', () => {
  it('leaves the issued invoice alone and prices the next application at the new numbers', async () => {
    const k = await makeKos([{ n: 'E1', type: 'Standar', price: 1_500_000 }, { n: 'E2', type: 'Standar', price: 1_500_000 }], { applicationFee: 100_000, studentDiscountAmount: 200_000 })
    const campus = await verified()
    const first = await approveApplication(campus.id, k.room('E1').id, { durationMonths: 3 })
    expect(first.invoice.amount).toBe(1_400_000)

    const kos = await prisma.kos.findUniqueOrThrow({ where: { id: k.kos.id } })
    await k.owner.kos.update({
      kosId: k.kos.id, name: kos.name, gender: kos.gender, address: kos.address, district: kos.district, city: kos.city, lat: kos.lat, lng: kos.lng,
      electricityType: kos.electricityType, privateAmenities: [], sharedAmenities: [], studentDiscountAmount: 0, applicationFee: 0,
    } as never)
    const room = k.room('E1')
    await k.owner.room.update({ kosId: k.kos.id, roomId: room.id, roomNumber: room.roomNumber, floor: room.floor, type: room.type, size: room.size, bedType: room.bedType, priceMonthly: 2_000_000 })

    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: first.invoiceId } })).amount).toBe(1_400_000)
    const next = await approveApplication((await verified()).id, k.room('E2').id, { durationMonths: 3 })
    expect(next.invoice.amount).toBe(1_500_000) // room E2 still 1,500,000, no fee, no discount any more
    const view = await callerFor(campus.id).booking.mine()
    const mine = view.flatMap((t) => t.invoices).find((i) => i.id === first.invoiceId)
    expect(mine?.amount).toBe(1_400_000)
  })
})
