import React from 'react';
import { Pencil } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { Skeleton } from '../ui/Skeleton';
import { useTRPC } from '../../lib/trpc';
import { formatRupiah } from '../../lib/ownerWorkspace';

/**
 * Tata tertib & denda on Kelola properti: what renters read before applying, with the one place to change it.
 * Reads the same kos.detail query the public page and the rules editor use.
 */
export const RulesCard: React.FC<{ kosId: string; onEdit: () => void }> = ({ kosId, onEdit }) => {
  const trpc = useTRPC();
  const detail = useQuery(trpc.kos.detail.queryOptions({ id: kosId }));
  const rules = detail.data?.rules ?? [];

  return (
    <section className="os-card" aria-labelledby="owner-rules-title">
      <div className="os-card__head">
        <h2 id="owner-rules-title" className="os-card__title">
          Tata tertib dan denda {detail.isSuccess && <span>{rules.length} kelompok</span>}
        </h2>
        <Button variant="outline" size="sm" icon={<Pencil size={14} />} onClick={onEdit}>
          {rules.length > 0 ? 'Ubah tata tertib' : 'Isi tata tertib'}
        </Button>
      </div>

      {detail.isPending && <Skeleton width="60%" height="1rem" />}
      {detail.isError && <Notice tone="error">Gagal memuat tata tertib.</Notice>}
      {detail.isSuccess && rules.length === 0 && (
        <p className="os-card__hint">Belum ada tata tertib. Calon penyewa membacanya di halaman kos sebelum mengajukan sewa, jadi isi aturan dan denda di sini.</p>
      )}
      {rules.length > 0 && (
        <ul className="rules-card__list">
          {rules.map((rule) => (
            <li key={rule.id} className="rules-card__row">
              <span className="rules-card__title">{rule.categoryTitle}</span>
              <span className="rules-card__count">{rule.rules.length} aturan</span>
              <span className="rules-card__fine">{rule.penaltyAmount != null ? `Denda ${formatRupiah(rule.penaltyAmount)}` : 'Tanpa denda'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
