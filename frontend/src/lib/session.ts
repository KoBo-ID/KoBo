import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from './trpc';
import { useAppStore } from '../store/AppContext';

/** Query flag put on the errorCallbackURL of a Google round trip; better-auth appends `error=<code>` to it. */
export const GOOGLE_RETURN_FLAG = 'google';

let googleReturnError: string | null = null;

/** The message left by a failed Google round trip, handed over once to the sign-in modal. */
export function takeGoogleReturnError(): string | null {
  const message = googleReturnError;
  googleReturnError = null;
  return message;
}

/** After a failed Google round trip: stash a short message, clean the URL, and reopen the sign-in modal. */
function useGoogleReturn() {
  const { openAuthModal } = useAppStore();
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get(GOOGLE_RETURN_FLAG) !== 'gagal') return;
    // One generic message for every code: never steer a user towards verifying an email that may be squatted (GHSA-g38m).
    googleReturnError = 'Masuk dengan Google belum berhasil. Silakan coba lagi.';
    for (const key of [GOOGLE_RETURN_FLAG, 'error', 'error_description']) url.searchParams.delete(key);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    openAuthModal();
  }, [openAuthModal]);
}

/** Who is signed in. Persona is derived from this: an owner is a user with an OwnerProfile. */
export function useSession() {
  useGoogleReturn();
  const trpc = useTRPC();
  const q = useQuery({ ...trpc.auth.me.queryOptions(), staleTime: 60_000 });
  return { me: q.data ?? null, isLoading: q.isPending };
}

export function useAuthActions() {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const refreshSession = useCallback(
    () => qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() }),
    [qc, trpc],
  );

  /** One-click demo sign-in: a plain fetch, so it needs no auth-client chunk. Resolves to an error message or null; the caller refreshes the session. */
  const demoLogin = useCallback(
    async (as: 'student' | 'owner'): Promise<string | null> => {
      try {
        const res = await fetch('/api/auth/demo-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ as }),
        });
        if (!res.ok) {
          return res.status === 429
            ? 'Terlalu banyak percobaan. Coba lagi sebentar lagi.'
            : 'Masuk cepat tidak tersedia saat ini.';
        }
        return null;
      } catch {
        return 'Tidak dapat terhubung ke server. Periksa koneksi Anda.';
      }
    },
    [],
  );

  /** The auth client is fetched on demand, the first time someone actually signs out. */
  const logout = useCallback(async () => {
    const { authClient } = await import('./authClient');
    await authClient.signOut();
    qc.setQueryData(trpc.auth.me.queryKey(), null);
    // Signed-in-only queries must not refetch (and 401) while the navbar still renders the old session.
    qc.removeQueries({ queryKey: trpc.booking.pathKey() });
    qc.removeQueries({ queryKey: trpc.payment.pathKey() });
    qc.removeQueries({ queryKey: trpc.kuitansi.pathKey() });
    qc.removeQueries({ queryKey: trpc.visit.pathKey() });
    qc.removeQueries({ queryKey: trpc.owner.visits.pathKey() });
    qc.removeQueries({ queryKey: trpc.waitlist.pathKey() });
    qc.removeQueries({ queryKey: trpc.owner.waitlistEntries.pathKey() });
    qc.removeQueries({ queryKey: trpc.owner.myKos.pathKey() });
    qc.removeQueries({ queryKey: trpc.owner.board.pathKey() });
    // Everything user-scoped is stale now, not just auth.me.
    await qc.invalidateQueries();
  }, [qc, trpc]);

  return { refreshSession, demoLogin, logout };
}
