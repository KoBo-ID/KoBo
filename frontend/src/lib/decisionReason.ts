import type { ApplicationDecisionReason } from '@kobo/shared/types';

/**
 * Reject reasons (ADR 0024). Owner radio labels and the sentence the student reads.
 * Kept here (not in @kobo/shared/schemas) so no route pulls Zod in just for labels.
 * The student sentences must match the email wording in backend/src/emailTemplates.ts.
 */
export const DECISION_REASON_OPTIONS: { value: ApplicationDecisionReason; ownerLabel: string }[] = [
  { value: 'KAMAR_TIDAK_TERSEDIA', ownerLabel: 'Kamar tidak tersedia' },
  { value: 'MEMILIH_PENGAJU_LAIN', ownerLabel: 'Memilih pengaju lain' },
  { value: 'TANGGAL_TIDAK_COCOK', ownerLabel: 'Tanggal mulai tidak cocok' },
  { value: 'LAINNYA', ownerLabel: 'Alasan lain' },
];

const STUDENT_SENTENCE: Record<ApplicationDecisionReason, string> = {
  KAMAR_TIDAK_TERSEDIA: 'Kamar ini tidak tersedia untuk tanggal yang Anda ajukan.',
  MEMILIH_PENGAJU_LAIN: 'Pemilik menerima pengajuan lain untuk kamar ini.',
  TANGGAL_TIDAK_COCOK: 'Tanggal mulai sewa yang Anda ajukan tidak cocok untuk pemilik.',
  LAINNYA: 'Pemilik menolak dengan alasan lain.',
};

/** The reason line a rejected student reads. A LAINNYA reason with a note lets the note speak instead. */
export function decisionReasonSentence(reason: ApplicationDecisionReason | null, note?: string | null): string | null {
  if (!reason) return 'Pemilik tidak menyebutkan alasan.';
  if (reason === 'LAINNYA' && note) return null;
  return STUDENT_SENTENCE[reason];
}

export const DECISION_NOTE_MAX = 200;
