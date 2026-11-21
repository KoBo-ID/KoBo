import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Notice } from '../ui/Notice';
import { useSession } from '../../lib/session';
import { useBecomeOwner, type OwnershipType } from '../../lib/owner';

const PHONE = /^\+?[0-9][0-9 ()-]{7,18}$/;

const OWNERSHIP_OPTIONS: { value: OwnershipType; label: string; hint: string }[] = [
  { value: 'PEMILIK', label: 'Saya pemilik properti', hint: 'Tanah dan bangunan atas nama Anda.' },
  { value: 'PENGELOLA_KUASA', label: 'Saya pengelola dengan surat kuasa', hint: 'Anda mengelola kos milik orang lain atas dasar surat kuasa.' },
  { value: 'LAINNYA', label: 'Lainnya', hint: 'Misalnya penyewa utama atau pengelola dengan perjanjian pengelolaan.' },
];

/** Owner sign-up data: only the WhatsApp number and how the owner relates to the property. Registers via owner.becomeOwner. */
export const OwnerDataStep: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const { me } = useSession();
  const { becomeOwner, isPending, error } = useBecomeOwner();
  const [phone, setPhone] = useState(me?.user.phone ?? '');
  const [type, setType] = useState<OwnershipType>('PEMILIK');
  const [fieldError, setFieldError] = useState<string | undefined>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPending) return;
    if (!PHONE.test(phone.trim())) {
      setFieldError('Isi nomor WhatsApp dengan angka, misalnya 0812 3456 7890.');
      return;
    }
    setFieldError(undefined);
    if (await becomeOwner(phone.trim(), type)) onDone();
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-s, 1rem)' }}>
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
        disabled={isPending}
      />
      <fieldset className="owner-type" disabled={isPending}>
        <legend className="owner-type__legend">Status Anda atas kos</legend>
        {OWNERSHIP_OPTIONS.map((o) => (
          <label key={o.value} className={`owner-type__opt${type === o.value ? ' is-on' : ''}`}>
            <input type="radio" name="ownership" value={o.value} checked={type === o.value} onChange={() => setType(o.value)} />
            <span>
              <span className="owner-type__label">{o.label}</span>
              <span className="owner-type__hint">{o.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" variant="primary" isLoading={isPending} disabled={isPending}>Lanjut</Button>
    </form>
  );
};
