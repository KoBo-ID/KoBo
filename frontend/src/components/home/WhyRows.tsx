import React from 'react';
import { useReveal } from '../../hooks/useReveal';
import { BellRing, GraduationCap, Home, MailCheck, PenLine, ScrollText, ShoppingCart, Shirt, UtensilsCrossed } from 'lucide-react';
import roomPhoto from '../../assets/room-survey.webp';
import livingPhoto from '../../assets/room-living.webp';

/* Four product promises as separated rows: text (numeral, heading, the real
   condition) beside a full-bleed stage that shows the UI it describes. Text
   stays first in the DOM; the desktop media query alone swaps sides. Sample
   values are the same product illustration the bento uses (Rp 100.000 is only
   the difference of the two sample prices). */

const CAMPUS_DISTANCE = 300;

/* Pins sit at percent positions of the map stage; the route path below uses the
   same coordinates (viewBox 0 0 100 100, stretched), so they always line up. */
const PINS = [
  { key: 'kos', x: 13, y: 80, label: 'Kos', icon: Home, kind: 'start' },
  { key: 'mini', x: 30, y: 58, label: 'Minimarket', meters: 50, icon: ShoppingCart },
  { key: 'makan', x: 44, y: 76, label: 'Tempat makan', meters: 80, icon: UtensilsCrossed },
  { key: 'laundry', x: 58, y: 42, label: 'Laundry', meters: 120, icon: Shirt },
  { key: 'kampus', x: 84, y: 20, label: 'Kampus', meters: CAMPUS_DISTANCE, icon: GraduationCap, kind: 'end' },
] as const;
const ROUTE = PINS.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');

interface RowProps {
  n: number;
  title: string;
  children: React.ReactNode;
  stage: React.ReactNode;
  flip?: boolean;
}

const Row: React.FC<RowProps> = ({ n, title, children, stage, flip }) => {
  const ref = useReveal<HTMLElement>();
  return (
  <article ref={ref} className={`whyr__row${flip ? ' whyr__row--flip' : ''}`}>
    <div className="whyr__text">
      <div className="whyr__promise">
        <span className="whyr__num" aria-hidden="true">{n}</span>
        <div>
          <h3>{title}</h3>
          <p>{children}</p>
        </div>
      </div>
    </div>
    {stage}
  </article>
  );
};

export const WhyRows: React.FC = () => {
  const titleRef = useReveal<HTMLHeadingElement>();
  return (
  <section className="app-container whyr" aria-labelledby="whyr-title">
    <h2 ref={titleRef} id="whyr-title" className="whyr__title rise">Kenapa cari kos lewat KoBo</h2>
    <div className="whyr__rows">
      <Row
        n={1}
        title="Survey gratis dulu"
        stage={
          <div className="whyr__stage whyr__stage--photo">
            <img
              className="whyr__photo"
              src={roomPhoto}
              width={1400}
              height={933}
              loading="lazy"
              alt="Kamar kos yang terang dengan sofa, rak buku, dan tanaman"
            />
            <div className="whyr__picker" aria-hidden="true">
              <span className="whyr__confirm">
                <span className="whyr__confirm-icon"><BellRing size={14} strokeWidth={2.5} /></span>
                <span className="whyr__confirm-text">
                  <strong>Jadwal survey baru</strong>
                  <span>Masuk ke dashboard pemilik</span>
                </span>
              </span>
              <div className="whyr__picker-row">
                <span className="whyr__chip whyr__chip--on">Sen, 20 Okt</span>
                <span className="whyr__chip">Sel, 21 Okt</span>
              </div>
              <div className="whyr__seg">
                <span className="whyr__seg-on">Pagi</span>
                <span>Siang</span>
              </div>
              <span className="whyr__picker-btn">Jadwalkan survey</span>
            </div>
          </div>
        }
      >
        Datang ke kos dan temui pemiliknya tanpa biaya dan tanpa DP. Pilih tanggal, lalu sesi pagi atau siang.
      </Row>

      <Row
        n={2}
        flip
        title="Diskon mahasiswa"
        stage={
          <div className="whyr__stage whyr__stage--teal" aria-hidden="true">
            <div className="whyr__card whyr__card--back" />
            <div className="whyr__card whyr__card--under" />
            <div className="whyr__card whyr__card--price">
              <span className="whyr__verified"><MailCheck size={16} strokeWidth={2.25} />Email kampus .ac.id terverifikasi</span>
              <div className="whyr__price-top">
                <span className="whyr__price-old">Rp 1.500.000</span>
                <span className="whyr__price-badge">Harga mahasiswa</span>
              </div>
              <span className="whyr__price-new">Rp 1.400.000</span>
              <span className="whyr__price-note">Pembayaran pertama</span>
            </div>
            <span className="whyr__save">Hemat Rp 100.000</span>
          </div>
        }
      >
        Aktif setelah email kampus (.ac.id) Anda terverifikasi, dan berlaku untuk pembayaran pertama. Besarnya ditentukan tiap pemilik.
      </Row>

      <Row
        n={3}
        title="Aturan dan denda tertulis"
        stage={
          <div className="whyr__stage whyr__stage--photo whyr__stage--rules">
            <img
              className="whyr__photo"
              src={livingPhoto}
              width={1200}
              height={800}
              loading="lazy"
              alt="Ruang bersama kos dengan sofa kulit, tanaman, dan dapur terbuka"
            />
            <div className="whyr__rulecard" aria-hidden="true">
              <span className="whyr__rulecard-head"><ScrollText size={16} strokeWidth={2.25} />Tata tertib dan denda</span>
              <ul>
                <li><span>Tamu menginap</span><b>Lapor pemilik</b></li>
                <li><span>Jam malam</span><b>23.00</b></li>
                <li className="whyr__rule-fine"><span>Denda telat bayar</span><b>Rp 50.000 / hari</b></li>
              </ul>
            </div>
            <span className="whyr__by" aria-hidden="true"><PenLine size={14} strokeWidth={2.25} />Ditulis oleh pemilik</span>
          </div>
        }
      >
        Pemilik menulis tata tertib dan denda untuk tiap kos. Anda bisa membacanya di halaman kos sebelum memesan.
      </Row>

      <Row
        n={4}
        flip
        title="Jarak dalam meter"
        stage={
          <div className="whyr__stage whyr__stage--map" aria-hidden="true">
            <svg className="whyr__map" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">
              <path className="whyr__map-water" d="M-5 96 C 20 88, 38 100, 62 92 S 96 84, 108 90 L108 110 L-5 110 Z" />
              <path className="whyr__map-park" d="M66 52 C 74 44, 92 46, 96 58 C 98 70, 86 80, 72 76 C 62 72, 60 60, 66 52 Z" />
              <path className="whyr__map-road whyr__map-road--wide" d="M-5 30 L105 36" />
              <path className="whyr__map-road whyr__map-road--wide" d="M-5 62 L105 58" />
              <path className="whyr__map-road whyr__map-road--wide" d="M22 -5 L40 105" />
              <path className="whyr__map-road whyr__map-road--wide" d="M72 -5 L68 105" />
              <path className="whyr__map-road" d="M-5 12 L105 14 M-5 82 L105 78 M52 -5 L56 105 M6 -5 L12 105 M90 -5 L94 105" />
              <path className="whyr__map-route" d={ROUTE} />
            </svg>
            {PINS.map((p) => {
              const Icon = p.icon;
              const end = 'kind' in p && p.kind === 'end';
              const start = 'kind' in p && p.kind === 'start';
              return (
                <span
                  key={p.key}
                  className={`whyr__pin${end ? ' whyr__pin--end' : ''}${start ? ' whyr__pin--start' : ''}`}
                  style={{ left: `${p.x}%`, top: `${p.y}%` }}
                >
                  <span className="whyr__pin-dot"><Icon size={end ? 20 : 17} strokeWidth={2.25} /></span>
                  <span className="whyr__pin-chip">
                    <span>{p.label}</span>
                    {'meters' in p && <b>{p.meters} m</b>}
                  </span>
                </span>
              );
            })}
          </div>
        }
      >
        Jarak ke kampus dan fasilitas sekitar tertulis dalam meter di halaman kos, sebelum Anda datang.
      </Row>
    </div>
  </section>
  );
};
