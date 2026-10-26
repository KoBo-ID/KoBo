import React, { useState } from 'react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { Kos } from '../types';
import { VisitModal } from '../components/booking/VisitModal';
import { Hero } from '../components/home/Hero';
import { FeaturedKos } from '../components/home/FeaturedKos';
import { WhyRows } from '../components/home/WhyRows';
import { OwnerCta } from '../components/home/OwnerCta';

export const Home: React.FC = () => {
  useDocumentTitle('KoBo');
  const [selectedVisitKos, setSelectedVisitKos] = useState<Kos | null>(null);

  return (
    <>
    <div className="landing-backdrop" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--section-gap) * 1.5)' }}>
      <Hero />
      <FeaturedKos onOpenSurvey={setSelectedVisitKos} />
      <WhyRows />
      <OwnerCta />
    </div>

      {/* Free Visit Modal (outside the backdrop's stacking context) */}
      {selectedVisitKos && (
        <VisitModal
          isOpen={!!selectedVisitKos}
          onClose={() => setSelectedVisitKos(null)}
          kos={selectedVisitKos}
        />
      )}
    </>
  );
};
