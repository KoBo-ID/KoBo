import { useQuery } from '@tanstack/react-query';
import { useTRPC } from './trpc';

/**
 * Counts for the owner nav: what is waiting on the active kos. Reads the same queries the pages use,
 * so React Query serves them from cache.
 */
export function useOwnerBadges(kosId: string | undefined): { dashboard: number; reviews: number } {
  const trpc = useTRPC();
  const enabled = !!kosId;
  const id = kosId ?? '';
  const board = useQuery({ ...trpc.owner.board.queryOptions({ kosId: id }), enabled });
  const applications = useQuery({ ...trpc.application.ownerList.queryOptions({ kosId: id }), enabled });
  const visits = useQuery({ ...trpc.owner.visits.queryOptions({ kosId: id }), enabled });
  const reviews = useQuery({ ...trpc.owner.reviews.queryOptions({ kosId: id }), enabled });

  const late = (board.data?.rooms ?? []).filter((r) => r.status === 'overdue' || r.status === 'due').length;
  const dashboard = late + (applications.data?.length ?? 0) + (visits.data ?? []).filter((v) => v.status === 'SCHEDULED').length;
  const unanswered = (reviews.data ?? []).filter((r) => !r.ownerReply).length;
  return { dashboard, reviews: unanswered };
}
