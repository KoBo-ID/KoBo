import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useAppStore } from '../../store/AppContext';
import { useSession } from '../../lib/session';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';

/** Shown to the shared demo accounts only: what they see is reset nightly, and they can reset it themselves. */
export const DemoNotice: React.FC = () => {
  const { me } = useSession();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { addToast } = useAppStore();
  const reset = useMutation(
    trpc.demo.reset.mutationOptions({
      onSuccess: async () => {
        await qc.invalidateQueries();
        addToast('Data demo dikembalikan ke kondisi awal.', 'success');
      },
      onError: (err) => addToast(messageForError(err), 'error'),
    }),
  );
  if (!me?.user.isDemo) return null;
  return (
    <div
      role="note"
      data-testid="demo-notice"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: '0.75rem', padding: '0.4rem 1rem', fontSize: '0.8rem', backgroundColor: 'var(--bg-muted)', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}
    >
      <span>Akun demo — data direset setiap malam</span>
      <button
        type="button"
        onClick={() => reset.mutate()}
        disabled={reset.isPending}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600, color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 'inherit' }}
      >
        <RotateCcw size={13} aria-hidden="true" />
        {reset.isPending ? 'Mereset…' : 'Reset data demo'}
      </button>
    </div>
  );
};
