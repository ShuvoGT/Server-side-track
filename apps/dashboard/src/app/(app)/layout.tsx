import type { ReactNode } from 'react';
import { logout } from '@/app/actions';
import { NavLink } from '@/components/client';
import { ThemeToggle } from '@/components/theme';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { api } from '@/lib/api';
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
  const pendingCount = user.superAdmin
    ? (await api.allUsers().catch(() => [])).filter((u) => u.status === 'pending').length
    : 0;
  const pendingBadge =
    pendingCount > 0 ? (
      <span className="nav-count" title={`${pendingCount} account request${pendingCount === 1 ? '' : 's'}`}>
        {pendingCount}
      </span>
    ) : null;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">O</span>
          <div>
            OpenTrack
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
            {pendingBadge}
          </NavLink>
          <NavLink href="/settings">
            {navIcon(
              'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.2-1.3L14.4 3h-4l-.4 2.4a7.6 7.6 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.2 1.3l.4 2.4h4l.4-2.4a7.6 7.6 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3Z',
            )}
            Settings
          </NavLink>
          <NavLink href="/help">
            {navIcon(
              'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm-2.5-13a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14m0 3v.01',
            )}
            User manual
          </NavLink>
          {user.superAdmin && (
            <NavLink href="/admin/users">
              {navIcon(
                'M12 2 4 5v6c0 5 3.4 9.3 8 11 4.6-1.7 8-6 8-11V5l-8-3Zm0 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
              )}
              All users
              {pendingBadge}
            </NavLink>
          )}
          {user.superAdmin && (
            <NavLink href="/admin/workspaces">
              {navIcon('M3 7h18M3 12h18M3 17h18M7 3v4m10-4v4')}
              All workspaces
            </NavLink>
          )}
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
