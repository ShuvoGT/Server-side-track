import Link from 'next/link';
import { Alert, ContainerStatusBadge, EmptyState, formatNumber, Icon } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { Container, Tenant } from '@/lib/types';

export const metadata = { title: 'Containers' };

export default async function ContainersPage() {
  let containers: Container[];
  let tenants: Tenant[];
  try {
    [containers, tenants] = await Promise.all([api.containers(), api.tenants()]);
  } catch (error) {
    if (error instanceof ApiError) return <Alert tone="critical">{error.message}</Alert>;
    throw error;
  }
  const tenantName = new Map(tenants.map((t) => [t.id, t.name]));
  const to = new Date();
  const from = new Date(to.getTime() - 86400_000);
  const usage = new Map(
    await Promise.all(
      containers.map(
        async (c) =>
          [
            c.id,
            await api
              .usage(c.id, from, to)
              .then((u) => u.totals)
              .catch(() => null),
          ] as const,
      ),
    ),
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Containers</h1>
          <p>One container per GTM server container. Each runs its own tagging and preview servers.</p>
        </div>
        {containers.length > 0 && (
          <Link className="btn btn-primary" href="/containers/new">
            New container
          </Link>
        )}
      </div>

      {containers.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Icon.server}
            title="No containers yet"
            action={
              <Link className="btn btn-primary" href="/containers/new">
                Create your first container
              </Link>
            }
          >
            Paste the Container Config of a GTM server container, add a tracking domain such as
            sst.example.com, and the platform runs the tagging server for it.
          </EmptyState>
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Container</th>
                <th>Status</th>
                <th>Domains</th>
                <th className="num">Requests, 24 h</th>
                <th className="num">Errors, 24 h</th>
              </tr>
            </thead>
            <tbody>
              {containers.map((c) => {
                const totals = usage.get(c.id);
                const verified = c.domains.filter((d) => d.status === 'verified');
                return (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/containers/${c.id}`}>
                        <strong>{c.name}</strong>
                      </Link>
                      <div className="small muted">
                        {tenantName.get(c.tenantId) ?? '—'} · <span className="mono">{c.gtmContainerId}</span>
                      </div>
                    </td>
                    <td>
                      <ContainerStatusBadge status={c.status} />
                    </td>
                    <td>
                      {c.domains.length === 0 ? (
                        <Link href={`/containers/${c.id}/domains`} className="small">
                          Add a domain
                        </Link>
                      ) : (
                        <span>
                          {verified[0]?.hostname ?? c.domains[0]!.hostname}
                          {c.domains.length > 1 && <span className="muted"> +{c.domains.length - 1}</span>}
                          {verified.length === 0 && <span className="small muted"> (not verified)</span>}
                        </span>
                      )}
                    </td>
                    <td className="num">
                      {totals ? formatNumber(totals.requests + totals.loader + totals.webhook) : '—'}
                    </td>
                    <td className="num">{totals ? formatNumber(totals.errors) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
