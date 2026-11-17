import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, FileCheck2, PhoneCall } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Notice } from '../ui/Notice';
import { useAppStore } from '../../store/AppContext';
import { useSession } from '../../lib/session';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';

const card: React.CSSProperties = {
  backgroundColor: 'var(--bg-surface)',
  borderRadius: 'var(--radius-lg)',
  border: '1px solid var(--border-subtle)',
  padding: '1.25rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
};
const heading = (icon: React.ReactNode, text: string) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
    {icon}
    <h4 style={{ fontSize: '1rem', fontWeight: 700 }}>{text}</h4>
  </div>
);
const hint: React.CSSProperties = { fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 };
const PHONE = /^\+?[0-9][0-9 ()-]{7,18}$/;

/** Emergency contact (required before a first application) with the consent that lets KoBo message them about a late payment. */
export const EmergencyContactCard: React.FC = () => {
  const { me } = useSession();
  const { addToast } = useAppStore();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const save = useMutation(trpc.auth.updateEmergencyContact.mutationOptions());
  const clear = useMutation(trpc.auth.clearEmergencyContact.mutationOptions());
  const saved = me?.emergencyContact ?? null;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });

  const start = () => {
    setName(saved?.name ?? '');
    setRelation(saved?.relation ?? '');
    setPhone(saved?.phone ?? '');
    setConsent(false);
    setError(null);
    setEditing(true);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!PHONE.test(phone.trim())) return setError('Isi nomor telepon dengan angka, misalnya 0812 3456 7890.');
    if (!consent) return setError('Centang persetujuan agar kontak darurat dapat dihubungi.');
    setError(null);
    try {
      await save.mutateAsync({ name, relation, phone: phone.trim(), consent: true });
      await refresh();
      addToast('Kontak darurat disimpan.', 'success');
      setEditing(false);
    } catch (err) {
      setError(messageForError(err));
    }
  };

  return (
    <div style={card} data-testid="emergency-contact-card">
      {heading(<PhoneCall size={18} color="var(--primary)" />, 'Kontak darurat')}
      {!editing && saved && (
        <>
          <p style={hint}>
            <strong style={{ color: 'var(--text-main)' }}>{saved.name}</strong> ({saved.relation}), {saved.phone}. Dihubungi lewat WhatsApp hanya jika pembayaran sewa Anda terlambat lebih dari 7 hari.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button variant="outline" size="sm" onClick={start}>Ubah</Button>
            <Button variant="ghost" size="sm" isLoading={clear.isPending} onClick={async () => { await clear.mutateAsync(); await refresh(); addToast('Kontak darurat dan persetujuannya dihapus.', 'info'); }}>Hapus dan cabut izin</Button>
          </div>
        </>
      )}
      {!editing && !saved && (
        <>
          <p style={hint}>Wajib diisi sebelum Anda mengajukan sewa pertama. Pemilik kos baru melihatnya setelah pengajuan Anda disetujui.</p>
          <div><Button variant="primary" size="sm" onClick={start}>Isi kontak darurat</Button></div>
        </>
      )}
      {editing && (
        <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <Input label="Nama" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required />
          <Input label="Hubungan" value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="Ibu, Ayah, Kakak" autoComplete="off" required />
          <Input label="Nomor WhatsApp" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0812 3456 7890" autoComplete="off" required />
          <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.8125rem', lineHeight: 1.5, color: 'var(--text-main)' }}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: '0.2rem' }} />
            <span>
              Saya sudah memberi tahu orang ini dan setuju KoBo menghubunginya lewat WhatsApp bila pembayaran sewa saya terlambat lebih dari 7 hari. Pesannya memuat nama saya dan permintaan menghubungi pemilik kos, tanpa jumlah tagihan. Saya dapat mencabut izin kapan saja. Lihat <Link to="/privasi" style={{ color: 'var(--primary)', fontWeight: 600 }}>Kebijakan Privasi</Link>.
            </span>
          </label>
          {error && <Notice tone="error">{error}</Notice>}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>Batal</Button>
            <Button type="submit" variant="primary" size="sm" isLoading={save.isPending}>Simpan</Button>
          </div>
        </form>
      )}
    </div>
  );
};

/** Reminders to the student themselves, and the terms version they agreed to. */
export const RemindersAndTermsCard: React.FC = () => {
  const { me } = useSession();
  const { addToast } = useAppStore();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const pref = useMutation(trpc.auth.setNotifyOptOut.mutationOptions());
  const accept = useMutation(trpc.auth.acceptTerms.mutationOptions());
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });

  return (
    <div style={card}>
      {heading(<BellRing size={18} color="var(--primary)" />, 'Pengingat tagihan')}
      <label style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', fontSize: '0.875rem', lineHeight: 1.5 }}>
        <input
          type="checkbox"
          checked={!me.notifyOptOut}
          disabled={pref.isPending}
          onChange={async (e) => {
            await pref.mutateAsync({ optOut: !e.target.checked });
            await refresh();
            addToast(e.target.checked ? 'Pengingat dinyalakan.' : 'Pengingat dimatikan.', 'info');
          }}
          style={{ marginTop: '0.2rem' }}
        />
        <span>Kirim pengingat 7, 3, dan 1 hari sebelum jatuh tempo lewat email dan WhatsApp (08.00 sampai 20.00 WIB).</span>
      </label>

      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <FileCheck2 size={16} color="var(--primary)" />
          <strong style={{ fontSize: '0.875rem' }}>Syarat dan Kebijakan Privasi</strong>
        </div>
        {me.termsCurrent ? (
          <p style={hint}>Anda sudah menyetujui versi {me.termsVersion}. Baca <Link to="/syarat" style={{ color: 'var(--primary)', fontWeight: 600 }}>Syarat</Link> dan <Link to="/privasi" style={{ color: 'var(--primary)', fontWeight: 600 }}>Privasi</Link>.</p>
        ) : (
          <>
            <p style={hint}>Versi {me.termsVersion} belum Anda setujui. Baca <Link to="/syarat" style={{ color: 'var(--primary)', fontWeight: 600 }}>Syarat</Link> dan <Link to="/privasi" style={{ color: 'var(--primary)', fontWeight: 600 }}>Privasi</Link>, lalu setujui sebelum mengajukan sewa.</p>
            {error && <Notice tone="error">{error}</Notice>}
            <div>
              <Button
                variant="outline"
                size="sm"
                isLoading={accept.isPending}
                onClick={async () => {
                  setError(null);
                  try {
                    await accept.mutateAsync({ version: me.termsVersion });
                    await refresh();
                    addToast('Persetujuan tersimpan.', 'success');
                  } catch (err) {
                    setError(messageForError(err));
                  }
                }}
              >
                Saya menyetujui
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
