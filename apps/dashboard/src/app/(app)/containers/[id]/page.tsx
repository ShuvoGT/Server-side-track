import Link from 'next/link';
import type { ReactNode } from 'react';
import { CodeBlock } from '@/components/client';
import { formatNumber, Icon } from '@/components/ui';
import { api } from '@/lib/api';
import { getContainer } from '@/lib/data';

export const metadata = { title: 'Overview' };

function Step({
  done,
  n,
  title,
  children,
}: {
  done: boolean;
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <li>
      <span className={`check-dot${done ? ' done' : ''}`} aria-label={done ? 'Done' : `Step ${n}`}>
        {done ? Icon.check : n}
      </span>
      <div className="stack" style={{ gap: 8, minWidth: 0, flex: 1 }}>
        <h3>{title}</h3>
        {children}
      </div>
    </li>
  );
}

const STATUS_TEXT = {
  active: 'Tagging servers are running.',
  provisioning: 'The provisioner is starting the tagging servers. This page updates by itself.',
  pending: 'Waiting to be provisioned.',
  failed: 'Provisioning failed.',
  deleting: 'Being deleted.',
} as const;

export default async function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const container = await getContainer(id);
  const verified = container.domains.find((d) => d.status === 'verified');
  const to = new Date();
  const [usage, snippet] = await Promise.all([
    api.usage(container.id, new Date(to.getTime() - 86400_000), to).catch(() => null),
    verified ? api.snippet(container.id).catch(() => null) : null,
  ]);
  const t = usage?.totals;
  const base = `/containers/${container.id}`;

  return (
    <div className="stack">
      <div className="stats">
        <div className="card stat">
          <div className="stat-label">Tracking requests, 24 h</div>
          <div className="stat-value">{t ? formatNumber(t.requests) : '—'}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Loader script requests, 24 h</div>
          <div className="stat-value">{t ? formatNumber(t.loader) : '—'}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Bots, 24 h</div>
          <div className="stat-value">{t ? formatNumber(t.botFlagged + t.botDropped) : '—'}</div>
          <div className="stat-note">{t ? `${formatNumber(t.botDropped)} dropped` : ''}</div>
        </div>
        <div className="card stat">
          <div className="stat-label">Errors, 24 h</div>
          <div className="stat-value">{t ? formatNumber(t.errors) : '—'}</div>
          <div className="stat-note">Tagging server unreachable</div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Setup</h2>
        </div>
        <ol className="checklist">
          <Step done n={1} title="Container created">
            <p>{STATUS_TEXT[container.status]}</p>
          </Step>
          <Step done={!!verified} n={2} title="Tracking domain verified">
            {verified ? (
              <p>
                Live on <strong>{verified.hostname}</strong>.
              </p>
            ) : (
              <p>
                {container.domains.length > 0 && 'A domain is waiting for DNS. '}
                <Link href={`${base}/domains`}>
                  {container.domains.length > 0 ? 'Check the DNS record' : 'Add a tracking domain'}
                </Link>
              </p>
            )}
          </Step>
          <Step done={false} n={3} title="Connect GTM and the website">
            {snippet ? (
              <>
                <p>
                  In the <strong>web</strong> container&apos;s Google tag, set{' '}
                  <code>server_container_url</code> to:
                </p>
                <CodeBlock code={snippet.serverContainerUrl} />
                {snippet.gtmHead ? (
                  <>
                    <p>
                      Replace the website&apos;s GTM head snippet with this one. It loads gtm.js from your own
                      domain, so ad blockers do not stop it:
                    </p>
                    <CodeBlock code={snippet.gtmHead} />
                  </>
                ) : (
                  <p>
                    {snippet.customLoader
                      ? 'Set a web container ID'
                      : 'Turn on the custom loader and set a web container ID'}{' '}
                    in <Link href={`${base}/power-ups`}>Power-ups</Link> to get a GTM snippet served from your
                    own domain.
                  </p>
                )}
                <p>WooCommerce plugin webhook URL:</p>
                <CodeBlock code={snippet.webhookUrl} />
              </>
            ) : (
              <p>Available once a domain is verified.</p>
            )}
          </Step>
        </ol>
      </div>
    </div>
  );
}
