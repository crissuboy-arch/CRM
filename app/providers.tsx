'use client';
import { OrganizationTransitionProvider } from '@/components/shell/OrganizationTransitionProvider';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState, type ReactNode } from 'react';
import { makeQueryClient } from '@/lib/query/client';

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => makeQueryClient());
  return (
    <OrganizationTransitionProvider>
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' &&
        process.env.NEXT_PUBLIC_REACT_QUERY_DEVTOOLS === 'true' && (
          <ReactQueryDevtools initialIsOpen={false} />
        )}
    </QueryClientProvider>
    </OrganizationTransitionProvider>
  );
}
