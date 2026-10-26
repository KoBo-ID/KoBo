import React from 'react';
import { InfoPage, InfoSection, InfoList } from '../components/ui/InfoPage';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export const Terms: React.FC = () => {
  useDocumentTitle('Syarat dan ketentuan');
  return (
    <InfoPage title="Syarat dan ketentuan" intro="Dengan memakai KoBo, Anda setuju dengan syarat di halaman ini.">
      <InfoSection heading="Tentang KoBo">
        <p>KoBo mempertemukan pencari kos dengan pemilik kos. KoBo bukan pemilik kos. Pemilik kos yang meninjau, menyetujui, atau menolak pengajuan sewa, dan hubungan sewa terjadi antara penyewa dan pemilik.</p>
      </InfoSection>
      <InfoSection heading="Akun">
        <InfoList
          items={[
            'Satu akun dipakai untuk mencari kos dan, bila Anda mendaftar sebagai pemilik, mengelola kos.',
            'Data yang Anda isi harus benar dan menjadi tanggung jawab Anda.',
            'Diskon mahasiswa hanya berlaku setelah email kampus (.ac.id) Anda terverifikasi.',
          ]}
        />
      </InfoSection>
      <InfoSection heading="Survey, pengajuan, dan pembayaran">
        <InfoList
          items={[
            'Survey kos gratis dan tidak mewajibkan pembayaran apa pun.',
            'Mengirim pengajuan sewa tidak menahan kamar dan tidak memindahkan uang.',
            'Setelah pemilik menyetujui, kamar ditahan 24 jam agar Anda dapat membayar pembayaran pertama. Jika tidak dibayar dalam waktu itu, kamar dilepas kembali.',
            'Pembayaran pertama terdiri dari sewa bulan pertama, biaya layanan KoBo (sekali), dikurangi diskon mahasiswa bila berlaku. Rinciannya tampil di halaman kos dan di halaman pengajuan sebelum Anda mengirim.',
            'Bulan berikutnya dibayar sebesar sewa bulanan, tanpa biaya layanan dan tanpa diskon.',
          ]}
        />
      </InfoSection>
      <InfoSection heading="Daftar tunggu">
        <p>Jika semua kamar terisi, Anda dapat masuk daftar tunggu. Saat kamar tersedia, penawaran diberikan sesuai urutan antrean dan berlaku 24 jam. Penawaran yang tidak diambil diteruskan ke pengantre berikutnya.</p>
      </InfoSection>
      <InfoSection heading="Ulasan">
        <p>Tulis ulasan berdasarkan pengalaman Anda sendiri, dan hindari isi yang menyerang pribadi atau tidak benar. Pemilik kos dapat membalas ulasan.</p>
      </InfoSection>
      <InfoSection heading="Tanggung jawab pemilik kos">
        <InfoList
          items={[
            'Mencantumkan harga, fasilitas, tata tertib, dan denda dengan benar.',
            'Menanggapi pengajuan dan permintaan survey secara wajar.',
            'Mencatat pembayaran tunai atau transfer yang Anda terima dengan jujur.',
          ]}
        />
      </InfoSection>
      <InfoSection heading="Perubahan">
        <p>Syarat ini dapat diperbarui. Versi terbaru selalu tersedia di halaman ini.</p>
      </InfoSection>
    </InfoPage>
  );
};
