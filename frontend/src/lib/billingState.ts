import type { InvoiceBillingState } from '@kobo/shared/types';
import { diffDays } from '@kobo/shared/domain';

/** Visual tone of an invoice row status. Every tone is paired with text, never colour alone. */
export type BillingTone = 'paid' | 'overdue' | 'muted' | 'default';

export interface BillingLabel {
  label: string;
  tone: BillingTone;
  /** Extra words for screen readers only (e.g. why a waived row is not owed). */
  srSuffix?: string;
}

/** Whole WIB days from the due day to today (0 on the due day itself, never negative). */
export const daysLate = (dueDate: string, today: string): number => Math.max(0, diffDays(dueDate, today));

/** Why an unpaid month of a finished tenancy is not billed (the tenancy's end cause). */
export type EndCause = 'HOLD_LAPSED' | 'CANCELLED_BY_OWNER' | 'MOVED_OUT' | null;

const NOT_BILLED: Record<NonNullable<EndCause> | 'DEFAULT', string> = {
  HOLD_LAPSED: 'Tidak ditagih, masa tahan berakhir',
  CANCELLED_BY_OWNER: 'Tidak ditagih, dibatalkan pemilik',
  MOVED_OUT: 'Tidak ditagih, sewa berakhir',
  DEFAULT: 'Tidak ditagih, sewa berakhir',
};

/**
 * The one place that turns the server's billingState (booking.mine) into row copy (ADR 0023).
 * The UI never re-derives overdue / waived / not billed from status or dates.
 */
export function billingStateLabel(state: InvoiceBillingState, opts: { dueDate: string; today: string; endCause?: EndCause; status?: string }): BillingLabel {
  switch (state) {
    case 'PAID':
      return { label: 'Lunas', tone: 'paid' };
    case 'OWED':
      return { label: 'Belum dibayar', tone: 'default' };
    case 'OVERDUE': {
      const n = daysLate(opts.dueDate, opts.today);
      return { label: n === 0 ? 'Jatuh tempo hari ini' : `Terlambat ${n} hari`, tone: 'overdue' };
    }
    case 'WAIVED':
      return { label: 'Dihapus pemilik', tone: 'muted', srSuffix: 'tunggakan dihapus pemilik, tidak ditagih lagi' };
    case 'NOT_BILLED':
      return { label: NOT_BILLED[opts.endCause ?? 'DEFAULT'], tone: 'muted' };
    default:
      // A response without billingState (an older server during a deploy, or a test stub): never crash the row.
      return opts.status === 'PAID' ? { label: 'Lunas', tone: 'paid' } : { label: 'Belum dibayar', tone: 'default' };
  }
}
