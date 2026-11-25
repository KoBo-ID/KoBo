import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from './trpc';
import { useAppStore } from '../store/AppContext';

/** Query flag put on the errorCallbackURL of a Google round trip; better-auth appends `error=<code>` to it. */
export const GOOGLE_RETURN_FLAG = 'google';
/** The full sign-in page. It reads the failed-return flag itself instead of reopening the dialog over it. */
export const AUTH_PAGE_PATH = '/masuk';

const GOOGLE_TERMS_KEY = 'kobo.google.terms';
const GOOGLE_PENDING_KEY = 'kobo.google.pending';

function storage<T>(fn: (s: Storage) => T, fallback: T): T {
  try {
    return fn(sessionStorage);
  } catch {
    return fallback;
  }
}
/** Terms version ticked in the Google dialog, waiting to be recorded once the round trip returns. */
export const readPendingGoogleTerms = (): string | null => storage((s) => s.getItem(GOOGLE_TERMS_KEY), null);
export const clearPendingGoogleTerms = (): void => storage((s) => s.removeItem(GOOGLE_TERMS_KEY), undefined);
/** Set right before leaving for Google: the page that comes back waits for the session instead of flashing logged-out. */
export function markGoogleRoundTrip(termsVersion: string): void {
  storage((s) => {
    s.setItem(GOOGLE_TERMS_KEY, termsVersion);
    // The page the round trip started on: a duplicate callback lands on `/?error=` instead of the callbackURL.
    s.setItem(GOOGLE_PENDING_KEY, window.location.pathname + window.location.search);
  }, undefined);
}
export const clearGoogleRoundTrip = (): void =>
  storage((s) => {
    s.removeItem(GOOGLE_TERMS_KEY);
    s.removeItem(GOOGLE_PENDING_KEY);
  }, undefined);
export const isGoogleRoundTrip = (): boolean => storage((s) => s.getItem(GOOGLE_PENDING_KEY) !== null, false);
/** Where the round trip started, if it was a same-site path. */
const googleRoundTripOrigin = (): string | null =>
  storage((s) => {
    const v = s.getItem(GOOGLE_PENDING_KEY);
    return v && v.startsWith('/') && !v.startsWith('//') ? v : null;
  }, null);

let googleReturnError: string | null = null;
let signedOutAt = 0;

/** True for a few seconds after an explicit sign-out, so route guards redirect home without reopening the sign-in dialog. */
export function justSignedOut(): boolean {
  return Date.now() - signedOutAt < 5000;
}

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
    if (url.pathname === AUTH_PAGE_PATH) return;
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

/**
 * Mounted app-wide (Navbar). On the first answer after a Google round trip: record the Terms ticked in the dialog,
 * send an owner to their dashboard (a page already inside /owner stays), and drop a stray `?error=` left by a duplicate
 * callback while the user is in fact signed in. /masuk does all this itself (AuthPage).
 */
export function useGoogleSignInReturn() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { openAuthModal } = useAppStore();
  const acceptTerms = useMutation(trpc.auth.acceptTerms.mutationOptions());
  const { me, isLoading } = useSession();
  const handled = useRef(false);
  const rechecked = useRef(false);
  const [recheckDone, setRecheckDone] = useState(false);
  useEffect(() => {
    if (isLoading || handled.current) return;
    const url = new URL(window.location.href);
    if (url.pathname === AUTH_PAGE_PATH) {
      handled.current = true;
      return;
    }
    const wasRoundTrip = isGoogleRoundTrip();
    // A round trip that answers "signed out" is asked once more before it counts as a failure: the session cookie
    // from the callback can race the first /me.
    if (!me && wasRoundTrip && !rechecked.current) {
      rechecked.current = true;
      void qc.refetchQueries({ queryKey: trpc.auth.me.queryKey() }).finally(() => setRecheckDone(true));
      return;
    }
    handled.current = true;
    const stray = url.pathname === '/' && url.searchParams.has('error') && !url.searchParams.has(GOOGLE_RETURN_FLAG);
    const dropError = () => {
      for (const key of ['error', 'error_description']) url.searchParams.delete(key);
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    };
    if (!me) {
      if (wasRoundTrip) clearGoogleRoundTrip();
      if (wasRoundTrip && stray) {
        googleReturnError = 'Masuk dengan Google belum berhasil. Silakan coba lagi.';
        dropError();
        openAuthModal();
      }
      return;
    }
    if (stray) dropError();
    if (!wasRoundTrip) return;
    const pendingTerms = readPendingGoogleTerms();
    const origin = googleRoundTripOrigin();
    clearGoogleRoundTrip();
    if (me.isOwner && !url.pathname.startsWith('/owner/')) navigate('/owner/dashboard', { replace: true });
    // A duplicate callback dropped the renter on `/?error=`: put them back where they started.
    else if (!me.isOwner && stray && origin && origin !== '/') navigate(origin, { replace: true });
    if (!me.user.isDemo && !me.termsCurrent && pendingTerms === me.termsVersion) {
      acceptTerms.mutate({ version: me.termsVersion }, { onSettled: () => void qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() }) });
    }
  }, [isLoading, me, recheckDone]); // eslint-disable-line react-hooks/exhaustive-deps -- decided once, on the first answer (or after the one recheck)
}

export type DemoLoginAs = 'student' | 'owner' | 'temanA' | 'temanB';

export function useAuthActions() {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const refreshSession = useCallback(
    () => qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() }),
    [qc, trpc],
  );

  /** One-click demo sign-in: a plain fetch, so it needs no auth-client chunk. Resolves to an error message or null; the caller refreshes the session. */
  const demoLogin = useCallback(
    async (as: DemoLoginAs): Promise<string | null> => {
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
    signedOutAt = Date.now();
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
    qc.removeQueries({ queryKey: trpc.matching.pathKey() });
    qc.removeQueries({ queryKey: trpc.ownerVerification.pathKey() });
    qc.removeQueries({ queryKey: trpc.campus.myDiscountStatus.queryKey() });
    // Everything user-scoped is stale now, not just auth.me.
    await qc.invalidateQueries();
  }, [qc, trpc]);

  return { refreshSession, demoLogin, logout };
}
