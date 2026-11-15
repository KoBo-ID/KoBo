import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

const STEPS: { title: string; text: React.ReactNode }[] = [
  { title: 'Cari kos dekat kampus', text: <>Pilih kampusmu, lihat kos terdekat dengan jarak dan harga per bulan.</> },
  { title: 'Survey gratis', text: <>Jadwalkan kunjungan <strong>tanpa bayar apa pun</strong>. Aturan dan denda tertulis sebelum kamu mengajukan.</> },
  { title: 'Ajukan sewa', text: <>Pengajuan <strong>tidak menahan kamar dan tidak memindahkan uang</strong>. Pemilik yang menyetujui.</> },
  { title: 'Bayar dan simpan kuitansi', text: <>Setelah disetujui, kamar ditahan <strong>24 jam</strong> untuk pembayaran pertama. Kuitansi digital langsung tersedia.</> },
];

const FAQ: { q: string; a: React.ReactNode }[] = [
  { q: 'Kenapa perlu email kampus?', a: <>Email kampus (.ac.id) yang terverifikasi membuka diskon mahasiswa di pembayaran pertama. Verifikasinya di halaman <Link to="/profile" className="mhs-link">Profil</Link>.</> },
  { q: 'Bagaimana jika belum punya email kampus?', a: 'Kamu tetap bisa mencari, survey, dan mengajukan sewa tanpa diskon. Verifikasi dengan kartu mahasiswa segera hadir.' },
  { q: 'Apakah orang tua bisa membayar?', a: 'Saat ini pembayaran dilakukan dari akunmu. Orang tua dapat membayar lewat metode yang tersedia di halaman pembayaran (misalnya transfer atau e-wallet) memakai tagihan atas namamu. Tautan bayar khusus orang tua belum tersedia.' },
  { q: 'Bayar per bulan atau per semester?', a: 'Harga ditampilkan per bulan. Pilihan 1, 3, atau 12 bulan ada di halaman kos; pembayaran pertama dan tagihan berikutnya tampil sebelum kamu mengajukan.' },
  { q: 'Kenapa diminta kontak darurat?', a: 'Sebelum pengajuan pertama kami meminta satu kontak (misalnya orang tua). Dengan izinmu, kami hanya menghubunginya bila sewa terlambat lebih dari seminggu.' },
  { q: 'Apakah data saya aman?', a: <>KoBo belum meminta KTP. Data yang kami simpan dan siapa yang dapat melihatnya dijelaskan di <Link to="/privasi" className="mhs-link">Kebijakan Privasi</Link> (draf).</> },
];

/** "Cara kerja untuk mahasiswa" and the student FAQ. Static; no data fetched. */
export const StudentFaq: React.FC = () => {
  const uid = useId();
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  // The rail plays once when it scrolls into view: a ball hops from step 1 to step 4, each dot filling as it arrives.
  // Without IntersectionObserver or with reduced motion the rail stays in its finished state.
  const railRef = useRef<HTMLDivElement>(null);
  const [anim, setAnim] = useState(false);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = railRef.current;
    if (!el || typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setAnim(true);
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setInView(true); io.disconnect(); } }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const toggle = (i: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  return (
    <section className="app-container mhs" aria-labelledby="mhs-title">
      <div className="mhs__block">
        <h2 id="mhs-title" className="mhs__title">Cara kerja untuk mahasiswa</h2>
        <div ref={railRef} className={`mhs-rail${anim ? ' mhs-rail--anim' : ''}${inView ? ' is-in' : ''}`}>
  <ol className="mhs-steps">
            {STEPS.map((s, i) => (
              <li key={s.title} className="mhs-steps__item" style={{ '--i': i } as React.CSSProperties}>
                <h3 className="mhs-steps__title">{s.title}</h3>
                <p className="mhs-steps__text">{s.text}</p>
              </li>
            ))}
          </ol>
          <span className="mhs-rail__travel" aria-hidden="true"><span className="mhs-rail__line" /><span className="mhs-rail__ball" /></span>
        </div>
      </div>

      <div className="mhs__block mhs-faq">
        <div className="mhs-faq__intro">
          <h2 className="mhs__title">Pertanyaan yang sering muncul</h2>
        </div>
        <div className="mhs-faq__list">
          {FAQ.map((f, i) => {
            const isOpen = open.has(i);
            const btnId = `${uid}-q${i}`;
            const panelId = `${uid}-a${i}`;
            return (
              <div key={f.q} className="mhs-faq__item" data-open={isOpen || undefined}>
                <h3>
                  <button type="button" id={btnId} className="mhs-faq__q" aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggle(i)}>
                    <span>{f.q}</span>
                    <span className="mhs-faq__icon" aria-hidden="true" />
                  </button>
                </h3>
                <div id={panelId} className="mhs-faq__panel">
                  <div className="mhs-faq__panel-inner">
                    <p>{f.a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
