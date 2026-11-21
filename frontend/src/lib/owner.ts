import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { OwnerVerificationStatusName } from '@kobo/shared/types';
import { useTRPC } from './trpc';
import { useAuthActions, useSession } from './session';
import { messageForError } from './errors';

export type OwnershipType = 'PEMILIK' | 'PENGELOLA_KUASA' | 'LAINNYA';

/**
 * The server refuses `owner.kos.create` with FORBIDDEN and a message starting with this text
 * (copied from OWNER_UNVERIFIED_MESSAGE in backend/src/trpc/trpc.ts, which is not importable from the browser).
 */
export const OWNER_UNVERIFIED_PREFIX = 'Akun pemilik belum terverifikasi';
export const isOwnerUnverifiedError = (message: string | null | undefined): boolean => !!message && message.startsWith(OWNER_UNVERIFIED_PREFIX);

/** Query param that opens the documents dialog in OwnerLayout (`?dokumen=1`). */
export const DOCS_PARAM = 'dokumen';

// The declared role comes from `ownerVerification.status.ownershipType`; this copy only covers the moment before that query loads.
const TYPE_KEY = 'kobo.ownerType';
export function rememberOwnershipType(t: OwnershipType | undefined): void {
  try {
    if (t) localStorage.setItem(TYPE_KEY, t);
  } catch {
    /* storage blocked: the docs step falls back to PEMILIK */
  }
}
export function recalledOwnershipType(): OwnershipType {
  try {
    const v = localStorage.getItem(TYPE_KEY);
    if (v === 'PEMILIK' || v === 'PENGELOLA_KUASA' || v === 'LAINNYA') return v;
  } catch {
    /* ignore */
  }
  return 'PEMILIK';
}

/** "Daftarkan diri sebagai pemilik": owner.becomeOwner, then refresh the session. The caller decides where to go next. */
export function useBecomeOwner() {
  const trpc = useTRPC();
  const { refreshSession } = useAuthActions();
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation(trpc.owner.becomeOwner.mutationOptions());

  /** Resolves true once registered, false with `error` set otherwise. */
  const becomeOwner = async (phone: string, ownershipType?: OwnershipType): Promise<boolean> => {
    setError(null);
    try {
      await mutation.mutateAsync({ phone, ...(ownershipType ? { ownershipType } : {}) });
      rememberOwnershipType(ownershipType);
      await refreshSession();
      return true;
    } catch (err) {
      setError(messageForError(err));
      return false;
    }
  };

  return { becomeOwner, isPending: mutation.isPending, error };
}

/** Whether new kos may be created, the reason when not, and a way to open the documents dialog. */
export function useOwnerGate() {
  const { me } = useSession();
  const [params, setParams] = useSearchParams();
  const status: OwnerVerificationStatusName | null = me?.ownerStatus ?? null;
  const approved = status === 'DISETUJUI';
  const reason =
    status === 'MENUNGGU'
      ? 'Dokumen Anda sedang diperiksa. Kos baru bisa dibuat setelah disetujui.'
      : status === 'DITOLAK'
        ? 'Dokumen Anda ditolak. Unggah ulang dokumen untuk mendaftarkan kos.'
        : 'Lengkapi dokumen dulu untuk mendaftarkan kos.';
  const openDocs = useCallback(() => {
    const next = new URLSearchParams(params);
    next.set(DOCS_PARAM, '1');
    setParams(next, { replace: true });
  }, [params, setParams]);
  const closeDocs = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete(DOCS_PARAM);
    setParams(next, { replace: true });
  }, [params, setParams]);
  return { status, approved, reason: approved ? null : reason, openDocs, closeDocs, docsOpen: params.get(DOCS_PARAM) === '1' };
}

/** Owner document state (SLA text, per-document status). Enabled only for owners who are not yet approved. */
export function useOwnerVerification() {
  const trpc = useTRPC();
  const { me } = useSession();
  return useQuery({ ...trpc.ownerVerification.status.queryOptions(), enabled: !!me?.isOwner && me.ownerStatus !== 'DISETUJUI' });
}
