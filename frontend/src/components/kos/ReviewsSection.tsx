import React, { useState } from 'react';
import { Star, MessageSquare, ShieldCheck, CornerDownRight, Send } from 'lucide-react';
import { Review } from '../../types';
import { Button } from '../ui/Button';
import { useAppStore } from '../../store/AppContext';

interface ReviewsSectionProps {
  kosId: string;
  ratingOverall: number;
  reviewCount: number;
}

export const ReviewsSection: React.FC<ReviewsSectionProps> = ({
  kosId,
  ratingOverall,
  reviewCount,
}) => {
  const { reviews, addReview, currentUser } = useAppStore();
  const kosReviews = reviews.filter((r) => r.kosId === kosId);

  // New review form state
  const [showForm, setShowForm] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [newRating, setNewRating] = useState(5);
  const [cleanliness, setCleanliness] = useState(5);
  const [wifi, setWifi] = useState(5);
  const [ownerScore, setOwnerScore] = useState(5);
  const [quietness, setQuietness] = useState(5);

  const handleSubmitReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim()) return;

    addReview({
      kosId,
      authorName: currentUser.name,
      authorCampus: currentUser.campus || 'Mahasiswa Binus',
      authorAvatar: currentUser.avatar,
      ratingOverall: newRating,
      subRatings: {
        cleanliness,
        wifi,
        owner: ownerScore,
        quietness,
      },
      comment: newComment,
      verifiedStudent: true,
    });

    setNewComment('');
    setShowForm(false);
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)',
        padding: '1.5rem',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {/* Header with overall rating */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
          paddingBottom: '1.5rem',
          borderBottom: '1px solid var(--border-subtle)',
          marginBottom: '1.5rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--primary-light)',
              color: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
              fontWeight: 800,
            }}
          >
            ★
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
              <span style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-main)' }}>
                {ratingOverall}
              </span>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>/ 5.0</span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Berdasarkan {kosReviews.length} ulasan mahasiswa terverifikasi
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          icon={<MessageSquare size={15} />}
          onClick={() => setShowForm((prev) => !prev)}
        >
          {showForm ? 'Batal Ulas' : 'Tulis Ulasan Kos'}
        </Button>
      </div>

      {/* 4 Sub-Ratings Score Bars */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem',
          paddingBottom: '1.5rem',
          borderBottom: '1px solid var(--border-subtle)',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', marginBottom: '0.35rem' }}>
            <span>Kebersihan Kamar & Gedung</span>
            <span style={{ fontWeight: 700 }}>4.9 / 5</span>
          </div>
          <div style={{ height: '6px', backgroundColor: 'var(--bg-muted)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ width: '98%', height: '100%', backgroundColor: 'var(--primary)', borderRadius: '3px' }} />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', marginBottom: '0.35rem' }}>
            <span>Kecepatan & Stabilitas Wi-Fi</span>
            <span style={{ fontWeight: 700 }}>4.8 / 5</span>
          </div>
          <div style={{ height: '6px', backgroundColor: 'var(--bg-muted)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ width: '96%', height: '100%', backgroundColor: 'var(--primary)', borderRadius: '3px' }} />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', marginBottom: '0.35rem' }}>
            <span>Respon & Keramahan Pemilik</span>
            <span style={{ fontWeight: 700 }}>4.9 / 5</span>
          </div>
          <div style={{ height: '6px', backgroundColor: 'var(--bg-muted)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ width: '98%', height: '100%', backgroundColor: 'var(--primary)', borderRadius: '3px' }} />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', marginBottom: '0.35rem' }}>
            <span>Ketenangan Jam Belajar</span>
            <span style={{ fontWeight: 700 }}>4.7 / 5</span>
          </div>
          <div style={{ height: '6px', backgroundColor: 'var(--bg-muted)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ width: '94%', height: '100%', backgroundColor: 'var(--primary)', borderRadius: '3px' }} />
          </div>
        </div>
      </div>

      {/* Review Submission Form */}
      {showForm && (
        <form
          onSubmit={handleSubmitReview}
          className="animate-slide-up"
          style={{
            backgroundColor: 'var(--bg-page)',
            padding: '1.25rem',
            borderRadius: 'var(--radius-md)',
            border: '1.5px solid var(--border-strong)',
            marginBottom: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <h4 style={{ fontSize: '1rem', fontWeight: 700 }}>Tulis Pengalaman Tinggal Anda</h4>

          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>
              Rating Keseluruhan (Bintang 1 - 5):
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  type="button"
                  key={star}
                  onClick={() => setNewRating(star)}
                  className="interactive-tap"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: `1px solid ${newRating >= star ? 'var(--accent)' : 'var(--border-subtle)'}`,
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.4rem 0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    color: newRating >= star ? 'var(--accent)' : 'var(--text-muted)',
                    fontWeight: 700,
                  }}
                >
                  <Star size={16} fill={newRating >= star ? 'var(--accent)' : 'none'} />
                  <span>{star}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>
              Ulasan & Catatan untuk Rekan Mahasiswa:
            </label>
            <textarea
              rows={3}
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder="Ceritakan kondisi kamar, Wi-Fi pas tugas malam, interaksi dengan ibu/bapak kos, dsb..."
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

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>
              Batal
            </Button>
            <Button type="submit" variant="primary" size="sm" icon={<Send size={14} />}>
              Kirim Ulasan Terverifikasi
            </Button>
          </div>
        </form>
      )}

      {/* Review List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {kosReviews.map((review) => (
          <div
            key={review.id}
            style={{
              padding: '1.25rem',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-page)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {/* Reviewer Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <img
                  src={review.authorAvatar}
                  alt={review.authorName}
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '50%',
                    objectFit: 'cover',
                  }}
                />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <h5 style={{ fontSize: '0.925rem', fontWeight: 700 }}>{review.authorName}</h5>
                    {review.verifiedStudent && (
                      <span
                        style={{
                          fontSize: '0.7rem',
                          color: 'var(--primary)',
                          backgroundColor: 'var(--primary-light)',
                          padding: '0.15rem 0.45rem',
                          borderRadius: 'var(--radius-badge)',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.2rem',
                        }}
                      >
                        <ShieldCheck size={12} />
                        <span>Mahasiswa Terverifikasi</span>
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {review.authorCampus} · {review.date}
                  </p>
                </div>
              </div>

              {/* Star Rating Badge */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  backgroundColor: 'var(--accent-light)',
                  color: 'var(--accent)',
                  padding: '0.25rem 0.5rem',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.8125rem',
                  fontWeight: 800,
                }}
              >
                <Star size={13} fill="var(--accent)" />
                <span>{review.ratingOverall}</span>
              </div>
            </div>

            {/* Comment */}
            <p style={{ fontSize: '0.875rem', color: 'var(--text-main)', lineHeight: 1.6 }}>
              {review.comment}
            </p>

            {/* Owner Reply Thread */}
            {review.ownerReply && (
              <div
                style={{
                  marginTop: '0.85rem',
                  padding: '0.85rem 1rem',
                  backgroundColor: 'var(--bg-surface)',
                  borderRadius: 'var(--radius-sm)',
                  borderLeft: '3px solid var(--primary)',
                  display: 'flex',
                  gap: '0.65rem',
                }}
              >
                <CornerDownRight size={16} color="var(--primary)" style={{ flexShrink: 0, marginTop: '0.15rem' }} />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--primary)' }}>
                      Tanggapan Pemilik Kos
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-subtle)' }}>
                      · {review.ownerReply.date}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.825rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    {review.ownerReply.text}
                  </p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
