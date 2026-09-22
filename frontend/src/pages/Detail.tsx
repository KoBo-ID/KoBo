import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Star,
  MapPin,
  Heart,
  Share2,
  ShieldCheck,
  Footprints,
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
import { Room } from '../types';

export const Detail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { kosList, currentUser, toggleWishlist, addToast } = useAppStore();

  const kos = kosList.find((k) => k.id === id) || kosList[0];

  const [selectedRoom, setSelectedRoom] = useState<Room>(
    kos.rooms.find((r) => r.status === 'vacant') || kos.rooms[0]
  );
  const [surveyModalOpen, setSurveyModalOpen] = useState(false);
  const [leaseMonths, setLeaseMonths] = useState<number>(1);

  const isSaved = currentUser.savedKosIds.includes(kos.id);

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    addToast('Tautan kos berhasil disalin ke clipboard!', 'success');
  };

  const handleGoToCheckout = () => {
    navigate(`/checkout/${kos.id}?room=${selectedRoom.id}&duration=${leaseMonths}`);
  };

  return (
    <div
      className="app-container"
      style={{
        maxWidth: '1180px',
        paddingTop: '2rem',
        paddingBottom: '4rem',
      }}
    >
      {/* Title & Top Metadata Zone */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <GenderBadge gender={kos.gender} />
          {kos.studentDiscountLabel && (
            <Badge variant="discount">
              🎓 {kos.studentDiscountLabel}
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
                <span>{kos.rating}</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({kos.reviewCount} ulasan mahasiswa)</span>
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => toggleWishlist(kos.id)}
              icon={<Heart size={16} fill={isSaved ? 'var(--status-overdue)' : 'none'} color={isSaved ? 'var(--status-overdue)' : 'currentColor'} />}
            >
              {isSaved ? 'Tersimpan' : 'Simpan'}
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
          <RoomPicker
            rooms={kos.rooms}
            selectedRoom={selectedRoom}
            onSelectRoom={setSelectedRoom}
          />

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
              <img
                src={kos.owner.avatar}
                alt={kos.owner.name}
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '2px solid var(--primary-light)',
                }}
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
            ratingOverall={kos.rating}
            reviewCount={kos.reviewCount}
          />
        </div>

        {/* Right Column: Sticky Booking Widget (35% on Desktop) */}
        <StickyBookingSidebar
          kos={kos}
          selectedRoom={selectedRoom}
          leaseMonths={leaseMonths}
          onSelectLeaseMonths={setLeaseMonths}
          onGoToCheckout={handleGoToCheckout}
          onOpenSurveyModal={() => setSurveyModalOpen(true)}
        />
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
