import { LogsView } from '@/components/LogsView';
import { getContainer } from '@/lib/data';

export const metadata = { title: 'Logs' };

export default async function LogsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const container = await getContainer(id);
  return <LogsView containerId={container.id} />;
}
