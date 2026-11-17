import React, { useState } from 'react';
import type { BoardRoom } from '../../../../backend/src/trpc/router';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Notice } from '../ui/Notice';

type Method = 'CASH' | 'BANK_TRANSFER';
const rupiah = (n: number) => `Rp ${n.toLocaleString('id-ID')}`;

/**
 * Audited "Tandai Lunas": the owner says how the money arrived, re-types the exact amount, and (for a transfer)
 * gives the bank reference. The server re-checks everything; this form only prevents obvious slips.
 */
export const ManualPaymentModal: React.FC<{
  room: BoardRoom;
  invoice: { id: string; amount: number };
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: { method: Method; confirmedAmount: number; reference?: string; note?: string }) => Promise<void>;
}> = ({ room, invoice, busy, onClose, onSubmit }) => {
  const [method, setMethod] = useState<Method>('CASH');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');

  const online = room.payment?.state === 'AWAITING_ONLINE';
  const confirmed = Number(amount.replace(/\D/g, ''));
  const amountOk = confirmed === invoice.amount;
  const refOk = method === 'CASH' || /^[A-Za-z0-9 ./_-]{3,64}$/.test(reference.trim());
  const canSubmit = !busy && !online && amountOk && refOk && note.length <= 500;

  return (
    <Modal isOpen onClose={onClose} title={`Tandai Lunas Kamar ${room.roomNumber}`} subtitle={room.tenant?.name ?? undefined} maxWidth="sm">
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!canSubmit) return;
          void onSubmit({ method, confirmedAmount: confirmed, reference: method === 'BANK_TRANSFER' ? reference.trim() : undefined, note: note.trim() || undefined });
        }}
      >
        {online && <Notice tone="error">Penyewa sedang membayar secara online. Tunggu sesi pembayaran berakhir sebelum mencatat manual.</Notice>}

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <legend style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>Cara pembayaran</legend>
          {([['CASH', 'Tunai'], ['BANK_TRANSFER', 'Transfer bank']] as const).map(([value, label]) => (
            <label key={value} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.9rem' }}>
              <input type="radio" name="method" value={value} checked={method === value} onChange={() => setMethod(value)} />
              {label}
            </label>
          ))}
        </fieldset>

        <Input
          label={`Ketik jumlah yang diterima (${rupiah(invoice.amount)})`}
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={amount && !amountOk ? 'Jumlah harus sama persis dengan tagihan.' : undefined}
        />
        {method === 'BANK_TRANSFER' && (
          <Input
            label="Nomor referensi transfer"
            value={reference}
            maxLength={64}
            onChange={(e) => setReference(e.target.value)}
            error={reference && !refOk ? 'Gunakan 3-64 karakter: huruf, angka, spasi, titik, garis miring, garis bawah, atau tanda hubung.' : undefined}
            helperText="Wajib untuk transfer bank."
          />
        )}
        <Input label="Catatan (opsional, hanya terlihat oleh Anda)" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Batal</Button>
          <Button type="submit" variant="primary" size="sm" isLoading={busy} disabled={!canSubmit}>Catat Lunas</Button>
        </div>
      </form>
    </Modal>
  );
};
