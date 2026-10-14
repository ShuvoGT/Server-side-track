'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LogsResponse, RequestLogEntry } from '@/lib/types';
import { Alert, Badge, EmptyState, Icon } from './ui';

const REFRESH_MS = 5_000;
type KindFilter = 'all' | RequestLogEntry['kind'];

const OUTCOME_LABEL: Record<string, string> = {
  proxied: 'Forwarded',
  loader_hit: 'Loader (cached)',
  loader_miss: 'Loader',
  gtag_fallback: 'Loader (gtag.js via Google)',
  webhook: 'Webhook',
  webhook_rejected: 'Bad signature',
  bot_dropped: 'Bot dropped',
  upstream_error: 'Tagging server error',
};

function statusTone(entry: RequestLogEntry) {
  if (entry.status >= 500) return 'critical' as const;
  if (entry.status >= 400) return 'warning' as const;
  return 'good' as const;
}

/** Redis stream ids are "<ms>-<seq>"; compare numerically, not as strings. */
function olderThan(id: string, other: string): boolean {
  const [a, b] = id.split('-').map(Number) as [number, number];
  const [c, d] = other.split('-').map(Number) as [number, number];
  return a < c || (a === c && b < d);
}

function time(value: string) {
  return new Date(value).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka' });
}

async function fetchLogs(containerId: string, before?: string): Promise<LogsResponse> {
  const query = new URLSearchParams({ limit: '100', ...(before && { before }) });
  const response = await fetch(`/api/containers/${containerId}/logs?${query}`, { cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Could not load logs (${response.status})`);
  return body as LogsResponse;
}

export function LogsView({ containerId }: { containerId: string }) {
  const [entries, setEntries] = useState<RequestLogEntry[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [kind, setKind] = useState<KindFilter>('all');
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [olderDone, setOlderDone] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchLogs(containerId);
      setAvailable(data.available);
      setEntries((current) => {
        // Keep older pages that were loaded with "Load older"; replace the newest page.
        const newest = data.entries;
        const lastNewId = newest.at(-1)?.id;
        const older = lastNewId ? current.filter((e) => olderThan(e.id, lastNewId)) : current;
        return [...newest, ...older];
      });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [containerId]);

  useEffect(() => {
    void refresh();
    if (!live) return;
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh, live]);

  const loadOlder = async () => {
    const last = entries.at(-1);
    if (!last) return;
    try {
      const data = await fetchLogs(containerId, last.id);
      if (data.entries.length === 0) setOlderDone(true);
      setEntries((current) => [...current, ...data.entries]);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const visible = useMemo(
    () =>
      entries.filter(
        (e) => (kind === 'all' || e.kind === kind) && (!problemsOnly || e.status >= 400 || e.bot !== null),
      ),
    [entries, kind, problemsOnly],
  );

  if (!available) {
    return (
      <Alert tone="warning">
        Request logs need Redis. Set REDIS_URL for the API and the gateway to collect them.
      </Alert>
    );
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <div className="segmented" role="group" aria-label="Request type">
            {(['all', 'tracking', 'loader', 'webhook'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === 'all' ? 'All' : k[0]!.toUpperCase() + k.slice(1)}
              </button>
            ))}
          </div>
          <label className="row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={problemsOnly}
              onChange={(e) => setProblemsOnly(e.target.checked)}
            />
            Errors and bots only
          </label>
        </div>
        <div className="row">
          <span className="small muted" aria-live="polite">
            {live ? 'Live, every 5 s' : 'Paused'}
          </span>
          <button type="button" className="btn btn-sm" onClick={() => setLive((v) => !v)}>
            {live ? 'Pause' : 'Resume'}
          </button>
        </div>
      </div>

      {error && <Alert tone="critical">{error}</Alert>}

      <div className="card table-wrap">
        {loading ? (
          <div className="card-body muted">Loading requests…</div>
        ) : visible.length === 0 ? (
          <EmptyState icon={Icon.list} title={entries.length ? 'No matching requests' : 'No requests yet'}>
            {entries.length
              ? 'Change the filters to see more.'
              : 'Requests to this container’s verified domains appear here within seconds. Logs are kept for 7 days.'}
          </EmptyState>
        ) : (
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Time</th>
                <th>Request</th>
                <th>Event</th>
                <th>Status</th>
                <th>Result</th>
                <th>Visitor</th>
                <th className="num">ms</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => (
                <tr key={e.id}>
                  <td className="mono small">{time(e.time)}</td>
                  <td>
                    <span className="muted small">{e.method}</span>{' '}
                    <span className="mono small">{e.path}</span>
                  </td>
                  <td className="small">{e.event ?? <span className="muted">—</span>}</td>
                  <td>
                    <Badge tone={statusTone(e)}>{e.status}</Badge>
                  </td>
                  <td className="small">
                    {OUTCOME_LABEL[e.outcome] ?? e.outcome}
                    {e.bot && e.outcome !== 'bot_dropped' && <span className="muted"> · bot ({e.bot})</span>}
                  </td>
                  <td className="small text-2">
                    {[e.country, e.device].filter(Boolean).join(' · ') || <span className="muted">—</span>}
                  </td>
                  <td className="num small">{e.durationMs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {entries.length >= 100 && !olderDone && (
        <div>
          <button type="button" className="btn btn-sm" onClick={loadOlder}>
            Load older
          </button>
        </div>
      )}
    </div>
  );
}
