import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/forms';
import { ThemeToggle } from '@/components/theme';
import { hasSession } from '@/lib/session';

export const metadata = { title: 'Sign in' };

export default async function LoginPage() {
  if (await hasSession()) redirect('/');
  return (
    <main className="login">
      <div className="login-theme">
        <ThemeToggle />
      </div>
      <div className="card">
        <div className="card-body stack">
          <div className="brand" style={{ padding: 0 }}>
            <span className="brand-mark">S</span>
            <div>
              Tracking Platform
              <small>Server-side tagging</small>
            </div>
          </div>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
