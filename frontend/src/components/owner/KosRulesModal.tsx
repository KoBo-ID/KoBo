import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Notice } from '../ui/Notice';
import { useAppStore } from '../../store/AppContext';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';

const MAX_GROUPS = 10;

interface Group {
  categoryTitle: string;
  linesText: string;
  fine: string;
  clause: string;
}

const emptyGroup = (): Group => ({ categoryTitle: '', linesText: '', fine: '', clause: '' });
const linesOf = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);

interface KosRulesModalProps {
  kosId: string;
  kosName: string;
  onClose: () => void;
}

export const KosRulesModal: React.FC<KosRulesModalProps> = ({ kosId, kosName, onClose }) => {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { addToast } = useAppStore();
  const detail = useQuery(trpc.kos.detail.queryOptions({ id: kosId }));
  const save = useMutation(trpc.owner.rules.set.mutationOptions());
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialise once, when the current rules first arrive; later refetches must not overwrite edits.
  useEffect(() => {
    if (groups !== null || !detail.data) return;
    setGroups(
      detail.data.rules.map((r) => ({
        categoryTitle: r.categoryTitle,
        linesText: r.rules.join('\n'),
        fine: r.penaltyAmount === null ? '' : String(r.penaltyAmount),
        clause: r.penaltyClause ?? '',
      })),
    );
  }, [detail.data, groups]);

  const list = groups ?? [];
  const update = (index: number, patch: Partial<Group>) => setGroups((prev) => (prev ?? []).map((g, i) => (i === index ? { ...g, ...patch } : g)));

  const onSave = async () => {
    setError(null);
    if (list.some((g) => !g.categoryTitle.trim() || linesOf(g.linesText).length === 0)) {
      setError('Isi judul dan minimal satu aturan di setiap kelompok.');
      return;
    }
    try {
      await save.mutateAsync({
        kosId,
        groups: list.map((g) => ({
          categoryTitle: g.categoryTitle.trim(),
          rules: linesOf(g.linesText),
          ...(g.fine.trim() ? { penaltyAmount: Number(g.fine) } : {}),
          ...(g.clause.trim() ? { penaltyClause: g.clause.trim() } : {}),
        })),
      });
      addToast('Tata tertib disimpan.', 'success');
      void qc.invalidateQueries({ queryKey: trpc.owner.pathKey() });
      void qc.invalidateQueries({ queryKey: trpc.kos.pathKey() });
      onClose();
    } catch (err) {
      setError(messageForError(err));
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Tata Tertib" subtitle={kosName} maxWidth="lg">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Kelompok aturan ini tampil di halaman kos. Calon penyewa membacanya sebelum mengajukan sewa.
        </p>
        {detail.isPending && <p role="status" style={{ color: 'var(--text-muted)' }}>Memuat tata tertib…</p>}
        {detail.isError && <Notice tone="error">Gagal memuat tata tertib. Tutup lalu buka kembali.</Notice>}
        {groups !== null && list.length === 0 && <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1rem 0' }}>Belum ada tata tertib.</p>}

        {list.map((g, i) => (
          <fieldset key={i} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.75rem', minWidth: 0 }}>
            <legend style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', padding: '0 0.35rem' }}>Kelompok {i + 1}</legend>
            <Input label="Judul kelompok" id={`rules-title-${i}`} value={g.categoryTitle} maxLength={60} onChange={(e) => update(i, { categoryTitle: e.target.value })} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label htmlFor={`rules-lines-${i}`} style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>Aturan (satu per baris)</label>
              <textarea
                id={`rules-lines-${i}`}
                value={g.linesText}
                rows={4}
                onChange={(e) => update(i, { linesText: e.target.value })}
                style={{ resize: 'vertical', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-strong)', padding: '0.75rem', backgroundColor: 'var(--bg-surface)', color: 'var(--text-main)', font: 'inherit' }}
              />
            </div>
            <Input label="Denda (Rp)" id={`rules-fine-${i}`} type="number" inputMode="numeric" min={0} max={10000000} value={g.fine} onChange={(e) => update(i, { fine: e.target.value })} />
            <Input label="Klausul denda (opsional)" id={`rules-clause-${i}`} value={g.clause} maxLength={300} onChange={(e) => update(i, { clause: e.target.value })} />
            <div>
              <Button variant="ghost" size="sm" icon={<Trash2 size={15} />} onClick={() => setGroups((prev) => (prev ?? []).filter((_, j) => j !== i))}>
                Hapus kelompok
              </Button>
            </div>
          </fieldset>
        ))}

        {groups !== null && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
            <Button variant="ghost" size="sm" icon={<Plus size={15} />} disabled={list.length >= MAX_GROUPS} onClick={() => setGroups((prev) => [...(prev ?? []), emptyGroup()])}>
              Tambah kelompok aturan
            </Button>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{list.length} dari {MAX_GROUPS} kelompok</span>
          </div>
        )}

        {error && <Notice tone="error">{error}</Notice>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" size="sm" disabled={groups === null || save.isPending} onClick={() => void onSave()}>
            Simpan tata tertib
          </Button>
        </div>
      </div>
    </Modal>
  );
};
