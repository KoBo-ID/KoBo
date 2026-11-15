import React from 'react';
import { Link } from 'react-router-dom';
import { InfoPage, InfoSection, InfoList } from '../components/ui/InfoPage';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { LegalMeta } from './Terms';

const link = { color: 'var(--primary)', fontWeight: 600 } as const;

export const Privacy: React.FC = () => {
  useDocumentTitle('Kebijakan privasi');
  return (
    <InfoPage title="Kebijakan privasi" intro="Halaman ini menjelaskan data pribadi apa yang KoBo simpan, untuk apa, dan pilihan Anda, sesuai UU Pelindungan Data Pribadi (UU 27/2022).">
      <LegalMeta />
      <InfoSection heading="1. Siapa kami">
        <p>KoBo adalah pengendali data pribadi untuk data yang Anda isi di KoBo. Kontak pengaduan data ada di halaman <Link to="/kontak" style={link}>Hubungi kami</Link>.</p>
      </InfoSection>
      <InfoSection heading="2. Data yang kami simpan">
        <InfoList
          items={[
            'Nama dan alamat email, serta nomor telepon bila Anda mengisinya',
            'Email kampus dan waktu verifikasinya',
            'Kontak darurat (nama, hubungan, nomor) dan waktu Anda menyetujui kami menghubunginya, bila Anda mengisinya',
            'Foto profil, bila ada',
            'Detail pengajuan sewa, catatan sewa, dan catatan pembayaran',
            'Permintaan survey dan posisi di daftar tunggu',
            'Ulasan yang Anda tulis',
            'Versi syarat yang Anda setujui dan waktunya',
            'Riwayat pengingat tagihan yang kami kirim',
            'Alamat IP dan jenis browser pada sesi masuk',
            'Untuk pemilik kos: jenis kepemilikan yang Anda nyatakan sendiri',
          ]}
        />
        <p>KoBo belum meminta foto atau nomor KTP. Bila fitur itu ditambahkan, KoBo akan meminta persetujuan terpisah dan menyimpannya di penyimpanan privat, tidak di alamat publik.</p>
      </InfoSection>
      <InfoSection heading="3. Tujuan dan dasar pemrosesan">
        <InfoList
          items={[
            'Menjalankan akun, memproses pengajuan dan pembayaran, mengatur survey dan daftar tunggu (pelaksanaan perjanjian).',
            'Mengirim pengingat tagihan lewat email dan WhatsApp antara 08.00 dan 20.00 WIB (kepentingan sah dan perjanjian; dapat dimatikan di Profil).',
            'Menghubungi kontak darurat bila pembayaran terlambat lebih dari 7 hari (persetujuan Anda, dapat dicabut).',
            'Menampilkan ulasan dan menjaga keamanan akun.',
          ]}
        />
      </InfoSection>
      <InfoSection heading="4. Kontak darurat">
        <InfoList
          items={[
            'Anda memberi tahu orang yang Anda cantumkan, dan memastikan ia bersedia.',
            'Pesan ke kontak darurat memuat nama Anda, bahwa pembayaran sewa terlambat lebih dari seminggu, dan permintaan agar Anda menghubungi pemilik kos. Tidak memuat jumlah tagihan atau alamat kos.',
            'Pesan dikirim sekali per tagihan dan memuat cara berhenti dihubungi.',
            'Pemilik kos melihat kontak darurat Anda hanya setelah pengajuan Anda disetujui.',
          ]}
        />
      </InfoSection>
      <InfoSection heading="5. Siapa yang dapat melihat">
        <InfoList
          items={[
            'Pemilik kos melihat nama, kampus, status verifikasi, dan detail pengajuan Anda untuk kos miliknya. Ringkasan ketepatan pembayaran dan ulasan yang Anda tulis juga terlihat di profil itu agar pemilik dapat menilai pengajuan. Nomor telepon dan kontak darurat dibuka setelah pengajuan disetujui. Setiap pemilik yang membuka profil Anda tercatat.',
            'Penyedia pembayaran memproses pembayaran Anda.',
            'Ulasan Anda tampil bersama nama dan kampus Anda.',
            'Pengunjung lain tidak melihat email atau nomor telepon Anda. Pemilik kos dapat dihubungi lewat WhatsApp dari profilnya, sehingga nomornya terlihat pengunjung.',
            'Data tidak dijual.',
          ]}
        />
      </InfoSection>
      <InfoSection heading="6. Penyimpanan dan penghapusan">
        <p>Data akun disimpan selama akun aktif. Catatan pembayaran disimpan sesuai kewajiban pembukuan. Jangka waktu rinci akan ditetapkan setelah ditinjau pengacara. Anda dapat meminta penghapusan akun lewat halaman Kontak.</p>
      </InfoSection>
      <InfoSection heading="7. Keamanan">
        <p>Kata sandi tidak disimpan dalam bentuk aslinya. Akses ke data pemilik dibatasi pada kos miliknya sendiri. Bila terjadi kegagalan pelindungan data yang berdampak pada Anda, kami memberi tahu Anda secepatnya dan paling lambat 3 x 24 jam setelah kami mengetahuinya.</p>
      </InfoSection>
      <InfoSection heading="8. Hak Anda">
        <p>Anda berhak mengakses, memperbaiki, menghapus data, menarik persetujuan, dan menolak pemrosesan tertentu. Ubah nama, nomor telepon, kampus, kontak darurat, dan pengingat di halaman <Link to="/profile" style={link}>Profil</Link>. Permintaan lain lewat halaman <Link to="/kontak" style={link}>Hubungi kami</Link>.</p>
      </InfoSection>
      <InfoSection heading="9. Pengguna di bawah 18 tahun">
        <p>Pengguna di bawah 18 tahun memakai KoBo dengan persetujuan orang tua atau wali. Kami tidak memakai data anak untuk tujuan lain.</p>
      </InfoSection>
      <InfoSection heading="10. Perubahan">
        <p>Bila kebijakan berubah secara berarti, versi baru ditampilkan dan persetujuan Anda diminta lagi.</p>
      </InfoSection>
    </InfoPage>
  );
};
