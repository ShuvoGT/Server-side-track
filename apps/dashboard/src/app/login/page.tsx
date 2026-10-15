import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthCard, GoogleButton, OrDivider } from '@/components/auth';
import { LoginForm } from '@/components/forms';
import { Alert } from '@/components/ui';
import { googleEnabled } from '@/lib/env';
import { getSession } from '@/lib/session';

export const metadata = { title: 'Sign in' };

const ERRORS: Record<string, string> = {
  google_cancelled: 'Google sign-in was cancelled.',
  google_expired: 'The Google sign-in took too long or was opened in another tab. Try again.',
  google_unverified: 'Google has not verified that email address, so it cannot be used to sign in.',
  google_failed: 'Google sign-in did not work. Try again, or sign in with your password.',
  google_off: 'Google sign-in is not set up on this server.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next = '/' } = await searchParams;
  if (await getSession()) redirect('/');
  return (
    <AuthCard title="Sign in" subtitle="Welcome back. Sign in to manage your tracking containers.">
      {error && ERRORS[error] && <Alert tone="critical">{ERRORS[error]}</Alert>}
      {googleEnabled() && (
        <>
          <GoogleButton next={next} label="Continue with Google" />
          <OrDivider />
        </>
      )}
      <LoginForm next={next} />
      <p className="small text-2 auth-switch">
        New here? <Link href="/signup">Create an account</Link>
      </p>
    </AuthCard>
  );
}
