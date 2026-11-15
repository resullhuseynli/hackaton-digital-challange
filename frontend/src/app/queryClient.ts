import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/http';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 1000 * 60 * 60 * 24,
      refetchOnWindowFocus: false,
      networkMode: 'offlineFirst',
      retry: (count, error) => {
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return count < 2;
      },
      retryDelay: (n) => Math.min(8000, 800 * 2 ** n),
    },
    mutations: { networkMode: 'always', retry: false },
  },
});
