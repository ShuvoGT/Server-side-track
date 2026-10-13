import type { ReactNode } from 'react';
import { logout } from '@/app/actions';
import { NavLink } from '@/components/client';
import { requireSession } from '@/lib/session';

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
            Containers
          </NavLink>
          <NavLink href="/containers/new">New container</NavLink>
        </nav>
        <div className="sidebar-foot">
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
