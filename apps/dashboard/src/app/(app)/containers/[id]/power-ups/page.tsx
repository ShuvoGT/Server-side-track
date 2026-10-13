import { PowerUpsForm, RegenerateLoaderPathsForm } from '@/components/forms';
import { getContainer } from '@/lib/data';

export const metadata = { title: 'Power-ups' };

export default async function PowerUpsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const container = await getContainer(id);
  return (
    <div className="stack">
      <p className="text-2">
        Power-ups run in the edge gateway before requests reach the tagging server. Tags in the server
        container read the added headers with Request Header variables.
      </p>
      <PowerUpsForm
        containerId={container.id}
        powerUps={container.powerUps}
        loader={{
          webContainerId: container.webContainerId,
          gtmPath: container.loaderGtmPath,
          gtagPath: container.loaderGtagPath,
          trackingHost: container.domains.find((d) => d.status === 'verified')?.hostname ?? null,
        }}
      />
      <RegenerateLoaderPathsForm containerId={container.id} />
    </div>
  );
}
