import { useQuery } from '@tanstack/react-query';
import { useSession } from './session';
import { useTRPC } from './trpc';

/** Number of the signed-in student's live tenancies (booked or active), for the navbar badge. 0 when signed out. */
export function useLiveTenancyCount(): number {
  const trpc = useTRPC();
  const { me } = useSession();
  const q = useQuery({ ...trpc.booking.mine.queryOptions(), enabled: !!me });
  if (!me) return 0;
  return (q.data ?? []).filter((t) => t.derivedStatus !== 'vacant').length;
}
