import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Kos } from '../../types';
import { ListingCard } from '../kos/ListingCard';
import { KosCardSkeleton } from '../kos/KosCardSkeleton';
import { Button } from '../ui/Button';
import { useTRPC } from '../../lib/trpc';
import { useReveal } from '../../hooks/useReveal';
import { kosCardToKos } from '../../utils/kosCard';

interface FeaturedKosProps {
  onOpenSurvey: (kos: Kos) => void;
}

export const FeaturedKos: React.FC<FeaturedKosProps> = ({ onOpenSurvey }) => {
  const trpc = useTRPC();
  const headRef = useReveal<HTMLDivElement>();
  const { data, isPending, isError, refetch } = useQuery(trpc.kos.list.queryOptions());
  const kosList = React.useMemo(() => (data ?? []).map(kosCardToKos), [data]);
  // One full row of 4 on desktop; a 5th card would sit orphaned on row two.
  // One kos per city first, so the row shows KoBo's spread rather than four
  // listings from the same neighbourhood; falls back to list order when there
  // are fewer than four cities.
  const featuredKos = React.useMemo(() => {
    const seen = new Set<string>();
    const spread = kosList.filter((k) => !seen.has(k.city) && seen.add(k.city));
    return [...spread, ...kosList.filter((k) => !spread.includes(k))].slice(0, 4);
  }, [kosList]);
  return (
        <section className="app-container">
          <div ref={headRef} className="featured-head rise">
            <h2 className="featured-head__title">Kos yang bisa Anda survey</h2>
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
              <span>Gagal memuat daftar kos. Periksa koneksi Anda lalu coba lagi.</span>
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
