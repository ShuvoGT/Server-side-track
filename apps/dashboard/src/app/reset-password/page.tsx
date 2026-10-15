import Link from 'next/link';
import { AuthCard } from '@/components/auth';
import { ResetPasswordForm } from '@/components/forms';
import { Alert } from '@/components/ui';

// The token is in the URL: never send it on as a referrer.
export const metadata = { title: 'Set a new password', referrer: 'no-referrer' as const };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <AuthCard title="Set a new password" subtitle="Choose the password you will sign in with from now on.">
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <Alert tone="critical">
          This link is incomplete. Open the link from the email again, or{' '}
          <Link href="/forgot-password">ask for a new one</Link>.
        </Alert>
      )}
      <p className="small text-2 auth-switch">
        <Link href="/login">Back to sign in</Link>
      </p>
    </AuthCard>
  );
}
