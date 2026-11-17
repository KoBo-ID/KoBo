import { QueryClient } from '@tanstack/react-query';
import { createTRPCClient, httpLink } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
// TYPE-ONLY: erased at build time, so no server runtime code reaches the bundle.
import type { AppRouter } from '../../../backend/src/trpc/router';
import { isNotFound } from './queryErrors';

export const { TRPCProvider, useTRPC } = createTRPCContext<AppRouter>();

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // One retry for flaky networks, none for a definite "does not exist".
      retry: (failures, error) => failures < 1 && !isNotFound(error),
      refetchOnWindowFocus: false,
    },
  },
});

// httpLink, not httpBatchLink: batching would pull extra client code and merge
// unrelated queries into one request.
export const trpcClient = createTRPCClient<AppRouter>({
  links: [httpLink({ url: '/api/trpc' })],
});
