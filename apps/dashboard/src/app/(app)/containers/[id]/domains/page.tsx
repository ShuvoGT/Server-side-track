import { AddDomainForm, DomainActions } from '@/components/forms';
import { Alert, DomainStatusBadge, EmptyState, formatDateTime, Icon } from '@/components/ui';
import { api } from '@/lib/api';
import { getContainer, getMe } from '@/lib/data';

export const metadata = { title: 'Domains' };

export default async function DomainsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [container, platform, { user }] = await Promise.all([getContainer(id), api.platform(), getMe()]);
  const tz = user.timezone;

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Tracking domains</h2>
            <p>
              A subdomain of the website, e.g. <span className="mono">ss.example.com</span>. Several websites
              can share one container.
            </p>
          </div>
        </div>
        <div className="card-body">
          <AddDomainForm containerId={container.id} />
        </div>
      </div>

      {container.domains.length === 0 ? (
        <div className="card">
          <EmptyState icon={Icon.globe} title="No domains yet">
            Add the subdomain that will receive tracking requests. Using the website&apos;s own domain makes
            the platform&apos;s cookies first-party.
          </EmptyState>
        </div>
      ) : (
        container.domains.map((domain) => (
          <div className="card" key={domain.id}>
            <div className="card-head">
              <div className="row" style={{ gap: 10 }}>
                <h2 className="mono" style={{ fontSize: 15 }}>
                  {domain.hostname}
                </h2>
                <DomainStatusBadge status={domain.status} />
              </div>
              <DomainActions
                domainId={domain.id}
                containerId={container.id}
                verified={domain.status === 'verified'}
              />
            </div>
            <div className="card-body stack">
              {domain.status !== 'verified' && (
                <>
                  <p className="text-2">Create this record at your DNS provider, then press Verify:</p>
                  <div className="table-wrap card" style={{ boxShadow: 'none' }}>
                    <table className="table table-compact">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Name</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>CNAME</td>
                          <td className="mono">{domain.hostname}</td>
                          <td className="mono">{platform.edgeHostname}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {platform.edgeIpv4.length > 0 && (
                    <p className="small muted">
                      If your DNS provider cannot create a CNAME here, use an A record to{' '}
                      <span className="mono">{platform.edgeIpv4.join(', ')}</span>. It works, but must be
                      updated if the platform&apos;s addresses ever change.
                    </p>
                  )}
                  {domain.lastError && <Alert tone="warning">Last check: {domain.lastError}</Alert>}
                </>
              )}
              <dl className="kv small">
                <dt>Added</dt>
                <dd>{formatDateTime(domain.createdAt, tz)}</dd>
                <dt>Verified</dt>
                <dd>{formatDateTime(domain.verifiedAt, tz)}</dd>
                <dt>Last DNS check</dt>
                <dd>{formatDateTime(domain.lastCheckedAt, tz)}</dd>
              </dl>
            </div>
          </div>
        ))
      )}

      <Alert tone="info">
        Safari limits cookies set from a subdomain whose IP address differs from the main website&apos;s. For
        the longest cookie lifetimes, route a path on the main domain (e.g. example.com/metrics) to the
        platform instead; the same-origin setup guide covers Nginx and Cloudflare.
      </Alert>
    </div>
  );
}
