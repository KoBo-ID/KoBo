import React from 'react';
import { Link } from 'react-router-dom';
import { useReveal } from '../../hooks/useReveal';
import { Building2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { OwnerBoardPreview } from './OwnerBoardPreview';

const ACTIONS = [
  'Setujui atau tolak pengajuan sewa dari calon penghuni.',
  'Lihat status tiap kamar: lunas, jatuh tempo, menunggak, kosong, atau booking.',
  'Kirim pesan WhatsApp yang sudah tersusun dan cetak kuitansi digital.',
];

export const OwnerCta: React.FC = () => {
  const ref = useReveal<HTMLDivElement>();
  return (
  <section className="owner-cta" aria-labelledby="owner-cta-title">
    <div ref={ref} className="app-container owner-cta__inner">
      <div className="owner-cta__copy rise">
        <h2 id="owner-cta-title" className="owner-cta__title">Kelola kamar dan pengajuan dari satu papan.</h2>
        <ul className="owner-cta__list">
          {ACTIONS.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        <Link to="/owner/login" style={{ textDecoration: 'none', alignSelf: 'flex-start' }}>
          <Button variant="primary" size="lg" icon={<Building2 size={18} />}>
            Masuk Portal Pemilik
          </Button>
        </Link>
      </div>
      <div className="owner-cta__visual rise" style={{ transitionDelay: 'var(--stagger)' }}>
        <OwnerBoardPreview />
      </div>
    </div>
  </section>
  );
};
