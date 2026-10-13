'use client';

import { Alert } from '@/components/ui';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="stack">
      <h1>Something went wrong</h1>
      <Alert tone="critical">
        {error.message.includes('not reachable')
          ? error.message
          : 'The page could not be loaded. If the control plane API is down, live tracking keeps working; only this dashboard is affected.'}
        {error.digest && <div className="small muted">Reference: {error.digest}</div>}
      </Alert>
      <div>
        <button className="btn" onClick={reset}>
          Try again
        </button>
      </div>
    </div>
  );
}
