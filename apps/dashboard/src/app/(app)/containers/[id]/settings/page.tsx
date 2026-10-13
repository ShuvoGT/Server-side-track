import {
  ContainerConfigForm,
  DeleteContainerForm,
  ProvisionButton,
  RotateSecretForm,
  SettingsForm,
} from '@/components/forms';
import { formatDateTime } from '@/components/ui';
import { getContainer } from '@/lib/data';

export const metadata = { title: 'Settings' };

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const container = await getContainer(id);
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <h2>General</h2>
        </div>
        <SettingsForm containerId={container.id} name={container.name} />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>GTM server container</h2>
        </div>
        <ContainerConfigForm containerId={container.id} gtmContainerId={container.gtmContainerId} />
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Tagging servers</h2>
            <p>Restart them, e.g. after a failure or to pick up a newer Google image.</p>
          </div>
          <ProvisionButton containerId={container.id} label="Restart tagging servers" />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Details</h2>
        </div>
        <div className="card-body">
          <dl className="kv">
            <dt>Container ID</dt>
            <dd className="mono">{container.id}</dd>
            <dt>Kubernetes namespace</dt>
            <dd className="mono">ctr-{container.id}</dd>
            <dt>Tagging server</dt>
            <dd className="mono">{container.upstreamUrl}</dd>
            <dt>gtm.js loader path</dt>
            <dd className="mono">{container.loaderGtmPath}</dd>
            <dt>gtag.js loader path</dt>
            <dd className="mono">{container.loaderGtagPath}?id=G-…</dd>
            <dt>Webhook path</dt>
            <dd className="mono">{container.webhookPath}</dd>
            <dt>Created</dt>
            <dd>{formatDateTime(container.createdAt)}</dd>
          </dl>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>WooCommerce webhook secret</h2>
        </div>
        <RotateSecretForm containerId={container.id} />
      </div>

      <div className="card" style={{ borderColor: 'var(--critical)' }}>
        <div className="card-head">
          <h2>Delete container</h2>
        </div>
        <DeleteContainerForm containerId={container.id} name={container.name} />
      </div>
    </div>
  );
}
