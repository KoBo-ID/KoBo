import React from 'react';
import { TERMS_DRAFT_NOTE, TERMS_VERSION } from '@kobo/shared/domain';
import { InfoPage, InfoSection, InfoList } from '../components/ui/InfoPage';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/** Shown on Terms and Privacy: the version users consent to, the effective date, and the draft status. */
export const LegalMeta: React.FC = () => (
  <p style={{ margin: '1rem 0 0', padding: '0.75rem 1rem', background: 'var(--status-due-bg)', border: '1px solid var(--status-due-border)', borderRadius: 'var(--radius-md)', color: 'var(--status-due-text)', fontSize: '0.875rem', lineHeight: 1.55 }}>
    <strong>Draf, belum ditinjau pengacara.</strong> Versi {TERMS_VERSION}, berlaku sejak 28 Oktober 2026. Isi halaman ini dapat berubah setelah ditinjau ({TERMS_DRAFT_NOTE}).
  </p>
);

/** Numbered clauses: one list per section so a clause can be cited ("Pasal 8.2"). */
const Clauses: React.FC<{ n: number; items: React.ReactNode[] }> = ({ n, items }) => (
  <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
    {items.map((item, i) => (
      <li key={i} style={{ display: 'grid', gridTemplateColumns: '2.75rem 1fr', columnGap: '0.5rem' }}>
        <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{n}.{i + 1}</span>
        <span>{item}</span>
      </li>
    ))}
  </ol>
);

const SECTIONS: { heading: string; items: React.ReactNode[] }[] = [
  {
    heading: 'Definisi dan ruang lingkup',
    items: [
      'KoBo adalah sistem elektronik yang mempertemukan pencari kos (terutama mahasiswa) dengan pemilik atau pengelola kos. KoBo bukan pemilik, pengelola, atau pihak dalam perjanjian sewa antara penyewa dan pemilik.',
      'Pemilik kos yang meninjau, menyetujui, atau menolak pengajuan sewa. Hubungan sewa terjadi antara penyewa dan pemilik.',
    ],
  },
  {
    heading: 'Penerimaan dan perubahan ketentuan',
    items: [
      'Dengan membuat akun atau memakai KoBo, Anda menyatakan sudah membaca dan menyetujui ketentuan ini dan Kebijakan Privasi, pada versi yang tertera di atas.',
      'Jika ketentuan berubah secara berarti (tujuan data baru, biaya, pengembalian dana, tanggung jawab), versi baru ditampilkan dan Anda diminta menyetujuinya lagi sebelum mengajukan sewa berikutnya.',
    ],
  },
  {
    heading: 'Akun dan usia',
    items: [
      'Satu akun dipakai untuk mencari kos dan, bila Anda mendaftar sebagai pemilik, mengelola kos.',
      'Data yang Anda isi harus benar dan menjadi tanggung jawab Anda. Jaga kerahasiaan kata sandi.',
      'Pengguna berusia 18 tahun ke atas. Pengguna di bawah 18 tahun memakai KoBo hanya dengan persetujuan dan pendampingan orang tua atau wali.',
      'Diskon mahasiswa hanya berlaku setelah email kampus (.ac.id) Anda terverifikasi.',
    ],
  },
  {
    heading: 'Peran dan batas tanggung jawab KoBo',
    items: [
      'KoBo menyediakan sarana pencarian, survey, pengajuan, dan pembayaran. KoBo tidak menjamin kebenaran semua informasi yang ditulis pemilik, tetapi berusaha menindaklanjuti laporan.',
      'Ketentuan ini tidak mengecualikan tanggung jawab KoBo atas kelalaian sendiri sebagaimana diatur dalam peraturan perlindungan konsumen yang berlaku.',
    ],
  },
  {
    heading: 'Kewajiban pemilik kos',
    items: [
      'Mencantumkan harga, fasilitas, tata tertib, dan denda dengan benar, dan memiliki hak atas properti atau kuasa dari pemiliknya.',
      'Menanggapi pengajuan dan permintaan survey secara wajar, dan menjaga keamanan bangunan.',
      'Mencatat pembayaran tunai atau transfer yang Anda terima dengan jujur.',
      'Memenuhi izin dan pajak daerah yang berlaku untuk usaha kos Anda.',
    ],
  },
  {
    heading: 'Verifikasi dan lencana "Terverifikasi dokumen"',
    items: [
      'Pemilik menyatakan sendiri jenis kepemilikannya. KoBo tidak memeriksa dokumen secara otomatis.',
      'Lencana "Terverifikasi dokumen", bila ada, diberikan setelah pemeriksaan manual atas dokumen yang diunggah dan dapat dicabut. Lencana bukan jaminan hukum atas properti.',
    ],
  },
  {
    heading: 'Kewajiban penyewa',
    items: [
      'Memberikan data yang benar, mematuhi tata tertib kos, dan membayar tepat waktu.',
      'Sebelum pengajuan pertama, penyewa mengisi kontak darurat dan, bila setuju, memberi izin agar KoBo menghubunginya jika pembayaran terlambat lebih dari 7 hari. Izin ini dapat dicabut kapan saja di halaman Profil.',
    ],
  },
  {
    heading: 'Pemesanan, pembayaran, dan biaya',
    items: [
      'Survey kos gratis dan tidak mewajibkan pembayaran apa pun. Mengirim pengajuan sewa tidak menahan kamar dan tidak memindahkan uang.',
      'Setelah pemilik menyetujui, kamar ditahan 24 jam agar Anda dapat membayar pembayaran pertama. Jika tidak dibayar dalam waktu itu, kamar dilepas kembali.',
      'Pembayaran pertama terdiri dari sewa bulan pertama, biaya layanan KoBo (sekali), dikurangi diskon mahasiswa bila berlaku. Rinciannya tampil sebelum Anda mengirim pengajuan. Bulan berikutnya dibayar sebesar sewa bulanan.',
      'KoBo dapat mengirim pengingat tagihan lewat email dan WhatsApp antara pukul 08.00 dan 20.00 WIB. Anda dapat mematikannya di halaman Profil.',
    ],
  },
  {
    heading: 'Pembatalan dan pengembalian dana',
    items: [
      'Pembayaran yang diterima setelah kamar tidak lagi dapat dipesan diproses sebagai pengembalian dana ke metode pembayaran asal.',
      'Ketentuan pembatalan, potongan, dan waktu pengembalian dana rinci akan diisi setelah ditinjau pengacara.',
    ],
  },
  {
    heading: 'Daftar tunggu',
    items: ['Jika semua kamar terisi, Anda dapat masuk daftar tunggu. Penawaran diberikan sesuai urutan antrean dan berlaku 24 jam; penawaran yang tidak diambil diteruskan ke pengantre berikutnya.'],
  },
  {
    heading: 'Ulasan dan konten',
    items: [
      'Tulis ulasan berdasarkan pengalaman Anda sendiri. Hindari isi yang menyerang pribadi atau tidak benar. Pemilik kos dapat membalas ulasan.',
      'KoBo dapat menurunkan konten yang melanggar ketentuan setelah ada laporan.',
    ],
  },
  {
    heading: 'Larangan',
    items: ['Penipuan, data atau dokumen palsu, mengalihkan transaksi ke luar KoBo untuk menghindari biaya, pelecehan, dan diskriminasi.'],
  },
  {
    heading: 'Penangguhan dan penutupan akun',
    items: ['KoBo dapat menangguhkan akun yang melanggar ketentuan ini. Anda dapat menutup akun kapan saja lewat halaman Kontak.'],
  },
  {
    heading: 'Pengaduan dan penyelesaian sengketa',
    items: [
      'Sampaikan pengaduan lewat halaman Kontak. Kami berusaha menanggapi dalam waktu yang wajar.',
      'Sengketa diselesaikan lebih dulu secara musyawarah, kemudian lewat lembaga yang berwenang (misalnya BPSK atau pengadilan negeri) menurut hukum Indonesia.',
    ],
  },
  {
    heading: 'Keadaan memaksa dan hukum yang berlaku',
    items: ['KoBo tidak bertanggung jawab atas keterlambatan akibat keadaan di luar kendali wajar. Ketentuan ini tunduk pada hukum Republik Indonesia.'],
  },
];

export const Terms: React.FC = () => {
  useDocumentTitle('Syarat dan ketentuan');
  return (
    <InfoPage title="Syarat dan ketentuan" intro="Dengan memakai KoBo, Anda setuju dengan syarat di halaman ini.">
      <LegalMeta />
      {SECTIONS.map((s, i) => (
        <InfoSection key={s.heading} heading={`${i + 1}. ${s.heading}`}>
          <Clauses n={i + 1} items={s.items} />
        </InfoSection>
      ))}
      <InfoSection heading="Catatan untuk peninjau hukum">
        <InfoList items={['Pasal 4 (batas tanggung jawab), 9 (pengembalian dana), dan 14 (sengketa) perlu rumusan akhir dari pengacara.', 'Batas usia dan persetujuan wali perlu dikonfirmasi.']} />
      </InfoSection>
    </InfoPage>
  );
};
