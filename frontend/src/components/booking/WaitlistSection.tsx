import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Hourglass } from 'lucide-react';
import { Button } from '../ui/Button';
import { OfferBanner } from '../kos/detail/WaitlistBox';
import { useMyWaitlist, roomTypeLabel, useWaitlistActions, WAITLIST_STATUS_LABEL } from '../../lib/waitlist';

/** "Daftar Tunggu" on /my-kos: live entries first (an offer shows its banner), the history folded away. */
export const WaitlistSection: React.FC = () => {
  const navigate = useNavigate();
  const mine = useMyWaitlist();
  const { leave, busy } = useWaitlistActions();
  const entries = mine.data ?? [];
  const live = entries.filter((e) => e.status === 'WAITING' || e.status === 'OFFERED');
  const history = entries.filter((e) => e.status !== 'WAITING' && e.status !== 'OFFERED');
  if (live.length === 0 && history.length === 0) return null;

  return (
    <section aria-labelledby="waitlist-title" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h2 id="waitlist-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.15rem', fontWeight: 700 }}>
        <Hourglass size={18} color="var(--primary)" aria-hidden="true" />
        Daftar Tunggu
      </h2>

      {live.map((e) => (
        <div
          key={e.id}
          data-testid="waitlist-entry"
          style={{ backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-card)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-xs)', padding: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
              {e.kos.image && <img src={e.kos.image} alt={e.kos.name} style={{ width: 56, height: 56, borderRadius: 'var(--radius-md)', objectFit: 'cover', flexShrink: 0 }} />}
              <div>
                <Link to={`/kos/${e.kos.id}`} style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  {e.kos.name}
                </Link>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  {roomTypeLabel(e.roomType)}
                  {e.status === 'WAITING' && (
                    <>
                      {' · '}
                      <strong style={{ color: 'var(--primary)' }}>Antrean #{e.position}</strong>
                    </>
                  )}
                </p>
              </div>
            </div>
            {e.status === 'WAITING' && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void leave(e.id)}>
                Keluar antrean
              </Button>
            )}
          </div>
          {e.status === 'OFFERED' && <OfferBanner entry={e} onBook={(roomId) => navigate(`/checkout/${e.kos.id}?room=${roomId}&duration=1`)} />}
        </div>
      ))}

      {history.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>Riwayat daftar tunggu ({history.length})</summary>
          <ul style={{ listStyle: 'none', margin: '0.6rem 0 0', padding: 0, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-card)', backgroundColor: 'var(--bg-surface)' }}>
            {history.map((e, i) => (
              <li key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', padding: '0.7rem 1rem', fontSize: '0.85rem', borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)' }}>
                <span>
                  <strong>{e.kos.name}</strong> · {roomTypeLabel(e.roomType)}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>{WAITLIST_STATUS_LABEL[e.status]}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
};
