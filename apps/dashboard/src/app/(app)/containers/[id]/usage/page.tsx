import Link from 'next/link';
import { UsageChart, type ChartPoint } from '@/components/UsageChart';
import { formatNumber } from '@/components/ui';
import { api } from '@/lib/api';
import { getContainer, getMe } from '@/lib/data';
import type { UsageCounts } from '@/lib/types';

export const metadata = { title: 'Usage' };

const RANGES = {
  '24h': { label: '24 hours', hours: 24, bucketHours: 1 },
  '7d': { label: '7 days', hours: 7 * 24, bucketHours: 6 },
  '30d': { label: '30 days', hours: 30 * 24, bucketHours: 24 },
} as const;
type RangeKey = keyof typeof RANGES;

const HOUR = 3600_000;

export default async function UsagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { id } = await params;
  const { range: rawRange } = await searchParams;
  const rangeKey: RangeKey = rawRange && rawRange in RANGES ? (rawRange as RangeKey) : '24h';
  const range = RANGES[rangeKey];
  const [container, { user }] = await Promise.all([getContainer(id), getMe()]);
  const fmt = (date: Date, options: Intl.DateTimeFormatOptions) =>
    date.toLocaleString('en-GB', { timeZone: user.timezone, ...options });

  // Buckets aligned to whole hours, ending with the current (partial) hour.
  const end = Math.floor(Date.now() / HOUR) * HOUR + HOUR;
  const start = end - range.hours * HOUR;
  const usage = await api.usage(container.id, new Date(start), new Date(end));

  const bucketMs = range.bucketHours * HOUR;
  const buckets = Array.from({ length: range.hours / range.bucketHours }, () => 0);
  for (const h of usage.hours) {
    const index = Math.floor((new Date(h.hour).getTime() - start) / bucketMs);
    if (index >= 0 && index < buckets.length) buckets[index]! += h.requests;
  }
  const tickEvery = Math.ceil(buckets.length / 8);
  const points: ChartPoint[] = buckets.map((value, i) => {
    const at = new Date(start + i * bucketMs);
    const label =
      range.bucketHours === 24
        ? fmt(at, { day: 'numeric', month: 'short' })
        : fmt(at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const tick =
      i % tickEvery === 0
        ? range.bucketHours === 1
          ? fmt(at, { hour: '2-digit', minute: '2-digit' })
          : fmt(at, { day: 'numeric', month: 'short' })
        : '';
    return { label, tick, value };
  });

  const t = usage.totals;
  const tiles: [string, keyof UsageCounts, string][] = [
    ['Tracking requests', 'requests', 'Sent on to the tagging server'],
    ['Loader script requests', 'loader', 'gtm.js and gtag.js from your domain'],
    ['WooCommerce webhooks', 'webhook', 'Signed order events'],
    ['Bots flagged', 'botFlagged', 'Forwarded with x-sst-bot: 1'],
    ['Bots dropped', 'botDropped', 'Answered without forwarding'],
    ['Errors', 'errors', 'Tagging server unreachable'],
  ];
  const hasData = Object.values(t).some((v) => v > 0);
  const per =
    range.bucketHours === 1 ? 'hour' : range.bucketHours === 24 ? 'day' : `${range.bucketHours} hours`;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <p className="text-2">
          Request counts for the last {range.label} (times in {user.timezone}).
        </p>
        <nav className="segmented" aria-label="Time range">
          {(Object.keys(RANGES) as RangeKey[]).map((key) => (
            <Link key={key} href={`?range=${key}`} aria-current={key === rangeKey ? 'true' : undefined}>
              {RANGES[key].label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="stats">
        {tiles.map(([label, key, note]) => (
          <div className="card stat" key={key}>
            <div className="stat-label">{label}</div>
            <div className="stat-value">{formatNumber(t[key])}</div>
            <div className="stat-note">{note}</div>
          </div>
        ))}
      </div>
      <div className="card card-body">
        {hasData ? (
          <UsageChart title={`Tracking requests per ${per}`} points={points} />
        ) : (
          <div className="empty">
            <h2>No requests in this period</h2>
            <p>
              Counts appear here within a few seconds of the first request to a verified domain. Check the
              Overview tab for setup steps.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
