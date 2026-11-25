import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MatchAgeBand, MatchGenderName, MatchKosTypeName } from '@kobo/shared/types';
import { useSession } from './session';
import { useTRPC } from './trpc';
import { formatRupiah } from './format';
import { errorCode } from './queryErrors';
import { messageForError } from './errors';

/** Teman Sekamar hooks and label tables shared by the matching pages (all lazy: nothing here is in the initial chunk). */

export const MATCH_BASE = '/teman-sekamar';

/** True for the matchingProcedure refusal: signed in but not a verified student. */
export const isUnverifiedError = (error: unknown): boolean => errorCode(error) === 'FORBIDDEN';

export const GENDER_LABEL: Record<MatchGenderName, string> = { LAKI_LAKI: 'Laki-laki', PEREMPUAN: 'Perempuan' };
export const KOS_TYPE_LABEL: Record<MatchKosTypeName, string> = { CAMPUR: 'Kos campur', PUTRA: 'Kos putra', PUTRI: 'Kos putri' };
export const AGE_BAND_LABEL = (band: MatchAgeBand): string => (band === '27+' ? '27 tahun ke atas' : `${band} tahun`);
export const PART_LABEL: Record<string, string> = {
  budget: 'Anggaran',
  location: 'Lokasi',
  moveIn: 'Tanggal pindah',
  duration: 'Durasi sewa',
  lifestyle: 'Gaya hidup',
  room: 'Kamar',
};
/** The shared contact-info refusal for intros (the server says the same). */
export const CONTACT_MESSAGE = 'Jangan bagikan nomor/email/tautan di pesan perkenalan.';

export const formatBudget = (min: number, max: number): string =>
  min === max ? formatRupiah(min) : `${formatRupiah(min)} - ${formatRupiah(max)}`;

/** 'YYYY-MM-DD' as "5 Okt 2026". */
export const formatMoveIn = (day: string): string =>
  new Date(`${day}T00:00:00+07:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });

/** "0,5 km", "2 km". The server already rounds to 0.5 km. */
export const formatKm = (km: number): string => `${km.toLocaleString('id-ID', { maximumFractionDigits: 1 })} km`;

/** ISO day of last activity as "Aktif hari ini" / "Aktif 3 hari lalu". */
export function activeAgo(day: string, now: Date = new Date()): string {
  // Whole calendar days since the start of that WIB day. Rounding made a profile active this afternoon read "1 hari lalu".
  const days = Math.max(0, Math.floor((now.getTime() - new Date(`${day}T00:00:00+07:00`).getTime()) / 86_400_000));
  return days === 0 ? 'Aktif hari ini' : `Aktif ${days} hari lalu`;
}

/** The caller's own profile (null before one exists). Throws FORBIDDEN for an unverified user; the shell shows the gate. */
export function useMatchingProfile() {
  const trpc = useTRPC();
  const { me } = useSession();
  return useQuery({ ...trpc.matching.profile.get.queryOptions(), enabled: !!me, retry: false });
}

/**
 * Unread messages and waiting requests for the nav badge. Polled every 60 s; TanStack pauses the interval while the tab is
 * hidden (refetchIntervalInBackground is off) and refetches when it becomes visible again.
 */
export function useMatchingUnread(enabled = true) {
  const trpc = useTRPC();
  const { me } = useSession();
  return useQuery({
    ...trpc.matching.message.unreadCount.queryOptions(),
    enabled: !!me && enabled,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

/** Call after any matching mutation: refreshes every matching query (profile, discover, requests, unread...). */
export function useInvalidateMatching() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: trpc.matching.pathKey() }), [qc, trpc]);
}

/**
 * Indonesian text for a refused matching action. The server's own copy (cooldown, caps, the 24 h rule, contact info) is shown
 * as is, including TOO_MANY_REQUESTS which `messageForError` would otherwise replace with generic text.
 */
export function refusalMessage(error: unknown): string {
  const e = error as { message?: unknown; data?: { code?: string } } | null;
  const text = typeof e?.message === 'string' ? e.message : '';
  if (/nomor telepon|tautan/i.test(text) && !/^\s*[[{]/.test(text)) return CONTACT_MESSAGE;
  if (e?.data?.code === 'TOO_MANY_REQUESTS' && text) return text;
  return messageForError(error);
}

/** Today as 'YYYY-MM-DD' in WIB (for date inputs' `min`). */
export function todayWib(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** The caller's connections (newest activity first), with unread counts. Refreshed every 15 s while the tab is visible and focused. */
export function useConnections() {
  const trpc = useTRPC();
  const { me } = useSession();
  const active = usePageActive();
  return useQuery({ ...trpc.matching.connection.list.queryOptions(), enabled: !!me, retry: false, refetchInterval: active ? 15_000 : false });
}

/** True while the tab is visible and the window is focused (polling and mark-as-read only run then). */
export function usePageActive(): boolean {
  const read = () => typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus();
  const [active, setActive] = useState(read);
  useEffect(() => {
    const update = () => setActive(read());
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
    };
  }, []);
  return active;
}

/** ISO time as "10.42" for today and "5 Okt" otherwise (WIB). */
export function formatChatTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const sameDay = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }) === now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  return sameDay
    ? d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' })
    : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' });
}
