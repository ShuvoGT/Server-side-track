import type { ReactNode } from 'react';
import { logout } from '@/app/actions';
import { NavLink } from '@/components/client';
import { ThemeToggle } from '@/components/theme';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { currentWorkspace, getMe } from '@/lib/data';
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
  const [{ user, workspaces }, workspace] = await Promise.all([getMe(), currentWorkspace()]);
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
        <WorkspaceSwitcher workspaces={workspaces} currentId={workspace.id} superAdmin={user.superAdmin} />
        <nav className="nav" aria-label="Main">
          <NavLink href="/" exact>
            {navIcon('m21 8-9-5-9 5v8l9 5 9-5V8Zm-18 0 9 5 9-5m-9 5v10')}
            Containers
          </NavLink>
          <NavLink href="/containers/new">
            {navIcon('M12 5v14M5 12h14')}
            New container
          </NavLink>
          <NavLink href="/workspace">
            {navIcon(
              'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
            )}
            Members
          </NavLink>
        </nav>
        <div className="sidebar-foot">
          <div className="me">
            <span className="avatar" aria-hidden="true">
              {(user.name || user.email).slice(0, 1).toUpperCase()}
            </span>
            <div className="me-text">
              <strong>{user.name}</strong>
              <span className="small muted">{user.email}</span>
              {user.superAdmin && <span className="badge badge-info super-badge">Super-admin</span>}
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', width: '100%' }}>
            <ThemeToggle />
            <form action={logout}>
              <button type="submit" className="btn btn-sm btn-ghost">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
