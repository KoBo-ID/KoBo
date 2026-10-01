import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Kos } from '../../types';
import { ListingCard } from '../kos/ListingCard';
import { Button } from '../ui/Button';

interface FeaturedKosProps {
  kosList: Kos[];
  onOpenSurvey: (kos: Kos) => void;
}

export const FeaturedKos: React.FC<FeaturedKosProps> = ({ kosList, onOpenSurvey }) => {
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
                Lihat Semua ({kosList.length})
              </Button>
            </Link>
          </div>
  
          <div className="kobo-featured-grid">
            {featuredKos.map((kos) => (
              <ListingCard
                key={kos.id}
                kos={kos}
                onOpenSurvey={onOpenSurvey}
              />
            ))}
          </div>
        </section>
  );
};
