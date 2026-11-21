import React, { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Send } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { containsContactInfo } from '@kobo/shared/domain';
import type { MatchCandidate } from '@kobo/shared/types';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { useTRPC } from '../../lib/trpc';
import { CONTACT_MESSAGE, MATCH_BASE, refusalMessage, useInvalidateMatching, useMatchingProfile } from '../../lib/matching';
import '../../styles/matching.css';

const MAX = 300;

/**
 * Sends (or reflects the state of) a roommate request to one candidate.
 * Prop: `candidate` is a `MatchCandidate` from discover or detail; its `relation` decides what shows:
 * NONE -> "Ajak jadi teman sekamar" opens an inline composer (optional intro up to 300 characters with a live counter, contact info
 * refused client-side) and shows the server's refusal inline (cooldown, caps, 24 h rule); REQUEST_SENT -> status plus "Batalkan";
 * REQUEST_RECEIVED -> link to Permintaan; CONNECTED -> link to the chat. Refreshes all matching queries after a change.
 */
export const RequestButton: React.FC<{ candidate: MatchCandidate }> = ({ candidate }) => {
  const trpc = useTRPC();
  const profile = useMatchingProfile();
  const invalidate = useInvalidateMatching();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fieldId = useId();

  const send = useMutation({
    ...trpc.matching.request.send.mutationOptions(),
    onSuccess: () => { setDone(true); setOpen(false); setError(null); void invalidate(); },
    onError: (e) => setError(refusalMessage(e)),
  });
  const cancel = useMutation({
    ...trpc.matching.request.cancel.mutationOptions(),
    onSuccess: () => { setDone(false); void invalidate(); },
    onError: (e) => setError(refusalMessage(e)),
  });

  const mine = profile.data;
  const young = !!mine && !mine.canSendRequests;
  const inactive = !mine || !mine.active || !!mine.pausedAt;

  if (candidate.relation === 'CONNECTED') {
    return candidate.connectionId
      ? <Link to={`${MATCH_BASE}/pesan/${candidate.connectionId}`}><Button variant="primary" size="md">Buka obrolan</Button></Link>
      : <Notice tone="success">Kalian sudah terhubung.</Notice>;
  }
  if (candidate.relation === 'REQUEST_RECEIVED') {
    return (
      <div className="mt-stack">
        <p className="mt-help">{candidate.displayName} sudah mengajakmu. Jawab di halaman Permintaan.</p>
        <div><Link to={`${MATCH_BASE}/permintaan`}><Button variant="primary" size="md">Lihat permintaan</Button></Link></div>
      </div>
    );
  }
  if (candidate.relation === 'REQUEST_SENT' || done) {
    const id = candidate.requestId;
    return (
      <div className="mt-stack">
        <Notice tone="success">
          <Check size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> Permintaan terkirim. Kedaluwarsa dalam 14 hari jika belum dijawab.
        </Notice>
        {error && <Notice tone="error">{error}</Notice>}
        {id && <div><Button variant="outline" size="sm" isLoading={cancel.isPending} onClick={() => { setError(null); cancel.mutate({ requestId: id }); }}>Batalkan permintaan</Button></div>}
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = message.trim();
    if (text && containsContactInfo(text)) { setError(CONTACT_MESSAGE); return; }
    setError(null);
    send.mutate({ profileId: candidate.profileId, ...(text ? { message: text } : {}) });
  };

  if (!open) {
    return (
      <div className="mt-stack">
        {young && <p className="mt-help">Profilmu baru bisa mengirim permintaan 24 jam setelah dibuat. Sementara itu kamu tetap bisa menerima ajakan.</p>}
        {inactive && !young && <p className="mt-help">Aktifkan profilmu dulu untuk mengirim permintaan.</p>}
        <div><Button variant="primary" size="md" icon={<Send size={16} />} disabled={profile.isPending || young || inactive} onClick={() => setOpen(true)}>Ajak jadi teman sekamar</Button></div>
      </div>
    );
  }

  return (
    <form className="mt-stack" onSubmit={submit} noValidate>
      <div className="mt-field">
        <label htmlFor={fieldId}>Pesan perkenalan (opsional)</label>
        <textarea
          id={fieldId}
          className="mt-textarea"
          value={message}
          maxLength={MAX}
          placeholder="Halo, aku jurusan ... dan cari kos dekat kampus. Boleh kenalan?"
          aria-invalid={error ? true : undefined}
          aria-describedby={`${fieldId}-count`}
          onChange={(e) => { setMessage(e.target.value); if (error) setError(null); }}
        />
        <span id={`${fieldId}-count`} className="mt-counter">{message.length}/{MAX}</span>
        <span className="mt-help">Jangan tulis nomor, email, atau tautan. Berbagi kontak lebih aman setelah permintaan diterima, lewat obrolan KoBo.</span>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="mt-row">
        <Button type="submit" variant="primary" size="md" isLoading={send.isPending}>Kirim permintaan</Button>
        <Button type="button" variant="ghost" size="md" disabled={send.isPending} onClick={() => { setOpen(false); setError(null); }}>Batal</Button>
      </div>
    </form>
  );
};
