import React, { useState } from 'react';
import { STATUS_META } from '../../components/owner/RoomOccupancyBoard';
import '../../styles/owner-kos.css';
import { Plus, Edit, Trash2, Eye, MapPin, CheckCircle2, Footprints, Images, MoreHorizontal } from 'lucide-react';
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
import { Popover } from '../../components/ui/Popover';
import { OwnerPageHeader } from '../../components/owner/OwnerPageHeader';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { SafeImage } from '../../components/ui/SafeImage';
import { Link } from 'react-router-dom';

export const KosManager: React.FC = () => {
  const { addToast } = useAppStore();
  const { selectedKos } = useOwnerWorkspace();
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
  const [confirmKosDelete, setConfirmKosDelete] = useState(false);
  const [confirmRoomId, setConfirmRoomId] = useState<string | null>(null);

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

  const openCreate = () => {
    setEditingKos(null);
    setIsFormOpen(true);
  };
  const kos = selectedKos;

  return (
    <div className="app-container owner-page owner-kos">
      <OwnerPageHeader
        title="Kelola properti"
        subtitle={kos?.name}
        actions={
          <Button variant="primary" size="md" onClick={openCreate} icon={<Plus size={16} />} style={{ minHeight: 40 }}>
            Tambah kos
          </Button>
        }
      />

      {!kos && (
        <section className="owner-kos__empty">
          <h2>Daftarkan kos pertama Anda</h2>
          <p>Properti yang terdaftar muncul di pencarian KoBo dan di papan okupansi Anda. Siapkan hal berikut:</p>
          <ul>
            <li>Nama, alamat, dan jenis kos (putra, putri, atau campur)</li>
            <li>Foto kos dan fasilitas utama</li>
            <li>Daftar kamar dengan tipe, ukuran, dan harga sewa bulanan</li>
          </ul>
          <Button variant="primary" size="md" onClick={openCreate} icon={<Plus size={16} />} style={{ minHeight: 40 }}>
            Tambah kos
          </Button>
        </section>
      )}

      {kos && (
        <div className="owner-kos__card">
          <div className="owner-kos__head">
            <div className="owner-kos__identity">
              {kos.image ? (
                <SafeImage src={kos.image} alt={kos.name} className="owner-kos__photo" />
              ) : (
                <div aria-hidden="true" className="owner-kos__photo" />
              )}
              <div className="owner-kos__meta">
                <span className="owner-kos__badge">{kos.gender.toLowerCase()}</span>
                <h2 className="owner-kos__name">{kos.name}</h2>
                <p className="owner-kos__line">
                  <MapPin size={14} />
                  <span>{kos.address}</span>
                </p>
                {kos.nearestCampus && kos.nearestCampus.meters !== null && (
                  <p className="owner-kos__line owner-kos__line--accent">
                    <Footprints size={14} />
                    <span>
                      {kos.nearestCampus.meters} m ke {kos.nearestCampus.shortName}
                    </span>
                  </p>
                )}
              </div>
            </div>

            <div className="owner-kos__actions">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingKos(kos);
                  setIsFormOpen(true);
                }}
                icon={<Edit size={14} />}
              >
                Edit kos
              </Button>
              <Popover
                role="menu"
                label="Aksi kos"
                panelClassName="kobo-menu"
                trigger={(p) => (
                  <button {...p} type="button" className="owner-kos__icon-btn" aria-label="Aksi lainnya">
                    <MoreHorizontal size={18} />
                  </button>
                )}
              >
                {({ close }) => (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        close();
                        setPhotosKos(kos);
                      }}
                    >
                      <Images size={15} /> Kelola foto
                    </button>
                    <Link to={`/kos/${kos.id}`} role="menuitem" className="kobo-menu__link" onClick={close}>
                      <Eye size={15} /> Lihat halaman publik
                    </Link>
                    <div className="kobo-menu__sep" role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      className="is-danger"
                      onClick={() => {
                        close();
                        setConfirmKosDelete(true);
                      }}
                    >
                      <Trash2 size={15} /> Hapus kos
                    </button>
                  </>
                )}
              </Popover>
            </div>
          </div>

          {confirmKosDelete && (
            <div className="owner-kos__confirm" role="alert">
              <span>Hapus {kos.name} beserta seluruh kamarnya? Tindakan ini tidak bisa dibatalkan.</span>
              <div className="owner-kos__confirm-actions">
                <Button variant="outline" size="sm" onClick={() => setConfirmKosDelete(false)}>
                  Batal
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  isLoading={deleteKosMutation.isPending}
                  onClick={() => {
                    void attempt(() => deleteKosMutation.mutateAsync({ kosId: kos.id }), 'Properti kos telah dihapus.').then(() =>
                      setConfirmKosDelete(false),
                    );
                  }}
                >
                  Hapus
                </Button>
              </div>
            </div>
          )}

          {/* Room details */}
          <section>
            <div className="owner-kos__section-head">
              <h3 className="owner-kos__section-title">
                Daftar kamar <span>{kos.totalRooms} kamar</span>
              </h3>
              <Button variant="secondary" size="sm" onClick={() => openAddRoom(kos.id)} icon={<Plus size={14} />} style={{ minHeight: 40 }}>
                Tambah kamar
              </Button>
            </div>

            {kos.rooms.length === 0 ? (
              <p className="owner-kos__section-hint">Belum ada kamar. Tambahkan kamar pertama agar kos ini bisa dipesan.</p>
            ) : (
              <div className="kobo-table-wrap">
                <table className="kobo-table kobo-table--labels" role="table">
                  <caption className="owner-kos__sr">Daftar kamar {kos.name}</caption>
                  <thead role="rowgroup">
                    <tr role="row">
                      <th role="columnheader" scope="col">Kamar</th>
                      <th role="columnheader" scope="col">Lantai</th>
                      <th role="columnheader" scope="col">Tipe &amp; ukuran</th>
                      <th role="columnheader" scope="col" className="kobo-table__right">Harga sewa</th>
                      <th role="columnheader" scope="col">Status</th>
                      <th role="columnheader" scope="col">Penghuni</th>
                      <th role="columnheader" scope="col"><span className="owner-kos__sr">Aksi</span></th>
                    </tr>
                  </thead>
                  <tbody role="rowgroup">
                    {kos.rooms.map((room) =>
                      confirmRoomId === room.id ? (
                        <tr role="row" key={room.id}>
                          <td role="cell" colSpan={7} className="owner-kos__confirmcell">
                            <div className="owner-kos__confirm" role="alert">
                              <span>Hapus Kamar {room.roomNumber}?</span>
                              <div className="owner-kos__confirm-actions">
                                <Button variant="outline" size="sm" onClick={() => setConfirmRoomId(null)}>
                                  Batal
                                </Button>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  isLoading={deleteRoomMutation.isPending}
                                  onClick={() => {
                                    void attempt(
                                      () => deleteRoomMutation.mutateAsync({ kosId: kos.id, roomId: room.id }),
                                      'Kamar berhasil dihapus.',
                                    ).then(() => setConfirmRoomId(null));
                                  }}
                                >
                                  Hapus
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        <tr role="row" key={room.id}>
                          <td role="cell" data-label="Kamar" className="kobo-table__strong">{room.roomNumber}</td>
                          <td role="cell" data-label="Lantai">Lt. {room.floor}</td>
                          <td role="cell" data-label="Tipe &amp; ukuran">
                            {room.type} <span className="kobo-table__muted">({room.size})</span>
                          </td>
                          <td role="cell" data-label="Harga sewa" className="kobo-table__num kobo-table__right">{formatRupiah(room.priceMonthly)}</td>
                          <td role="cell" data-label="Status">
                            <span
                              className={room.status === 'vacant' ? 'kobo-status kobo-status--hollow' : 'kobo-status'}
                              style={{ ['--dot' as string]: STATUS_META[room.status].dot }}
                            >
                              <span className="kobo-status__dot" aria-hidden="true" />
                              {STATUS_META[room.status].label}
                            </span>
                          </td>
                          <td role="cell" data-label="Penghuni" className="kobo-table__muted">{room.tenant?.name || '-'}</td>
                          <td role="cell" className="owner-kos__actioncell">
                            <Popover
                              role="menu"
                              label={`Aksi Kamar ${room.roomNumber}`}
                              panelClassName="kobo-menu"
                              trigger={(p) => (
                                <button
                                  {...p}
                                  type="button"
                                  className="owner-kos__icon-btn owner-kos__icon-btn--quiet"
                                  aria-label={`Aksi Kamar ${room.roomNumber}`}
                                >
                                  <MoreHorizontal size={18} />
                                </button>
                              )}
                            >
                              {({ close }) => (
                                <>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => {
                                      close();
                                      openEditRoom(kos.id, room);
                                    }}
                                  >
                                    <Edit size={15} /> Edit kamar
                                  </button>
                                  <button
                                    type="button"
                                    role="menuitem"
                                    className="is-danger"
                                    onClick={() => {
                                      close();
                                      setConfirmRoomId(room.id);
                                    }}
                                  >
                                    <Trash2 size={15} /> Hapus kamar
                                  </button>
                                </>
                              )}
                            </Popover>
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <WaitlistPanel kosId={kos.id} kosName={kos.name} />
        </div>
      )}

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
