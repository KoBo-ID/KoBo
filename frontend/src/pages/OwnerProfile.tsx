import React from 'react';
import { useParams } from 'react-router-dom';
import { ShieldCheck, MessageSquare } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { ListingCard } from '../components/kos/ListingCard';
import { KosCardSkeleton } from '../components/kos/KosCardSkeleton';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { ErrorState, NotFoundState } from '../components/ui/QueryState';
import { useTRPC } from '../lib/trpc';
import { isNotFound } from '../lib/queryErrors';
import { kosCardToKos } from '../utils/kosCard';
import { formatMonthYear } from '../utils/kosDetail';

export const OwnerProfile: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const trpc = useTRPC();
  const { data, isPending, error, refetch } = useQuery(trpc.owner.publicProfile.queryOptions({ id }));
  const ownerKosList = React.useMemo(() => (data?.kos ?? []).map(kosCardToKos), [data]);

  if (isPending) {
    return (
      <div
        className="app-container"
        role="status"
        aria-busy="true"
        aria-label="Memuat profil pemilik"
        style={{ maxWidth: '1080px', paddingTop: '2.5rem', paddingBottom: '4rem' }}
      >
        <div style={{ height: '17rem', backgroundColor: 'var(--bg-muted)', borderRadius: 'var(--radius-xl)', marginBottom: '3rem' }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
          {[0, 1, 2].map((i) => (
            <KosCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }
  if (error) {
    return isNotFound(error) ? (
      <NotFoundState
        title="Pemilik tidak ditemukan"
        text="Profil pemilik yang Anda cari tidak ada. Coba cari kos lain."
        linkTo="/search"
        linkLabel="Cari Kos"
      />
    ) : (
      <div className="app-container" style={{ paddingTop: '2rem' }}>
        <ErrorState message="Gagal memuat profil pemilik. Periksa koneksi Anda lalu coba lagi." onRetry={() => void refetch()} />
      </div>
    );
  }
  const owner = data.owner;

  return (
    <div className="app-container" style={{ maxWidth: '1080px', paddingTop: '2.5rem', paddingBottom: '4rem' }}>
      {/* Owner Profile Banner Card */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderRadius: 'var(--radius-xl)',
          border: '1.5px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-sm)',
          padding: '2.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.75rem',
          marginBottom: '3rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.5rem' }}>
          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
            <Avatar
              src={owner.avatar}
              name={owner.name}
              size={90}
              style={{ border: '3px solid var(--primary-light)', boxShadow: 'var(--shadow-md)' }}
            />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  {owner.name}
                </h1>
                <div
                  style={{
                    backgroundColor: 'var(--primary-light)',
                    color: 'var(--primary)',
                    padding: '0.2rem 0.6rem',
                    borderRadius: 'var(--radius-badge)',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                  }}
                >
                  <ShieldCheck size={14} />
                  <span>Pemilik Kos Terverifikasi KoBo</span>
                </div>
              </div>

              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.35rem', maxWidth: '640px', lineHeight: 1.5 }}>
                {owner.bio || 'Pengelola kos profesional yang berkomitmen memberikan hunian aman, bersih, dan nyaman bagi para penyewa.'}
              </p>
            </div>
          </div>

          <a
            href={`https://wa.me/${(owner.phone ?? '').replace(/^0/, '62')}?text=Halo%20${encodeURIComponent(owner.name)},%20saya%20tertarik%20dengan%20properti%20kos%20Anda%20di%20KoBo`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none' }}
          >
            <Button
              type="button"
              variant="primary"
              size="md"
              icon={<MessageSquare size={16} />}
              style={{ backgroundColor: '#25D366', borderColor: '#25D366' }}
            >
              Hubungi via WhatsApp
            </Button>
          </a>
        </div>

        {/* Stats Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '1rem',
            paddingTop: '1.5rem',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>
              Kecepatan Respon:
            </span>
            <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)' }}>
              {owner.responseRate ?? '-'}
            </span>
          </div>

          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>
              Anggota Sejak:
            </span>
            <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)' }}>
              {formatMonthYear(owner.memberSince)}
            </span>
          </div>

          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>
              Total Properti Dikelola:
            </span>
            <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-main)' }}>
              {ownerKosList.length} Properti Kos
            </span>
          </div>

          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block' }}>
              Jaminan Keamanan:
            </span>
            <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--primary)' }}>
              100% Bebas Calo
            </span>
          </div>
        </div>
      </div>

      {/* Owner's Properties Grid (Idea.md requirement: View Kos Owner's Kos) */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
          <div>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 800 }}>
              Daftar Kos Milik {owner.name} ({ownerKosList.length})
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Semua properti resmi yang dikelola langsung oleh Bapak/Ibu Kos ini.
            </p>
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '1.5rem',
          }}
        >
          {ownerKosList.map((kos) => (
            <ListingCard key={kos.id} kos={kos} />
          ))}
        </div>
      </div>
    </div>
  );
};
