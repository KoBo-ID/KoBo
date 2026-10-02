import React, { useState } from 'react';
import { Star, MessageSquare, CornerDownRight, Send, ShieldCheck } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OwnerReview } from '../../../../backend/src/trpc/router';
import { useAppStore } from '../../store/AppContext';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';
import { useOwnerWorkspace } from '../../lib/ownerWorkspace';
import { formatLongDate } from '../../utils/kosDetail';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/QueryState';

const SUB_LABELS: { key: keyof OwnerReview['subRatings']; label: string }[] = [
  { key: 'cleanliness', label: 'Kebersihan' },
  { key: 'wifi', label: 'Wi-Fi' },
  { key: 'owner', label: 'Respon Pemilik' },
  { key: 'quietness', label: 'Ketenangan' },
];

export const ReviewsManager: React.FC = () => {
  const { addToast } = useAppStore();
  const { selectedKos } = useOwnerWorkspace();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const kosId = selectedKos?.id ?? '';
  const reviews = useQuery({ ...trpc.owner.reviews.queryOptions({ kosId }), enabled: !!selectedKos });
  const reply = useMutation(trpc.review.reply.mutationOptions());

  const [filterRating, setFilterRating] = useState<number | 'all'>('all');
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const filtered = (reviews.data ?? []).filter((r) => filterRating === 'all' || r.rating === filterRating);

  const sendReply = async (reviewId: string) => {
    if (!replyText.trim() || !selectedKos) return;
    try {
      await reply.mutateAsync({ kosId: selectedKos.id, reviewId, text: replyText });
      addToast('Tanggapan pemilik berhasil dipublikasikan.', 'success');
      setReplyText('');
      setActiveReplyId(null);
      void qc.invalidateQueries({ queryKey: trpc.owner.reviews.pathKey() });
      void qc.invalidateQueries({ queryKey: trpc.kos.pathKey() });
    } catch (err) {
      addToast(messageForError(err), 'error');
    }
  };

  return (
    <div className="app-container" style={{ maxWidth: '960px', paddingTop: '2.5rem', paddingBottom: '4rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="kobo-segmented" role="group" aria-label="Filter rating ulasan">
          {(
            [
              { id: 'all', label: 'Semua Ulasan' },
              { id: 5, label: 'Bintang 5' },
              { id: 4, label: 'Bintang 4' },
              { id: 3, label: 'Bintang 3' },
              { id: 2, label: 'Bintang 2' },
              { id: 1, label: 'Bintang 1' },
            ] as const
          ).map((item) => (
            <button key={item.id} type="button" aria-pressed={filterRating === item.id} onClick={() => setFilterRating(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {!selectedKos && <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>Belum ada properti. Daftarkan kos pertama Anda di menu Kelola Kos.</p>}
      {selectedKos && reviews.isPending && <p role="status" style={{ color: 'var(--text-muted)' }}>Memuat ulasan…</p>}
      {selectedKos && reviews.isError && <ErrorState message="Gagal memuat ulasan." onRetry={() => void reviews.refetch()} minHeight="10rem" />}
      {reviews.isSuccess && filtered.length === 0 && (
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>
          {reviews.data.length === 0 ? `Belum ada ulasan untuk ${selectedKos?.name}.` : 'Tidak ada ulasan dengan rating ini.'}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {filtered.map((rev) => (
          <div
            key={rev.id}
            data-testid="owner-review"
            style={{ backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', padding: '1.5rem', boxShadow: 'var(--shadow-sm)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Avatar src={rev.authorAvatar} name={rev.authorName} size={42} />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <h4 style={{ fontSize: '1rem', fontWeight: 700 }}>{rev.authorName}</h4>
                    {rev.verified && (
                      <span style={{ fontSize: '0.7rem', color: 'var(--primary)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                        <ShieldCheck size={12} /> Mahasiswa Terverifikasi
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {rev.authorCampus ?? 'Penyewa KoBo'} · {formatLongDate(rev.createdAt)}
                  </span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', backgroundColor: 'var(--accent-light)', color: 'var(--accent)', padding: '0.25rem 0.5rem', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', fontWeight: 800 }}>
                <Star size={14} fill="var(--accent)" />
                <span>{rev.rating}</span>
              </div>
            </div>

            <p style={{ fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.6, marginBottom: '1rem' }}>"{rev.comment}"</p>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              {SUB_LABELS.filter(({ key }) => rev.subRatings[key] !== null).map(({ key, label }) => (
                <span key={key} style={{ fontSize: '0.72rem', backgroundColor: 'var(--bg-muted)', padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-xs)' }}>
                  {label}: {rev.subRatings[key]}/5
                </span>
              ))}
            </div>

            {rev.ownerReply && activeReplyId !== rev.id && (
              <div style={{ padding: '1rem', backgroundColor: 'var(--bg-page)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid var(--primary)', display: 'flex', gap: '0.75rem' }}>
                <CornerDownRight size={18} color="var(--primary)" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                    <span style={{ fontSize: '0.825rem', fontWeight: 700, color: 'var(--primary)' }}>Tanggapan Resmi Pemilik Kos</span>
                    {rev.ownerReply.at && <span style={{ fontSize: '0.7rem', color: 'var(--text-subtle)' }}>· {formatLongDate(rev.ownerReply.at)}</span>}
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: 1.5 }}>{rev.ownerReply.text}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setActiveReplyId(rev.id);
                      setReplyText(rev.ownerReply?.text ?? '');
                    }}
                  >
                    Ubah Tanggapan
                  </Button>
                </div>
              </div>
            )}

            {(!rev.ownerReply || activeReplyId === rev.id) &&
              (activeReplyId === rev.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem' }}>
                  <textarea
                    rows={2}
                    aria-label="Tanggapan pemilik"
                    value={replyText}
                    maxLength={1000}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Tulis tanggapan santun dan ramah untuk ulasan mahasiswa ini..."
                    style={{ width: '100%', padding: '0.65rem 0.85rem', borderRadius: 'var(--radius-md)', border: '1.5px solid var(--border-strong)', fontFamily: 'var(--font-sans)', fontSize: '0.85rem' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <Button variant="ghost" size="sm" onClick={() => setActiveReplyId(null)}>
                      Batal
                    </Button>
                    <Button variant="primary" size="sm" isLoading={reply.isPending} onClick={() => void sendReply(rev.id)} icon={<Send size={14} />}>
                      Kirim Tanggapan Pemilik
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setActiveReplyId(rev.id);
                    setReplyText('');
                  }}
                  icon={<MessageSquare size={14} />}
                >
                  Beri Tanggapan Pemilik
                </Button>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
};
