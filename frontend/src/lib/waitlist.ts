import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from './session';
import { useTRPC } from './trpc';
import { messageForError } from './errors';
import { useAppStore } from '../store/AppContext';

/** Re-renders every `intervalMs` so countdowns stay live. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** "sisa 17 jam 42 menit" / "sisa 35 menit" / "waktu habis". */
export function formatTimeLeft(expiresAtIso: string, now: number): string {
  const mins = Math.floor((new Date(expiresAtIso).getTime() - now) / 60_000);
  if (mins <= 0) return 'waktu habis';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `sisa ${h > 0 ? `${h} jam ` : ''}${m} menit`;
}

/** Queue state of one kos: is it full, how long is each type's queue, and (signed in) my entry. */
export function useWaitlistStatus(kosId: string) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { me } = useSession();
  // The query is public, so a sign-in or sign-out must refetch it for `mine` to follow.
  const userId = me?.user.id ?? null;
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: trpc.waitlist.status.queryKey({ kosId }) });
  }, [userId, kosId, qc, trpc]);
  return useQuery({ ...trpc.waitlist.status.queryOptions({ kosId }), refetchInterval: 60_000 });
}

/** The signed-in student's entries (live first, then recent history). */
export function useMyWaitlist() {
  const trpc = useTRPC();
  const { me } = useSession();
  return useQuery({ ...trpc.waitlist.mine.queryOptions(), enabled: !!me, refetchInterval: 60_000 });
}

/** One kos's queue for its owner. Disabled until a kos is selected. */
export function useOwnerWaitlist(kosId: string | undefined) {
  const trpc = useTRPC();
  return useQuery({ ...trpc.owner.waitlistEntries.queryOptions({ kosId: kosId ?? '' }), enabled: !!kosId });
}

/** Join and the like answer BAD_REQUEST with their own Indonesian reason ("Masih ada kamar kosong..."); the server already collapses schema failures to a generic Indonesian line. */
function waitlistError(err: unknown): string {
  const e = err as { message?: string; data?: { code?: string } } | null;
  return e?.data?.code === 'BAD_REQUEST' && e.message ? e.message : messageForError(err);
}

/** join / leave / decline for the student. Each toasts its own result and refreshes everything the queue touches. */
export function useWaitlistActions() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { addToast } = useAppStore();

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: trpc.waitlist.pathKey() });
    void qc.invalidateQueries({ queryKey: trpc.kos.detail.pathKey() });
  };
  const run = async (job: () => Promise<unknown>, ok: string, tone: 'success' | 'info' = 'success') => {
    try {
      await job();
      addToast(ok, tone);
      return true;
    } catch (err) {
      addToast(waitlistError(err), 'error');
      return false;
    } finally {
      refresh();
    }
  };

  const join = useMutation(trpc.waitlist.join.mutationOptions());
  const leave = useMutation(trpc.waitlist.leave.mutationOptions());
  const decline = useMutation(trpc.waitlist.decline.mutationOptions());

  return {
    busy: join.isPending || leave.isPending || decline.isPending,
    join: (kosId: string, roomType: string | null) => run(() => join.mutateAsync({ kosId, roomType }), 'Kamu masuk daftar tunggu. Kami kirim email saat kamar tersedia.'),
    leave: (entryId: string) => run(() => leave.mutateAsync({ entryId }), 'Kamu keluar dari daftar tunggu.', 'info'),
    decline: (entryId: string) => run(() => decline.mutateAsync({ entryId }), 'Penawaran dilewati. Kamar diteruskan ke antrean berikutnya.', 'info'),
  };
}

export const WAITLIST_STATUS_LABEL = {
  WAITING: 'Mengantre',
  OFFERED: 'Ditawari kamar',
  FULFILLED: 'Dipesan',
  EXPIRED: 'Penawaran habis',
  DECLINED: 'Dilewati',
  LEFT: 'Keluar antrean',
  REMOVED: 'Dihapus pemilik',
} as const;

/** "Tipe apa saja" for a null preference. */
export const roomTypeLabel = (roomType: string | null) => roomType ?? 'Tipe apa saja';
