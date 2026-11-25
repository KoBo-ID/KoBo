import React from 'react';
import type { ApplicationDecisionReason } from '@kobo/shared/types';
import { decisionReasonSentence } from '../../lib/decisionReason';

/**
 * Why a rental application was not accepted, in the student's words (SIM-006): the reason sentence,
 * the owner's note when there is one, and that nothing is charged. The next action is rendered by the caller.
 */
export const DecisionReasonText: React.FC<{ reason: ApplicationDecisionReason | null; note: string | null }> = ({ reason, note }) => {
  const sentence = decisionReasonSentence(reason, note);
  return (
    <div className="mk-row__note" data-testid="decision-reason">
      {sentence && <p style={{ margin: 0 }}>Alasan: {sentence}</p>}
      {note && <p style={{ margin: 0 }}>Catatan pemilik: &ldquo;{note}&rdquo;</p>}
      <p style={{ margin: 0 }}>Tidak ada biaya yang ditagihkan untuk pengajuan ini.</p>
    </div>
  );
};
