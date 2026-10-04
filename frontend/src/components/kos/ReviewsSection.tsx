import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Star, MessageSquare, ShieldCheck, CornerDownRight } from 'lucide-react';
import { Review } from '../../types';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { ReviewFormModal } from './ReviewFormModal';
import { useSession } from '../../lib/session';
import { useTRPC } from '../../lib/trpc';

interface ReviewsSectionProps {
  kosId: string;
  ratingOverall: number | null;
  reviewCount: number;
  /** Kos-level means of each aspect (1 decimal); null when nobody rated it. */
  subRatings: { cleanliness: number | null; wifi: number | null; owner: number | null; quietness: number | null };
  /** Server reviews, newest first. */
  reviews: Review[];
}

const SUB_RATING_ROWS = [
  { key: 'cleanliness', label: 'Kebersihan Kamar & Gedung' },
  { key: 'wifi', label: 'Kecepatan & Stabilitas Wi-Fi' },
  { key: 'owner', label: 'Respon & Keramahan Pemilik' },
  { key: 'quietness', label: 'Ketenangan Jam Belajar' },
] as const;

export const ReviewsSection: React.FC<ReviewsSectionProps> = ({
  kosId,
  ratingOverall,
  reviewCount,
  subRatings,
  reviews: serverReviews,
}) => {
  const trpc = useTRPC();
  const { me } = useSession();
  const kosReviews = serverReviews;
  // Only a tenant who has actually lived (or lives) here can review, once per tenancy.
  const mine = useQuery({ ...trpc.booking.mine.queryOptions(), enabled: !!me });
  const tenancies = (mine.data ?? []).filter((t) => t.kos.id === kosId);
  const writable = tenancies.find((t) => t.canReview);
  const editable = tenancies.find((t) => t.review?.editable);
  const [formFor, setFormFor] = useState<'create' | 'edit' | null>(null);

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
            }}
          >
            <Star size={22} fill="currentColor" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
              <span style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-main)' }}>
                {ratingOverall ?? '–'}
              </span>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>/ 5.0</span>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Berdasarkan {reviewCount} ulasan
            </p>
          </div>
        </div>

        {(writable || editable) && (
          <Button
            variant="outline"
            size="sm"
            icon={<MessageSquare size={15} />}
            onClick={() => setFormFor(writable ? 'create' : 'edit')}
          >
            {writable ? 'Tulis Ulasan Kos' : 'Ubah Ulasan Saya'}
          </Button>
        )}
      </div>

      {/* 4 Sub-Ratings Score Bars */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '0.75rem 1rem',
          paddingBottom: '1.5rem',
          borderBottom: '1px solid var(--border-subtle)',
          marginBottom: '1.5rem',
        }}
      >
        {SUB_RATING_ROWS.map(({ key, label }) => {
          const value = subRatings[key];
          return (
            <div key={key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem', fontSize: '0.75rem', lineHeight: 1.3, marginBottom: '0.3rem' }}>
                <span style={{ minWidth: 0 }}>{label}</span>
                <span style={{ fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>{value === null ? '–' : value.toFixed(1)} / 5</span>
              </div>
              <div style={{ height: '5px', backgroundColor: 'var(--bg-muted)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ width: `${((value ?? 0) / 5) * 100}%`, height: '100%', backgroundColor: 'var(--primary)', borderRadius: '3px' }} />
              </div>
            </div>
          );
        })}
      </div>

      {formFor && (writable || editable) && (
        <ReviewFormModal
          onClose={() => setFormFor(null)}
          tenancyId={(formFor === 'create' ? writable : editable)!.id}
          kosName={(formFor === 'create' ? writable : editable)!.kos.name}
          existing={formFor === 'edit' ? editable!.review : null}
        />
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
                <Avatar src={review.authorAvatar} name={review.authorName} size={38} />
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
                        <span>Penyewa Terverifikasi</span>
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
