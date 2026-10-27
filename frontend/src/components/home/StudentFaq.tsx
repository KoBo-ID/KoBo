import React from 'react';
import { Link } from 'react-router-dom';

const STEPS = [
  { title: 'Cari kos dekat kampus', text: 'Pilih kampusmu, lihat kos terdekat dengan jarak dan harga per bulan.' },
  { title: 'Survey gratis', text: 'Jadwalkan kunjungan tanpa bayar apa pun. Aturan dan denda tertulis sebelum kamu mengajukan.' },
  { title: 'Ajukan sewa', text: 'Pengajuan tidak menahan kamar dan tidak memindahkan uang. Pemilik yang menyetujui.' },
  { title: 'Bayar dan simpan kuitansi', text: 'Setelah disetujui, kamar ditahan 24 jam untuk pembayaran pertama. Kuitansi digital langsung tersedia.' },
];

const FAQ: { q: string; a: React.ReactNode }[] = [
  { q: 'Kenapa perlu email kampus?', a: <>Email kampus (.ac.id) yang terverifikasi membuka diskon mahasiswa di pembayaran pertama. Verifikasinya di halaman <Link to="/profile" style={{ color: 'var(--primary)', fontWeight: 600 }}>Profil</Link>.</> },
  { q: 'Bagaimana jika belum punya email kampus?', a: 'Kamu tetap bisa mencari, survey, dan mengajukan sewa tanpa diskon. Verifikasi dengan kartu mahasiswa segera hadir.' },
  { q: 'Apakah orang tua bisa membayar?', a: 'Saat ini pembayaran dilakukan dari akunmu. Orang tua dapat membayar lewat metode yang tersedia di halaman pembayaran (misalnya transfer atau e-wallet) memakai tagihan atas namamu. Tautan bayar khusus orang tua belum tersedia.' },
  { q: 'Bayar per bulan atau per semester?', a: 'Harga ditampilkan per bulan. Pilihan 1, 3, atau 12 bulan ada di halaman kos; pembayaran pertama dan tagihan berikutnya tampil sebelum kamu mengajukan.' },
  { q: 'Kenapa diminta kontak darurat?', a: 'Sebelum pengajuan pertama kami meminta satu kontak (misalnya orang tua). Dengan izinmu, kami hanya menghubunginya bila sewa terlambat lebih dari seminggu.' },
  { q: 'Apakah data saya aman?', a: <>KoBo belum meminta KTP. Data yang kami simpan dan siapa yang dapat melihatnya dijelaskan di <Link to="/privasi" style={{ color: 'var(--primary)', fontWeight: 600 }}>Kebijakan Privasi</Link> (draf).</> },
];

/** "Cara kerja untuk mahasiswa" and the student FAQ. Static; no data fetched. */
export const StudentFaq: React.FC = () => (
  <section className="app-container" aria-labelledby="mhs-title" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
    <div>
      <h2 id="mhs-title" style={{ fontSize: 'clamp(1.4rem, 1.1rem + 1vw, 1.9rem)', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>Cara kerja untuk mahasiswa</h2>
      <ol style={{ listStyle: 'none', margin: '1.25rem 0 0', padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '1rem' }}>
        {STEPS.map((s, i) => (
          <li key={s.title} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-card)', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <span style={{ color: 'var(--primary)', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{i + 1}</span>
            <strong style={{ fontSize: '1rem' }}>{s.title}</strong>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem', lineHeight: 1.55 }}>{s.text}</span>
          </li>
        ))}
      </ol>
    </div>
    <div>
      <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 0.75rem' }}>Pertanyaan yang sering muncul</h2>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-card)', padding: '0.25rem 1.25rem' }}>
        {FAQ.map((f, i) => (
          <details key={f.q} style={{ padding: '0.9rem 0', borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: '0.9375rem', minHeight: '2rem' }}>{f.q}</summary>
            <p style={{ margin: '0.5rem 0 0', color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.65 }}>{f.a}</p>
          </details>
        ))}
      </div>
    </div>
  </section>
);
