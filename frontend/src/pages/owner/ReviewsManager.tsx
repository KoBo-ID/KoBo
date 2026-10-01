import React, { useState } from 'react';
import { Star, MessageSquare, CornerDownRight, Send } from 'lucide-react';
import { useAppStore } from '../../store/AppContext';
import { Button } from '../../components/ui/Button';

export const ReviewsManager: React.FC = () => {
  const { reviews, replyToReview, kosList } = useAppStore();

  const [filterRating, setFilterRating] = useState<number | 'all'>('all');
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<string>('');

  const filteredReviews = reviews.filter((r) => {
    if (filterRating === 'all') return true;
    return Math.floor(r.ratingOverall) === filterRating;
  });

  const handleSendReply = (reviewId: string) => {
    if (!replyText.trim()) return;
    replyToReview(reviewId, replyText);
    setReplyText('');
    setActiveReplyId(null);
  };

  const getKosName = (kosId: string) => {
    const found = kosList.find((k) => k.id === kosId);
    return found ? found.name : 'Kos Mahasiswa';
  };

  return (
    <div className="app-container" style={{ maxWidth: '960px', paddingTop: '2.5rem', paddingBottom: '4rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>

        {/* Rating Filter */}
        <div className="kobo-segmented" role="group" aria-label="Filter rating ulasan">
          {(
            [
              { id: 'all', label: 'Semua Ulasan' },
              { id: 5, label: 'Bintang 5' },
              { id: 4, label: 'Bintang 4' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={filterRating === item.id}
              onClick={() => setFilterRating(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Reviews Stream */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {filteredReviews.map((rev) => (
          <div
            key={rev.id}
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--border-subtle)',
              padding: '1.5rem',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <img
                  src={rev.authorAvatar}
                  alt={rev.authorName}
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '50%',
                    objectFit: 'cover',
                  }}
                />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <h4 style={{ fontSize: '1rem', fontWeight: 700 }}>{rev.authorName}</h4>
                    <span style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>
                      pada {getKosName(rev.kosId)}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {rev.authorCampus} · {rev.date}
                  </span>
                </div>
              </div>

              {/* Star Badge */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  backgroundColor: 'var(--accent-light)',
                  color: 'var(--accent)',
                  padding: '0.25rem 0.5rem',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem',
                  fontWeight: 800,
                }}
              >
                <Star size={14} fill="var(--accent)" />
                <span>{rev.ratingOverall}</span>
              </div>
            </div>

            {/* Comment */}
            <p style={{ fontSize: '0.9rem', color: 'var(--text-main)', lineHeight: 1.6, marginBottom: '1rem' }}>
              "{rev.comment}"
            </p>

            {/* Sub-Ratings Chips */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <span style={{ fontSize: '0.72rem', backgroundColor: 'var(--bg-muted)', padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-xs)' }}>
                Kebersihan: {rev.subRatings.cleanliness}/5
              </span>
              <span style={{ fontSize: '0.72rem', backgroundColor: 'var(--bg-muted)', padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-xs)' }}>
                Wi-Fi: {rev.subRatings.wifi}/5
              </span>
              <span style={{ fontSize: '0.72rem', backgroundColor: 'var(--bg-muted)', padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-xs)' }}>
                Respon Pemilik: {rev.subRatings.owner}/5
              </span>
              <span style={{ fontSize: '0.72rem', backgroundColor: 'var(--bg-muted)', padding: '0.2rem 0.5rem', borderRadius: 'var(--radius-xs)' }}>
                Ketenangan: {rev.subRatings.quietness}/5
              </span>
            </div>

            {/* Owner Reply Thread or Action */}
            {rev.ownerReply ? (
              <div
                style={{
                  padding: '1rem',
                  backgroundColor: 'var(--bg-page)',
                  borderRadius: 'var(--radius-md)',
                  borderLeft: '3px solid var(--primary)',
                  display: 'flex',
                  gap: '0.75rem',
                }}
              >
                <CornerDownRight size={18} color="var(--primary)" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                    <span style={{ fontSize: '0.825rem', fontWeight: 700, color: 'var(--primary)' }}>
                      Tanggapan Resmi Pemilik Kos
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-subtle)' }}>
                      · {rev.ownerReply.date}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: 1.5 }}>
                    {rev.ownerReply.text}
                  </p>
                </div>
              </div>
            ) : (
              <div>
                {activeReplyId === rev.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem' }}>
                    <textarea
                      rows={2}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Tulis tanggapan santun dan ramah untuk ulasan mahasiswa ini..."
                      style={{
                        width: '100%',
                        padding: '0.65rem 0.85rem',
                        borderRadius: 'var(--radius-md)',
                        border: '1.5px solid var(--border-strong)',
                        fontFamily: 'var(--font-sans)',
                        fontSize: '0.85rem',
                      }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                      <Button variant="ghost" size="sm" onClick={() => setActiveReplyId(null)}>
                        Batal
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleSendReply(rev.id)}
                        icon={<Send size={14} />}
                      >
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
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
