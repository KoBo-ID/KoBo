import React from 'react';
import { Link } from 'react-router-dom';
import { Plus, Check } from 'lucide-react';
import type { KosCandidate } from '@kobo/shared/types';
import { Button } from '../ui/Button';
import { formatRupiah } from '../../lib/format';
import '../../styles/matching.css';
import '../../styles/matching-chat.css';

/**
 * A kos near the middle of both budgets and anchors. Props: `candidate` (KosCandidate); `onAdd` runs when Tambah is pressed;
 * `adding` shows the busy state; `disabled` blocks Tambah (frozen connection or another add in flight).
 * The price says what it counts ("per kamar" or "per orang"); capacity is "Bisa berdua" or "Kapasitas belum diketahui".
 */
export const KosCandidateCard: React.FC<{ candidate: KosCandidate; onAdd: (kosId: string) => void; adding: boolean; disabled: boolean }> = ({
  candidate: c,
  onAdd,
  adding,
  disabled,
}) => (
  <li className="mt-card mc-kos">
    <div className="mt-card__top">
      <div style={{ minWidth: 0 }}>
        <Link to={`/kos/${c.kosId}`} className="mt-card__name mc-link">{c.name}</Link>
        <div className="mt-card__sub">{c.district}, {c.city}</div>
      </div>
      <strong className="mc-price">
        {formatRupiah(c.price)}
        <span className="mt-small mt-muted"> {c.priceUnit === 'PER_ORANG' ? '/ orang / bulan' : '/ kamar / bulan'}</span>
      </strong>
    </div>
    <p className="mt-help">
      {c.status === 'SHAREABLE' ? 'Bisa berdua' : 'Kapasitas belum diketahui · Tanyakan pemilik'}
    </p>
    <div className="mt-row">
      {c.inShortlist ? (
        <span className="mc-tag" data-tone="ok"><Check size={12} aria-hidden="true" /> Sudah di daftar</span>
      ) : (
        <Button size="sm" variant="outline" icon={<Plus size={14} />} isLoading={adding} disabled={disabled || adding} onClick={() => onAdd(c.kosId)}>
          Tambah
        </Button>
      )}
    </div>
  </li>
);
