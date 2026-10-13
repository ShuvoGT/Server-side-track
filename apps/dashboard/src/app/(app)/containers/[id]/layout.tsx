import Link from 'next/link';
import type { ReactNode } from 'react';
import { AutoRefresh, NavLink } from '@/components/client';
import { ProvisionButton } from '@/components/forms';
import { Alert, ContainerStatusBadge } from '@/components/ui';
import { getContainer } from '@/lib/data';

export default async function ContainerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const container = await getContainer(id);
  const base = `/containers/${container.id}`;
  return (
    <>
      <div className="crumbs">
        <Link href="/">Containers</Link> / {container.name}
      </div>
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h1>{container.name}</h1>
            <ContainerStatusBadge status={container.status} />
          </div>
          <p>
            Server container <span className="mono">{container.gtmContainerId}</span>
            {container.webContainerId && (
              <>
                {' '}
                · Web container <span className="mono">{container.webContainerId}</span>
              </>
            )}
          </p>
        </div>
      </div>
      <AutoRefresh active={container.status === 'provisioning' || container.status === 'pending'} />
      {container.status === 'failed' && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="critical">
            <div className="stack" style={{ gap: 8 }}>
              <span>Provisioning failed{container.statusMessage ? `: ${container.statusMessage}` : '.'}</span>
              <ProvisionButton containerId={container.id} label="Provision again" />
            </div>
          </Alert>
        </div>
      )}
      {container.status === 'provisioning' && container.statusMessage && (
        <div style={{ marginBottom: 16 }}>
          <Alert tone="info">{container.statusMessage}…</Alert>
        </div>
      )}
      <nav className="tabs" aria-label="Container">
        <NavLink href={base} exact>
          Overview
        </NavLink>
        <NavLink href={`${base}/domains`}>Domains</NavLink>
        <NavLink href={`${base}/power-ups`}>Power-ups</NavLink>
        <NavLink href={`${base}/usage`}>Usage</NavLink>
        <NavLink href={`${base}/logs`}>Logs</NavLink>
        <NavLink href={`${base}/settings`}>Settings</NavLink>
      </nav>
      {children}
    </>
  );
}
