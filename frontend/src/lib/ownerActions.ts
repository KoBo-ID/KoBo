import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from './trpc';
import { messageForError } from './errors';
import { useAppStore } from '../store/AppContext';
import type { TenancyEndPreview } from '../../../backend/src/trpc/router';

/**
 * The two things an owner can do to a room's tenancy from the board. "Tandai Lunas" is a real MANUAL payment
 * (payment.recordManual) and moving out is owner.tenancy.end; there is no way to set a status by hand.
 */
export function useRoomActions(kosId: string | undefined) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { addToast } = useAppStore();
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: trpc.owner.board.pathKey() });
    void qc.invalidateQueries({ queryKey: trpc.owner.myKos.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.kos.pathKey() });
  };

  const recordManual = useMutation(trpc.payment.recordManual.mutationOptions());
  const endTenancy = useMutation(trpc.owner.tenancy.end.mutationOptions());

  const run = async (roomId: string, job: () => Promise<unknown>, okMessage: string) => {
    setBusyRoomId(roomId);
    try {
      await job();
      addToast(okMessage, 'success');
    } catch (err) {
      addToast(messageForError(err), 'error');
    } finally {
      setBusyRoomId(null);
      refresh();
    }
  };

  return {
    busyRoomId,
    /** Records a MANUAL payment from the confirmation modal. Resolves true on success so the modal can close. */
    markPaid: async (
      roomId: string,
      input: { invoiceId: string; method: 'CASH' | 'BANK_TRANSFER'; confirmedAmount: number; reference?: string; note?: string },
    ): Promise<boolean> => {
      if (!kosId) return false;
      let ok = false;
      await run(roomId, async () => { await recordManual.mutateAsync({ kosId, ...input }); ok = true; }, 'Pembayaran dicatat lunas. Kuitansi sudah terbit.');
      return ok;
    },
    /**
     * Looks up what ending this tenancy would leave unpaid. Marks the room busy meanwhile.
     * Returns null (after a toast, unless quiet) when the lookup fails, so the caller opens nothing.
     */
    previewEnd: async (roomId: string, tenancyId: string, opts: { quiet?: boolean } = {}): Promise<TenancyEndPreview | null> => {
      if (!kosId) return null;
      setBusyRoomId(roomId);
      try {
        return await qc.fetchQuery({ ...trpc.owner.tenancy.endPreview.queryOptions({ kosId, tenancyId }), staleTime: 0 });
      } catch {
        if (!opts.quiet) addToast('Gagal memeriksa tagihan penyewa. Coba lagi.', 'error');
        return null;
      } finally {
        setBusyRoomId(null);
      }
    },
    /**
     * Ends a tenancy. The caller supplies the success toast; a failure is returned (not toasted) so the caller can show it
     * where the owner is looking, for instance inside the dialog.
     */
    endTenancy: async (
      roomId: string,
      tenancyId: string,
      opts: { okMessage: string; arrears?: 'KEEP' | 'WAIVE'; waiverReason?: string },
    ): Promise<{ ok: true } | { ok: false; error: unknown }> => {
      if (!kosId) return { ok: false, error: new Error('Kos belum dipilih.') };
      setBusyRoomId(roomId);
      try {
        await endTenancy.mutateAsync({ kosId, tenancyId, arrears: opts.arrears, waiverReason: opts.waiverReason });
        addToast(opts.okMessage, 'success');
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      } finally {
        setBusyRoomId(null);
        refresh();
      }
    },
  };
}
