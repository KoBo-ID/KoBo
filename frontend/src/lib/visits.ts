import { useQuery } from '@tanstack/react-query';
import { useSession } from './session';
import { useTRPC } from './trpc';

/** Number of the signed-in student's scheduled (not yet visited or cancelled) surveys, for the navbar badge. 0 when signed out. */
export function useScheduledVisitCount(): number {
  const trpc = useTRPC();
  const { me } = useSession();
  const q = useQuery({ ...trpc.visit.mine.queryOptions(), enabled: !!me });
  if (!me) return 0;
  return (q.data ?? []).filter((v) => v.status === 'SCHEDULED').length;
}

/** Free survey visits booked for one kos (owner.visits), soonest first. Disabled until a kos is selected. */
export function useOwnerVisits(kosId: string | undefined) {
  const trpc = useTRPC();
  return useQuery({ ...trpc.owner.visits.queryOptions({ kosId: kosId ?? '' }), enabled: !!kosId });
}

export const VISIT_SLOT_LABEL: Record<'PAGI' | 'SIANG', string> = {
  PAGI: 'Pagi (09.00 - 12.00)',
  SIANG: 'Siang/Sore (13.00 - 17.00)',
};

/** 'YYYY-MM-DD' (a WIB calendar day) as "Senin, 5 Oktober 2026". */
export function formatVisitDate(d: string): string {
  return new Date(`${d}T00:00:00+07:00`).toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });
}
