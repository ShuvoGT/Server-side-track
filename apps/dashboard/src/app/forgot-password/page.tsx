import Link from 'next/link';
import { AuthCard } from '@/components/auth';
import { ForgotPasswordForm } from '@/components/forms';

export const metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Forgot your password?"
      subtitle="Enter the email address of your account and we send you a link to set a new password."
    >
      <ForgotPasswordForm />
      <p className="small text-2 auth-switch">
        Remembered it? <Link href="/login">Sign in</Link>
      </p>
    </AuthCard>
  );
}
