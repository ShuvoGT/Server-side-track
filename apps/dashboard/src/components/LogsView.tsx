'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LogsResponse, RequestLogEntry } from '@/lib/types';
import { Alert, EmptyState, Icon } from './ui';

const LIVE_REFRESH_MS = 5_000;
const PAGE_SIZE = 25;

const RANGES = {
  '15m': { label: 'Last 15 minutes', ms: 15 * 60_000 },
  '1h': { label: 'Last hour', ms: 3_600_000 },
  '24h': { label: 'Last 24 hours', ms: 86_400_000 },
  '7d': { label: 'Last 7 days', ms: 7 * 86_400_000 },
} as const;
type RangeKey = keyof typeof RANGES | 'custom';
/** Logs are kept for 7 days, so a custom range cannot start earlier than that. */
const RETENTION_MS = 7 * 86_400_000;
const LIMITS = [50, 100, 250, 500] as const;
type KindFilter = 'all' | RequestLogEntry['kind'];
type StatusFilter = 'all' | '2xx' | 'non2xx' | '4xx' | '5xx';

interface Filters {
  range: RangeKey;
  /** Custom range, as <input type="datetime-local"> values in the browser's time zone. */
  from: string;
  to: string;
  limit: (typeof LIMITS)[number];
  kind: KindFilter;
  status: StatusFilter;
  event: string;
}
const DEFAULT_FILTERS: Filters = {
  range: '24h',
  from: '',
  to: '',
  limit: 100,
  kind: 'all',
  status: 'all',
  event: 'all',
};
type WindowFilters = Pick<Filters, 'range' | 'from' | 'to' | 'limit'>;

/** A Date as a datetime-local value ("2026-10-14T17:05") in the browser's time zone. */
function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The time window of a filter: a preset ends now, a custom range ends at the end of its "to" minute. */
function windowOf(f: WindowFilters, now: number): { from: number; to: number | null } {
  if (f.range !== 'custom') return { from: now - RANGES[f.range].ms, to: null };
  return { from: new Date(f.from).getTime(), to: new Date(f.to).getTime() + 59_999 };
}

function customRangeError(f: Filters): string | null {
  if (f.range !== 'custom') return null;
  if (!f.from || !f.to) return 'Choose both a start and an end.';
  const from = new Date(f.from).getTime();
  const to = new Date(f.to).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 'Enter a valid date and time.';
  if (from > to) return 'The start must be before the end.';
  return null;
}
const NO_EVENT = '(no event)';

const OUTCOME_LABEL: Record<string, string> = {
  proxied: 'Forwarded',
  loader_hit: 'Loader (cached)',
  loader_miss: 'Loader',
  gtag_fallback: 'Loader (gtag.js via Google)',
  webhook: 'Webhook',
  webhook_rejected: 'Bad signature',
  bot_dropped: 'Bot dropped',
  unknown_host: 'Unknown host',
  upstream_error: 'Tagging server error',
};

const KIND_LABEL: Record<RequestLogEntry['kind'], string> = {
  tracking: 'Tracking',
  loader: 'Loader',
  webhook: 'Webhook',
};

const statusClass = (s: number) => (s >= 500 ? 'is-critical' : s >= 400 ? 'is-warning' : 'is-good');
const eventsOf = (e: RequestLogEntry) => (e.event ? e.event.split(', ') : [NO_EVENT]);

function matchesStatus(s: number, f: StatusFilter) {
  if (f === '2xx') return s >= 200 && s < 300;
  if (f === 'non2xx') return s < 200 || s >= 300;
  if (f === '4xx') return s >= 400 && s < 500;
  if (f === '5xx') return s >= 500;
  return true;
}

/** Redis stream ids are "<ms>-<seq>"; compare numerically, not as strings. */
function newerFirst(a: RequestLogEntry, b: RequestLogEntry) {
  const [a1, a2] = a.id.split('-').map(Number) as [number, number];
  const [b1, b2] = b.id.split('-').map(Number) as [number, number];
  return b1 - a1 || b2 - a2;
}

/** Formatters in the user's time zone (Settings › Preferences). */
function formattersFor(timeZone: string) {
  return {
    timeFmt: new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    dateFmt: new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short' }),
    fullFmt: new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'medium', timeStyle: 'medium' }),
  };
}
const num = new Intl.NumberFormat('en');
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "just now", "5 minutes ago", "14 hours ago", relative to the last load so Live keeps it fresh. */
function ago(then: number, now: number) {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return rtf.format(-s, 'second');
  if (s < 3_600) return rtf.format(-Math.floor(s / 60), 'minute');
  if (s < 86_400) return rtf.format(-Math.floor(s / 3_600), 'hour');
  return rtf.format(-Math.floor(s / 86_400), 'day');
}

async function fetchLogs(containerId: string, f: WindowFilters): Promise<LogsResponse> {
  // The server applies the window too, so the limit counts requests inside it rather than the newest overall.
  const window = windowOf(f, Date.now());
  const params = new URLSearchParams({ limit: String(f.limit), from: new Date(window.from).toISOString() });
  if (window.to !== null) params.set('to', new Date(window.to).toISOString());
  const response = await fetch(`/api/containers/${containerId}/logs?${params}`, { cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `Could not load logs (${response.status})`);
  return body as LogsResponse;
}

function StatCard({
  tone,
  icon,
  value,
  label,
  note,
}: {
  tone: 'accent' | 'good' | 'neutral' | 'violet';
  icon: React.ReactNode;
  value: string;
  label: string;
  note?: React.ReactNode;
}) {
  return (
    <div className={`log-stat log-stat-${tone}`}>
      <div className="log-stat-icon" aria-hidden="true">
        {icon}
      </div>
      <div className="log-stat-value">{value}</div>
      <div className="log-stat-label">{label}</div>
      {note && <div className="log-stat-note">{note}</div>}
    </div>
  );
}

const svg = (d: string) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);
const STAT_ICONS = {
  total: svg('M4 19V9m6 10V5m6 14v-7m4 7H3'),
  ok: svg('M20 6 9 17l-5-5'),
  time: svg('M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'),
  types: svg('M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8ZM7.5 7.5h.01'),
};

export function LogsView({ containerId, timeZone }: { containerId: string; timeZone: string }) {
  const { timeFmt, dateFmt, fullFmt } = useMemo(() => formattersFor(timeZone), [timeZone]);
  const [entries, setEntries] = useState<RequestLogEntry[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);
  const [draft, setDraft] = useState<Filters>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);

  // Kind, status and event are filtered in the browser; only the window and the limit need a new request.
  const { range, from, to, limit } = applied;
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await fetchLogs(containerId, { range, from, to, limit });
      setAvailable(data.available);
      setEntries([...data.entries].sort(newerFirst));
      setLastLoaded(new Date());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [containerId, range, from, to, limit]);

  useEffect(() => {
    void load();
    if (!live) return;
    const timer = setInterval(() => void load(), LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, live]);

  // Requests inside the time window and type/status filters; the event filter applies on top, so the event chips
  // keep showing every event of the window.
  const inScope = useMemo(() => {
    // A preset window ends at the last load, so it moves forward with every refresh.
    const window = windowOf(applied, lastLoaded?.getTime() ?? Date.now());
    return entries.filter(
      (e) =>
        new Date(e.time).getTime() >= window.from &&
        (window.to === null || new Date(e.time).getTime() <= window.to) &&
        (applied.kind === 'all' || e.kind === applied.kind) &&
        matchesStatus(e.status, applied.status),
    );
  }, [entries, applied, lastLoaded]);

  const eventCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of inScope) for (const name of eventsOf(e)) counts.set(name, (counts.get(name) ?? 0) + 1);
    return [...counts].sort((a, b) => (a[0] === NO_EVENT ? 1 : b[0] === NO_EVENT ? -1 : b[1] - a[1]));
  }, [inScope]);

  const visible = useMemo(
    () => (applied.event === 'all' ? inScope : inScope.filter((e) => eventsOf(e).includes(applied.event))),
    [inScope, applied.event],
  );

  const stats = useMemo(() => {
    const ok = visible.filter((e) => e.status >= 200 && e.status < 300).length;
    const avg = visible.length ? visible.reduce((sum, e) => sum + e.durationMs, 0) / visible.length : 0;
    const types = new Set(visible.flatMap((e) => (e.event ? e.event.split(', ') : []))).size;
    return { total: visible.length, ok, failed: visible.length - ok, avg, types };
  }, [visible]);

  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const rows = visible.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const apply = (next: Filters) => {
    setApplied(next);
    setDraft(next);
    setPage(0);
    setOpen(null);
  };
  const pickEvent = (name: string) => apply({ ...applied, event: applied.event === name ? 'all' : name });
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const rangeError = customRangeError(draft);
  const filtered = entries.length > 0 || JSON.stringify(applied) !== JSON.stringify(DEFAULT_FILTERS);
  const pickRange = (value: RangeKey) => {
    if (value !== 'custom' || (draft.from && draft.to)) return setDraft({ ...draft, range: value });
    // Start a custom range from the last 24 hours, to the minute.
    const now = new Date();
    setDraft({
      ...draft,
      range: value,
      from: toLocalInput(new Date(now.getTime() - 86_400_000)),
      to: toLocalInput(now),
    });
  };

  if (!available) {
    return (
      <Alert tone="warning">
        Request logs need Redis. Set REDIS_URL for the API and the gateway to collect them.
      </Alert>
    );
  }

  return (
    <div className="logs">
      <div className="logs-head">
        <div>
          <h2 className="logs-title">Event logs</h2>
          <p className="small muted">
            Requests to this container&apos;s domains, newest first. Kept for 7 days; no IP addresses or query
            strings stored. Calls to GA4, Meta and other vendors appear in GTM Preview.
            {lastLoaded && ` Updated ${timeFmt.format(lastLoaded)}.`}
          </p>
        </div>
        <div className="row">
          <button
            type="button"
            className={`btn btn-sm live-toggle${live ? ' is-on' : ''}`}
            aria-pressed={live}
            onClick={() => setLive((v) => !v)}
          >
            <span className="live-dot" aria-hidden="true" />
            {live ? 'Live' : 'Go live'}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => void load()}
            disabled={refreshing}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              className={refreshing ? 'spin' : undefined}
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      <div className="logs-banner">
        <span className={`banner-dot${live ? ' is-on' : ''}`} aria-hidden="true" />
        {live ? (
          <span>Live: new requests appear every 5 seconds.</span>
        ) : (
          <span>
            Showing a snapshot. Turn on <strong>Live</strong> to watch requests arrive while you test, or
            press Refresh.
          </span>
        )}
        <button type="button" className="link-btn" onClick={() => setLive((v) => !v)}>
          {live ? 'Pause' : 'Turn on Live'}
        </button>
      </div>

      {error && <Alert tone="critical">{error}</Alert>}

      <div className="log-stats">
        <StatCard
          tone="accent"
          icon={STAT_ICONS.total}
          value={num.format(stats.total)}
          label="Total requests"
        />
        <StatCard
          tone="good"
          icon={STAT_ICONS.ok}
          value={num.format(stats.ok)}
          label="Success (2xx)"
          note={
            stats.failed ? (
              <button
                type="button"
                className="link-btn"
                onClick={() => apply({ ...applied, status: 'non2xx' })}
              >
                {num.format(stats.failed)} non-2xx
              </button>
            ) : (
              'no errors'
            )
          }
        />
        <StatCard
          tone="neutral"
          icon={STAT_ICONS.time}
          value={`${num.format(Math.round(stats.avg))} ms`}
          label="Avg processing time"
        />
        <StatCard tone="violet" icon={STAT_ICONS.types} value={num.format(stats.types)} label="Event types" />
      </div>

      <div className="logs-filters card">
        <form
          className="filter-row"
          onSubmit={(e) => {
            e.preventDefault();
            apply(draft);
          }}
        >
          <label className="filter">
            <span>Time</span>
            <select
              className="select"
              value={draft.range}
              onChange={(e) => pickRange(e.target.value as RangeKey)}
            >
              {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((k) => (
                <option key={k} value={k}>
                  {RANGES[k].label}
                </option>
              ))}
              <option value="custom">Custom range…</option>
            </select>
          </label>
          <label className="filter">
            <span>Limit</span>
            <select
              className="select"
              value={draft.limit}
              onChange={(e) => setDraft({ ...draft, limit: Number(e.target.value) as Filters['limit'] })}
            >
              {LIMITS.map((l) => (
                <option key={l} value={l}>
                  {l} requests
                </option>
              ))}
            </select>
          </label>
          <label className="filter">
            <span>Type</span>
            <select
              className="select"
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as KindFilter })}
            >
              <option value="all">All types</option>
              <option value="tracking">Tracking</option>
              <option value="loader">Loader</option>
              <option value="webhook">Webhook</option>
            </select>
          </label>
          <label className="filter">
            <span>Status</span>
            <select
              className="select"
              value={draft.status}
              onChange={(e) => setDraft({ ...draft, status: e.target.value as StatusFilter })}
            >
              <option value="all">All status</option>
              <option value="2xx">Success (2xx)</option>
              <option value="non2xx">Not 2xx</option>
              <option value="4xx">Client errors (4xx)</option>
              <option value="5xx">Server errors (5xx)</option>
            </select>
          </label>
          <label className="filter">
            <span>Event</span>
            <select
              className="select"
              value={draft.event}
              onChange={(e) => setDraft({ ...draft, event: e.target.value })}
            >
              <option value="all">All events</option>
              {eventCounts.map(([name]) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          {draft.range === 'custom' && (
            <div className="custom-range">
              <label className="filter">
                <span>From</span>
                <input
                  type="datetime-local"
                  className="input"
                  value={draft.from}
                  min={toLocalInput(new Date(Date.now() - RETENTION_MS))}
                  max={draft.to || undefined}
                  onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                />
              </label>
              <span className="custom-range-arrow" aria-hidden="true">
                →
              </span>
              <label className="filter">
                <span>To</span>
                <input
                  type="datetime-local"
                  className="input"
                  value={draft.to}
                  min={draft.from || undefined}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                />
              </label>
              <div className="custom-range-quick" role="group" aria-label="Quick ranges">
                {(
                  [
                    ['Today', 0],
                    ['Yesterday', 1],
                  ] as const
                ).map(([label, daysAgo]) => (
                  <button
                    key={label}
                    type="button"
                    className="chip"
                    onClick={() => {
                      const start = new Date();
                      start.setHours(0, 0, 0, 0);
                      start.setDate(start.getDate() - daysAgo);
                      const end = new Date(start);
                      end.setHours(23, 59, 0, 0);
                      setDraft({ ...draft, from: toLocalInput(start), to: toLocalInput(end) });
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className={`small ${rangeError ? 'range-error' : 'muted'}`}>
                {rangeError ?? 'Your computer\u2019s time zone. Logs are kept for 7 days.'}
              </p>
            </div>
          )}
          <div className="filter-actions">
            <button type="submit" className="btn btn-primary" disabled={!dirty || rangeError !== null}>
              Apply filters
            </button>
            {JSON.stringify(applied) !== JSON.stringify(DEFAULT_FILTERS) && (
              <button type="button" className="btn btn-ghost" onClick={() => apply(DEFAULT_FILTERS)}>
                Reset
              </button>
            )}
          </div>
        </form>

        {eventCounts.length > 0 && (
          <div className="chip-row" aria-label="Events in this period">
            <span className="small muted">
              {visible.length
                ? `Showing ${current * PAGE_SIZE + 1}–${current * PAGE_SIZE + rows.length} of ${num.format(visible.length)}`
                : 'No requests'}{' '}
              · {PAGE_SIZE} per page
            </span>
            <span className="chip-sep" aria-hidden="true" />
            {eventCounts.map(([name, count]) => (
              <button
                key={name}
                type="button"
                className={`chip${applied.event === name ? ' is-active' : ''}${name === NO_EVENT ? ' is-muted' : ''}`}
                aria-pressed={applied.event === name}
                onClick={() => pickEvent(name)}
              >
                {name}
                <span className="chip-count">{num.format(count)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="card card-body muted">Loading requests…</div>
      ) : visible.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Icon.list}
            title={filtered ? 'No matching requests' : 'No requests yet'}
            action={
              filtered ? (
                <button type="button" className="btn btn-sm" onClick={() => apply(DEFAULT_FILTERS)}>
                  Reset filters
                </button>
              ) : undefined
            }
          >
            {filtered
              ? 'Nothing in this period matches the filters.'
              : 'Requests to this container’s verified domains appear here within seconds.'}
          </EmptyState>
        </div>
      ) : (
        <ul className="log-list">
          {rows.map((e) => {
            const expanded = open === e.id;
            const at = new Date(e.time);
            const visitor = [e.country, e.device].filter(Boolean).join(' · ');
            return (
              <li key={e.id} className={`log-item ${statusClass(e.status)}${expanded ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="log-item-head"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : e.id)}
                >
                  <span className="log-main">
                    <span className="log-line">
                      {e.event ? (
                        e.event.split(', ').map((name) => (
                          <span key={name} className="event-tag">
                            {name}
                          </span>
                        ))
                      ) : (
                        <span className={`kind-tag kind-${e.kind}`}>{KIND_LABEL[e.kind]}</span>
                      )}
                      <span className={`method method-${e.method.toLowerCase()}`}>{e.method}</span>
                      <span className="mono log-path" title={e.path}>
                        {e.path}
                      </span>
                    </span>
                    <span className="log-sub small">
                      {OUTCOME_LABEL[e.outcome] ?? e.outcome}
                      {visitor && <span className="dot-sep">{visitor}</span>}
                      {e.bot && e.outcome !== 'bot_dropped' && <span className="bot-flag">bot</span>}
                    </span>
                  </span>
                  <span className="log-meta">
                    <span className={`status-pill ${statusClass(e.status)}`}>
                      <span className="status-dot" aria-hidden="true" />
                      {e.status}
                    </span>
                    <span className={`ms-pill${e.durationMs > 2_000 ? ' is-slow' : ''}`}>
                      <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                        <path
                          d="M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                      {num.format(e.durationMs)} ms
                    </span>
                    <span className="log-when" title={`${fullFmt.format(at)} (${timeZone})`}>
                      {ago(at.getTime(), lastLoaded?.getTime() ?? at.getTime())}
                      <span className="mono small muted">{timeFmt.format(at)}</span>
                    </span>
                    <svg
                      className="chevron"
                      viewBox="0 0 24 24"
                      width="16"
                      height="16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </span>
                </button>
                {expanded && (
                  <div className="log-item-body">
                    <dl className="kv small">
                      <dt>Received</dt>
                      <dd>
                        {fullFmt.format(at)} ({timeZone}) · {dateFmt.format(at)}
                      </dd>
                      <dt>Request ID</dt>
                      <dd className="mono">{e.requestId}</dd>
                      <dt>Type</dt>
                      <dd>{KIND_LABEL[e.kind]}</dd>
                      <dt>Request</dt>
                      <dd className="mono">
                        {e.method} {e.path}
                      </dd>
                      <dt>Result</dt>
                      <dd>
                        {OUTCOME_LABEL[e.outcome] ?? e.outcome} ({e.outcome}), HTTP {e.status}, {e.durationMs}{' '}
                        ms
                      </dd>
                      <dt>Bot check</dt>
                      <dd>{e.bot ? `Bot: ${e.bot}` : 'Not a bot'}</dd>
                      <dt>Visitor</dt>
                      <dd>{visitor || 'Unknown'}</dd>
                    </dl>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <nav className="pager" aria-label="Pages">
          <button
            type="button"
            className="btn btn-sm"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            ← Newer
          </button>
          <span className="small muted">
            Page {current + 1} of {pages}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            Older →
          </button>
        </nav>
      )}
      {entries.length >= applied.limit && (
        <p className="small muted">
          Only the latest {applied.limit} requests are loaded. Raise the limit to look further back.
        </p>
      )}
    </div>
  );
}
