import '../../styles/owner-form.css';
import React, { useId, useMemo, useRef, useState } from 'react';
import { Building2, CheckCircle2, MapPin, Search } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { haversineMeters, parseCoordinates } from '@kobo/shared/domain';
import type { FacilityItem } from '@kobo/shared/facilities';
import { MAX_ROOMS_PER_KOS } from '@kobo/shared/schemas';
import type { OwnerKos } from '../../../../backend/src/trpc/router';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Notice } from '../ui/Notice';
import { FacilityEditor } from './FacilityEditor';
import { useAppStore } from '../../store/AppContext';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';
import { useOwnerWorkspace } from '../../lib/ownerWorkspace';
import { CAMPUSES } from '../../data/campuses';

interface KosFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingKos?: OwnerKos | null;
}

type Lookup = 'idle' | 'found' | 'area' | 'notfound' | 'error';

const toNumber = (v: string) => (v.trim() === '' ? NaN : Number(v));

const Section: React.FC<{ title: string; intro?: string; children: React.ReactNode }> = ({ title, intro, children }) => {
  const id = useId();
  return (
    <section className="okf-section" role="group" aria-labelledby={id}>
      <div className="okf-section__head">
        <h3 id={id} className="okf-section__title">{title}</h3>
        {intro && <p className="okf-section__intro">{intro}</p>}
      </div>
      {children}
    </section>
  );
};

export const KosFormModal: React.FC<KosFormModalProps> = ({ isOpen, onClose, existingKos }) => {
  const { addToast } = useAppStore();
  const { selectKos } = useOwnerWorkspace();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const create = useMutation(trpc.owner.kos.create.mutationOptions());
  const update = useMutation(trpc.owner.kos.update.mutationOptions());
  const resolveAddress = useMutation(trpc.place.resolveAddress.mutationOptions());

  const [name, setName] = useState(existingKos?.name ?? '');
  const [gender, setGender] = useState<string>(existingKos?.gender ?? '');
  const [address, setAddress] = useState(existingKos?.address ?? '');
  const [district, setDistrict] = useState(existingKos?.district ?? '');
  const [city, setCity] = useState(existingKos?.city ?? '');
  const [lat, setLat] = useState(existingKos ? String(existingKos.lat) : '');
  const [lng, setLng] = useState(existingKos ? String(existingKos.lng) : '');
  const [lookup, setLookup] = useState<Lookup>(existingKos ? 'found' : 'idle');
  const [electricityType, setElectricityType] = useState<string>(existingKos?.electricityType ?? '');
  const [floors, setFloors] = useState(existingKos?.floors ? String(existingKos.floors) : '');
  const [roomCount, setRoomCount] = useState('');
  const [area, setArea] = useState(existingKos?.buildingAreaM2 ? String(existingKos.buildingAreaM2) : '');
  const [priceMonthly, setPriceMonthly] = useState('');
  const [discount, setDiscount] = useState(existingKos ? String(existingKos.studentDiscountAmount) : '');
  const [facilities, setFacilities] = useState<FacilityItem[]>(existingKos?.facilities ?? []);
  const [coordsOpen, setCoordsOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteResult, setPasteResult] = useState<'ok' | 'bad' | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const point = useMemo(() => {
    const la = toNumber(lat);
    const ln = toNumber(lng);
    return Number.isFinite(la) && Number.isFinite(ln) ? { lat: la, lng: ln } : null;
  }, [lat, lng]);

  /** Campuses by distance from the entered location, nearest first (the server stores the nearest one itself). */
  const nearby = useMemo(() => {
    if (!point) return [];
    return CAMPUSES.map((c) => ({ campus: c, meters: haversineMeters(point, c.coordinates) }))
      .sort((a, b) => a.meters - b.meters)
      .slice(0, 3);
  }, [point]);

  const findLocation = async () => {
    setServerError(null);
    if (address.trim().length < 5) {
      setErrors((e) => ({ ...e, address: 'Tulis alamat lengkap dulu, misalnya nama jalan, nomor, dan kelurahan.' }));
      return;
    }
    setErrors((e) => {
      const { address: _a, ...rest } = e;
      return rest;
    });
    try {
      const match = await resolveAddress.mutateAsync({ q: `${address}${city ? `, ${city}` : ''}` });
      if (!match) {
        setLookup('notfound');
        return;
      }
      setLat(String(match.lat));
      setLng(String(match.lng));
      if (match.city) setCity(match.city);
      if (match.district) setDistrict(match.district);
      setLookup(match.precision === 'area' ? 'area' : 'found');
      if (match.precision === 'area') setCoordsOpen(true);
    } catch {
      setLookup('error');
    }
  };

  const pickCampus = (id: string) => {
    const c = CAMPUSES.find((x) => x.id === id);
    if (!c) return;
    setLat(String(c.coordinates.lat));
    setLng(String(c.coordinates.lng));
    if (!city) setCity(c.city);
    setLookup('found');
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Tulis nama kos, misalnya "Kost Wisma Sakura".';
    if (!gender) e.gender = 'Pilih siapa yang boleh menyewa.';
    if (!address.trim()) e.address = 'Tulis alamat lengkap kos.';
    if (!district.trim()) e.district = 'Isi kecamatan atau kelurahan.';
    if (!city.trim()) e.city = 'Isi kota atau kabupaten.';
    if (!point) e.lat = 'Titik lokasi belum ada. Tekan "Cari lokasi" atau pilih kampus terdekat.';
    if (!electricityType) e.electricity = 'Pilih sistem listrik.';
    const fl = toNumber(floors);
    if (!existingKos && !(fl >= 1 && fl <= 60)) e.floors = 'Isi jumlah lantai, antara 1 dan 60.';
    else if (floors.trim() && !(fl >= 1 && fl <= 60)) e.floors = 'Jumlah lantai harus antara 1 dan 60.';
    if (!existingKos) {
      const rc = toNumber(roomCount);
      if (!(Number.isInteger(rc) && rc >= 1 && rc <= MAX_ROOMS_PER_KOS)) e.roomCount = `Isi jumlah kamar, antara 1 dan ${MAX_ROOMS_PER_KOS}.`;
      if (!(toNumber(priceMonthly) > 0)) e.price = 'Isi harga sewa per bulan.';
    }
    if (area.trim() && !(toNumber(area) >= 1)) e.area = 'Isi luas dalam meter persegi.';
    const d = discount.trim() === '' ? 0 : toNumber(discount);
    if (!(d >= 0 && d <= 5_000_000)) e.discount = 'Potongan harus antara 0 dan 5.000.000.';
    if (facilities.some((f) => f.status === 'PAID' && f.fee != null && f.fee < 0)) e.facilities = 'Biaya fasilitas tidak boleh negatif.';
    return e;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setServerError(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      // GOV.UK pattern: the summary takes focus and links to each field; what was typed stays.
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    const fields = {
      name: name.trim(),
      gender: gender as OwnerKos['gender'],
      address: address.trim(),
      district: district.trim(),
      city: city.trim(),
      lat: point!.lat,
      lng: point!.lng,
      electricityType: electricityType as OwnerKos['electricityType'],
      facilities,
      studentDiscountAmount: discount.trim() === '' ? 0 : Number(discount),
      ...(floors.trim() ? { floors: Number(floors) } : {}),
      ...(area.trim() ? { buildingAreaM2: Number(area) } : {}),
    };
    try {
      if (existingKos) {
        await update.mutateAsync({ ...fields, kosId: existingKos.id });
        addToast('Informasi kos berhasil diperbarui.', 'success');
      } else {
        const { id } = await create.mutateAsync({ ...fields, initialRooms: { count: Number(roomCount), priceMonthly: Number(priceMonthly) } });
        addToast(`Properti kos "${name.trim()}" berhasil didaftarkan. Tambahkan foto dari menu Kelola foto agar kos menarik dilihat.`, 'success');
        await qc.invalidateQueries({ queryKey: trpc.owner.myKos.queryKey() });
        selectKos(id);
      }
      void qc.invalidateQueries({ queryKey: trpc.owner.pathKey() });
      void qc.invalidateQueries({ queryKey: trpc.kos.pathKey() });
      onClose();
    } catch (err) {
      setServerError(messageForError(err));
      requestAnimationFrame(() => summaryRef.current?.focus());
    }
  };

  const pending = create.isPending || update.isPending;
  const errorList = Object.entries(errors);
  const fieldId: Record<string, string> = { name: 'okf-name', gender: 'okf-gender', address: 'okf-address', district: 'okf-district', city: 'okf-city', lat: 'okf-find', electricity: 'okf-electricity', floors: 'okf-floors', roomCount: 'okf-rooms', price: 'okf-price', area: 'okf-area', discount: 'okf-discount', facilities: 'okf-facilities' };
  const perFloor = !existingKos && toNumber(floors) >= 1 && toNumber(roomCount) >= 1 ? Math.ceil(toNumber(roomCount) / toNumber(floors)) : null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Building2 size={20} color="var(--primary)" />
          <span>{existingKos ? 'Edit Properti Kos' : 'Daftarkan Properti Kos Baru'}</span>
        </div>
      }
      subtitle={existingKos ? 'Perubahan langsung tampil di halaman kos.' : 'Isi dari atas ke bawah. Alamat dulu, sisanya terisi sebagian otomatis.'}
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} noValidate className="okf">
        {(errorList.length > 0 || serverError) && (
          <div ref={summaryRef} tabIndex={-1} role="alert" className="okf-summary">
            <p className="okf-summary__title">{serverError ? 'Kos belum tersimpan' : 'Ada isian yang perlu diperbaiki'}</p>
            {serverError ? (
              <p className="okf-summary__text">{serverError}</p>
            ) : (
              <ul>
                {errorList.map(([key, message]) => (
                  <li key={key}>
                    <a href={`#${fieldId[key]}`} onClick={(ev) => { ev.preventDefault(); document.getElementById(fieldId[key])?.focus(); }}>{message}</a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <Section title="1. Identitas">
          <Input id="okf-name" label="Nama Properti Kos" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="Contoh: Kost Wisma Sakura" maxLength={100} />
          <div className="okf-grid">
            <Select
              id="okf-gender"
              label="Kategori Penghuni"
              value={gender}
              error={errors.gender}
              onChange={(e) => setGender(e.target.value)}
              options={[
                { value: '', label: 'Pilih kategori…' },
                { value: 'CAMPUR', label: 'Kost Campur (Putra & Putri)' },
                { value: 'PUTRI', label: 'Khusus Putri' },
                { value: 'PUTRA', label: 'Khusus Putra' },
              ]}
            />
            <Select
              id="okf-electricity"
              label="Sistem Listrik"
              value={electricityType}
              error={errors.electricity}
              onChange={(e) => setElectricityType(e.target.value)}
              options={[
                { value: '', label: 'Pilih sistem listrik…' },
                { value: 'TOKEN', label: 'Listrik token mandiri' },
                { value: 'INCLUDED', label: 'Termasuk biaya sewa' },
              ]}
            />
          </div>
        </Section>

        <Section title="2. Lokasi" intro="Mulai dari alamat. Kota, kecamatan, dan titik peta terisi otomatis, dan Anda tetap bisa mengubahnya.">
          <Input id="okf-address" label="Alamat Lengkap Kos" value={address} onChange={(e) => { setAddress(e.target.value); if (lookup !== 'idle') setLookup('idle'); }} error={errors.address} placeholder="Jl. KH. Syahdan No. 28, RT 02/RW 11" maxLength={200} />
          <div className="okf-find">
            <Button id="okf-find" type="button" variant="secondary" size="sm" icon={<Search size={14} />} isLoading={resolveAddress.isPending} onClick={() => void findLocation()}>
              Cari lokasi
            </Button>
            {lookup === 'found' && point && (
              <span className="okf-find__ok" role="status">
                <CheckCircle2 size={15} aria-hidden="true" /> Lokasi ditemukan. Periksa kota dan kecamatan di bawah.
              </span>
            )}
            {lookup === 'area' && (
              <span className="okf-find__warn" role="status">
                Nama jalan atau cluster ini belum ada di peta, jadi titik memakai pusat {district || 'wilayah'}. Kota dan kecamatan sudah terisi. Untuk titik yang tepat, tempel tautan Google Maps di bawah.
              </span>
            )}
            {lookup === 'notfound' && <span className="okf-find__warn" role="status">Alamat tidak ditemukan. Cek ejaan kelurahan dan kecamatan, atau tempel tautan Google Maps di bawah. Bisa juga isi kota dan kecamatan lalu pilih kampus terdekat.</span>}
            {lookup === 'error' && <span className="okf-find__warn" role="status">Pencarian alamat sedang tidak tersedia. Isi kota dan kecamatan secara manual, lalu pilih kampus terdekat di bawah.</span>}
            {errors.lat && <span className="okf-find__err">{errors.lat}</span>}
          </div>

          <div className="okf-grid">
            <Input id="okf-district" label="Kecamatan / Kelurahan" value={district} onChange={(e) => setDistrict(e.target.value)} error={errors.district} placeholder="Contoh: Kemanggisan" maxLength={80} />
            <Input id="okf-city" label="Kota / Kabupaten" value={city} onChange={(e) => setCity(e.target.value)} error={errors.city} placeholder="Contoh: Jakarta Barat" maxLength={80} />
          </div>

          {point && nearby.length > 0 && (
            <div className="okf-campuses" aria-live="polite">
              <p className="okf-label">Kampus terdekat dari lokasi ini</p>
              <ul>
                {nearby.map(({ campus, meters }, index) => (
                  <li key={campus.id}>
                    <MapPin size={14} aria-hidden="true" />
                    <span>{campus.name}</span>
                    <span className="okf-campuses__dist">{meters >= 1000 ? `${(meters / 1000).toFixed(1).replace('.', ',')} km` : `${meters} m`}{index === 0 && meters <= 10_000 ? ' (tertaut otomatis)' : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(lookup === 'notfound' || lookup === 'error') && (
            <Select
              id="okf-campus"
              label="Pakai titik kampus terdekat"
              value=""
              onChange={(e) => pickCampus(e.target.value)}
              options={[{ value: '', label: 'Pilih kampus terdekat…' }, ...CAMPUSES.map((c) => ({ value: c.id, label: c.name }))]}
              helperText="Dipakai hanya bila alamat tidak ditemukan. Titik bisa diperhalus di bawah."
            />
          )}

          <details className="okf-coords" open={coordsOpen} onToggle={(e) => setCoordsOpen((e.currentTarget as HTMLDetailsElement).open)}>
            <summary>Ubah titik koordinat</summary>
            <div className="okf-grid">
              <Input
                id="okf-paste"
                label="Tempel tautan Google Maps atau koordinat"
                value={pasted}
                onChange={(e) => {
                  const text = e.target.value;
                  setPasted(text);
                  const found = text.trim() ? parseCoordinates(text) : null;
                  if (found) {
                    setLat(String(found.lat));
                    setLng(String(found.lng));
                    setLookup('found');
                  }
                  setPasteResult(!text.trim() ? null : found ? 'ok' : 'bad');
                }}
                placeholder="Contoh: -6.2437, 106.6291"
                error={pasteResult === 'bad' ? 'Titik tidak terbaca. Pakai tautan panjang dari Google Maps (bukan maps.app.goo.gl) atau tulis "lintang, bujur".' : undefined}
                helperText={pasteResult === 'ok' ? 'Titik diperbarui dari tautan.' : 'Buka lokasi kos di Google Maps, pilih Bagikan, lalu tempel tautannya.'}
              />
              <Input label="Latitude" type="number" step="any" value={lat} onChange={(e) => setLat(e.target.value)} />
              <Input label="Longitude" type="number" step="any" value={lng} onChange={(e) => setLng(e.target.value)} />
            </div>
          </details>
        </Section>

        <Section title="3. Bangunan" intro={existingKos ? 'Kamar ditambah atau dihapus satu per satu di Kelola properti.' : 'Kamar dibuat merata di setiap lantai. Nomor, tipe, dan harga tiap kamar bisa diubah setelahnya.'}>
          <Input id="okf-floors" label="Jumlah Lantai" type="number" inputMode="numeric" min={1} max={60} value={floors} onChange={(e) => setFloors(e.target.value)} error={errors.floors} placeholder="Contoh: 3" />
          {existingKos ? (
            <div className="okf-static">
              <span className="okf-label">Jumlah Kamar</span>
              <span className="okf-static__value">{existingKos.totalRooms} kamar</span>
            </div>
          ) : (
            <Input id="okf-rooms" label="Jumlah Kamar" type="number" inputMode="numeric" min={1} max={MAX_ROOMS_PER_KOS} value={roomCount} onChange={(e) => setRoomCount(e.target.value)} error={errors.roomCount} placeholder="Contoh: 12" helperText={perFloor ? `Sekitar ${perFloor} kamar per lantai` : undefined} />
          )}
          <Input id="okf-area" label="Luas Bangunan (m², opsional)" type="number" inputMode="numeric" min={1} value={area} onChange={(e) => setArea(e.target.value)} error={errors.area} placeholder="Contoh: 320" />
        </Section>

        <Section title="4. Harga dan diskon">
          <div className="okf-grid">
            {!existingKos && (
              <Input id="okf-price" label="Harga Sewa per Kamar (Rp/bulan)" type="number" inputMode="numeric" min={0} value={priceMonthly} onChange={(e) => setPriceMonthly(e.target.value)} error={errors.price} placeholder="Contoh: 1600000" />
            )}
            <Input
              id="okf-discount"
              label="Potongan Diskon Mahasiswa (Rp)"
              type="number"
              inputMode="numeric"
              min={0}
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              error={errors.discount}
              placeholder="0 bila tidak ada"
              info="Nominal ini dikurangkan dari tagihan pembayaran pertama, hanya untuk mahasiswa yang email kampusnya sudah terverifikasi. Harga sewa per bulan tidak berubah."
            />
          </div>
        </Section>

        <Section title="5. Fasilitas kamar" intro="Pilih yang ada di dalam kamar. Kosongkan yang tidak tersedia.">
          <div id="okf-facilities" tabIndex={-1}>
            <FacilityEditor scope="KAMAR" value={facilities} onChange={setFacilities} />
          </div>
          {errors.facilities && <span className="okf-find__err">{errors.facilities}</span>}
        </Section>

        <Section title="6. Fasilitas gedung" intro="Keamanan, parkir, utilitas, dan layanan yang dipakai bersama. Tandai yang berbayar dan isi biayanya.">
          <FacilityEditor scope="GEDUNG" value={facilities} onChange={setFacilities} />
        </Section>

        {!existingKos && <p className="okf-note">Foto kos diunggah setelah kos tersimpan, lewat menu Kelola foto. Kos yang baru terdaftar muncul di pencarian setelah akun pemilik disetujui KoBo.</p>}

        <div className="okf-actions">
          <Button type="button" variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" variant="primary" isLoading={pending} disabled={pending} icon={<CheckCircle2 size={16} />}>
            {existingKos ? 'Simpan Perubahan Kos' : 'Simpan Kos Baru'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
