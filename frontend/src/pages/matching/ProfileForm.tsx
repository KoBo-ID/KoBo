import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { LIFESTYLE_LABEL, LIFESTYLE_VALUES, LIFESTYLE_VALUE_LABEL, MIN_MATCH_AGE, containsContactInfo } from '@kobo/shared/domain';
import { PRICE_MAX } from '@kobo/shared/search';
import type { MatchGenderName, MatchKosTypeName, MyMatchingProfile } from '@kobo/shared/types';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Notice } from '../../components/ui/Notice';
import { Stepper } from '../../components/ui/Stepper';
import { CampusSearchField } from '../../components/search/CampusSearchField';
import { MatchingShell } from '../../components/matching/MatchingShell';
import { useTRPC } from '../../lib/trpc';
import { messageForError } from '../../lib/errors';
import { formatRupiah } from '../../lib/format';
import { CONTACT_MESSAGE, GENDER_LABEL, KOS_TYPE_LABEL, MATCH_BASE, todayWib, useInvalidateMatching, useMatchingProfile } from '../../lib/matching';
import '../../styles/matching.css';

type OptionalKey = 'sleep' | 'tidiness' | 'guests' | 'noise' | 'social' | 'study' | 'ac' | 'expenses';
const OPTIONAL_KEYS: OptionalKey[] = ['sleep', 'tidiness', 'guests', 'noise', 'social', 'study', 'ac', 'expenses'];
type SmokingValue = (typeof LIFESTYLE_VALUES.smoking)[number];

interface Draft {
  displayName: string;
  gender: MatchGenderName | null;
  birthYear: string;
  budgetMin: number;
  budgetMax: number;
  anchor: { lat: number; lng: number; label: string } | null;
  radiusKm: number;
  moveInDate: string;
  smoking: SmokingValue | null;
  intro: string;
  durationMonths: number;
  kosType: MatchKosTypeName | null;
  roomShare: 2 | 3;
  lifestyle: Record<OptionalKey, string>;
}

const BUDGET_OPTIONS = Array.from({ length: PRICE_MAX / 100_000 }, (_, i) => (i + 1) * 100_000);
const STEPS = [{ id: 'inti', label: 'Data inti' }, { id: 'pref', label: 'Preferensi' }];
const defaultKos = (g: MatchGenderName | null): MatchKosTypeName => (g === 'PEREMPUAN' ? 'PUTRI' : g === 'LAKI_LAKI' ? 'PUTRA' : 'CAMPUR');

const emptyDraft = (): Draft => ({
  displayName: '', gender: null, birthYear: '', budgetMin: 800_000, budgetMax: 1_500_000, anchor: null, radiusKm: 3,
  moveInDate: '', smoking: null, intro: '', durationMonths: 12, kosType: null, roomShare: 2,
  lifestyle: Object.fromEntries(OPTIONAL_KEYS.map((k) => [k, 'BEBAS'])) as Record<OptionalKey, string>,
});

const fromProfile = (p: MyMatchingProfile): Draft => ({
  displayName: p.displayName, gender: p.gender, birthYear: String(p.birthYear), budgetMin: p.budgetMin, budgetMax: p.budgetMax,
  anchor: { lat: p.anchorLat, lng: p.anchorLng, label: p.anchorLabel }, radiusKm: p.radiusKm, moveInDate: p.moveInDate,
  smoking: p.smoking, intro: p.intro, durationMonths: p.durationMonths, kosType: p.kosType, roomShare: p.roomShare === 3 ? 3 : 2,
  lifestyle: Object.fromEntries(OPTIONAL_KEYS.map((k) => [k, p[k]])) as Record<OptionalKey, string>,
});

type Errors = Partial<Record<'displayName' | 'gender' | 'birthYear' | 'budget' | 'anchor' | 'moveInDate' | 'smoking' | 'intro', string>>;

function validateCore(d: Draft, now: Date = new Date()): Errors {
  const e: Errors = {};
  const name = d.displayName.trim();
  if (name.length < 2) e.displayName = 'Nama tampilan minimal 2 karakter.';
  else if (name.length > 40) e.displayName = 'Nama tampilan maksimal 40 karakter.';
  if (!d.gender) e.gender = 'Pilih gender.';
  const year = Number(d.birthYear);
  if (!/^\d{4}$/.test(d.birthYear.trim()) || year < 1950 || year > 2020) e.birthYear = 'Isi tahun lahir 4 digit, contoh 2004.';
  else if (now.getUTCFullYear() - year < MIN_MATCH_AGE) e.birthYear = `Teman Sekamar hanya untuk pengguna berusia ${MIN_MATCH_AGE} tahun ke atas.`;
  if (d.budgetMin > d.budgetMax) e.budget = 'Anggaran minimum tidak boleh melebihi maksimum.';
  if (!d.anchor) e.anchor = 'Pilih kampus atau lokasi dari daftar yang muncul.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.moveInDate)) e.moveInDate = 'Pilih tanggal pindah.';
  if (!d.smoking) e.smoking = 'Pilih salah satu.';
  return e;
}

const Choices: React.FC<{
  legend: string; name: string; value: string | number | null; options: { value: string | number; label: string }[];
  onChange: (v: string) => void; error?: string; help?: string;
}> = ({ legend, name, value, options, onChange, error, help }) => (
  <fieldset className="mt-choices" aria-describedby={error || help ? `${name}-note` : undefined}>
    <legend>{legend}</legend>
    {options.map((o) => (
      <label key={o.value} className="mt-choice">
        <input type="radio" name={name} value={o.value} checked={String(value) === String(o.value)} onChange={() => onChange(String(o.value))} />
        <span>{o.label}</span>
      </label>
    ))}
    {error ? <span id={`${name}-note`} className="mt-error" style={{ flexBasis: '100%' }} role="alert">{error}</span>
      : help ? <span id={`${name}-note`} className="mt-help" style={{ flexBasis: '100%' }}>{help}</span> : null}
  </fieldset>
);

const MoneySelect: React.FC<{ id: string; label: string; value: number; onChange: (n: number) => void }> = ({ id, label, value, onChange }) => (
  <div className="mt-field">
    <label htmlFor={id}>{label}</label>
    <select id={id} className="mt-control" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {BUDGET_OPTIONS.map((b) => <option key={b} value={b}>{formatRupiah(b)}</option>)}
    </select>
  </div>
);

export const ProfileForm: React.FC = () => (
  <MatchingShell active="profil" title="Profil Teman Sekamar" lead="Isi data inti dulu; profilmu langsung aktif. Preferensi tambahan membuat skor kecocokan lebih akurat.">
    <FormBody />
  </MatchingShell>
);

const FormBody: React.FC = () => {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const invalidate = useInvalidateMatching();
  const profile = useMatchingProfile();
  const existing = profile.data ?? null;
  const [draft, setDraft] = useState<Draft>(() => (existing ? fromProfile(existing) : emptyDraft()));
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(existing ? 1 : 0);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [anchorText, setAnchorText] = useState(existing?.anchorLabel ?? '');
  const textRef = useRef(anchorText);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => { setDraft((d) => ({ ...d, [key]: value })); setSaved(null); };

  const gender = draft.gender;
  const ownKos = defaultKos(gender);
  const kosType: MatchKosTypeName = draft.kosType === 'CAMPUR' || draft.kosType === ownKos ? draft.kosType : ownKos;

  const upsert = useMutation({ ...trpc.matching.profile.upsert.mutationOptions(), onError: (e) => setServerError(messageForError(e)) });

  const payload = () => ({
    displayName: draft.displayName.trim(),
    gender: draft.gender!,
    birthYear: Number(draft.birthYear),
    budgetMin: draft.budgetMin,
    budgetMax: draft.budgetMax,
    anchorLat: draft.anchor!.lat,
    anchorLng: draft.anchor!.lng,
    anchorLabel: draft.anchor!.label,
    radiusKm: draft.radiusKm,
    moveInDate: draft.moveInDate,
    smoking: draft.smoking!,
    intro: draft.intro.trim(),
    durationMonths: draft.durationMonths,
    kosType,
    roomShare: draft.roomShare,
    ...(draft.lifestyle as Record<OptionalKey, never>),
  });

  const saveCore = (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateCore(draft);
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length) return;
    upsert.mutate(payload(), {
      onSuccess: () => { void invalidate(); setSaved('Profilmu aktif. Lengkapi preferensi supaya skornya lebih akurat, atau lewati.'); setFurthest(1); setStep(1); },
    });
  };

  const saveOptional = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (draft.intro.trim() && containsContactInfo(draft.intro)) { setErrors({ intro: CONTACT_MESSAGE }); return; }
    setErrors({});
    upsert.mutate(payload(), { onSuccess: () => { void invalidate(); navigate(MATCH_BASE); } });
  };

  const onAnchorText = (text: string) => {
    textRef.current = text;
    setAnchorText(text);
    setDraft((d) => (d.anchor && d.anchor.label !== text ? { ...d, anchor: null } : d));
  };
  const pickAnchor = (lat: number, lng: number, label: string) => { setDraft((d) => ({ ...d, anchor: { lat, lng, label } })); setErrors((x) => ({ ...x, anchor: undefined })); setSaved(null); };

  return (
    <div className="mt-stack">
      <Stepper steps={STEPS} current={step} furthest={furthest} onStepClick={(i) => { setStep(i); setServerError(null); }} />
      {existing && (
        <div className="mt-meter" aria-label={`Kelengkapan profil ${existing.completeness}%`}>
          <span className="mt-small mt-muted">Kelengkapan</span>
          <span className="mt-bar" aria-hidden="true"><span style={{ width: `${existing.completeness}%` }} /></span>
          <span className="mt-small" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{existing.completeness}%</span>
        </div>
      )}
      {saved && <Notice tone="success">{saved}</Notice>}
      {serverError && <Notice tone="error">{serverError}</Notice>}

      {step === 0 ? (
        <form className="mt-card mt-form" onSubmit={saveCore} noValidate aria-label="Data inti profil">
          <div className="mt-form__full">
            <Input label="Nama tampilan" value={draft.displayName} maxLength={40} autoComplete="nickname" error={errors.displayName}
              helperText="Yang dilihat calon teman sekamar. Pakai nama panggilan, bukan nama lengkap." onChange={(e) => set('displayName', e.target.value)} />
          </div>
          <Choices legend="Gender" name="gender" value={draft.gender} error={errors.gender}
            options={(Object.keys(GENDER_LABEL) as MatchGenderName[]).map((g) => ({ value: g, label: GENDER_LABEL[g] }))}
            onChange={(v) => set('gender', v as MatchGenderName)} />
          <Input label="Tahun lahir" inputMode="numeric" maxLength={4} placeholder="2004" value={draft.birthYear} error={errors.birthYear}
            onChange={(e) => set('birthYear', e.target.value.replace(/\D/g, ''))} />
          <p className="mt-help mt-form__full">Gender dan usia hanya dipakai di dalam Teman Sekamar untuk mencocokkan kamu. Yang tampil ke orang lain hanya rentang usia, bukan tahun lahir.</p>

          <MoneySelect id="pf-bmin" label="Anggaran minimum per bulan" value={draft.budgetMin} onChange={(n) => set('budgetMin', n)} />
          <MoneySelect id="pf-bmax" label="Anggaran maksimum per bulan" value={draft.budgetMax} onChange={(n) => set('budgetMax', n)} />
          {errors.budget && <p className="mt-error mt-form__full" role="alert">{errors.budget}</p>}

          <div className="mt-field mt-form__full">
            <span className="mt-label" id="pf-anchor-l">Area pencarian (kampus atau lokasi)</span>
            <CampusSearchField
              value={anchorText}
              label="Area pencarian"
              placeholder="Ketik nama kampus, contoh: Binus Kemanggisan"
              onChange={onAnchorText}
              onSubmitText={() => undefined}
              onClear={() => onAnchorText('')}
              onPickCampus={(b) => pickAnchor(b.lat, b.lng, textRef.current || b.label)}
              onPickPoint={(p) => pickAnchor(p.lat, p.lng, p.label)}
            />
            {errors.anchor ? <span className="mt-error" role="alert">{errors.anchor}</span> : draft.anchor ? <span className="mt-help">Terpilih: {draft.anchor.label}</span> : null}
          </div>
          <div className="mt-field">
            <label htmlFor="pf-radius">Radius dari area itu</label>
            <select id="pf-radius" className="mt-control" value={draft.radiusKm} onChange={(e) => set('radiusKm', Number(e.target.value))}>
              {Array.from({ length: 15 }, (_, i) => i + 1).map((r) => <option key={r} value={r}>{r} km</option>)}
            </select>
          </div>
          <div className="mt-field">
            <label htmlFor="pf-date">Tanggal pindah</label>
            <input id="pf-date" type="date" className="mt-control" min={todayWib()} value={draft.moveInDate} aria-invalid={errors.moveInDate ? true : undefined}
              onChange={(e) => set('moveInDate', e.target.value)} />
            {errors.moveInDate && <span className="mt-error" role="alert">{errors.moveInDate}</span>}
          </div>
          <div className="mt-form__full">
            <Choices legend="Merokok" name="smoking" value={draft.smoking} error={errors.smoking}
              help="Dipakai sebagai penyaring: perokok tidak dipasangkan dengan yang menolak teman perokok."
              options={LIFESTYLE_VALUES.smoking.map((v) => ({ value: v, label: LIFESTYLE_VALUE_LABEL.smoking[v] }))}
              onChange={(v) => set('smoking', v as SmokingValue)} />
          </div>
          <div className="mt-form__full mt-row">
            <Button type="submit" variant="primary" size="md" isLoading={upsert.isPending}>{existing ? 'Simpan data inti' : 'Simpan dan aktifkan profil'}</Button>
          </div>
        </form>
      ) : (
        <form className="mt-card mt-form" onSubmit={saveOptional} noValidate aria-label="Preferensi opsional">
          <h2 className="mt-section-title mt-form__full">Lengkapi preferensi (opsional)</h2>
          <p className="mt-help mt-form__full">Semua boleh dibiarkan &quot;Bebas&quot;, tetapi makin lengkap makin akurat skor kecocokannya.</p>
          <div className="mt-field">
            <label htmlFor="pf-dur">Durasi sewa</label>
            <select id="pf-dur" className="mt-control" value={draft.durationMonths} onChange={(e) => set('durationMonths', Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m} bulan</option>)}
            </select>
          </div>
          <Choices legend="Tipe kos" name="kosType" value={kosType}
            options={[ownKos, 'CAMPUR' as MatchKosTypeName].map((k) => ({ value: k, label: KOS_TYPE_LABEL[k] }))}
            help="Hanya tipe kos sesuai gendermu atau campur."
            onChange={(v) => set('kosType', v as MatchKosTypeName)} />
          <Choices legend="Satu kamar untuk" name="roomShare" value={draft.roomShare}
            options={[{ value: 2, label: '2 orang' }, { value: 3, label: '3 orang' }]}
            onChange={(v) => set('roomShare', v === '3' ? 3 : 2)} />
          {OPTIONAL_KEYS.map((k) => (
            <Choices key={k} legend={LIFESTYLE_LABEL[k]} name={`ls-${k}`} value={draft.lifestyle[k]}
              options={LIFESTYLE_VALUES[k].map((v) => ({ value: v, label: (LIFESTYLE_VALUE_LABEL[k] as Record<string, string>)[v] ?? v }))}
              onChange={(v) => { setDraft((d) => ({ ...d, lifestyle: { ...d.lifestyle, [k]: v } })); setSaved(null); }} />
          ))}
          <div className="mt-field mt-form__full">
            <label htmlFor="pf-intro">Perkenalan singkat</label>
            <textarea id="pf-intro" className="mt-textarea" maxLength={300} value={draft.intro} aria-invalid={errors.intro ? true : undefined}
              placeholder="Jurusan, kebiasaan, atau hal yang kamu cari dari teman sekamar."
              onChange={(e) => { set('intro', e.target.value); if (errors.intro) setErrors({}); }} />
            <span className="mt-counter">{draft.intro.length}/300</span>
            {errors.intro ? <span className="mt-error" role="alert">{errors.intro}</span> : <span className="mt-help">Jangan tulis nomor, email, atau tautan.</span>}
          </div>
          <div className="mt-form__full mt-row">
            <Button type="submit" variant="primary" size="md" isLoading={upsert.isPending}>Simpan preferensi</Button>
            <Button type="button" variant="ghost" size="md" disabled={upsert.isPending} onClick={() => navigate(MATCH_BASE)}>Lewati</Button>
            <Button type="button" variant="ghost" size="md" disabled={upsert.isPending} onClick={() => setStep(0)}>Kembali</Button>
          </div>
        </form>
      )}
    </div>
  );
};
