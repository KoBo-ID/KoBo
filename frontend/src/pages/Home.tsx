import React, { useState } from 'react';
import { Kos } from '../types';
import { VisitModal } from '../components/booking/VisitModal';
import { Hero } from '../components/home/Hero';
import { WhyKobo } from '../components/home/WhyKobo';
import { FeaturedKos } from '../components/home/FeaturedKos';
import { OwnerCta } from '../components/home/OwnerCta';

export const Home: React.FC = () => {
  const [selectedVisitKos, setSelectedVisitKos] = useState<Kos | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--section-gap)' }}>
      <Hero />
      <WhyKobo />
      <FeaturedKos onOpenSurvey={setSelectedVisitKos} />
      <OwnerCta />

      {/* Free Visit Modal */}
      {selectedVisitKos && (
        <VisitModal
          isOpen={!!selectedVisitKos}
          onClose={() => setSelectedVisitKos(null)}
          kos={selectedVisitKos}
        />
      )}
    </div>
  );
};
