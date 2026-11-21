import React, { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Trash2 } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { ErrorState } from '../ui/QueryState';
import { Notice } from '../ui/Notice';
import { Skeleton } from '../ui/Skeleton';
import { MatchEmptyState } from './EmptyState';
import { useTRPC } from '../../lib/trpc';
import { formatRupiah } from '../../lib/format';
import { messageForError } from '../../lib/errors';
import { refusalMessage, useInvalidateMatching } from '../../lib/matching';
import '../../styles/matching.css';
import '../../styles/matching-chat.css';

/**
 * The shared kos shortlist of a connection. Props: `connectionId`; `live` is false once the connection ended or a block froze it
 * (then entries stay readable and a frozen notice replaces the remove buttons).
 * "Lamar kos ini" links to the kos page, where each student applies on their own. Because the application form
 * (Checkout) does not take a prefilled note, the optional note from `applicationNoteFor` is shown for copying after a consent tick.
 */
export const ShortlistPanel: React.FC<{ connectionId: string; live: boolean }> = ({ connectionId, live }) => {
  const trpc = useTRPC();
  const invalidate = useInvalidateMatching();
  const list = useQuery({ ...trpc.matching.shortlist.list.queryOptions({ connectionId }), retry: false });
  const [consent, setConsent] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consentId = useId();
  const note = useQuery({ ...trpc.matching.shortlist.applicationNoteFor.queryOptions({ connectionId }), enabled: consent, retry: false });
  const remove = useMutation({
    ...trpc.matching.shortlist.remove.mutationOptions(),
    onSuccess: () => { setError(null); void invalidate(); },
    onError: (e) => setError(refusalMessage(e)),
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (list.isPending) return <div className="mt-stack" aria-busy="true" aria-label="Memuat daftar kos"><Skeleton height="5rem" borderRadius="var(--radius-lg)" /></div>;
  if (list.isError) return <ErrorState message={messageForError(list.error)} onRetry={() => void list.refetch()} minHeight="8rem" />;
  const entries = list.data;

  return (
    <div className="mt-stack">
      {!live && <Notice tone="error">Koneksi ini sudah berakhir, jadi daftar kos dibekukan. Kamu masih bisa melihatnya, tapi tidak mengubahnya.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {entries.length === 0 ? (
        <MatchEmptyState title="Daftar kos bersama masih kosong">
          {live ? 'Tambahkan kos dari saran di bawah. Kalian berdua bisa melihat dan mengubah daftar ini.' : 'Tidak ada kos di daftar ini.'}
        </MatchEmptyState>
      ) : (
        <ul className="mc-reqlist">
          {entries.map((e) => (
            <li key={e.kosId} className="mt-card mc-kos">
              <div className="mt-card__top">
                <div style={{ minWidth: 0 }}>
                  <Link to={`/kos/${e.kosId}`} className="mt-card__name mc-link">{e.name}</Link>
                  <div className="mt-card__sub">{e.district}, {e.city} · mulai {formatRupiah(e.priceFrom)} / kamar</div>
                </div>
              </div>
              <p className="mt-help">Ditambahkan oleh {e.addedBy}</p>
              <div className="mt-row">
                <Link to={`/kos/${e.kosId}`}><Button size="sm" variant="primary">Lamar kos ini</Button></Link>
                {live && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 size={14} />}
                    disabled={remove.isPending}
                    onClick={() => { setError(null); remove.mutate({ connectionId, kosId: e.kosId }); }}
                    aria-label={`Hapus ${e.name} dari daftar`}
                  >
                    Hapus
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-help">Setiap mahasiswa melamar sendiri; pemilik memutuskan tiap pelamar.</p>

      {entries.length > 0 && (
        <div className="mt-card mt-stack">
          <label htmlFor={consentId} className="mc-consent">
            <input id={consentId} type="checkbox" checked={consent} onChange={(e) => { setConsent(e.target.checked); setCopied(false); }} />
            <span>Sertakan nama calon teman sekamar di catatan lamaranku. Pemilik kos akan membacanya.</span>
          </label>
          {consent && note.isPending && <Skeleton height="2.5rem" />}
          {consent && note.isError && <Notice tone="error">{messageForError(note.error)}</Notice>}
          {consent && note.data && (
            <div className="mt-stack">
              <p className="mc-quote" data-testid="application-note">{note.data.note}</p>
              <div className="mt-row">
                <Button size="sm" variant="outline" icon={<Copy size={14} />} onClick={() => void copy(note.data.note)}>Salin catatan</Button>
                <span className="mt-help" role="status">{copied ? 'Tersalin. Tempel di kolom catatan saat melamar.' : 'Tempel di kolom catatan saat melamar.'}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
