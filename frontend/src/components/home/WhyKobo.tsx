import React from 'react';
import { BellRing, GraduationCap, Home, ShoppingCart, Shirt, UtensilsCrossed } from 'lucide-react';
import roomPhoto from '../../assets/room-survey.webp';

const CAMPUS_DISTANCE = 300;

const STOPS = [
  { icon: ShoppingCart, label: 'Minimarket', meters: 50 },
  { icon: UtensilsCrossed, label: 'Tempat makan', meters: 80 },
  { icon: Shirt, label: 'Laundry', meters: 120 },
];

export const WhyKobo: React.FC = () => (
  <section className="app-container why" aria-labelledby="why-title">
    <h2 id="why-title" className="why__title">Kenapa cari kos lewat KoBo</h2>

    <div className="why__grid">
      <article className="why__tile why__tile--survey">
        <img
          className="why__photo"
          src={roomPhoto}
          width={1400}
          height={933}
          loading="lazy"
          alt="Kamar kos yang terang dengan sofa, rak buku, dan tanaman"
        />
        <div className="why__panel">
          <h3>Survey dulu sebelum sewa</h3>
          <p>Datang ke kos dan temui pemiliknya. Pilih tanggal, lalu slot pagi atau siang.</p>
        </div>
        <div className="why__picker" aria-hidden="true">
          <span className="why__confirm">
            {/* The other side of the booking: the picker shows what the renter
                chose, this shows where it lands (the owner's Jadwal survey panel). */}
            <span className="why__confirm-icon"><BellRing size={14} strokeWidth={2.5} /></span>
            <span className="why__confirm-text">
              <strong>Jadwal survey baru</strong>
              <span>Masuk ke dashboard pemilik</span>
            </span>
          </span>
          <div className="why__picker-row">
            <span className="why__chip why__chip--on">Sen, 20 Okt</span>
            <span className="why__chip">Sel, 21 Okt</span>
          </div>
          <div className="why__seg">
            <span className="why__seg-on">Pagi</span>
            <span>Siang</span>
          </div>
          <span className="why__picker-btn">Jadwalkan survey</span>
        </div>
      </article>

      <article className="why__tile why__tile--discount">
        <div className="why__price" aria-hidden="true">
          <div className="why__price-top">
            <span className="why__price-old">Rp 1.500.000</span>
            <span className="why__price-badge">Harga mahasiswa</span>
          </div>
          <span className="why__price-new">Rp 1.400.000</span>
          <span className="why__price-note">Contoh tampilan</span>
        </div>
        <div>
          <h3>Diskon mahasiswa</h3>
          <p>Potongan dari tiap pemilik, aktif setelah verifikasi email kampus (.ac.id).</p>
        </div>
      </article>

      <article className="why__tile why__tile--rules">
        <div>
          <h3>Aturan dan denda tertulis</h3>
          <p>Peraturan dan nominal denda tertulis sebelum Anda mengajukan.</p>
        </div>
        <div className="why__receipt" aria-hidden="true">
          <span className="why__caption">Contoh aturan</span>
          <ul className="why__rules">
            <li><span>Denda telat bayar</span><i /><b>Rp 50.000 / hari</b></li>
            <li><span>Tamu menginap</span><i /><b>Lapor pemilik</b></li>
            <li><span>Jam malam</span><i /><b>23.00</b></li>
          </ul>
        </div>
      </article>

      <article className="why__tile why__tile--nearby">
        <div className="why__text">
          <h3>Jarak ke kampus dan fasilitas</h3>
          <p>Kampus, tempat makan, minimarket, dan laundry di sekitar kos beserta jaraknya.</p>
        </div>
        <div className="why__route-wrap" aria-hidden="true">
          <span className="why__caption">Contoh jarak dari satu kos</span>
          <ol className="why__route">
            <li className="why__stop why__stop--end why__stop--start">
              <span className="why__stop-dot"><Home size={16} /></span>
              <span className="why__stop-text"><b>Kos</b></span>
            </li>
            {STOPS.map(({ icon: Icon, label, meters }) => (
              <li
                key={label}
                className="why__stop"
              >
                <span className="why__stop-dot"><Icon size={16} /></span>
                <span className="why__stop-text">
                  <span>{label}</span>
                  <b>{meters} m</b>
                </span>
              </li>
            ))}
            <li className="why__stop why__stop--end why__stop--finish">
              <span className="why__stop-dot why__stop-dot--on"><GraduationCap size={16} /></span>
              <span className="why__stop-text">
                <span>Kampus</span>
                <b>{CAMPUS_DISTANCE} m</b>
              </span>
            </li>
          </ol>
        </div>
      </article>
    </div>
  </section>
);
