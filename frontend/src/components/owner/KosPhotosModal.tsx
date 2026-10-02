import React, { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { useAppStore } from '../../store/AppContext';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';
import { putToStorage, resizeVariants, UploadError } from '../../lib/imageUpload';

interface KosPhotosModalProps {
  kosId: string;
  kosName: string;
  onClose: () => void;
}

export const KosPhotosModal: React.FC<KosPhotosModalProps> = ({ kosId, kosName, onClose }) => {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { addToast } = useAppStore();
  const images = useQuery(trpc.owner.images.queryOptions({ kosId }));
  const presign = useMutation(trpc.owner.image.presign.mutationOptions());
  const confirm = useMutation(trpc.owner.image.confirm.mutationOptions());
  const remove = useMutation(trpc.owner.image.delete.mutationOptions());
  const reorder = useMutation(trpc.owner.image.reorder.mutationOptions());
  const fileInput = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = images.data ?? [];

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: trpc.owner.images.queryKey({ kosId }) });
    void qc.invalidateQueries({ queryKey: trpc.owner.myKos.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.kos.pathKey() });
  };

  const uploadOne = async (file: File, order: number, label: string) => {
    setProgress(`${label}: mengecilkan foto…`);
    const variants = await resizeVariants(file);
    // Both variants share one uuid so deleting the photo can remove the sibling too. The largest is the one shown.
    const baseId = crypto.randomUUID();
    let largestKey = '';
    for (const [i, v] of variants.entries()) {
      setProgress(`${label}: mengunggah ${i + 1} dari ${variants.length}…`);
      const p = await presign.mutateAsync({ kosId, contentType: v.contentType, contentLength: v.blob.size, width: v.width, baseId });
      await putToStorage(p.url, p.headers, v.blob);
      largestKey = p.key;
    }
    const largest = variants[variants.length - 1];
    setProgress(`${label}: menyimpan…`);
    await confirm.mutateAsync({ kosId, key: largestKey, width: largest.width, height: largest.height, order });
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setError(null);
    let order = list.length;
    let uploaded = 0;
    try {
      for (const [i, file] of files.entries()) {
        await uploadOne(file, order++, `Foto ${i + 1}/${files.length}`);
        uploaded++;
      }
    } catch (err) {
      setError(err instanceof UploadError ? err.message : messageForError(err));
    } finally {
      setProgress(null);
      if (uploaded > 0) {
        addToast(uploaded === 1 ? 'Foto berhasil ditambahkan.' : `${uploaded} foto berhasil ditambahkan.`, 'success');
        await refresh();
      }
    }
  };

  const act = async (job: () => Promise<unknown>, ok: string) => {
    setError(null);
    try {
      await job();
      addToast(ok, 'success');
    } catch (err) {
      setError(messageForError(err));
    } finally {
      await refresh();
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    const ids = list.map((i) => i.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void act(() => reorder.mutateAsync({ kosId, imageIds: ids }), 'Urutan foto diperbarui.');
  };

  const busy = progress !== null || remove.isPending || reorder.isPending;

  return (
    <Modal isOpen onClose={onClose} title="Foto Kos" subtitle={kosName} maxWidth="lg">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Foto pertama menjadi foto utama. Foto dikecilkan otomatis di browser Anda sebelum diunggah.
          </p>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            hidden
            data-testid="photo-input"
            aria-label="Pilih foto kos"
            onChange={(e) => void onPick(e)}
          />
          <Button variant="primary" size="sm" disabled={busy} icon={<ImagePlus size={15} />} onClick={() => fileInput.current?.click()}>
            Tambah Foto
          </Button>
        </div>

        {progress && (
          <p role="status" style={{ fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 600 }}>
            {progress}
          </p>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        {images.isPending && <p role="status" style={{ color: 'var(--text-muted)' }}>Memuat foto…</p>}
        {images.isError && <Notice tone="error">Gagal memuat foto. Tutup lalu buka kembali.</Notice>}
        {images.isSuccess && list.length === 0 && <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem 0' }}>Belum ada foto.</p>}

        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '0.85rem' }}>
          {list.map((img, i) => (
            <li key={img.id} data-testid="kos-photo" style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden', backgroundColor: 'var(--bg-surface)' }}>
              <img src={img.url} alt={`Foto ${i + 1} ${kosName}`} loading="lazy" style={{ width: '100%', height: '110px', objectFit: 'cover', display: 'block' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0.5rem', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: i === 0 ? 'var(--primary)' : 'var(--text-muted)' }}>{i === 0 ? 'Utama' : `#${i + 1}`}</span>
                <span style={{ display: 'flex', gap: '0.15rem' }}>
                  <button type="button" aria-label={`Naikkan foto ${i + 1}`} disabled={busy || i === 0} onClick={() => move(i, -1)} style={{ padding: '0.25rem', cursor: 'pointer' }}>
                    <ArrowUp size={14} />
                  </button>
                  <button type="button" aria-label={`Turunkan foto ${i + 1}`} disabled={busy || i === list.length - 1} onClick={() => move(i, 1)} style={{ padding: '0.25rem', cursor: 'pointer' }}>
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Hapus foto ${i + 1}`}
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('Hapus foto ini?')) void act(() => remove.mutateAsync({ kosId, imageId: img.id }), 'Foto dihapus.');
                    }}
                    style={{ padding: '0.25rem', cursor: 'pointer', color: 'var(--status-overdue)' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Selesai
          </Button>
        </div>
      </div>
    </Modal>
  );
};
