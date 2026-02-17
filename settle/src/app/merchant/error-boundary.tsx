'use client';

import { ErrorBoundary } from '@/components/ErrorBoundary';

export function MerchantErrorBoundary({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
