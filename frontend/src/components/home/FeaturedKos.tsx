import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Kos } from '../../types';
import { ListingCard } from '../kos/ListingCard';
import { KosCardSkeleton } from '../kos/KosCardSkeleton';
import { Button } from '../ui/Button';
import { useTRPC } from '../../lib/trpc';
import { kosCardToKos } from '../../utils/kosCard';

interface FeaturedKosProps {
  onOpenSurvey: (kos: Kos) => void;
}

export const FeaturedKos: React.FC<FeaturedKosProps> = ({ onOpenSurvey }) => {
  const trpc = useTRPC();
  const { data, isPending, isError, refetch } = useQuery(trpc.kos.list.queryOptions());
  const kosList = React.useMemo(() => (data ?? []).map(kosCardToKos), [data]);
  // One full row of 4 on desktop; a 5th card would sit orphaned on row two.
  const featuredKos = kosList.slice(0, 4);
  return (
        <section className="app-container">
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '2rem' }}>
            <div>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Pilihan Terverifikasi
              </span>
              <h2 style={{ fontSize: '1.8rem', fontWeight: 800, letterSpacing: '-0.02em', marginTop: '0.2rem' }}>
                Rekomendasi Kos Terpopuler
              </h2>
            </div>
            <Link to="/search">
              <Button variant="outline" size="sm" icon={<ArrowRight size={16} />} iconPosition="right">
                {data ? `Lihat Semua (${kosList.length})` : 'Lihat Semua'}
              </Button>
            </Link>
          </div>

          {isError ? (
            <div
              role="alert"
              style={{
                minHeight: '20rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1rem',
                textAlign: 'center',
                color: 'var(--text-muted)',
              }}
            >
              <span>Gagal memuat rekomendasi kos. Periksa koneksi Anda lalu coba lagi.</span>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Coba Lagi
              </Button>
            </div>
          ) : (
            <div className="kobo-featured-grid" aria-busy={isPending}>
              {isPending
                ? [0, 1, 2, 3].map((i) => <KosCardSkeleton key={i} />)
                : featuredKos.map((kos) => (
                    <ListingCard key={kos.id} kos={kos} onOpenSurvey={onOpenSurvey} />
                  ))}
            </div>
          )}
        </section>
  );
};
