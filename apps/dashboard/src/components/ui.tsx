import type { ReactNode } from 'react';
import type { ContainerStatus, DomainStatus } from '@/lib/types';

/* Small inline icons; status always pairs an icon with a label, never color alone. */

export const Icon = {
  check: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" />
    </svg>
  ),
  alert: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M8 2l6.5 11.5h-13z" strokeLinejoin="round" />
      <path d="M8 6.5v3M8 11.5v.5" strokeLinecap="round" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M6 6l4 4M10 6l-4 4" strokeLinecap="round" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.5v3.5M8 5v.5" strokeLinecap="round" />
    </svg>
  ),
  server: (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
  globe: (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
    </svg>
  ),
  list: (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" strokeLinecap="round" />
    </svg>
  ),
};

type Tone = 'good' | 'warning' | 'critical' | 'info' | 'neutral';

const TONE_ICON: Record<Tone, ReactNode> = {
  good: Icon.check,
  warning: Icon.clock,
  critical: Icon.x,
  info: Icon.info,
  neutral: Icon.clock,
};

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`badge badge-${tone}`}>
      {TONE_ICON[tone]}
      {children}
    </span>
  );
}

const CONTAINER_STATUS: Record<ContainerStatus, [Tone, string]> = {
  pending: ['neutral', 'Pending'],
  provisioning: ['warning', 'Provisioning'],
  active: ['good', 'Active'],
  failed: ['critical', 'Failed'],
  deleting: ['neutral', 'Deleting'],
};

export function ContainerStatusBadge({ status }: { status: ContainerStatus }) {
  const [tone, label] = CONTAINER_STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

const DOMAIN_STATUS: Record<DomainStatus, [Tone, string]> = {
  pending: ['warning', 'Waiting for DNS'],
  verified: ['good', 'Verified'],
  failed: ['critical', 'Failed'],
};

export function DomainStatusBadge({ status }: { status: DomainStatus }) {
  const [tone, label] = DOMAIN_STATUS[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Alert({
  tone,
  children,
}: {
  tone: 'critical' | 'warning' | 'good' | 'info';
  children: ReactNode;
}) {
  const icon = tone === 'good' ? Icon.check : tone === 'info' ? Icon.info : Icon.alert;
  return (
    <div className={`alert alert-${tone}`} role={tone === 'critical' ? 'alert' : 'status'}>
      {icon}
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Skeleton({ width = '100%', height = 16 }: { width?: number | string; height?: number }) {
  return <div className="skeleton" style={{ width, height }} aria-hidden="true" />;
}

const numberFormat = new Intl.NumberFormat('en');
export const formatNumber = (n: number) => numberFormat.format(n);

/** Short date and time in the signed-in user's time zone (Settings › Preferences). */
export function formatDateTime(value: string | null, timeZone = 'Asia/Dhaka'): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}
