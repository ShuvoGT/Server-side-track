import { notFound } from 'next/navigation';
import { approveUser, deleteUser, rejectUser } from '@/app/actions';
import { InlineAction } from '@/components/forms';
import { formatDateTime } from '@/components/ui';
import { api } from '@/lib/api';
import { formatPhone } from '@/lib/countries';
import { getMe } from '@/lib/data';
import type { AdminUser } from '@/lib/types';

export const metadata = { title: 'All users' };

const DAY = 86_400_000;

function signInMethods(u: AdminUser) {
  return [u.hasGoogle && 'Google', u.hasPassword && 'Password'].filter(Boolean).join(' + ') || '—';
}

export default async function AllUsersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { user } = await getMe();
  if (!user.superAdmin) notFound();
  const tz = user.timezone;
  const { q = '' } = await searchParams;
  const all = await api.allUsers();
  const query = q.trim().toLowerCase();
  const users = query
    ? all.filter(
        (u) =>
          u.email.includes(query) ||
          u.name.toLowerCase().includes(query) ||
          u.workspaces.some((w) => w.name.toLowerCase().includes(query)),
      )
    : all;

  const now = Date.now();
  const newThisWeek = all.filter((u) => now - Date.parse(u.createdAt) < 7 * DAY).length;
  const activeThisWeek = all.filter((u) => u.lastLoginAt && now - Date.parse(u.lastLoginAt) < 7 * DAY).length;
  const google = all.filter((u) => u.hasGoogle).length;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>All users</h1>
          <p>Everyone with an account on the platform. Only super-admins see this page.</p>
        </div>
      </div>

      <div className="stats">
        <div className="card stat">
          <div className="stat-label">Accounts</div>
          <div className="stat-value">{all.length}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">New, last 7 days</div>
          <div className="stat-value">{newThisWeek}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Signed in, last 7 days</div>
          <div className="stat-value">{activeThisWeek}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">With Google</div>
          <div className="stat-value">{google}</div>
          <div className="stat-note">{all.length - google} with a password only</div>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <form className="row" style={{ flex: 1 }}>
            <input
              name="q"
              defaultValue={q}
              className="input"
              placeholder="Search by name, email or workspace"
              style={{ maxWidth: 360 }}
            />
            <button type="submit" className="btn">
              Search
            </button>
          </form>
          <span className="small muted">
            {users.length} of {all.length}
          </span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Sign-in</th>
                <th>Workspaces</th>
                <th>Joined</th>
                <th>Last sign-in</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="member">
                      <span className="avatar" aria-hidden="true">
                        {(u.name || u.email).slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <strong>{u.name}</strong>{' '}
                        {u.superAdmin && <span className="badge badge-info">Super-admin</span>}
                        <div className="small muted">{u.email}</div>
                        {u.phone && <div className="small muted">{formatPhone(u.phoneCountry, u.phone)}</div>}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="small">{signInMethods(u)}</div>
                    <span className={`badge ${u.emailVerified ? 'badge-good' : 'badge-warning'}`}>
                      {u.emailVerified ? 'Email verified' : 'Email not verified'}
                    </span>
                  </td>
                  <td className="small">
                    {u.workspaces.length === 0 ? (
                      <span className="muted">None</span>
                    ) : (
                      u.workspaces.map((w) => (
                        <div key={w.id}>
                          {w.name} <span className="muted">· {w.role === 'owner' ? 'Owner' : 'Member'}</span>
                        </div>
                      ))
                    )}
                  </td>
                  <td className="small text-2">{formatDateTime(u.createdAt, tz)}</td>
                  <td className="small text-2">
                    {u.lastLoginAt ? formatDateTime(u.lastLoginAt, tz) : 'Never'}
                  </td>
                  <td>
                    <div className="member-actions" style={{ justifyContent: 'flex-start' }}>
                      <span
                        className={`badge ${u.status === 'active' ? 'badge-good' : u.status === 'pending' ? 'badge-warning' : 'badge-critical'}`}
                      >
                        {u.status === 'active' ? 'Approved' : u.status === 'pending' ? 'Waiting' : 'Rejected'}
                      </span>
                      {u.status !== 'active' && (
                        <InlineAction
                          action={approveUser.bind(null, u.id)}
                          label="Approve"
                          pending="…"
                          primary
                        />
                      )}
                      {u.status === 'pending' && (
                        <InlineAction
                          action={rejectUser.bind(null, u.id)}
                          label="Reject"
                          pending="…"
                          danger
                        />
                      )}
                      {!u.superAdmin && u.id !== user.id && (
                        <InlineAction
                          action={deleteUser.bind(null, u.id)}
                          label="Delete"
                          pending="Deleting…"
                          confirm={`Delete the account of ${u.email}? They lose access at once. Workspaces they share with another owner stay; an empty workspace of their own is deleted. This cannot be undone.`}
                          danger
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No user matches &ldquo;{q}&rdquo;.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
