import { beforeEach, describe, expect, it } from 'vitest'
import { addDays, todayWIB } from '@kobo/shared/domain'
import { resetDb } from '../../src/db/seed.ts'
import { FakeWhatsApp, scanNotifications } from '../../src/notifications.ts'
import { approveApplication, callerFor, newStudent, prisma, vacantRoom } from '../helpers.ts'

beforeEach(async () => {
  await resetDb(prisma)
  // The seed has live tenancies with unpaid invoices; settle them so each test only sees the invoices it builds.
  await prisma.invoice.updateMany({ data: { status: 'PAID' } })
})

const today = () => todayWIB(new Date())
/** An instant `hh:mm:ss` WIB on the WIB calendar day `date`. */
const wib = (date: string, hhmmss: string) => new Date(`${date}T${hhmmss}+07:00`)

async function activeInvoice(over: { contact?: boolean } = {}) {
  const s = await newStudent()
  await prisma.user.update({
    where: { id: s.id },
    data: {
      phone: '081200000001',
      ...(over.contact === false ? {} : { emergencyContactName: 'Bu Sari', emergencyContactRelation: 'Ibu', emergencyContactPhone: '081200000009', emergencyContactConsentAt: new Date() }),
    },
  })
  const a = await approveApplication(s.id, (await vacantRoom()).id)
  await prisma.tenancy.update({ where: { id: a.tenancyId }, data: { status: 'ACTIVE', expiresAt: null } })
  const setDue = (date: string) => prisma.invoice.update({ where: { id: a.invoiceId }, data: { dueDate: new Date(`${date}T00:00:00Z`) } })
  return { ...a, userId: s.id, setDue }
}
const logs = (invoiceId: string) => prisma.notificationLog.findMany({ where: { invoiceId }, orderBy: [{ kind: 'asc' }, { channel: 'asc' }] })
const emergency = (wa: FakeWhatsApp) => wa.sent.filter((m) => m.kind === 'EMERGENCY_CONTACT')

describe('[G-027][R-094] the emergency contact', () => {
  it('is reached exactly once, first at 08:00 WIB on day 7, never in quiet hours', async () => {
    const inv = await activeInvoice()
    const due = addDays(today(), -7)
    await inv.setDue(due)
    const wa = new FakeWhatsApp()

    await scanNotifications(prisma, wib(today(), '07:59:59'), { whatsapp: wa })
    await scanNotifications(prisma, wib(today(), '21:00:00'), { whatsapp: wa })
    expect(emergency(wa)).toHaveLength(0)

    await scanNotifications(prisma, wib(today(), '08:00:00'), { whatsapp: wa })
    expect(emergency(wa)).toHaveLength(1)
    expect(emergency(wa)[0]).toMatchObject({ to: '081200000009' })

    await scanNotifications(prisma, wib(addDays(today(), 1), '10:00:00'), { whatsapp: wa })
    await scanNotifications(prisma, wib(addDays(today(), 2), '10:00:00'), { whatsapp: wa })
    expect(emergency(wa)).toHaveLength(1)
    expect((await logs(inv.invoiceId)).filter((l) => l.recipient === 'KONTAK_DARURAT')).toHaveLength(1)
  })

  it('is never reached after the student withdrew consent', async () => {
    const inv = await activeInvoice()
    await inv.setDue(addDays(today(), -7))
    await callerFor(inv.userId).auth.clearEmergencyContact()
    const wa = new FakeWhatsApp()

    await scanNotifications(prisma, wib(today(), '08:00:00'), { whatsapp: wa })
    await scanNotifications(prisma, wib(addDays(today(), 1), '10:00:00'), { whatsapp: wa })

    expect(emergency(wa)).toHaveLength(0)
    expect((await logs(inv.invoiceId)).filter((l) => l.recipient === 'KONTAK_DARURAT')).toHaveLength(0)
  })
})

describe('[G-028][R-094] reminders stop when the student opts out or the tenancy ends', () => {
  it('sends H-7, then nothing at H-3 and H-1 after opt-out through auth.setNotifyOptOut', async () => {
    const inv = await activeInvoice({ contact: false })
    const due = addDays(today(), 10)
    await inv.setDue(due)
    const wa = new FakeWhatsApp()

    await scanNotifications(prisma, wib(addDays(due, -7), '10:00:00'), { whatsapp: wa })
    expect(wa.sent.map((m) => m.kind)).toEqual(['REMINDER_H7'])

    await callerFor(inv.userId).auth.setNotifyOptOut({ optOut: true })
    await scanNotifications(prisma, wib(addDays(due, -3), '10:00:00'), { whatsapp: wa })
    await scanNotifications(prisma, wib(addDays(due, -1), '10:00:00'), { whatsapp: wa })

    expect(wa.sent.map((m) => m.kind)).toEqual(['REMINDER_H7'])
    expect((await logs(inv.invoiceId)).map((l) => l.kind)).not.toContain('REMINDER_H3')
  })

  it('sends nothing for an invoice of an ENDED tenancy', async () => {
    const inv = await activeInvoice({ contact: false })
    const due = addDays(today(), 10)
    await inv.setDue(due)
    const wa = new FakeWhatsApp()
    await scanNotifications(prisma, wib(addDays(due, -7), '10:00:00'), { whatsapp: wa })
    const sentBefore = wa.sent.length
    const outboxBefore = await prisma.emailOutbox.count({ where: { template: 'invoice-reminder' } })

    await prisma.tenancy.update({ where: { id: inv.tenancyId }, data: { status: 'ENDED', endedAt: new Date() } })
    await scanNotifications(prisma, wib(addDays(due, -3), '10:00:00'), { whatsapp: wa })
    await scanNotifications(prisma, wib(addDays(due, -1), '10:00:00'), { whatsapp: wa })

    expect(wa.sent).toHaveLength(sentBefore)
    expect(await prisma.emailOutbox.count({ where: { template: 'invoice-reminder' } })).toBe(outboxBefore)
  })
})

describe('[G-029][R-094] two scans at once', () => {
  it('log, message and email every reminder exactly once', async () => {
    const inv = await activeInvoice({ contact: false })
    await inv.setDue(addDays(today(), 1))
    const wa = new FakeWhatsApp()

    await Promise.all([scanNotifications(prisma, wib(today(), '10:00:00'), { whatsapp: wa }), scanNotifications(prisma, wib(today(), '10:00:00'), { whatsapp: wa })])

    expect((await logs(inv.invoiceId)).map((l) => `${l.kind}/${l.channel}`)).toEqual(['REMINDER_H1/EMAIL', 'REMINDER_H1/WHATSAPP'])
    expect(wa.sent).toHaveLength(1)
    expect(await prisma.emailOutbox.count({ where: { template: 'invoice-reminder' } })).toBe(1)
  })
})
