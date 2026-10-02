import React, { useState } from 'react';
import { Building2, CheckCircle2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { OwnerKos } from '../../../../backend/src/trpc/router';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Notice } from '../ui/Notice';
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

const toList = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);

export const KosFormModal: React.FC<KosFormModalProps> = ({ isOpen, onClose, existingKos }) => {
  const { addToast } = useAppStore();
  const { selectKos } = useOwnerWorkspace();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const create = useMutation(trpc.owner.kos.create.mutationOptions());
  const update = useMutation(trpc.owner.kos.update.mutationOptions());
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(existingKos?.name ?? '');
  const [gender, setGender] = useState<OwnerKos['gender']>(existingKos?.gender ?? 'CAMPUR');
  const [address, setAddress] = useState(existingKos?.address ?? '');
  const [district, setDistrict] = useState(existingKos?.district ?? 'Kemanggisan');
  const [city, setCity] = useState(existingKos?.city ?? 'Jakarta Barat');
  const [lat, setLat] = useState(String(existingKos?.lat ?? CAMPUSES[0].coordinates.lat));
  const [lng, setLng] = useState(String(existingKos?.lng ?? CAMPUSES[0].coordinates.lng));
  const [electricityType, setElectricityType] = useState<OwnerKos['electricityType']>(existingKos?.electricityType ?? 'TOKEN');
  const [studentDiscountAmount, setStudentDiscountAmount] = useState(existingKos?.studentDiscountAmount ?? 150000);
  const [privateAmenities, setPrivateAmenities] = useState((existingKos?.privateAmenities ?? ['AC', 'Kamar Mandi Dalam', 'Kasur']).join(', '));
  const [sharedAmenities, setSharedAmenities] = useState((existingKos?.sharedAmenities ?? ['Wi-Fi', 'Dapur Bersama', 'Parkir Motor']).join(', '));
  const [priceMonthly, setPriceMonthly] = useState(1600000);
  const [roomCount, setRoomCount] = useState(6);
  const [imageUrl, setImageUrl] = useState('');

  const fillFromCampus = (id: string) => {
    const c = CAMPUSES.find((x) => x.id === id);
    if (!c) return;
    setLat(String(c.coordinates.lat));
    setLng(String(c.coordinates.lng));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const fields = {
      name,
      gender,
      address,
      district,
      city,
      lat: Number(lat),
      lng: Number(lng),
      electricityType,
      privateAmenities: toList(privateAmenities),
      sharedAmenities: toList(sharedAmenities),
      studentDiscountAmount: Number(studentDiscountAmount),
    };
    try {
      if (existingKos) {
        await update.mutateAsync({ ...fields, kosId: existingKos.id });
        addToast('Informasi kos berhasil diperbarui.', 'success');
      } else {
        const { id } = await create.mutateAsync({
          ...fields,
          imageUrl: imageUrl.trim() || undefined,
          initialRooms: Number(roomCount) > 0 ? { count: Number(roomCount), priceMonthly: Number(priceMonthly) } : undefined,
        });
        addToast(`Properti kos "${name}" berhasil didaftarkan!`, 'success');
        await qc.invalidateQueries({ queryKey: trpc.owner.myKos.queryKey() });
        selectKos(id);
      }
      void qc.invalidateQueries({ queryKey: trpc.owner.pathKey() });
      void qc.invalidateQueries({ queryKey: trpc.kos.pathKey() });
      onClose();
    } catch (err) {
      setError(messageForError(err));
    }
  };

  const pending = create.isPending || update.isPending;

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <Input label="Nama Properti Kos" value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: Kost Wisma Sakura Syahdan" required />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Select
              label="Kategori Penghuni"
              value={gender}
              onChange={(e) => setGender(e.target.value as OwnerKos['gender'])}
              options={[
                { value: 'CAMPUR', label: 'Kost Campur (Putra & Putri)' },
                { value: 'PUTRI', label: 'Khusus Putri' },
                { value: 'PUTRA', label: 'Khusus Putra' },
              ]}
            />
            <Select
              label="Isi Koordinat dari Kampus"
              value=""
              onChange={(e) => fillFromCampus(e.target.value)}
              options={[{ value: '', label: 'Pilih kampus terdekat…' }, ...CAMPUSES.map((c) => ({ value: c.id, label: c.name }))]}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <Input label="Latitude" type="number" step="any" value={lat} onChange={(e) => setLat(e.target.value)} required />
            <Input label="Longitude" type="number" step="any" value={lng} onChange={(e) => setLng(e.target.value)} helperText="Jarak ke kampus dihitung otomatis" required />
            <Select
              label="Sistem Listrik"
              value={electricityType}
              onChange={(e) => setElectricityType(e.target.value as OwnerKos['electricityType'])}
              options={[
                { value: 'TOKEN', label: 'Listrik Token Mandiri' },
                { value: 'INCLUDED', label: 'Termasuk Biaya Sewa' },
              ]}
            />
          </div>

          <Input label="Alamat Lengkap Kos" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Jl. KH. Syahdan No. 28, RT 02/RW 11" required />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <Input label="Kecamatan / Kelurahan" value={district} onChange={(e) => setDistrict(e.target.value)} required />
            <Input label="Kota / Kabupaten" value={city} onChange={(e) => setCity(e.target.value)} required />
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <h4 style={{ fontSize: '0.95rem', fontWeight: 700 }}>Harga Sewa, Diskon & Fasilitas</h4>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {!existingKos && (
              <Input label="Harga Sewa per Kamar (Rp/bulan)" type="number" value={priceMonthly} onChange={(e) => setPriceMonthly(Number(e.target.value))} min={0} required />
            )}
            <Input
              label="Potongan Diskon Mahasiswa"
              type="number"
              value={studentDiscountAmount}
              onChange={(e) => setStudentDiscountAmount(Number(e.target.value))}
              min={0}
              helperText="Berlaku untuk mahasiswa dengan email kampus terverifikasi"
              required
            />
          </div>

          {!existingKos && (
            <Input label="Jumlah Kamar Awal" type="number" value={roomCount} onChange={(e) => setRoomCount(Number(e.target.value))} min={0} max={50} helperText="Kamar bisa ditambah atau dihapus kapan saja" required />
          )}

          <Input label="Fasilitas Kamar" value={privateAmenities} onChange={(e) => setPrivateAmenities(e.target.value)} helperText="Pisahkan dengan koma" />
          <Input label="Fasilitas Bersama" value={sharedAmenities} onChange={(e) => setSharedAmenities(e.target.value)} helperText="Pisahkan dengan koma" />

          {!existingKos && (
            <Input label="URL Foto Utama (opsional)" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://images.unsplash.com/..." />
          )}
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
          <Button type="button" variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button type="submit" variant="primary" disabled={pending} icon={<CheckCircle2 size={16} />}>
            {existingKos ? 'Simpan Perubahan Kos' : 'Simpan Kos Baru'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
