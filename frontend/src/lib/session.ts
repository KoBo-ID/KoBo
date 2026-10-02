import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from './trpc';

/** Who is signed in. Persona is derived from this: an owner is a user with an OwnerProfile. */
export function useSession() {
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
            : 'Akun demo tidak tersedia saat ini.';
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
    qc.removeQueries({ queryKey: trpc.owner.myKos.pathKey() });
    qc.removeQueries({ queryKey: trpc.owner.board.pathKey() });
    // Everything user-scoped is stale now, not just auth.me.
    await qc.invalidateQueries();
  }, [qc, trpc]);

  return { refreshSession, demoLogin, logout };
}
