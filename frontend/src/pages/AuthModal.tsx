import React, { useState } from 'react';
import { User, Lock, Mail, Phone, GraduationCap, Building2, CheckCircle2 } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAppStore } from '../store/AppContext';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultRole?: 'student' | 'owner';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  defaultRole = 'student',
}) => {
  const { updateUserProfile, setActivePersona, addToast } = useAppStore();
  const [role, setRole] = useState<'student' | 'owner'>(defaultRole);
  const [isRegister, setIsRegister] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [campus, setCampus] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const userName = name || (role === 'student' ? 'Rafi Aditya' : 'Ibu Ratna Hendrawan');
    const userEmail = email || (role === 'student' ? 'rafi.aditya@binus.ac.id' : 'ratna.hendrawan@gmail.com');
    const userPhone = phone || (role === 'student' ? '081234567890' : '081298765432');

    updateUserProfile({
      name: userName,
      email: userEmail,
      phone: userPhone,
      role,
      campus: role === 'student' ? (campus || 'Binus Syahdan') : undefined,
    });

    setActivePersona(role);
    addToast(`Selamat datang di KoBo, ${userName}!`, 'success');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <User size={20} color="var(--primary)" />
          <span>{isRegister ? 'Daftar Akun KoBo' : 'Masuk ke Akun KoBo'}</span>
        </div>
      }
      subtitle="Pilih peran Anda untuk pengalaman terbaik"
      maxWidth="sm"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Dual Persona Toggle (Idea.md) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '0.5rem',
            backgroundColor: 'var(--bg-muted)',
            padding: '0.35rem',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <button
            type="button"
            onClick={() => setRole('student')}
            className="interactive-tap"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
              padding: '0.6rem 0.5rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              fontWeight: role === 'student' ? 700 : 500,
              backgroundColor: role === 'student' ? 'var(--bg-surface)' : 'transparent',
              color: role === 'student' ? 'var(--primary)' : 'var(--text-muted)',
              boxShadow: role === 'student' ? 'var(--shadow-sm)' : 'none',
            }}
          >
            <GraduationCap size={16} />
            <span>Saya Pencari Kos</span>
          </button>

          <button
            type="button"
            onClick={() => setRole('owner')}
            className="interactive-tap"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
              padding: '0.6rem 0.5rem',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              fontWeight: role === 'owner' ? 700 : 500,
              backgroundColor: role === 'owner' ? 'var(--bg-surface)' : 'transparent',
              color: role === 'owner' ? 'var(--primary)' : 'var(--text-muted)',
              boxShadow: role === 'owner' ? 'var(--shadow-sm)' : 'none',
            }}
          >
            <Building2 size={16} />
            <span>Saya Pemilik Kos</span>
          </button>
        </div>

        {isRegister && (
          <Input
            label="Nama Lengkap"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={role === 'student' ? 'Contoh: Rafi Aditya' : 'Contoh: Ibu Ratna Hendrawan'}
            iconLeft={<User size={16} />}
            required
          />
        )}

        <Input
          label={role === 'student' ? 'Email Kampus / Pribadi' : 'Email Bisnis'}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={role === 'student' ? 'nama@binus.ac.id' : 'pemilik@gmail.com'}
          iconLeft={<Mail size={16} />}
          required
        />

        {isRegister && (
          <Input
            label="Nomor WhatsApp Aktif"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="081234567890"
            iconLeft={<Phone size={16} />}
            required
          />
        )}

        {isRegister && role === 'student' && (
          <Input
            label="Asal Kampus / Universitas"
            value={campus}
            onChange={(e) => setCampus(e.target.value)}
            placeholder="Contoh: Binus University Syahdan"
            iconLeft={<GraduationCap size={16} />}
          />
        )}

        <Input
          label="Kata Sandi"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          iconLeft={<Lock size={16} />}
          required
        />

        <Button type="submit" variant="primary" fullWidth icon={<CheckCircle2 size={16} />}>
          {isRegister ? 'Daftar Sekarang' : 'Masuk ke Akun'}
        </Button>

        {/* Toggle Login vs Register */}
        <div style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          {isRegister ? (
            <span>
              Sudah punya akun?{' '}
              <button
                type="button"
                onClick={() => setIsRegister(false)}
                style={{ color: 'var(--primary)', fontWeight: 700, textDecoration: 'underline' }}
              >
                Masuk di sini
              </button>
            </span>
          ) : (
            <span>
              Belum punya akun?{' '}
              <button
                type="button"
                onClick={() => setIsRegister(true)}
                style={{ color: 'var(--primary)', fontWeight: 700, textDecoration: 'underline' }}
              >
                Daftar baru
              </button>
            </span>
          )}
        </div>
      </form>
    </Modal>
  );
};
