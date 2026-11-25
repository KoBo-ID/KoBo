import { diffDays, todayWIB } from '@kobo/shared/domain'
import type { PrismaClient } from './db/client.ts'
import { enqueueEmail } from './outbox.ts'
import { startPeriodic, type StopWorker } from './worker.ts'

/*
 * Payment reminders (item 2). One scan, driven by a `now` the caller passes (tests and the demo fast-forward never sleep):
 *
 *   - H-7, H-3, H-1 before an unpaid invoice's due date: email (always, through the outbox) and WhatsApp (when the student has a
 *     number), unless the student switched reminders off.
 *   - One week after the due date and still unpaid: one WhatsApp to the emergency contact, only if the student consented when
 *     they saved it. The message carries the minimum (who, that rent is a week late, who to call), no amount and no address.
 *
 * Every send is a NotificationLog row with a unique (invoice, kind, channel) key, so a rescan, a second container or a worker
 * restart can never send the same reminder twice. Reminders go out at any hour, 24 hours a day. Demo accounts and demo owners' kos never get messages. WhatsApp goes through WhatsAppProvider; the only
 * implementation shipped logs to the console (D-E: no real messages without Bryan's account and keys).
 */

export type ReminderKind = 'REMINDER_H7' | 'REMINDER_H3' | 'REMINDER_H1' | 'EMERGENCY_CONTACT'
export type NotificationKind = ReminderKind | 'hold-expiring'

/** The emergency contact hears about it once rent is this many days past the due date. */
export const EMERGENCY_AFTER_DAYS = 7
/** N4 (SIM-002): remind the student once when a PENDING tenancy's 24-hour payment hold has this much time left or less. */
export const HOLD_EXPIRING_WINDOW_HOURS = 6

export interface WhatsAppMessage {
  to: string
  text: string
  kind: ReminderKind
}
export interface WhatsAppProvider {
  send(message: WhatsAppMessage): Promise<void>
}

/** Logs instead of sending. The default until a real provider (Meta Cloud API or a gateway) is wired with Bryan's keys. */
export class ConsoleWhatsApp implements WhatsAppProvider {
  async send(m: WhatsAppMessage): Promise<void> {
    console.log(`[whatsapp:console] ${m.kind} -> ${m.to.slice(0, 4)}****: ${m.text.slice(0, 60)}...`)
  }
}

/** Collects messages in memory; for tests. */
export class FakeWhatsApp implements WhatsAppProvider {
  readonly sent: WhatsAppMessage[] = []
  failWith: Error | null = null
  async send(m: WhatsAppMessage): Promise<void> {
    if (this.failWith) throw this.failWith
    this.sent.push(m)
  }
}

export function whatsappFromEnv(): WhatsAppProvider {
  return new ConsoleWhatsApp()
}

/** Which reminder an invoice due in `daysToDue` days gets (0 = due today); null when it is not due within a week or already late. */
export function reminderKind(daysToDue: number): ReminderKind | null {
  if (daysToDue < 0 || daysToDue > 7) return null
  if (daysToDue <= 1) return 'REMINDER_H1'
  if (daysToDue <= 3) return 'REMINDER_H3'
  return 'REMINDER_H7'
}

const rupiah = (n: number) => `Rp ${n.toLocaleString('id-ID')}`
const dayLabel = (d: number) => (d <= 0 ? 'hari ini' : d === 1 ? 'besok' : `${d} hari lagi`)

export function tenantReminderText(p: { name: string; kosName: string; roomNumber: string; amount: number; days: number; url: string }): string {
  return `Halo ${p.name}, tagihan sewa ${rupiah(p.amount)} untuk kamar ${p.roomNumber} di ${p.kosName} jatuh tempo ${dayLabel(p.days)}. Bayar lewat KoBo: ${p.url} . Abaikan pesan ini jika sudah membayar. Matikan pengingat di halaman Profil.`
}

export function emergencyContactText(p: { studentName: string; contactName: string }): string {
  return `Halo ${p.contactName}, ini KoBo. ${p.studentName} mencantumkan Anda sebagai kontak darurat. Pembayaran sewa kos ${p.studentName} belum kami terima lebih dari seminggu. Mohon sampaikan agar segera menghubungi pemilik kos. Balas BERHENTI jika Anda tidak ingin dihubungi lagi.`
}

export interface ScanResult {
  scanned: number
  sent: number
  failed: number
}

interface Deps {
  whatsapp: WhatsAppProvider
}

/** Claims the (invoice, kind, channel) slot. False means it was already taken: do not send. */
async function claim(prisma: PrismaClient, row: { invoiceId: string; kind: NotificationKind; channel: 'EMAIL' | 'WHATSAPP'; recipient: 'PENYEWA' | 'KONTAK_DARURAT' }): Promise<string | null> {
  const made = await prisma.notificationLog.createManyAndReturn({ data: [{ ...row, status: 'SENT' }], skipDuplicates: true, select: { id: true } })
  return made[0]?.id ?? null
}

export async function scanNotifications(prisma: PrismaClient, now: Date, deps: Deps): Promise<ScanResult> {
  const result: ScanResult = { scanned: 0, sent: 0, failed: 0 }
  const today = todayWIB(now)
  const origin = (process.env.BETTER_AUTH_URL ?? '').replace(/\/+$/, '')
  // Due within a week, or up to two months late: older arrears are a conversation, not a reminder.
  const from = new Date(`${today}T00:00:00Z`)
  const lo = new Date(from.getTime() - 60 * 86_400_000)
  const hi = new Date(from.getTime() + 7 * 86_400_000)
  const invoices = await prisma.invoice.findMany({
    where: { status: 'UNPAID', dueDate: { gte: lo, lte: hi }, tenancy: { status: 'ACTIVE' } },
    include: { tenancy: { include: { user: true, room: { include: { kos: { include: { owner: { include: { user: { select: { isDemo: true } } } } } } } } } } },
    orderBy: { dueDate: 'asc' },
    take: 500,
  })

  for (const inv of invoices) {
    const t = inv.tenancy
    const user = t.user
    if (user.isDemo || t.room.kos.owner.user.isDemo) continue
    result.scanned += 1
    const due = inv.dueDate.toISOString().slice(0, 10)
    const daysToDue = diffDays(today, due)
    const kind = reminderKind(daysToDue)

    if (kind && !user.notifyOptOut) {
      const base = { name: user.name, kosName: t.room.kos.name, roomNumber: t.room.roomNumber, amount: inv.amount, days: daysToDue, url: `${origin}/my-kos` }
      if (await claim(prisma, { invoiceId: inv.id, kind, channel: 'EMAIL', recipient: 'PENYEWA' })) {
        await enqueueEmail(prisma, { to: user.email, template: 'invoice-reminder', payload: { ...base, dueDate: due } })
        result.sent += 1
      }
      if (user.phone) {
        const id = await claim(prisma, { invoiceId: inv.id, kind, channel: 'WHATSAPP', recipient: 'PENYEWA' })
        if (id) await deliver(prisma, deps.whatsapp, id, { to: user.phone, text: tenantReminderText(base), kind }, result)
      }
    }

    // One week past the due date: the emergency contact, with the student's earlier consent, once per invoice.
    if (-daysToDue >= EMERGENCY_AFTER_DAYS && user.emergencyContactPhone && user.emergencyContactConsentAt) {
      const id = await claim(prisma, { invoiceId: inv.id, kind: 'EMERGENCY_CONTACT', channel: 'WHATSAPP', recipient: 'KONTAK_DARURAT' })
      if (id) {
        const text = emergencyContactText({ studentName: user.name, contactName: user.emergencyContactName ?? 'Bapak/Ibu' })
        await deliver(prisma, deps.whatsapp, id, { to: user.emergencyContactPhone, text, kind: 'EMERGENCY_CONTACT' }, result)
      }
    }
  }

  // N4 (SIM-002): PENDING tenancies whose payment hold ends in <= 6 hours while invoice #1 is still UNPAID.
  const holdCutoff = new Date(now.getTime() + HOLD_EXPIRING_WINDOW_HOURS * 3600_000)
  const expiringHolds = await prisma.tenancy.findMany({
    where: {
      status: 'PENDING',
      expiresAt: { gt: now, lte: holdCutoff },
    },
    include: {
      user: { select: { name: true, email: true, isDemo: true } },
      room: { include: { kos: { include: { owner: { include: { user: { select: { isDemo: true } } } } } } } },
      invoices: { orderBy: [{ dueDate: 'asc' }, { id: 'asc' }], take: 1, select: { id: true, status: true, amount: true } },
    },
    orderBy: { expiresAt: 'asc' },
    take: 500,
  })
  for (const t of expiringHolds) {
    if (!t.expiresAt) continue
    const inv = t.invoices[0]
    if (!inv || inv.status !== 'UNPAID') continue
    if (t.user.isDemo || t.room.kos.owner.user.isDemo) continue
    result.scanned += 1
    if (await claim(prisma, { invoiceId: inv.id, kind: 'hold-expiring', channel: 'EMAIL', recipient: 'PENYEWA' })) {
      await enqueueEmail(prisma, {
        to: t.user.email,
        template: 'hold-expiring',
        payload: {
          studentName: t.user.name,
          kosName: t.room.kos.name,
          roomNumber: t.room.roomNumber,
          amount: inv.amount,
          holdExpiresAt: t.expiresAt.toISOString(),
          myKosUrl: `${origin}/my-kos`,
        },
      })
      result.sent += 1
    }
  }
  return result
}

async function deliver(prisma: PrismaClient, provider: WhatsAppProvider, logId: string, message: WhatsAppMessage, result: ScanResult): Promise<void> {
  try {
    await provider.send(message)
    result.sent += 1
  } catch (err) {
    result.failed += 1
    await prisma.notificationLog.update({ where: { id: logId }, data: { status: 'FAILED', reason: (err instanceof Error ? err.message : 'gagal').slice(0, 200) } })
  }
}

/** Started from index.ts only; tests call scanNotifications with their own clock. Every 10 minutes. */
export function startNotificationWorker(prisma: PrismaClient, deps: Deps, intervalMs = 10 * 60_000): StopWorker {
  return startPeriodic('notifications', intervalMs, () => scanNotifications(prisma, new Date(), deps))
}
