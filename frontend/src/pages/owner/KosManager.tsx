import React, { useState } from 'react';
import { STATUS_META } from '../../components/owner/RoomOccupancyBoard';
import { Plus, Edit, Trash2, Eye, MapPin, CheckCircle2, Footprints, Images } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BoardRoom, OwnerKos } from '../../../../backend/src/trpc/router';
import { useAppStore } from '../../store/AppContext';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';
import { formatRupiah, useOwnerWorkspace } from '../../lib/ownerWorkspace';
import { KosFormModal } from '../../components/owner/KosFormModal';
import { KosPhotosModal } from '../../components/owner/KosPhotosModal';
import { WaitlistPanel } from '../../components/owner/WaitlistPanel';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Link } from 'react-router-dom';

export const KosManager: React.FC = () => {
  const { addToast } = useAppStore();
  const { kosList } = useOwnerWorkspace();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const deleteKosMutation = useMutation(trpc.owner.kos.delete.mutationOptions());
  const createRoomMutation = useMutation(trpc.owner.room.create.mutationOptions());
  const updateRoomMutation = useMutation(trpc.owner.room.update.mutationOptions());
  const deleteRoomMutation = useMutation(trpc.owner.room.delete.mutationOptions());

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: trpc.owner.pathKey() });
    void qc.invalidateQueries({ queryKey: trpc.kos.pathKey() });
  };
  const attempt = async (job: () => Promise<unknown>, ok: string) => {
    try {
      await job();
      addToast(ok, 'success');
      return true;
    } catch (err) {
      addToast(messageForError(err), 'error');
      return false;
    } finally {
      refresh();
    }
  };

  const [editingKos, setEditingKos] = useState<OwnerKos | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [roomModalKosId, setRoomModalKosId] = useState<string | null>(null);
  const [editingRoom, setEditingRoom] = useState<BoardRoom | null>(null);
  const [photosKos, setPhotosKos] = useState<OwnerKos | null>(null);

  // New room state
  const [roomNumber, setRoomNumber] = useState('');
  const [floor, setFloor] = useState(1);
  const [roomType, setRoomType] = useState('Deluxe AC');
  const [priceMonthly, setPriceMonthly] = useState(1650000);
  const [size, setSize] = useState('3 x 4 m');
  const [bedType, setBedType] = useState('Single Bed 120x200');

  const openAddRoom = (kosId: string) => {
    setEditingRoom(null);
    setRoomNumber('');
    setFloor(1);
    setRoomType('Deluxe AC');
    setPriceMonthly(1650000);
    setSize('3 x 4 m');
    setBedType('Single Bed 120x200');
    setRoomModalKosId(kosId);
  };
  const openEditRoom = (kosId: string, room: BoardRoom) => {
    setEditingRoom(room);
    setRoomNumber(room.roomNumber);
    setFloor(room.floor);
    setRoomType(room.type);
    setPriceMonthly(room.priceMonthly);
    setSize(room.size);
    setBedType(room.bedType);
    setRoomModalKosId(kosId);
  };

  const handleSaveRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomModalKosId) return;
    const fields = { roomNumber, floor: Number(floor), type: roomType, size, bedType, priceMonthly: Number(priceMonthly) };
    const ok = await attempt(
      () =>
        editingRoom
          ? updateRoomMutation.mutateAsync({ kosId: roomModalKosId, roomId: editingRoom.id, ...fields })
          : createRoomMutation.mutateAsync({ kosId: roomModalKosId, ...fields }),
      editingRoom ? `Kamar ${roomNumber} berhasil diperbarui.` : `Kamar ${roomNumber} berhasil ditambahkan!`,
    );
    if (ok) {
      setRoomNumber('');
      setEditingRoom(null);
      setRoomModalKosId(null);
    }
  };

  return (
    <div className="app-container" style={{ maxWidth: '1080px', paddingTop: '2.5rem', paddingBottom: '4rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>

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

      {kosList.length === 0 && (
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem 0' }}>Belum ada properti. Daftarkan kos pertama Anda dengan tombol di atas.</p>
      )}
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
                {kos.image ? (
                  <img
                    src={kos.image}
                    alt={kos.name}
                    style={{ width: '110px', height: '110px', borderRadius: 'var(--radius-md)', objectFit: 'cover' }}
                  />
                ) : (
                  <div aria-hidden="true" style={{ width: '110px', height: '110px', borderRadius: 'var(--radius-md)', backgroundColor: 'var(--bg-muted)', flexShrink: 0 }} />
                )}
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
                      {kos.gender.toLowerCase()}
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

                  {kos.nearestCampus && kos.nearestCampus.meters !== null && (
                    <p style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--primary)', fontWeight: 600, marginTop: '0.2rem' }}>
                      <Footprints size={13} /> {kos.nearestCampus.meters}m ke {kos.nearestCampus.shortName}
                    </p>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Link to={`/kos/${kos.id}`}>
                  <Button variant="outline" size="sm" icon={<Eye size={14} />}>
                    Lihat Publik
                  </Button>
                </Link>

                <Button variant="outline" size="sm" onClick={() => setPhotosKos(kos)} icon={<Images size={14} />}>
                  Foto
                </Button>

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

                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    if (window.confirm(`Hapus properti "${kos.name}" beserta seluruh kamarnya?`)) {
                      void attempt(() => deleteKosMutation.mutateAsync({ kosId: kos.id }), 'Properti kos telah dihapus.');
                    }
                  }}
                  icon={<Trash2 size={14} />}
                >
                  Hapus
                </Button>
              </div>
            </div>

            {/* Room Inventory Sub-Table */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <h4 style={{ fontSize: '1rem', fontWeight: 700 }}>
                  Daftar Kamar ({kos.totalRooms} Kamar)
                </h4>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openAddRoom(kos.id)}
                  icon={<Plus size={14} />}
                >
                  Tambah Kamar
                </Button>
              </div>

              <div className="kobo-table-wrap">
                <table className="kobo-table">
                  <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', padding: 0 }}>
                    Daftar kamar {kos.name}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">No. Kamar</th>
                      <th scope="col">Lantai</th>
                      <th scope="col">Tipe &amp; Dimensi</th>
                      <th scope="col" className="kobo-table__right">Harga Sewa</th>
                      <th scope="col">Status</th>
                      <th scope="col">Penghuni</th>
                      <th scope="col" className="kobo-table__right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kos.rooms.map((room) => (
                      <tr key={room.id}>
                        <td className="kobo-table__strong">{room.roomNumber}</td>
                        <td>Lt. {room.floor}</td>
                        <td>{room.type} ({room.size})</td>
                        <td className="kobo-table__num kobo-table__right">{formatRupiah(room.priceMonthly)}</td>
                        <td>
                          <span
                            className={room.status === 'vacant' ? 'kobo-status kobo-status--hollow' : 'kobo-status'}
                            style={{ ['--dot' as string]: STATUS_META[room.status].dot }}
                          >
                            <span className="kobo-status__dot" aria-hidden="true" />
                            {STATUS_META[room.status].label}
                          </span>
                        </td>
                        <td className="kobo-table__muted">{room.tenant?.name || '—'}</td>
                        <td>
                          <div className="kobo-table__actions">
                            <button
                              type="button"
                              aria-label={`Edit kamar ${room.roomNumber}`}
                              onClick={() => openEditRoom(kos.id, room)}
                              style={{ color: 'var(--primary)', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void attempt(() => deleteRoomMutation.mutateAsync({ kosId: kos.id, roomId: room.id }), 'Kamar berhasil dihapus.')}
                              style={{ color: 'var(--status-overdue)', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
                            >
                              Hapus
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <WaitlistPanel kosId={kos.id} kosName={kos.name} />
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

      {photosKos && <KosPhotosModal kosId={photosKos.id} kosName={photosKos.name} onClose={() => setPhotosKos(null)} />}

      {/* Add / Edit Room Modal */}
      {roomModalKosId && (
        <Modal
          isOpen={!!roomModalKosId}
          onClose={() => {
            setRoomModalKosId(null);
            setEditingRoom(null);
          }}
          title={editingRoom ? `Edit Kamar ${editingRoom.roomNumber}` : 'Tambah Kamar Baru ke Properti'}
          maxWidth="sm"
        >
          <form onSubmit={handleSaveRoom} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
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
              label="Tipe Kasur"
              value={bedType}
              onChange={(e) => setBedType(e.target.value)}
              placeholder="Single Bed 120x200"
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRoomModalKosId(null);
                  setEditingRoom(null);
                }}
              >
                Batal
              </Button>
              <Button type="submit" variant="primary" size="sm" icon={<CheckCircle2 size={16} />}>
                {editingRoom ? 'Simpan Perubahan' : 'Simpan Kamar'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
