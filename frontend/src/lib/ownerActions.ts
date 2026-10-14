import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from './trpc';
import { messageForError } from './errors';
import { useAppStore } from '../store/AppContext';

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
    endTenancy: (roomId: string, tenancyId: string) =>
      kosId ? run(roomId, () => endTenancy.mutateAsync({ kosId, tenancyId }), 'Sewa diakhiri. Kamar kembali kosong.') : Promise.resolve(),
  };
}
