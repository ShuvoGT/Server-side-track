import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth';
import { TwoFactorSignInForm } from '@/components/forms';
import { getPendingSignIn } from '@/lib/session';

export const metadata = { title: 'Two-step verification' };

export default async function VerifyPage() {
  if (!(await getPendingSignIn())) redirect('/login?error=two_factor_expired');
  return (
    <AuthCard
      title="Two-step verification"
      subtitle="Enter the 6-digit code from your authenticator app, or one of your recovery codes."
    >
      <TwoFactorSignInForm />
      <p className="small text-2 auth-switch">
        <a href="/logout">Cancel and sign in again</a>
      </p>
    </AuthCard>
  );
}
