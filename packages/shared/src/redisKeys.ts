/** Redis keys and channels shared by the control plane API (writer) and the edge gateway (reader). */
export const RedisKeys = {
  /** JSON ContainerRoute for one host name. */
  route: (host: string) => `sst:route:${host}`,
  /** Published with the host name whenever a route changes or is removed. */
  routeInvalidateChannel: 'sst:route-invalidate',
  /** Hash of request counters for one container and UTC hour, e.g. sst:usage:ctr_123:2026101309. */
  usage: (containerId: string, hour: string) => `sst:usage:${containerId}:${hour}`,
  usagePattern: 'sst:usage:*',
  /** Redis stream of request log entries for one container. */
  logs: (containerId: string) => `sst:logs:${containerId}`,
  /** BullMQ queue the provisioner consumes. */
  provisioningQueue: 'provisioning',
} as const;

/** A job on the provisioning queue. It carries only the id: the provisioner always applies the current state. */
export interface ProvisioningJob {
  type: 'apply' | 'delete';
  containerId: string;
}

export type UsageField = 'requests' | 'loader' | 'webhook' | 'bot_flagged' | 'bot_dropped' | 'errors';

/** UTC hour bucket as YYYYMMDDHH. */
export function hourBucket(date = new Date()): string {
  return date.toISOString().slice(0, 13).replace(/[-T]/g, '');
}

export function parseHourBucket(bucket: string): Date {
  const iso = `${bucket.slice(0, 4)}-${bucket.slice(4, 6)}-${bucket.slice(6, 8)}T${bucket.slice(8, 10)}:00:00Z`;
  return new Date(iso);
}

/** Request logs are kept 7 days (MVP plan), and at most this many entries per container. */
export const LOG_RETENTION_MS = 7 * 86400_000;
export const LOG_MAX_ENTRIES = 10_000;

/**
 * One request as shown in the dashboard's request log. Deliberately small: no IP address, no query string, no
 * cookies, so the log never holds personal data.
 */
export interface RequestLogEntry {
  /** Redis stream id; also the ordering key. Empty until stored. */
  id: string;
  time: string;
  requestId: string;
  kind: 'tracking' | 'loader' | 'webhook';
  method: string;
  path: string;
  /** GA4 event name(s) from the en parameter, if any. */
  event: string | null;
  status: number;
  durationMs: number;
  outcome: string;
  country: string | null;
  device: string | null;
  bot: string | null;
}
