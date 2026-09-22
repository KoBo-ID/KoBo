import React, { useState } from 'react';
import { Building2, Plus, Edit, Trash2, Eye, Bed, MapPin, CheckCircle2, Footprints } from 'lucide-react';
import { useAppStore } from '../../store/AppContext';
import { Kos, Room } from '../../types';
import { KosFormModal } from '../../components/owner/KosFormModal';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Link } from 'react-router-dom';

export const KosManager: React.FC = () => {
  const { kosList, deleteKos, addRoomToKos, deleteRoomFromKos } = useAppStore();

  const [editingKos, setEditingKos] = useState<Kos | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [roomModalKosId, setRoomModalKosId] = useState<string | null>(null);

  // New room state
  const [roomNumber, setRoomNumber] = useState('');
  const [floor, setFloor] = useState(1);
  const [roomType, setRoomType] = useState('Deluxe AC');
  const [priceMonthly, setPriceMonthly] = useState(1650000);
  const [size, setSize] = useState('3 x 4 m');

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomModalKosId) return;

    addRoomToKos(roomModalKosId, {
      roomNumber,
      floor: Number(floor),
      roomType,
      size,
      bedType: 'Single Bed 120x200',
      priceMonthly: Number(priceMonthly),
      status: 'vacant',
    });

    setRoomNumber('');
    setRoomModalKosId(null);
  };

  return (
    <div className="app-container" style={{ maxWidth: '1080px', paddingTop: '2.5rem', paddingBottom: '4rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '2.1rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em' }}>
            Kelola Properti Kos (CRUD Kos)
          </h1>
          <p style={{ fontSize: '0.95rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Daftarkan properti baru, atur tipe kamar, harga sewa bulanan, dan kelola inventaris kamar kos Anda.
          </p>
        </div>

        <Button
          variant="primary"
          size="md"
          onClick={() => {
            setEditingKos(null);
            setIsFormOpen(true);
          }}
          icon={<Plus size={16} />}
        >
          Tambah Kos Baru
        </Button>
      </div>

      {/* Kos Properties List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        {kosList.map((kos) => (
          <div
            key={kos.id}
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderRadius: 'var(--radius-lg)',
              border: '1.5px solid var(--border-subtle)',
              boxShadow: 'var(--shadow-sm)',
              padding: '1.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.5rem',
            }}
          >
            {/* Header with image, details, and actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1.25rem' }}>
              <div style={{ display: 'flex', gap: '1.25rem' }}>
                <img
                  src={kos.images[0]}
                  alt={kos.name}
                  style={{
                    width: '110px',
                    height: '110px',
                    borderRadius: 'var(--radius-md)',
                    objectFit: 'cover',
                  }}
                />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span
                      style={{
                        backgroundColor: 'var(--primary-light)',
                        color: 'var(--primary)',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        padding: '0.15rem 0.55rem',
                        borderRadius: 'var(--radius-badge)',
                        textTransform: 'capitalize',
                      }}
                    >
                      {kos.gender}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-subtle)' }}>
                      ID: {kos.id}
                    </span>
                  </div>

                  <h3 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '0.35rem' }}>
                    {kos.name}
                  </h3>

                  <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                    <MapPin size={14} style={{ display: 'inline', marginRight: '0.25rem' }} />
                    {kos.address}
                  </p>

                  <p style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600, marginTop: '0.2rem' }}>
                    <Footprints size={13} /> {kos.campusProximity.distanceMeters}m ke {kos.campusProximity.campusName}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Link to={`/kos/${kos.id}`}>
                  <Button variant="outline" size="sm" icon={<Eye size={14} />}>
                    Lihat Publik
                  </Button>
                </Link>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingKos(kos);
                    setIsFormOpen(true);
                  }}
                  icon={<Edit size={14} />}
                >
                  Edit Kos
                </Button>

                {kosList.length > 1 && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      if (window.confirm(`Hapus properti "${kos.name}" beserta seluruh kamarnya?`)) {
                        deleteKos(kos.id);
                      }
                    }}
                    icon={<Trash2 size={14} />}
                  >
                    Hapus
                  </Button>
                )}
              </div>
            </div>

            {/* Room Inventory Sub-Table */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <h4 style={{ fontSize: '1rem', fontWeight: 700 }}>
                  Daftar Kamar ({kos.rooms.length} Kamar)
                </h4>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setRoomModalKosId(kos.id)}
                  icon={<Plus size={14} />}
                >
                  Tambah Kamar
                </Button>
              </div>

              <div
                style={{
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  overflowX: 'auto',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: 'var(--bg-muted)', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}>
                      <th style={{ padding: '0.65rem 1rem' }}>No. Kamar</th>
                      <th style={{ padding: '0.65rem 1rem' }}>Lantai</th>
                      <th style={{ padding: '0.65rem 1rem' }}>Tipe & Dimensi</th>
                      <th style={{ padding: '0.65rem 1rem' }}>Harga Sewa</th>
                      <th style={{ padding: '0.65rem 1rem' }}>Status</th>
                      <th style={{ padding: '0.65rem 1rem' }}>Penghuni</th>
                      <th style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kos.rooms.map((room) => (
                      <tr key={room.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '0.65rem 1rem', fontWeight: 700 }}>{room.roomNumber}</td>
                        <td style={{ padding: '0.65rem 1rem' }}>Lt. {room.floor}</td>
                        <td style={{ padding: '0.65rem 1rem' }}>{room.roomType} ({room.size})</td>
                        <td style={{ padding: '0.65rem 1rem', fontWeight: 700, color: 'var(--primary)' }}>
                          {formatRupiah(room.priceMonthly)}
                        </td>
                        <td style={{ padding: '0.65rem 1rem' }}>
                          <span
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              padding: '0.15rem 0.45rem',
                              borderRadius: 'var(--radius-badge)',
                              backgroundColor: room.status === 'vacant' ? 'var(--status-vacant-bg)' : 'var(--status-paid-bg)',
                              color: room.status === 'vacant' ? 'var(--status-vacant)' : 'var(--status-paid)',
                              textTransform: 'capitalize',
                            }}
                          >
                            {room.status}
                          </span>
                        </td>
                        <td style={{ padding: '0.65rem 1rem', color: 'var(--text-muted)' }}>
                          {room.tenantName || '-'}
                        </td>
                        <td style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>
                          <button
                            onClick={() => deleteRoomFromKos(kos.id, room.id)}
                            style={{
                              color: 'var(--status-overdue)',
                              fontSize: '0.75rem',
                              cursor: 'pointer',
                            }}
                          >
                            Hapus
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Kos Form Modal (Add / Edit) */}
      {isFormOpen && (
        <KosFormModal
          isOpen={isFormOpen}
          onClose={() => {
            setIsFormOpen(false);
            setEditingKos(null);
          }}
          existingKos={editingKos}
        />
      )}

      {/* Add Room Modal */}
      {roomModalKosId && (
        <Modal
          isOpen={!!roomModalKosId}
          onClose={() => setRoomModalKosId(null)}
          title="Tambah Kamar Baru ke Properti"
          maxWidth="sm"
        >
          <form onSubmit={handleCreateRoom} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <Input
              label="Nomor / Nama Kamar"
              value={roomNumber}
              onChange={(e) => setRoomNumber(e.target.value)}
              placeholder="Contoh: 105 atau B2"
              required
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <Input
                label="Lantai Gedung"
                type="number"
                value={floor}
                onChange={(e) => setFloor(Number(e.target.value))}
                min={1}
                required
              />
              <Input
                label="Ukuran Kamar"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="3 x 4 m"
                required
              />
            </div>
            <Input
              label="Tipe Kamar"
              value={roomType}
              onChange={(e) => setRoomType(e.target.value)}
              placeholder="Deluxe AC"
              required
            />
            <Input
              label="Harga Sewa Bulanan (Rp)"
              type="number"
              value={priceMonthly}
              onChange={(e) => setPriceMonthly(Number(e.target.value))}
              required
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
              <Button type="button" variant="ghost" size="sm" onClick={() => setRoomModalKosId(null)}>
                Batal
              </Button>
              <Button type="submit" variant="primary" size="sm" icon={<CheckCircle2 size={16} />}>
                Simpan Kamar
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
