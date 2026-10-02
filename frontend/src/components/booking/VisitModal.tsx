import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addDays, todayWIB } from '@kobo/shared/domain';
import { Calendar, Clock, Phone, CheckCircle2, ShieldCheck } from 'lucide-react';
import { Kos } from '../../types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Notice } from '../ui/Notice';
import { useSession } from '../../lib/session';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';
import { useAppStore } from '../../store/AppContext';

interface VisitModalProps {
  isOpen: boolean;
  onClose: () => void;
  kos: Kos;
}

export const VisitModal: React.FC<VisitModalProps> = ({ isOpen, onClose, kos }) => {
  const { addToast, openAuthModal } = useAppStore();
  const { me } = useSession();
  const trpc = useTRPC();
  const qc = useQueryClient();

  // The next 5 days, as WIB calendar days (the server only accepts dates after today in WIB).
  const availableDays = useMemo(() => {
    const today = todayWIB(new Date());
    return [1, 2, 3, 4, 5].map((i) => {
      const isoStr = addDays(today, i);
      const d = new Date(`${isoStr}T00:00:00+07:00`);
      const fmt = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('id-ID', { ...o, timeZone: 'Asia/Jakarta' });
      return { isoStr, dayName: fmt({ weekday: 'short' }), dayNum: fmt({ day: 'numeric' }), monthName: fmt({ month: 'short' }) };
    });
  }, []);

  const [selectedDate, setSelectedDate] = useState(availableDays[0].isoStr);
  const [timeSlot, setTimeSlot] = useState<'PAGI' | 'SIANG'>('SIANG');
  // undefined = untouched: show the profile value.
  const [phoneInput, setPhoneInput] = useState<string | undefined>(undefined);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const updateProfile = useMutation(trpc.auth.updateProfile.mutationOptions());
  const create = useMutation(trpc.visit.create.mutationOptions());
  const isSubmitting = create.isPending || updateProfile.isPending;
  const phone = phoneInput ?? me?.user.phone ?? '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!me) return;
    setError(null);
    try {
      // The owner contacts the student on the WhatsApp number saved in their profile.
      if (phone.trim() !== (me.user.phone ?? '')) {
        await updateProfile.mutateAsync({ name: me.user.name, phone: phone.trim() || null, campus: me.user.campus });
        void qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
      }
      await create.mutateAsync({ kosId: kos.id, date: selectedDate, timeSlot, notes: notes.trim() || undefined });
      void qc.invalidateQueries({ queryKey: trpc.visit.mine.queryKey() });
      addToast(`Jadwal survey ke ${kos.name} berhasil dikonfirmasi!`, 'success');
      onClose();
    } catch (err) {
      setError(messageForError(err));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Calendar size={20} color="var(--primary)" />
          <span>Jadwalkan Survey Gratis</span>
        </div>
      }
      subtitle={`Kunjungi fisik kamar di ${kos.name} sebelum memutuskan sewa.`}
      maxWidth="md"
    >
      <form onSubmit={(e) => void handleSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Zero-Commitment Trust Ribbon */}
        <div
          style={{
            backgroundColor: 'var(--primary-light)',
            border: '1px solid hsla(158, 64%, 32%, 0.2)',
            borderRadius: 'var(--radius-md)',
            padding: '0.85rem 1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            fontSize: '0.85rem',
            color: 'var(--primary)',
            fontWeight: 600,
          }}
        >
          <ShieldCheck size={20} style={{ flexShrink: 0 }} />
          <span>
            100% Gratis Tanpa Biaya Tersembunyi. Anda tidak diwajibkan membayar uang muka (DP) apa pun untuk survey ini.
          </span>
        </div>

        {/* 1. Pilih Tanggal Kunjungan */}
        <div>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>
            1. Pilih Tanggal Kunjungan:
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem' }}>
            {availableDays.map((day) => {
              const isSelected = selectedDate === day.isoStr;
              return (
                <button
                  type="button"
                  key={day.isoStr}
                  onClick={() => setSelectedDate(day.isoStr)}
                  className="interactive-tap"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    padding: '0.65rem 0.25rem',
                    borderRadius: 'var(--radius-md)',
                    border: `1.5px solid ${isSelected ? 'var(--primary)' : 'var(--border-strong)'}`,
                    backgroundColor: isSelected ? 'var(--primary)' : 'var(--bg-surface)',
                    color: isSelected ? 'white' : 'var(--text-main)',
                    boxShadow: isSelected ? 'var(--shadow-md)' : 'none',
                    transition: 'all var(--duration-fast) var(--ease-out-spring)',
                  }}
                >
                  <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', opacity: isSelected ? 0.9 : 0.6 }}>
                    {day.dayName}
                  </span>
                  <span style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0.1rem 0' }}>
                    {day.dayNum}
                  </span>
                  <span style={{ fontSize: '0.72rem', opacity: isSelected ? 0.9 : 0.6 }}>
                    {day.monthName}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 2. Pilih Sesi Waktu */}
        <div>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, display: 'block', marginBottom: '0.5rem' }}>
            2. Pilih Sesi Waktu Kunjungan:
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => setTimeSlot('PAGI')}
              className="interactive-tap"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: `1.5px solid ${timeSlot === 'PAGI' ? 'var(--primary)' : 'var(--border-strong)'}`,
                backgroundColor: timeSlot === 'PAGI' ? 'var(--primary-light)' : 'var(--bg-surface)',
                color: timeSlot === 'PAGI' ? 'var(--primary)' : 'var(--text-main)',
                textAlign: 'left',
              }}
            >
              <Clock size={18} />
              <div>
                <span style={{ fontSize: '0.9rem', fontWeight: 700, display: 'block' }}>Sesi Pagi</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>09.00 - 12.00 WIB</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setTimeSlot('SIANG')}
              className="interactive-tap"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: `1.5px solid ${timeSlot === 'SIANG' ? 'var(--primary)' : 'var(--border-strong)'}`,
                backgroundColor: timeSlot === 'SIANG' ? 'var(--primary-light)' : 'var(--bg-surface)',
                color: timeSlot === 'SIANG' ? 'var(--primary)' : 'var(--text-main)',
                textAlign: 'left',
              }}
            >
              <Clock size={18} />
              <div>
                <span style={{ fontSize: '0.9rem', fontWeight: 700, display: 'block' }}>Sesi Siang/Sore</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>13.00 - 17.00 WIB</span>
              </div>
            </button>
          </div>
        </div>

        {/* 3. Kontak */}
        {me ? (
          <Input
            label="Nomor WhatsApp"
            value={phone}
            onChange={(e) => setPhoneInput(e.target.value)}
            iconLeft={<Phone size={16} />}
            placeholder="0812xxxxxxxx"
            helperText={`Pemilik menghubungi Anda atas nama ${me.user.name}.`}
            required
          />
        ) : (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Masuk dulu agar pemilik tahu siapa yang akan berkunjung.</p>
        )}

        <div>
          <label style={{ fontSize: '0.875rem', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>
            Catatan Khusus ke Pengelola Kos (Opsional):
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Contoh: Mau cek colokan meja belajar atau bawa motor..."
            style={{
              width: '100%',
              padding: '0.625rem 0.875rem',
              borderRadius: 'var(--radius-md)',
              border: '1.5px solid var(--border-strong)',
              fontFamily: 'var(--font-sans)',
              fontSize: '0.875rem',
              backgroundColor: 'var(--bg-surface)',
            }}
          />
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Batal
          </Button>
          {me ? (
            <Button type="submit" variant="primary" isLoading={isSubmitting} icon={<CheckCircle2 size={16} />}>
              Konfirmasi Jadwal Survey Gratis
            </Button>
          ) : (
            <Button type="button" variant="primary" onClick={() => { onClose(); openAuthModal(); }}>
              Masuk
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
};
