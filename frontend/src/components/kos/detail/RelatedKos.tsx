import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../../lib/trpc';
import { kosCardToKos } from '../../../utils/kosCard';
import { ListingCard } from '../ListingCard';

/** Up to three other kos: same campus first, then same city. Reuses the cached kos.list the Home page also reads. */
export const RelatedKos: React.FC<{ kosId: string; campusId: string; city: string; campusName: string }> = ({ kosId, campusId, city, campusName }) => {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.kos.list.queryOptions());
  const headingId = React.useId();
  const others = (data ?? []).filter((card) => card.id !== kosId);
  const rank = (card: (typeof others)[number]) => (campusId && card.nearestCampusId === campusId ? 0 : card.city === city ? 1 : 2);
  const picks = others.filter((card) => rank(card) < 2).sort((a, b) => rank(a) - rank(b)).slice(0, 3);
  if (picks.length === 0) return null;
  return (
    <section aria-labelledby={headingId}>
      <div className="section-head">
        <h3 id={headingId} className="section-title">{campusName ? `Kos lain dekat ${campusName}` : 'Kos lain di sekitar'}</h3>
      </div>
      <div className="detail-related">
        {picks.map((card) => <ListingCard key={card.id} kos={kosCardToKos(card)} />)}
      </div>
    </section>
  );
};
