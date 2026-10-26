import React from 'react';
import { Link } from 'react-router-dom';
import { InfoPage, InfoSection, InfoList } from '../components/ui/InfoPage';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export const Privacy: React.FC = () => {
  useDocumentTitle('Kebijakan privasi');
  return (
    <InfoPage title="Kebijakan privasi">
      <InfoSection heading="Data yang kami simpan">
        <InfoList
          items={[
            'Nama dan alamat email, serta nomor telepon bila Anda mengisinya',
            'Email kampus dan waktu verifikasinya',
            'Foto profil, bila ada',
            'Detail pengajuan sewa, catatan sewa, dan catatan pembayaran',
            'Permintaan survey dan posisi di daftar tunggu',
            'Ulasan yang Anda tulis',
            'Alamat IP dan jenis browser pada sesi masuk',
            'Email yang KoBo kirim kepada Anda',
          ]}
        />
      </InfoSection>
      <InfoSection heading="Untuk apa data dipakai">
        <p>Untuk menjalankan akun, memproses pengajuan dan pembayaran, mengatur survey dan daftar tunggu, mengirim pemberitahuan, menampilkan ulasan, dan menjaga keamanan akun.</p>
      </InfoSection>
      <InfoSection heading="Siapa yang dapat melihat">
        <InfoList
          items={[
            'Pemilik kos melihat nama, kontak, kampus, dan detail pengajuan Anda untuk kos miliknya.',
            'Penyedia pembayaran memproses pembayaran Anda.',
            'Ulasan Anda tampil bersama nama dan kampus Anda.',
            'Pengunjung lain tidak melihat email atau nomor telepon Anda. Pemilik kos dapat dihubungi lewat WhatsApp dari profilnya, sehingga nomornya terlihat pengunjung.',
          ]}
        />
      </InfoSection>
      <InfoSection heading="Keamanan">
        <p>Kata sandi tidak disimpan dalam bentuk aslinya. Akses ke data pemilik dibatasi pada kos miliknya sendiri.</p>
      </InfoSection>
      <InfoSection heading="Pilihan Anda">
        <p>Anda dapat mengubah nama, nomor telepon, dan kampus di halaman <Link to="/profile" style={{ color: 'var(--primary)', fontWeight: 600 }}>Profil</Link>. Pertanyaan lain tentang data Anda dapat disampaikan lewat halaman <Link to="/kontak" style={{ color: 'var(--primary)', fontWeight: 600 }}>Hubungi kami</Link>.</p>
      </InfoSection>
    </InfoPage>
  );
};
