import React, { useState } from 'react';
import { Home, Building2, MapPin, Image, ShieldCheck, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { Kos, KosGender, Room } from '../../types';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useAppStore } from '../../store/AppContext';
import { CAMPUSES } from '../../data/campuses';

interface KosFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingKos?: Kos | null;
}

export const KosFormModal: React.FC<KosFormModalProps> = ({
  isOpen,
  onClose,
  existingKos,
}) => {
  const { addKos, updateKos, currentUser } = useAppStore();

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Form State
  const [name, setName] = useState(existingKos?.name || '');
  const [gender, setGender] = useState<KosGender>(existingKos?.gender || 'campur');
  const [address, setAddress] = useState(existingKos?.address || '');
  const [district, setDistrict] = useState(existingKos?.district || 'Kemanggisan');
  const [city, setCity] = useState(existingKos?.city || 'Jakarta Barat');
  const [selectedCampus, setSelectedCampus] = useState(existingKos?.campusProximity.campusId || 'binus-syahdan');
  const [distanceMeters, setDistanceMeters] = useState(existingKos?.campusProximity.distanceMeters || 350);
  const [walkMinutes, setWalkMinutes] = useState(existingKos?.campusProximity.walkMinutes || 4);
  const [priceMonthlyStart, setPriceMonthlyStart] = useState(existingKos?.priceMonthlyStart || 1600000);
  const [studentDiscountAmount, setStudentDiscountAmount] = useState(existingKos?.studentDiscountAmount || 150000);
  const [studentDiscountLabel, setStudentDiscountLabel] = useState(existingKos?.studentDiscountLabel || 'Diskon Mhs Rp 150rb');
  const [electricityType, setElectricityType] = useState<'included' | 'token'>(existingKos?.electricityType || 'token');
  const [imageUrl, setImageUrl] = useState(
    existingKos?.images[0] ||
      'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=800&auto=format&fit=crop&q=80'
  );

  // Initial Rooms
  const [roomCount, setRoomCount] = useState(existingKos?.rooms.length || 6);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const campusObj = CAMPUSES.find((c) => c.id === selectedCampus) || CAMPUSES[0];

    // Generate room array if adding new
    const generatedRooms: Room[] = existingKos?.rooms || Array.from({ length: Number(roomCount) }).map((_, i) => ({
      id: `room-gen-${i + 1}`,
      kosId: existingKos?.id || 'kos-temp',
      roomNumber: `${101 + i}`,
      floor: Math.floor(i / 4) + 1,
      roomType: 'Deluxe AC Mahasiswa',
      size: '3 x 4 m',
      bedType: 'Single Bed 120x200',
      priceMonthly: Number(priceMonthlyStart),
      status: i === 0 ? 'paid' : i === 1 ? 'due' : 'vacant',
      tenantName: i === 0 ? 'Bima Sakti' : undefined,
      tenantPhone: i === 0 ? '081298765431' : undefined,
      tenantCampus: i === 0 ? campusObj.name : undefined,
    }));

    if (existingKos) {
      updateKos(existingKos.id, {
        name,
        gender,
        address,
        district,
        city,
        campusProximity: {
          campusId: campusObj.id,
          campusName: campusObj.shortName,
          distanceMeters: Number(distanceMeters),
          walkMinutes: Number(walkMinutes),
        },
        priceMonthlyStart: Number(priceMonthlyStart),
        studentDiscountAmount: Number(studentDiscountAmount),
        studentDiscountLabel,
        electricityType,
      });
    } else {
      addKos({
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        gender,
        address,
        district,
        city,
        coordinates: campusObj.coordinates,
        campusProximity: {
          campusId: campusObj.id,
          campusName: campusObj.shortName,
          distanceMeters: Number(distanceMeters),
          walkMinutes: Number(walkMinutes),
        },
        priceMonthlyStart: Number(priceMonthlyStart),
        studentDiscountAmount: Number(studentDiscountAmount),
        studentDiscountLabel,
        images: [
          imageUrl,
          'https://images.unsplash.com/photo-1598928506311-c55ded91a20c?w=800&auto=format&fit=crop&q=80',
          'https://images.unsplash.com/photo-1584622650111-993a426fbf0a?w=800&auto=format&fit=crop&q=80',
          'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&auto=format&fit=crop&q=80',
          'https://images.unsplash.com/photo-1554995207-c18c203602cb?w=800&auto=format&fit=crop&q=80',
        ],
        privateAmenities: ['AC 1/2 PK', 'Kamar Mandi Dalam', 'Kasur Springbed', 'Meja Belajar'],
        sharedAmenities: ['Wi-Fi Kencang', 'Dapur Bersama', 'Parkir Motor', 'CCTV 24 Jam'],
        electricityType,
        totalRooms: generatedRooms.length,
        availableRooms: generatedRooms.filter((r) => r.status === 'vacant').length,
        owner: {
          id: currentUser.id,
          name: currentUser.name,
          phone: currentUser.phone,
          avatar: currentUser.avatar,
          responseRate: '100% (balas cepat)',
          memberSince: 'Hari ini',
          verified: true,
          totalProperties: 1,
        },
        rules: [
          {
            id: 'r-default-1',
            tier: 1,
            categoryTitle: 'Akses & Jam Malam',
            rules: ['Pagar dikunci jam 23.00 WIB, penghuni mendapat kunci mandiri.'],
            penaltyAmount: 50000,
          },
          {
            id: 'r-default-4',
            tier: 4,
            categoryTitle: 'Denda Keterlambatan Sewa',
            rules: ['Jatuh tempo tanggal 5 setiap bulan. Denda telat Rp 25.000/hari.'],
            penaltyAmount: 25000,
          },
        ],
        pois: [
          {
            id: 'poi-gen-1',
            category: 'campus',
            name: `${campusObj.shortName} (Gerbang Utama)`,
            distanceMeters: Number(distanceMeters),
            walkMinutes: Number(walkMinutes),
            description: 'Jalan kaki langsung tanpa hambatan kendaraan.',
          },
        ],
        rooms: generatedRooms,
      });
    }

    onClose();
  };

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
      subtitle="Kelola properti kos Anda secara profesional dan gratis di KoBo"
      maxWidth="lg"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Step 1: Info Dasar & Lokasi Kampus */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <Input
            label="Nama Properti Kos"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Contoh: Kost Wisma Sakura Syahdan"
            required
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Select
              label="Kategori Penghuni"
              value={gender}
              onChange={(e) => setGender(e.target.value as KosGender)}
              options={[
                { value: 'campur', label: 'Kost Campur (Putra & Putri)' },
                { value: 'putri', label: 'Khusus Putri' },
                { value: 'putra', label: 'Khusus Putra' },
              ]}
            />
            <Select
              label="Kampus Terdekat"
              value={selectedCampus}
              onChange={(e) => setSelectedCampus(e.target.value)}
              options={CAMPUSES.map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <Input
              label="Jarak ke Kampus (Meter)"
              type="number"
              value={distanceMeters}
              onChange={(e) => setDistanceMeters(Number(e.target.value))}
              required
            />
            <Input
              label="Estimasi Jalan (Menit)"
              type="number"
              value={walkMinutes}
              onChange={(e) => setWalkMinutes(Number(e.target.value))}
              required
            />
            <Select
              label="Sistem Listrik"
              value={electricityType}
              onChange={(e) => setElectricityType(e.target.value as any)}
              options={[
                { value: 'token', label: 'Listrik Token Mandiri' },
                { value: 'included', label: 'Termasuk Biaya Sewa' },
              ]}
            />
          </div>

          <Input
            label="Alamat Lengkap Kos"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Jl. KH. Syahdan No. 28, RT 02/RW 11"
            required
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Input
              label="Kecamatan / Kelurahan"
              value={district}
              onChange={(e) => setDistrict(e.target.value)}
              required
            />
            <Input
              label="Kota / Kabupaten"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
            />
          </div>
        </div>

        {/* Step 2: Harga & Diskon Mahasiswa */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <h4 style={{ fontSize: '0.95rem', fontWeight: 700 }}>Harga Sewa & Diskon Mahasiswa</h4>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Input
              label="Harga Sewa Mulai (Rp/bulan)"
              type="number"
              value={priceMonthlyStart}
              onChange={(e) => setPriceMonthlyStart(Number(e.target.value))}
              required
            />
            <Input
              label="Potongan Diskon Mahasiswa (KTM)"
              type="number"
              value={studentDiscountAmount}
              onChange={(e) => setStudentDiscountAmount(Number(e.target.value))}
              helperText="Menarik mahasiswa kampus dengan diskon khusus"
              required
            />
          </div>

          {!existingKos && (
            <Input
              label="Jumlah Total Kamar di Properti"
              type="number"
              value={roomCount}
              onChange={(e) => setRoomCount(Number(e.target.value))}
              min={1}
              max={50}
              required
            />
          )}

          <Input
            label="URL Foto Utama Kamar"
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://images.unsplash.com/..."
            required
          />
        </div>

        {/* Modal Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" variant="primary" icon={<CheckCircle2 size={16} />}>
            {existingKos ? 'Simpan Perubahan Kos' : 'Simpan & Buka Papan Kamar'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
