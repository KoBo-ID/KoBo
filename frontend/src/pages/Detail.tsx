import React, { useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Star,
  MapPin,
  Share2,
  ShieldCheck,
  Footprints,
  GraduationCap,
} from 'lucide-react';
import { useAppStore } from '../store/AppContext';
import { PhotoHeroMosaic } from '../components/kos/PhotoHeroMosaic';
import { AmenitiesSection } from '../components/kos/AmenitiesSection';
import { PoiRadar } from '../components/kos/PoiRadar';
import { RulesAccordion } from '../components/kos/RulesAccordion';
import { ReviewsSection } from '../components/kos/ReviewsSection';
import { VisitModal } from '../components/booking/VisitModal';
import { GenderBadge, Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { RoomPicker } from '../components/kos/detail/RoomPicker';
import { StickyBookingSidebar } from '../components/kos/detail/StickyBookingSidebar';
import { BackButton } from '../components/ui/BackButton';
import { Avatar } from '../components/ui/Avatar';
import { ErrorState, NotFoundState } from '../components/ui/QueryState';
import { useTRPC } from '../lib/trpc';
import { useWaitlistStatus } from '../lib/waitlist';
import { isNotFound } from '../lib/queryErrors';
import { kosDetailToKos, reviewsToLegacy } from '../utils/kosDetail';
import type { KosDetail } from '../../../backend/src/trpc/router';
import type { Room } from '../types';

/** Reserves the final page's footprint (title row, 408px photo mosaic, two columns) so nothing jumps on load. */
const DetailSkeleton: React.FC = () => {
  const block = (h: string, extra?: React.CSSProperties) => (
    <div style={{ height: h, backgroundColor: 'var(--bg-muted)', borderRadius: 'var(--radius-lg)', ...extra }} />
  );
  return (
    <div
      className="app-container"
      role="status"
      aria-busy="true"
      aria-label="Memuat detail kos"
      style={{ paddingTop: '2rem', paddingBottom: '4rem' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {block('1.5rem', { width: '12rem' })}
        {block('2.6rem', { width: 'min(26rem, 80%)' })}
        {block('1.2rem', { width: 'min(34rem, 90%)' })}
      </div>
      {block('408px')}
      <div className="detail-split-layout" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2.5rem', marginTop: '2.5rem', alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {block('16rem')}
          {block('7rem')}
          {block('14rem')}
        </div>
        {block('28rem')}
      </div>
    </div>
  );
};

export const Detail: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const { data, isPending, error, refetch } = useQuery(trpc.kos.detail.queryOptions({ id }));

  if (isPending) return <DetailSkeleton />;
  if (error) {
    if (isNotFound(error)) {
      return (
        <NotFoundState
          title="Kos tidak ditemukan"
          text="Kos yang Anda cari tidak ada atau sudah tidak tersedia. Coba cari kos lain."
          linkTo="/search"
          linkLabel="Cari Kos Lain"
        />
      );
    }
    return (
      <div className="app-container" style={{ paddingTop: '2rem' }}>
        <ErrorState message="Gagal memuat detail kos. Periksa koneksi Anda lalu coba lagi." onRetry={() => void refetch()} />
      </div>
    );
  }
  // key: switching between kos resets the room and lease selection.
  return <DetailView key={data.id} detail={data} />;
};

const DetailView: React.FC<{ detail: KosDetail }> = ({ detail }) => {
  const navigate = useNavigate();
  const { addToast } = useAppStore();

  const kos = useMemo(() => kosDetailToKos(detail), [detail]);
  const reviews = useMemo(() => reviewsToLegacy(detail), [detail]);

  const waitlist = useWaitlistStatus(kos.id);
  // undefined = not picking a queue; null = any type; a string = that type (set by clicking a full type).
  const [joinType, setJoinType] = useState<string | null | undefined>(undefined);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  // Bookable = vacant and not held by a daftar tunggu offer for someone else; an offer made to me comes first.
  const bookable = (r: Room) => r.status === 'vacant' && !r.reservedForWaitlist;
  const selectedRoom =
    kos.rooms.find((r) => r.id === selectedRoomId) ??
    kos.rooms.find((r) => r.offeredToMe) ??
    kos.rooms.find(bookable) ??
    kos.rooms[0];
  const [surveyModalOpen, setSurveyModalOpen] = useState(false);
  const [leaseMonths, setLeaseMonths] = useState<number>(1);

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    addToast('Tautan kos berhasil disalin ke clipboard!', 'success');
  };

  const handleBookOffer = (roomId: string) => navigate(`/checkout/${kos.id}?room=${roomId}&duration=${leaseMonths}`);

  const handleGoToCheckout = () => {
    if (!selectedRoom) return;
    navigate(`/checkout/${kos.id}?room=${selectedRoom.id}&duration=${leaseMonths}`);
  };

  return (
    <div
      className="app-container"
      style={{
        /* No maxWidth override: inherits the fluid --container-max so the kos
           page has the same left/right gutters as Home and Search, which is
           where users arrive from. */
        paddingTop: '2rem',
        paddingBottom: '4rem',
      }}
    >
      {/* Title & Top Metadata Zone */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <BackButton style={{ alignSelf: 'flex-start', marginBottom: '-0.25rem' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <GenderBadge gender={kos.gender} />
          {kos.studentDiscountLabel && (
            <Badge variant="discount" icon={<GraduationCap size={12} />}>
              {kos.studentDiscountLabel}
            </Badge>
          )}
          <span
            style={{
              fontSize: '0.8rem',
              color: 'var(--primary)',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
            }}
          >
            <Footprints size={14} />
            <span>{kos.campusProximity.distanceMeters}m ke {kos.campusProximity.campusName}</span>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '2.1rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
              {kos.name}
            </h1>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.4rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 700, color: 'var(--text-main)' }}>
                <Star size={16} fill="var(--accent)" color="var(--accent)" />
                <span>{detail.rating ?? '–'}</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({kos.reviewCount} ulasan)</span>
              </div>
              <span>·</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <MapPin size={15} color="var(--text-subtle)" />
                {kos.address}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button
              variant="outline"
              size="sm"
              onClick={handleShare}
              icon={<Share2 size={16} />}
            >
              Bagikan
            </Button>
          </div>
        </div>
      </div>

      {/* 5-Photo Mosaic Hero */}
      <PhotoHeroMosaic images={kos.images} kosName={kos.name} />

      {/* Split Content Layout: 65% Details (Left) / 35% Sticky Booking Box (Right) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: '2.5rem',
          marginTop: '2.5rem',
          alignItems: 'start',
        }}
        className="detail-split-layout"
      >
        {/* Left Column (65% on Desktop) */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* Room Picker Section */}
          {selectedRoom ? (
            <RoomPicker
              rooms={kos.rooms}
              selectedRoom={selectedRoom}
              onSelectRoom={(r) => {
                setSelectedRoomId(r.id);
                setJoinType(undefined);
              }}
              onSelectFullType={setJoinType}
            />
          ) : (
            <p style={{ color: 'var(--text-muted)' }}>Belum ada kamar yang terdaftar untuk kos ini.</p>
          )}

          <hr className="section-divider" />

          {/* Owner Profile Card */}
          <div
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderRadius: 'var(--radius-card)',
              border: '1px solid var(--border-subtle)',
              padding: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '1.25rem',
              boxShadow: 'var(--shadow-xs)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <Avatar
                src={kos.owner.avatar}
                name={kos.owner.name}
                size={56}
                style={{ border: '2px solid var(--primary-light)' }}
              />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <h4 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{kos.owner.name}</h4>
                  <span style={{ color: 'var(--primary)' }}>
                    <ShieldCheck size={18} />
                  </span>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  Pemilik Terverifikasi · Respon {kos.owner.responseRate} · Bergabung sejak {kos.owner.memberSince}
                </p>
              </div>
            </div>

            <Link to={`/owner/${kos.owner.id}`}>
              <Button variant="outline" size="sm">
                Lihat Profil & Semua Kos ({kos.owner.totalProperties} Properti)
              </Button>
            </Link>
          </div>

          <hr className="section-divider" />

          {/* Segregated Amenities Section */}
          <AmenitiesSection
            privateAmenities={kos.privateAmenities}
            sharedAmenities={kos.sharedAmenities}
            electricityType={kos.electricityType}
          />

          <hr className="section-divider" />

          {/* POI Radar (Di Sekitar Kos) */}
          <PoiRadar pois={kos.pois} campusName={kos.campusProximity.campusName} />

          <hr className="section-divider" />

          {/* Tata Tertib & Denda Accordion */}
          <RulesAccordion rules={kos.rules} />

          <hr className="section-divider" />

          {/* Verified Student Reviews */}
          <ReviewsSection
            kosId={kos.id}
            ratingOverall={detail.rating}
            reviewCount={detail.reviewCount}
            subRatings={detail.subRatings}
            reviews={reviews}
          />
        </div>

        {/* Right Column: Sticky Booking Widget (35% on Desktop) */}
        {selectedRoom && (
          <StickyBookingSidebar
            kos={kos}
            selectedRoom={selectedRoom}
            leaseMonths={leaseMonths}
            onSelectLeaseMonths={setLeaseMonths}
            onGoToCheckout={handleGoToCheckout}
            onOpenSurveyModal={() => setSurveyModalOpen(true)}
            waitlist={{ status: waitlist.data, joinType, onBookOffer: handleBookOffer, onBackToBooking: () => setJoinType(undefined) }}
          />
        )}
      </div>

      {/* Free Visit Modal */}
      <VisitModal
        isOpen={surveyModalOpen}
        onClose={() => setSurveyModalOpen(false)}
        kos={kos}
      />

      <style>{`
        @media (min-width: 1024px) {
          .detail-split-layout {
            grid-template-columns: minmax(0, 1fr) 360px !important;
            gap: 2.25rem !important;
          }
        }
      `}</style>
    </div>
  );
};
