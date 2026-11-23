import React, { useState } from 'react';
import { Ban } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Notice } from '../ui/Notice';
import { useTRPC } from '../../lib/trpc';
import { refusalMessage, useInvalidateMatching } from '../../lib/matching';

/**
 * "Blokir" with a confirm dialog that names the consequences.
 * Props: `profileId` and `displayName` of the person to block; `onBlocked` runs after success (for example navigate away);
 * `variant` / `size` pass through to the Button.
 */
export const BlockButton: React.FC<{
  profileId: string;
  displayName: string;
  onBlocked?: () => void;
  variant?: 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}> = ({ profileId, displayName, onBlocked, variant = 'outline', size = 'sm' }) => {
  const trpc = useTRPC();
  const invalidate = useInvalidateMatching();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const block = useMutation({
    ...trpc.matching.safety.block.mutationOptions(),
    onSuccess: () => { setOpen(false); void invalidate(); onBlocked?.(); },
    onError: (e) => setError(refusalMessage(e)),
  });
  return (
    <>
      <Button variant={variant} size={size} icon={<Ban size={14} />} onClick={() => { setError(null); setOpen(true); }}>Blokir</Button>
      {open && (
        <ConfirmDialog
          title={`Blokir ${displayName}?`}
          message={
            <>
              Kalian tidak akan saling melihat di pencarian, dan koneksi atau permintaan yang ada diakhiri. Obrolan lama menjadi hanya-baca.
              Membuka blokir nanti tidak memulihkan koneksi. Kamu bisa membuka blokir di Pengaturan.
              {error && <div style={{ marginTop: '0.75rem' }}><Notice tone="error">{error}</Notice></div>}
            </>
          }
          confirmLabel="Blokir"
          danger
          busy={block.isPending}
          onConfirm={() => { setError(null); block.mutate({ profileId }); }}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
};
