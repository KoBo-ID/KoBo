import '../../styles/owner-reviews.css';
import React, { useEffect, useMemo, useState } from 'react';
import { Star, ShieldCheck, Send } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OwnerReview } from '../../../../backend/src/trpc/router';
import { useAppStore } from '../../store/AppContext';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';
import { useOwnerWorkspace } from '../../lib/ownerWorkspace';
import { formatLongDate } from '../../utils/kosDetail';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorState } from '../../components/ui/QueryState';
import { OwnerPageHeader } from '../../components/owner/OwnerPageHeader';

const SUB_LABELS: { key: keyof OwnerReview['subRatings']; label: string }[] = [
  { key: 'cleanliness', label: 'Kebersihan' },
  { key: 'wifi', label: 'Wi-Fi' },
  { key: 'owner', label: 'Respon pemilik' },
  { key: 'quietness', label: 'Ketenangan' },
];

type Filter = 'all' | 'unanswered' | 1 | 2 | 3 | 4 | 5;
const PAGE = 10;
const CLAMP_CHARS = 220;

const fmt = (n: number) => n.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const emptyText = (f: Filter): string => {
  if (f === 'unanswered') return 'Semua ulasan sudah dibalas.';
  if (f === 'all') return 'Belum ada ulasan.';
  return `Belum ada ulasan bintang ${f}.`;
};

const ReviewRow: React.FC<{
  rev: OwnerReview;
  editing: boolean;
  replyText: string;
  setReplyText: (v: string) => void;
  onStart: () => void;
  onCancel: () => void;
  onSend: () => void;
  sending: boolean;
}> = ({ rev, editing, replyText, setReplyText, onStart, onCancel, onSend, sending }) => {
  const [expanded, setExpanded] = useState(false);
  const long = rev.comment.length > CLAMP_CHARS;
  const subs = SUB_LABELS.filter(({ key }) => rev.subRatings[key] !== null);
  const fieldId = `reply-${rev.id}`;

  return (
    <li className="rv-row" data-testid="owner-review">
      <Avatar src={rev.authorAvatar} name={rev.authorName} size={40} />
      <div className="rv-main">
        <div className="rv-head">
          <div className="rv-who">
            <span className="rv-name">{rev.authorName}</span>
            {rev.verified && (
              <span className="rv-verified" title="Mahasiswa terverifikasi">
                <ShieldCheck size={13} aria-hidden="true" />
                <span>Mahasiswa terverifikasi</span>
              </span>
            )}
            <span className="rv-meta">
              {rev.authorCampus ?? 'Penyewa KoBo'}, {formatLongDate(rev.createdAt)}
            </span>
          </div>
          <span className="rv-stars" aria-label={`Rating ${rev.rating} dari 5`}>
            <Star size={14} fill="currentColor" aria-hidden="true" />
            {rev.rating}
          </span>
        </div>

        <p className={`rv-quote${long && !expanded ? ' is-clamped' : ''}`}>{rev.comment}</p>
        {long && (
          <button type="button" className="rv-link" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Tampilkan lebih sedikit' : 'Selengkapnya'}
          </button>
        )}

        {subs.length > 0 && (
          <p className="rv-subs">
            {subs.map(({ key, label }) => (
              <span key={key}>
                {label} <span className="rv-num">{rev.subRatings[key]}</span>
              </span>
            ))}
          </p>
        )}

        {rev.ownerReply && !editing && (
          <div className="rv-reply">
            <p className="rv-reply__label">
              Tanggapan Anda{rev.ownerReply.at ? <span className="rv-meta">, {formatLongDate(rev.ownerReply.at)}</span> : null}
            </p>
            <p className="rv-reply__text">{rev.ownerReply.text}</p>
          </div>
        )}

        {editing && (
          <div
            className="rv-form"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancel();
            }}
          >
            <label htmlFor={fieldId}>Tanggapan Anda</label>
            <textarea
              id={fieldId}
              rows={3}
              autoFocus
              value={replyText}
              maxLength={1000}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Tulis tanggapan yang santun untuk ulasan ini"
            />
            <div className="rv-form__actions">
              <Button variant="ghost" size="sm" onClick={onCancel}>
                Batal
              </Button>
              <Button variant="primary" size="sm" isLoading={sending} disabled={!replyText.trim()} onClick={onSend} icon={<Send size={14} />}>
                Kirim
              </Button>
            </div>
          </div>
        )}
      </div>

      {!editing && (
        <div className="rv-action">
          <Button variant="outline" size="sm" onClick={onStart}>
            {rev.ownerReply ? 'Ubah tanggapan' : 'Balas'}
          </Button>
        </div>
      )}
    </li>
  );
};

export const ReviewsManager: React.FC = () => {
  const { addToast } = useAppStore();
  const { selectedKos } = useOwnerWorkspace();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const kosId = selectedKos?.id ?? '';
  const reviews = useQuery({ ...trpc.owner.reviews.queryOptions({ kosId }), enabled: !!selectedKos });
  const reply = useMutation(trpc.review.reply.mutationOptions());

  const [filter, setFilter] = useState<Filter>('all');
  const [visible, setVisible] = useState(PAGE);
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  useEffect(() => setVisible(PAGE), [filter]);

  const all = useMemo(() => reviews.data ?? [], [reviews.data]);
  const stats = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    let unanswered = 0;
    for (const r of all) {
      counts[r.rating] = (counts[r.rating] ?? 0) + 1;
      sum += r.rating;
      if (!r.ownerReply) unanswered++;
    }
    const subs = SUB_LABELS.map(({ key, label }) => {
      const vals = all.map((r) => r.subRatings[key]).filter((v): v is number => v !== null);
      return { label, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
    });
    return { counts, unanswered, avg: all.length ? sum / all.length : 0, subs };
  }, [all]);

  const filtered = all.filter((r) => (filter === 'all' ? true : filter === 'unanswered' ? !r.ownerReply : r.rating === filter));
  const shown = filtered.slice(0, visible);
  const maxCount = Math.max(1, ...Object.values(stats.counts));

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

  const filterItems: { id: Filter; label: string; count: number }[] = [
    { id: 'all', label: 'Semua', count: all.length },
    { id: 'unanswered', label: 'Belum dibalas', count: stats.unanswered },
    ...([5, 4, 3, 2, 1] as const).map((n) => ({ id: n as Filter, label: String(n), count: stats.counts[n] })),
  ];

  return (
    <div className="app-container owner-page rv-page">
      <OwnerPageHeader title="Ulasan" subtitle={selectedKos?.name} />

      {!selectedKos && <p className="rv-empty">Belum ada properti. Daftarkan kos pertama Anda di menu Kelola Kos.</p>}

      {selectedKos && reviews.isError && <ErrorState message="Gagal memuat ulasan." onRetry={() => void reviews.refetch()} minHeight="10rem" />}

      {selectedKos && reviews.isPending && (
        <div role="status" aria-label="Memuat ulasan">
          <div className="rv-surface">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rv-row rv-row--skeleton">
                <Skeleton width={40} height={40} borderRadius="50%" />
                <div className="rv-main">
                  <Skeleton width="40%" height="0.9rem" />
                  <Skeleton height="0.9rem" style={{ marginTop: '0.6rem' }} />
                  <Skeleton width="70%" height="0.9rem" style={{ marginTop: '0.4rem' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {reviews.isSuccess && all.length === 0 && <p className="rv-empty">Belum ada ulasan untuk {selectedKos?.name}.</p>}

      {reviews.isSuccess && all.length > 0 && (
        <>
          <section className="rv-summary" aria-label="Ringkasan ulasan">
            <div className="rv-avg">
              <p className="rv-avg__value">
                <span className="rv-num">{fmt(stats.avg)}</span>
                <Star size={22} fill="currentColor" aria-hidden="true" />
              </p>
              <p className="rv-avg__caption">dari {all.length} ulasan</p>
            </div>

            <ol className="rv-dist" aria-label="Sebaran rating">
              {[5, 4, 3, 2, 1].map((n) => (
                <li key={n}>
                  <span className="rv-dist__label rv-num">{n}</span>
                  <span className="rv-dist__bar" style={{ width: `${(stats.counts[n] / maxCount) * 100}%`, minWidth: stats.counts[n] ? 3 : 0 }} aria-hidden="true" />
                  <span className="rv-dist__count rv-num">{stats.counts[n]}</span>
                </li>
              ))}
            </ol>

            <div className="rv-side">
              <button type="button" className="rv-unanswered" onClick={() => setFilter('unanswered')}>
                <span className="rv-num rv-unanswered__n">{stats.unanswered}</span>
                <span>belum dibalas</span>
              </button>
              <dl className="rv-subavg">
                {stats.subs.map((s) => (
                  <div key={s.label}>
                    <dt>{s.label}</dt>
                    <dd className="rv-num">{s.avg === null ? '-' : fmt(s.avg)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <div className="rv-filters" role="group" aria-label="Filter ulasan">
            {filterItems.map((item) => (
              <button key={String(item.id)} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
                {typeof item.id === 'number' && <Star size={12} fill="currentColor" aria-hidden="true" />}
                {item.label}
                <span className="rv-num rv-filters__count">{item.count}</span>
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <p className="rv-empty">{emptyText(filter)}</p>
          ) : (
            <>
              <ul className="rv-surface">
                {shown.map((rev) => (
                  <ReviewRow
                    key={rev.id}
                    rev={rev}
                    editing={activeReplyId === rev.id}
                    replyText={replyText}
                    setReplyText={setReplyText}
                    onStart={() => {
                      setActiveReplyId(rev.id);
                      setReplyText(rev.ownerReply?.text ?? '');
                    }}
                    onCancel={() => setActiveReplyId(null)}
                    onSend={() => void sendReply(rev.id)}
                    sending={reply.isPending}
                  />
                ))}
              </ul>
              {filtered.length > shown.length && (
                <div className="rv-more">
                  <Button variant="outline" onClick={() => setVisible((v) => v + PAGE)}>
                    Tampilkan {Math.min(PAGE, filtered.length - shown.length)} lagi
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};
