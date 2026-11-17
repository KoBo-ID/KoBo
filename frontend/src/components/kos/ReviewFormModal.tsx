import React, { useState } from 'react';
import { Send, Star } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MyReview } from '../../../../backend/src/trpc/router';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { useAppStore } from '../../store/AppContext';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';

interface ReviewFormModalProps {
  onClose: () => void;
  tenancyId: string;
  kosName: string;
  /** When set, the form edits this review (14-day window) instead of creating one. */
  existing?: MyReview | null;
}

type SubKey = 'cleanliness' | 'wifi' | 'owner' | 'quietness';

const SUBS: { key: SubKey; label: string }[] = [
  { key: 'cleanliness', label: 'Kebersihan Kamar & Gedung' },
  { key: 'wifi', label: 'Kecepatan & Stabilitas Wi-Fi' },
  { key: 'owner', label: 'Respon & Keramahan Pemilik' },
  { key: 'quietness', label: 'Ketenangan Jam Belajar' },
];

const Stars: React.FC<{ label: string; value: number | null; onChange: (n: number) => void }> = ({ label, value, onChange }) => (
  <div role="group" aria-label={label} style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
    {[1, 2, 3, 4, 5].map((n) => {
      const on = value !== null && value >= n;
      return (
        <button
          key={n}
          type="button"
          aria-label={`${label}: ${n} bintang`}
          aria-pressed={value === n}
          onClick={() => onChange(n)}
          className="interactive-tap"
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: `1px solid ${on ? 'var(--accent)' : 'var(--border-subtle)'}`,
            borderRadius: 'var(--radius-sm)',
            padding: '0.3rem 0.6rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.2rem',
            color: on ? 'var(--accent)' : 'var(--text-muted)',
            fontWeight: 700,
          }}
        >
          <Star size={14} fill={on ? 'var(--accent)' : 'none'} />
          <span>{n}</span>
        </button>
      );
    })}
  </div>
);

export const ReviewFormModal: React.FC<ReviewFormModalProps> = ({ onClose, tenancyId, kosName, existing }) => {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { addToast } = useAppStore();
  const create = useMutation(trpc.review.create.mutationOptions());
  const update = useMutation(trpc.review.update.mutationOptions());
  const [rating, setRating] = useState(existing?.rating ?? 5);
  const [subs, setSubs] = useState<Record<SubKey, number | null>>(existing?.subRatings ?? { cleanliness: null, wifi: null, owner: null, quietness: null });
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const subRatings = Object.fromEntries(Object.entries(subs).filter(([, v]) => v !== null)) as Partial<Record<SubKey, number>>;
    try {
      if (existing) await update.mutateAsync({ reviewId: existing.id, rating, subRatings, comment });
      else await create.mutateAsync({ tenancyId, rating, subRatings, comment });
      addToast(existing ? 'Ulasan Anda diperbarui.' : 'Ulasan Anda berhasil dikirim! Terima kasih.', 'success');
      void qc.invalidateQueries({ queryKey: trpc.booking.mine.queryKey() });
      void qc.invalidateQueries({ queryKey: trpc.kos.pathKey() });
      void qc.invalidateQueries({ queryKey: trpc.owner.reviews.pathKey() });
      onClose();
    } catch (err) {
      setError(messageForError(err));
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={existing ? 'Ubah Ulasan Anda' : 'Tulis Ulasan'} subtitle={kosName} maxWidth="md">
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>Rating keseluruhan</span>
          <Stars label="Rating keseluruhan" value={rating} onChange={setRating} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.85rem' }}>
          {SUBS.map(({ key, label }) => (
            <div key={key}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: '0.3rem' }}>{label} (opsional)</span>
              <Stars label={label} value={subs[key]} onChange={(n) => setSubs((s) => ({ ...s, [key]: n }))} />
            </div>
          ))}
        </div>

        <div>
          <label htmlFor="review-comment" style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>
            Ceritakan pengalaman tinggal Anda
          </label>
          <textarea
            id="review-comment"
            rows={4}
            value={comment}
            maxLength={1500}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Kondisi kamar, Wi-Fi saat tugas malam, interaksi dengan pemilik kos, dsb."
            required
            style={{
              width: '100%',
              padding: '0.75rem',
              borderRadius: 'var(--radius-md)',
              border: '1.5px solid var(--border-strong)',
              fontFamily: 'var(--font-sans)',
              fontSize: '0.9rem',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--text-main)',
            }}
          />
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" variant="primary" size="sm" isLoading={create.isPending || update.isPending} icon={<Send size={14} />}>
            {existing ? 'Simpan Perubahan' : 'Kirim Ulasan'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
