import React from 'react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useParams } from 'react-router-dom';
import { BadgeCheck, MessageSquare } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { ListingCard } from '../components/kos/ListingCard';
import { KosCardSkeleton } from '../components/kos/KosCardSkeleton';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { ErrorState, NotFoundState } from '../components/ui/QueryState';
import { useTRPC } from '../lib/trpc';
import { useSession } from '../lib/session';
import { isNotFound } from '../lib/queryErrors';
import { kosCardToKos } from '../utils/kosCard';
import { formatMonthYear } from '../utils/kosDetail';

export const OwnerProfile: React.FC = () => {
  const { id = '' } = useParams<{ id: string }>();
  const { me } = useSession();
  const trpc = useTRPC();
  const { data, isPending, error, refetch } = useQuery(trpc.owner.publicProfile.queryOptions({ id }));
  const ownerKosList = React.useMemo(() => (data?.kos ?? []).map(kosCardToKos), [data]);
  useDocumentTitle(data ? data.owner.name : null);

  if (isPending) {
    return (
      <div
        className="app-container"
        role="status"
        aria-busy="true"
        aria-label="Memuat profil pemilik"
        style={{ maxWidth: '1080px', paddingTop: '2.5rem', paddingBottom: '4rem' }}
      >
        <div style={{ height: '17rem', backgroundColor: 'var(--bg-muted)', borderRadius: 'var(--radius-card)', marginBottom: '3rem' }} />
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
  const ownPending = me?.ownerProfileId === owner.id && me.ownerStatus !== 'DISETUJUI';
  // Only a plausible number gets a wa.me link; digits only, local 0 becomes 62.
  const digits = (owner.phone ?? '').replace(/\D/g, '');
  const waNumber = digits.length >= 8 ? digits.replace(/^0/, '62') : '';

  return (
    <div className="app-container" style={{ maxWidth: '1080px', paddingTop: '2.5rem', paddingBottom: '4rem' }}>
      {ownPending && (
        <p role="note" style={{ marginBottom: '1.25rem', padding: '0.75rem 1rem', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--primary-light)', border: '1px solid var(--primary)', fontSize: 'var(--step--1)', fontWeight: 600 }}>
          Hanya Anda yang dapat melihat halaman ini sampai akun pemilik disetujui.
        </p>
      )}
      {/* Owner Profile Banner Card */}
      <div
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderRadius: 'var(--radius-card)',
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
          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
            <Avatar
              src={owner.avatar}
              name={owner.name}
              size={90}
              style={{ border: '3px solid var(--primary-light)', boxShadow: 'var(--shadow-md)' }}
            />
            <div style={{ flex: '1 1 14rem', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <h1 style={{ fontSize: 'var(--step-2)', fontWeight: 800, color: 'var(--text-main)' }}>
                  {owner.name}
                </h1>
                {owner.verified === true && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'var(--primary)', fontSize: 'var(--step--2)', fontWeight: 700 }}>
                    <BadgeCheck size={14} aria-hidden="true" /> Pemilik terverifikasi
                  </span>
                )}
              </div>

              {owner.bio && (
                <p style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)', marginTop: '0.35rem', maxWidth: '640px', lineHeight: 1.5 }}>
                  {owner.bio}
                </p>
              )}
            </div>
          </div>

          {waNumber && (
          <a
            href={`https://wa.me/${waNumber}?text=Halo%20${encodeURIComponent(owner.name)},%20saya%20tertarik%20dengan%20properti%20kos%20Anda%20di%20KoBo`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none' }}
          >
            <Button
              type="button"
              variant="primary"
              size="md"
              icon={<MessageSquare size={16} />}
              style={{ backgroundColor: 'var(--whatsapp)', borderColor: 'var(--whatsapp)' }}
            >
              Hubungi via WhatsApp
            </Button>
          </a>
          )}
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
            <span style={{ fontSize: 'var(--step--2)', color: 'var(--text-muted)', display: 'block' }}>
              Anggota Sejak:
            </span>
            <span style={{ fontSize: 'var(--step-0)', fontWeight: 700, color: 'var(--text-main)' }}>
              {formatMonthYear(owner.memberSince)}
            </span>
          </div>

          <div>
            <span style={{ fontSize: 'var(--step--2)', color: 'var(--text-muted)', display: 'block' }}>
              Total Properti Dikelola:
            </span>
            <span style={{ fontSize: 'var(--step-0)', fontWeight: 700, color: 'var(--text-main)' }}>
              {ownerKosList.length} Properti Kos
            </span>
          </div>
        </div>
      </div>

      {/* Owner's Properties Grid (Idea.md requirement: View Kos Owner's Kos) */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
          <div>
            <h2 style={{ fontSize: 'var(--step-2)', fontWeight: 800 }}>
              Daftar Kos Milik {owner.name} ({ownerKosList.length})
            </h2>
            <p style={{ fontSize: 'var(--step--1)', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Kos yang dikelola pemilik ini di KoBo.
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
