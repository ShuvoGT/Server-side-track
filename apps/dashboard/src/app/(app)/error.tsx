'use client';

import { Alert } from '@/components/ui';

export default function ErrorPage({ error }: { error: Error & { digest?: string } }) {
  // A page opened before a deploy calls server actions the new build no longer has; a reload fixes it.
  const outdated = /server action/i.test(error.message);
  return (
    <div className="stack">
      <h1>{outdated ? 'The dashboard was updated' : 'Something went wrong'}</h1>
      <Alert tone={outdated ? 'info' : 'critical'}>
        {outdated
          ? 'This page was opened before the latest update. Reload it and try once more.'
          : error.message.includes('not reachable')
            ? error.message
            : 'The page could not be loaded. If the control plane API is down, live tracking keeps working; only this dashboard is affected.'}
        {!outdated && error.digest && <div className="small muted">Reference: {error.digest}</div>}
      </Alert>
      <div>
        {/* A full reload, so the browser also picks up a new deployment. */}
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          {outdated ? 'Reload page' : 'Try again'}
        </button>
      </div>
    </div>
  );
}
