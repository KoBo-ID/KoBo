import React, { useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Notice } from '../ui/Notice';
import { useSession } from '../../lib/session';
import { useBecomeOwner } from '../../lib/owner';

const PHONE = /^\+?[0-9][0-9 ()-]{7,18}$/;

/** "Daftarkan diri sebagai pemilik": asks for the WhatsApp number, then registers. The kos go public after KoBo approves the account. */
export const BecomeOwnerModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { me } = useSession();
  const { becomeOwner, isPending, error } = useBecomeOwner();
  const [phone, setPhone] = useState(me?.user.phone ?? '');
  const [fieldError, setFieldError] = useState<string | undefined>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!PHONE.test(phone.trim())) {
      setFieldError('Isi nomor WhatsApp dengan angka, misalnya 0812 3456 7890.');
      return;
    }
    setFieldError(undefined);
    if (await becomeOwner(phone.trim())) onClose();
  };

  return (
    <Modal isOpen onClose={onClose} title="Daftar sebagai pemilik kos" subtitle="Gratis. Akun Anda tetap sama untuk mencari kos dan mengelola kos." maxWidth="sm">
      <form onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <Input
          label="Nomor WhatsApp"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={fieldError}
          placeholder="0812 3456 7890"
          helperText="Dipakai calon penyewa dan KoBo untuk menghubungi Anda."
        />
        <p style={{ margin: 0, fontSize: '0.8125rem', lineHeight: 1.5, color: 'var(--text-muted)' }}>
          Anda bisa langsung menyiapkan kos, kamar, dan foto. Kos baru muncul di pencarian setelah KoBo memeriksa dan menyetujui akun pemilik Anda.
        </p>
        {error && <Notice tone="error">{error}</Notice>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <Button type="button" variant="ghost" onClick={onClose}>Batal</Button>
          <Button type="submit" variant="primary" isLoading={isPending} disabled={isPending}>Daftar sebagai pemilik</Button>
        </div>
      </form>
    </Modal>
  );
};
