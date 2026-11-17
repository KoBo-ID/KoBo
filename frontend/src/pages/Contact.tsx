import React from 'react';
import { Link } from 'react-router-dom';
import { InfoPage, InfoSection } from '../components/ui/InfoPage';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

const link: React.CSSProperties = { color: 'var(--primary)', fontWeight: 600 };

export const Contact: React.FC = () => {
  useDocumentTitle('Hubungi kami');
  return (
    <InfoPage title="Hubungi kami">
      <InfoSection heading="Pengajuan dan pembayaran">
        <p>Status pengajuan, tagihan, dan kuitansi ada di <Link to="/my-kos" style={link}>Kos Saya</Link>. Dari sana Anda juga dapat melanjutkan pembayaran dan melihat jadwal survey.</p>
      </InfoSection>
      <InfoSection heading="Akun dan email kampus">
        <p>Ubah nama, nomor telepon, kampus, dan verifikasi email kampus di <Link to="/profile" style={link}>Profil</Link>. Lupa kata sandi? Gunakan tautan atur ulang di jendela masuk.</p>
      </InfoSection>
      <InfoSection heading="Pertanyaan tentang kos tertentu">
        <p>Buka halaman kos lalu pilih <strong>Jadwalkan Survey Gratis</strong> untuk bertemu pemilik langsung, atau buka profil pemilik di halaman kos untuk menghubunginya lewat WhatsApp.</p>
      </InfoSection>
      <InfoSection heading="Pemilik kos">
        <p>Kelola kamar, pengajuan, dan tata tertib dari <Link to="/owner/dashboard" style={link}>portal pemilik</Link>. Belum punya akun pemilik? <Link to="/owner/login" style={link}>Daftar atau masuk di sini</Link>.</p>
      </InfoSection>
    </InfoPage>
  );
};
