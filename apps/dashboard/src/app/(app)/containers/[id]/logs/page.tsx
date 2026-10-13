import { LogsView } from '@/components/LogsView';
import { getContainer } from '@/lib/data';

export const metadata = { title: 'Logs' };

export default async function LogsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const container = await getContainer(id);
  return (
    <div className="stack">
      <p className="text-2">
        Incoming requests on this container&apos;s domains, newest first, kept for 7 days. Visitor IP
        addresses and query strings are never stored. Calls from the tagging server to GA4, Meta and other
        vendors appear in GTM Preview.
      </p>
      <LogsView containerId={container.id} />
    </div>
  );
}
