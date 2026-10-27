import React, { useMemo, useState } from 'react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Star, Share2 } from 'lucide-react';
import { useAppStore } from '../store/AppContext';
import { PhotoHeroMosaic } from '../components/kos/PhotoHeroMosaic';
import { AmenitiesSection } from '../components/kos/AmenitiesSection';
import { itemsFromArrays } from '@kobo/shared/facilities';
import { PoiRadar } from '../components/kos/PoiRadar';
import { RulesAccordion } from '../components/kos/RulesAccordion';
import { ReviewsSection } from '../components/kos/ReviewsSection';
import { VisitModal } from '../components/booking/VisitModal';
import { Button } from '../components/ui/Button';
import { RoomPicker } from '../components/kos/detail/RoomPicker';
import { StickyBookingSidebar } from '../components/kos/detail/StickyBookingSidebar';
import { DetailSectionNav } from '../components/kos/detail/DetailSectionNav';
import { KosFacts } from '../components/kos/detail/KosFacts';
import { RelatedKos } from '../components/kos/detail/RelatedKos';
import { Avatar } from '../components/ui/Avatar';
import { ErrorState, NotFoundState } from '../components/ui/QueryState';
import { useTRPC } from '../lib/trpc';
import { useWaitlistStatus } from '../lib/waitlist';
import { isNotFound } from '../lib/queryErrors';
import { kosDetailToKos, reviewsToLegacy } from '../utils/kosDetail';
import { NearbyList } from '../components/kos/NearbyList';
import type { KosDetail } from '../../../backend/src/trpc/router';
import type { Room } from '../types';

/** Reserves the final page's footprint (title row, 408px photo mosaic, two columns) so nothing jumps on load. */
const DetailSkeleton: React.FC = () => {
  const block = (h: string, extra?: React.CSSProperties) => (
    <div className="skeleton" aria-hidden="true" style={{ height: h, borderRadius: 'var(--radius-lg)', ...extra }} />
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
  useDocumentTitle(`${kos.name}, ${kos.district}`);
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

  const navItems = [
    { id: 'kamar', label: 'Kamar' },
    { id: 'fasilitas', label: 'Fasilitas' },
    { id: 'lokasi', label: 'Lokasi' },
    { id: 'aturan', label: 'Tata tertib' },
    { id: 'ulasan', label: 'Ulasan' },
  ];

  return (
    <div
      className="app-container"
      style={{
        /* No maxWidth override: inherits the fluid --container-max so the kos
           page has the same left/right gutters as Home and Search, which is
           where users arrive from. */
        paddingTop: '1.5rem',
        paddingBottom: '4rem',
      }}
    >
      {/* Title zone: breadcrumb, title, rating and address, then the key facts */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', marginBottom: '1.5rem' }}>
        <nav aria-label="Breadcrumb">
          <ol className="detail-crumbs">
            <li><Link to="/">Beranda</Link></li>
            <li><Link to="/search">Cari kos</Link></li>
            <li><Link to={`/search?q=${encodeURIComponent(kos.district)}`}>{kos.district}</Link></li>
            <li aria-current="page"><span>{kos.name}</span></li>
          </ol>
        </nav>

        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ minWidth: 0 }}>
            <h1 className="page-title" style={{ fontSize: 'clamp(1.75rem, 1.3rem + 1.4vw, 2.25rem)' }}>{kos.name}</h1>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.25rem 1rem', marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: 700, color: 'var(--text-main)', whiteSpace: 'nowrap' }}>
                <Star size={16} fill="var(--accent)" color="var(--accent)" />
                <span>{detail.rating ?? '-'}</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({kos.reviewCount} ulasan)</span>
              </div>
              <span aria-hidden="true">·</span>
              <span>{kos.address}</span>
            </div>
          </div>

          <Button variant="outline" size="sm" onClick={handleShare} icon={<Share2 size={16} />}>
            Bagikan
          </Button>
        </div>

        <KosFacts kos={kos} />
      </div>

      {/* 5-Photo Mosaic Hero */}
      <PhotoHeroMosaic images={kos.images} kosName={kos.name} />

      {/* Split Content Layout: details (left) / sticky booking box (right); one column on a phone */}
      <div className="detail-split-layout">
        <div className="detail-main">
          <DetailSectionNav items={navItems} />

          <div className="detail-info">
            <div id="kamar" className="detail-section">
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
                <p className="detail-card" style={{ color: 'var(--text-muted)' }}>Belum ada kamar yang terdaftar untuk kos ini.</p>
              )}
            </div>

            <div id="fasilitas" className="detail-section">
              <AmenitiesSection
                facilities={kos.facilities ?? itemsFromArrays(kos.privateAmenities, kos.sharedAmenities)}
                building={kos.building}
              />
            </div>

            <div id="lokasi" className="detail-section">
              {detail?.nearby ? <NearbyList nearby={detail.nearby} /> : <PoiRadar pois={kos.pois} campusName={kos.campusProximity.campusName} />}
            </div>

            <div id="aturan" className="detail-section">
              <RulesAccordion rules={kos.rules} />
            </div>

            {/* Owner: name and since-date only; nothing here claims a verification that does not exist */}
            <div className="detail-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
                <Avatar
                  src={kos.owner.avatar}
                  name={kos.owner.name}
                  size={56}
                  style={{ border: '2px solid var(--primary-light)' }}
                />
                <div style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Pemilik kos</span>
                  <h4 style={{ fontSize: '1.1rem', fontWeight: 700, margin: '0.1rem 0 0' }}>{kos.owner.name}</h4>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.15rem 0 0' }}>Bergabung sejak {kos.owner.memberSince}</p>
                </div>
              </div>

              <Link to={`/owner/${kos.owner.id}`}>
                <Button variant="outline" size="sm">
                  Lihat Profil & Semua Kos ({kos.owner.totalProperties} Properti)
                </Button>
              </Link>
            </div>
          </div>

          {/* Verified Student Reviews: after the booking card on a phone, under the details on desktop */}
          <div id="ulasan" className="detail-reviews detail-section">
            <ReviewsSection
              kosId={kos.id}
              ratingOverall={detail.rating}
              reviewCount={detail.reviewCount}
              subRatings={detail.subRatings}
              reviews={reviews}
            />
          </div>
        </div>

        {/* Right Column: Sticky Booking Widget */}
        {selectedRoom && (
          <div className="detail-sidebar">
            <StickyBookingSidebar
              kos={kos}
              selectedRoom={selectedRoom}
              leaseMonths={leaseMonths}
              onSelectLeaseMonths={setLeaseMonths}
              onGoToCheckout={handleGoToCheckout}
              onOpenSurveyModal={() => setSurveyModalOpen(true)}
              waitlist={{ status: waitlist.data, joinType, onBookOffer: handleBookOffer, onBackToBooking: () => setJoinType(undefined) }}
            />
          </div>
        )}

        <div className="detail-related-wrap">
          <RelatedKos kosId={kos.id} campusId={kos.campusProximity.campusId} city={kos.city} campusName={kos.campusProximity.campusName} />
        </div>
      </div>

      {/* Free Visit Modal */}
      <VisitModal
        isOpen={surveyModalOpen}
        onClose={() => setSurveyModalOpen(false)}
        kos={kos}
      />
    </div>
  );
};
