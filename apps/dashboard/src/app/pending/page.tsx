import { redirect } from 'next/navigation';
import { logout } from '@/app/actions';
import { AuthCard } from '@/components/auth';
import { Alert } from '@/components/ui';
import { api } from '@/lib/api';
import { getSession } from '@/lib/session';

export const metadata = { title: 'Waiting for approval' };
export const dynamic = 'force-dynamic';

/** Where a new account waits until a super-admin approves it. */
export default async function PendingPage() {
  if (!(await getSession())) redirect('/login');
  const { user } = await api.me();
  if (user.status === 'active') redirect('/');
  const rejected = user.status === 'rejected';

  return (
    <AuthCard
      title={rejected ? 'Account not approved' : 'Waiting for approval'}
      subtitle={`Signed in as ${user.email}`}
    >
      {rejected ? (
        <Alert tone="critical">
          Your account request was not approved, so the dashboard is not available. If you think this is a
          mistake, contact the platform team.
        </Alert>
      ) : (
        <>
          <Alert tone="info">
            Thanks for signing up, {user.name}. An administrator reviews new accounts before they can use the
            dashboard. We email you at {user.email} as soon as yours is approved.
          </Alert>
          <a className="btn" href="/pending">
            Check again
          </a>
        </>
      )}
      <form action={logout}>
        <button type="submit" className="btn btn-ghost" style={{ width: '100%' }}>
          Sign out
        </button>
      </form>
    </AuthCard>
  );
}
