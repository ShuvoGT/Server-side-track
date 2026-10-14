import type { ReactNode } from 'react';
import { logout } from '@/app/actions';
import { NavLink } from '@/components/client';
import { ThemeToggle } from '@/components/theme';
import { requireSession } from '@/lib/session';

const navIcon = (d: string) => (
  <svg
    viewBox="0 0 24 24"
    width="17"
    height="17"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireSession();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">S</span>
          <div>
            Tracking Platform
            <small>Server-side tagging</small>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          <NavLink href="/" exact>
            {navIcon('m21 8-9-5-9 5v8l9 5 9-5V8Zm-18 0 9 5 9-5m-9 5v10')}
            Containers
          </NavLink>
          <NavLink href="/containers/new">
            {navIcon('M12 5v14M5 12h14')}
            New container
          </NavLink>
        </nav>
        <div className="sidebar-foot">
          <ThemeToggle />
          <form action={logout}>
            <button type="submit" className="btn btn-sm btn-ghost">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
