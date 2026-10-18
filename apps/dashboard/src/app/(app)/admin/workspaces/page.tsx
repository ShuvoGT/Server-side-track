import { notFound } from 'next/navigation';
import { adminDeleteWorkspace } from '@/app/actions';
import { InlineAction } from '@/components/forms';
import { ContainerStatusBadge, formatDateTime } from '@/components/ui';
import { api } from '@/lib/api';
import { getMe } from '@/lib/data';

export const metadata = { title: 'All workspaces' };

export default async function AllWorkspacesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { user } = await getMe();
  if (!user.superAdmin) notFound();
  const tz = user.timezone;
  const { q = '' } = await searchParams;
  const all = await api.allWorkspaces();
  const query = q.trim().toLowerCase();
  const workspaces = query
    ? all.filter(
        (w) =>
          w.name.toLowerCase().includes(query) ||
          w.owners.some((o) => o.email.includes(query) || o.name.toLowerCase().includes(query)) ||
          w.containers.some((c) => c.name.toLowerCase().includes(query)),
      )
    : all;
  const containers = all.reduce((sum, w) => sum + w.containers.length, 0);
  const empty = all.filter((w) => w.containers.length === 0).length;
  const ownerless = all.filter((w) => w.owners.length === 0).length;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>All workspaces</h1>
          <p>Every workspace on the platform. Only super-admins see this page.</p>
        </div>
      </div>

      <div className="stats">
        <div className="card stat">
          <div className="stat-label">Workspaces</div>
          <div className="stat-value">{all.length}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Containers</div>
          <div className="stat-value">{containers}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Without containers</div>
          <div className="stat-value">{empty}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Without an owner</div>
          <div className="stat-value">{ownerless}</div>
        </div>
      </div>

      <section className="card">
        <div className="card-head">
          <form className="row" style={{ flex: 1 }}>
            <input
              name="q"
              defaultValue={q}
              className="input"
              placeholder="Search by workspace, owner or container"
              style={{ maxWidth: 360 }}
            />
            <button type="submit" className="btn">
              Search
            </button>
          </form>
          <span className="small muted">
            {workspaces.length} of {all.length}
          </span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Owners</th>
                <th className="num">Members</th>
                <th>Containers</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {workspaces.map((w) => (
                <tr key={w.id}>
                  <td>
                    <strong>{w.name}</strong>
                    <div className="small muted mono">{w.id}</div>
                  </td>
                  <td className="small">
                    {w.owners.length === 0 ? (
                      <span className="muted">None</span>
                    ) : (
                      w.owners.map((o) => (
                        <div key={o.id}>
                          {o.name} <span className="muted">· {o.email}</span>
                        </div>
                      ))
                    )}
                  </td>
                  <td className="num">{w.memberCount}</td>
                  <td className="small">
                    {w.containers.length === 0 ? (
                      <span className="muted">None</span>
                    ) : (
                      w.containers.map((c) => (
                        <div key={c.id} className="row" style={{ gap: 6 }}>
                          {c.name} <ContainerStatusBadge status={c.status} />
                        </div>
                      ))
                    )}
                  </td>
                  <td className="small text-2">{formatDateTime(w.createdAt, tz)}</td>
                  <td>
                    <div className="member-actions">
                      <InlineAction
                        action={adminDeleteWorkspace.bind(null, w.id)}
                        label="Delete"
                        pending="Deleting…"
                        danger
                        confirm={
                          w.containers.length > 0
                            ? `Delete ${w.name} and its ${w.containers.length === 1 ? 'container' : `${w.containers.length} containers`} (${w.containers.map((c) => c.name).join(', ')})? Their tracking stops at once and their tagging servers are removed. This cannot be undone.`
                            : `Delete ${w.name}? Its members lose access to it. This cannot be undone.`
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {workspaces.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No workspace matches.
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
