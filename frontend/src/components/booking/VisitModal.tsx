import React, { useState } from 'react';
import { Calendar, Clock, User, Phone, GraduationCap, CheckCircle2, ShieldCheck, Sparkles } from 'lucide-react';
import { Kos } from '../../types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useAppStore } from '../../store/AppContext';

interface VisitModalProps {
  isOpen: boolean;
  onClose: () => void;
  kos: Kos;
}

export const VisitModal: React.FC<VisitModalProps> = ({ isOpen, onClose, kos }) => {
  const { currentUser, scheduleVisit } = useAppStore();

  // Next 5 days dates generator
  const getNextDays = () => {
    const days = [];
    const today = new Date();
    for (let i = 1; i <= 5; i++) {
      const nextDate = new Date();
      nextDate.setDate(today.getDate() + i);
      const dayName = nextDate.toLocaleDateString('id-ID', { weekday: 'short' });
      const dayNum = nextDate.getDate();
      const monthName = nextDate.toLocaleDateString('id-ID', { month: 'short' });
      const isoStr = nextDate.toISOString().split('T')[0];
      days.push({ dayName, dayNum, monthName, isoStr });
    }
    return days;
  };

  const availableDays = getNextDays();

  const [selectedDate, setSelectedDate] = useState(availableDays[0]?.isoStr || '');
  const [timeSlot, setTimeSlot] = useState<'pagi' | 'siang'>('siang');
  const [studentName, setStudentName] = useState(currentUser.name);
  const [studentPhone, setStudentPhone] = useState(currentUser.phone);
  const [studentCampus, setStudentCampus] = useState(currentUser.campus || 'Binus Syahdan');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    setTimeout(() => {
      scheduleVisit({
        kosId: kos.id,
        kosName: kos.name,
        studentName,
        studentPhone,
        studentCampus,
        date: selectedDate,
        timeSlot,
        notes,
      });
      setIsSubmitting(false);
      onClose();
    }, 400);
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
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
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
              onClick={() => setTimeSlot('pagi')}
              className="interactive-tap"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: `1.5px solid ${timeSlot === 'pagi' ? 'var(--primary)' : 'var(--border-strong)'}`,
                backgroundColor: timeSlot === 'pagi' ? 'var(--primary-light)' : 'var(--bg-surface)',
                color: timeSlot === 'pagi' ? 'var(--primary)' : 'var(--text-main)',
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
              onClick={() => setTimeSlot('siang')}
              className="interactive-tap"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: `1.5px solid ${timeSlot === 'siang' ? 'var(--primary)' : 'var(--border-strong)'}`,
                backgroundColor: timeSlot === 'siang' ? 'var(--primary-light)' : 'var(--bg-surface)',
                color: timeSlot === 'siang' ? 'var(--primary)' : 'var(--text-main)',
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

        {/* 3. Data Kontak Mahasiswa */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <Input
            label="Nama Lengkap"
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            iconLeft={<User size={16} />}
            required
          />
          <Input
            label="Nomor WhatsApp"
            value={studentPhone}
            onChange={(e) => setStudentPhone(e.target.value)}
            iconLeft={<Phone size={16} />}
            required
          />
        </div>

        <Input
          label="Asal Kampus / Universitas"
          value={studentCampus}
          onChange={(e) => setStudentCampus(e.target.value)}
          iconLeft={<GraduationCap size={16} />}
          required
        />

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

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" variant="primary" isLoading={isSubmitting} icon={<CheckCircle2 size={16} />}>
            Konfirmasi Jadwal Survey Gratis
          </Button>
        </div>
      </form>
    </Modal>
  );
};
