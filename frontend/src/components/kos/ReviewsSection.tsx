import React, { useMemo, useRef, useState } from 'react';
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
  /** Server reviews, newest first. The section shows the highest rated first (stable, so newest first among equals). */
  reviews: Review[];
}

const SUB_RATING_ROWS = [
  { key: 'cleanliness', label: 'Kebersihan Kamar & Gedung' },
  { key: 'wifi', label: 'Kecepatan & Stabilitas Wi-Fi' },
  { key: 'owner', label: 'Respon & Keramahan Pemilik' },
  { key: 'quietness', label: 'Ketenangan Jam Belajar' },
] as const;

const ReviewItem: React.FC<{ review: Review }> = ({ review }) => (
  <div className="kos-reviews__item">
    <div className="kos-reviews__review-header">
      <div className="kos-reviews__author">
        <Avatar src={review.authorAvatar} name={review.authorName} size={38} />
        <div>
          <div className="kos-reviews__author-name">
            <h5>{review.authorName}</h5>
            {review.verifiedStudent && (
              <span className="kos-reviews__verified" title="Email kampus telah diverifikasi saat ulasan ditulis.">
                <ShieldCheck size={12} aria-hidden="true" />
                Email kampus terverifikasi
              </span>
            )}
          </div>
          <p>{[review.authorCampus, review.date].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div className="kos-reviews__rating">
        <Star size={13} fill="currentColor" aria-hidden="true" />
        <span>{review.ratingOverall}</span>
      </div>
    </div>
    <p className="kos-reviews__comment">{review.comment}</p>
    {review.ownerReply && (
      <div className="kos-reviews__reply">
        <CornerDownRight size={16} color="var(--primary)" aria-hidden="true" />
        <div>
          <div className="kos-reviews__reply-title">
            <strong>Tanggapan Pemilik Kos</strong>
            <span>· {review.ownerReply.date}</span>
          </div>
          <p>{review.ownerReply.text}</p>
        </div>
      </div>
    )}
  </div>
);

export const ReviewsSection: React.FC<ReviewsSectionProps> = ({
  kosId,
  ratingOverall,
  reviewCount,
  subRatings,
  reviews: serverReviews,
}) => {
  const trpc = useTRPC();
  const { me } = useSession();
  const kosReviews = useMemo(() => [...serverReviews].sort((a, b) => b.ratingOverall - a.ratingOverall), [serverReviews]);
  // Only a tenant who has actually lived (or lives) here can review, once per tenancy.
  const mine = useQuery({ ...trpc.booking.mine.queryOptions(), enabled: !!me });
  const tenancies = (mine.data ?? []).filter((t) => t.kos.id === kosId);
  const writable = tenancies.find((t) => t.canReview);
  const editable = tenancies.find((t) => t.review?.editable);
  const [formFor, setFormFor] = useState<'create' | 'edit' | null>(null);
  const [showAllReviews, setShowAllReviews] = useState(false);
  const moreReviewsButton = useRef<HTMLButtonElement>(null);
  const extraReviewsId = `kos-extra-reviews-${kosId}`;

  const toggleReviews = () => {
    const collapsing = showAllReviews;
    setShowAllReviews(!showAllReviews);
    if (collapsing) requestAnimationFrame(() => {
      const button = moreReviewsButton.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) button.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    });
  };

  return (
    <section
      className="kos-reviews"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-subtle)',
        padding: '1.5rem',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {(writable || editable) && (
        <div className="section-head" style={{ justifyContent: 'flex-end' }}>
          <Button
            variant="outline"
            size="sm"
            icon={<MessageSquare size={15} />}
            onClick={() => setFormFor(writable ? 'create' : 'edit')}
          >
            {writable ? 'Tulis ulasan kos' : 'Ubah ulasan saya'}
          </Button>
        </div>
      )}

      <div className="kos-reviews__summary">
        <div className="kos-reviews__score">
          <div>
            <strong>{ratingOverall ?? '-'}</strong>
            <span>/ 5.0</span>
          </div>
          <p>Berdasarkan {reviewCount} ulasan</p>
        </div>

        {/* Read-only aspect ratings: label and stars share one row. */}
        <div className="kos-reviews__aspects">
          {SUB_RATING_ROWS.map(({ key, label }) => {
            const value = subRatings[key];
            return (
              <div key={key} className="kos-reviews__aspect">
                <span className="kos-reviews__aspect-label">{label}</span>
                {value === null ? (
                  <span className="kos-reviews__unrated">Belum dinilai</span>
                ) : (
                  <div
                    className="kos-reviews__star-meter"
                    role="img"
                    aria-label={`${label}: ${value.toFixed(1).replace('.', ',')} dari 5 bintang`}
                  >
                    <span className="kos-reviews__stars" aria-hidden="true">
                      {[0, 1, 2, 3, 4].map((index) => {
                        const fill = Math.max(0, Math.min(10, Math.round(value * 10) - index * 10)) * 10;
                        return (
                          <span className="kos-reviews__star" key={index}>
                            <Star size={16} className="kos-reviews__star-outline" />
                            <span className="kos-reviews__star-fill" style={{ width: `${fill}%` }}>
                              <Star size={16} fill="currentColor" />
                            </span>
                          </span>
                        );
                      })}
                    </span>
                    <span className="kos-reviews__aspect-score" aria-hidden="true">{value.toFixed(1)} / 5</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {formFor && (writable || editable) && (
        <ReviewFormModal
          onClose={() => setFormFor(null)}
          tenancyId={(formFor === 'create' ? writable : editable)!.id}
          kosName={(formFor === 'create' ? writable : editable)!.kos.name}
          existing={formFor === 'edit' ? editable!.review : null}
        />
      )}

      {/* The same renderer keeps initial and expanded reviews consistent. */}
      <div className="kos-reviews__list">
        {kosReviews.slice(0, 5).map((review) => <ReviewItem key={review.id} review={review} />)}
        <div id={extraReviewsId} hidden={!showAllReviews} className="kos-reviews__extra">
          {kosReviews.slice(5).map((review) => <ReviewItem key={review.id} review={review} />)}
        </div>
      </div>
      {kosReviews.length > 5 && <button ref={moreReviewsButton} type="button" className="kos-reviews__more" aria-expanded={showAllReviews} aria-controls={extraReviewsId} onClick={toggleReviews}>{showAllReviews ? 'Lihat lebih sedikit ulasan' : `Lihat ulasan lainnya (${kosReviews.length - 5})`}</button>}
    </section>
  );
};
