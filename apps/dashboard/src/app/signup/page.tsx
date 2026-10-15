import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthCard, GoogleButton, OrDivider } from '@/components/auth';
import { SignUpForm } from '@/components/forms';
import { googleEnabled } from '@/lib/env';
import { getSession } from '@/lib/session';

export const metadata = { title: 'Create account' };

export default async function SignUpPage() {
  if (await getSession()) redirect('/');
  return (
    <AuthCard
      title="Create your account"
      subtitle="You get your own workspace for containers, and can invite your team later."
    >
      {googleEnabled() && (
        <>
          <GoogleButton label="Sign up with Google" />
          <OrDivider />
        </>
      )}
      <SignUpForm />
      <p className="small text-2 auth-switch">
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </AuthCard>
  );
}
