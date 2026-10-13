import type { PowerUps, RequestLogEntry } from '@sst/shared';

export type { PowerUps, RequestLogEntry };

export type ContainerStatus = 'pending' | 'provisioning' | 'active' | 'failed' | 'deleting';
export type DomainStatus = 'pending' | 'verified' | 'failed';

export interface Tenant {
  id: string;
  name: string;
  createdAt: string;
}

export interface Domain {
  id: string;
  containerId: string;
  hostname: string;
  status: DomainStatus;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface Container {
  id: string;
  tenantId: string;
  name: string;
  gtmContainerId: string;
  webContainerId: string | null;
  status: ContainerStatus;
  statusMessage: string | null;
  upstreamUrl: string;
  loaderGtmPath: string;
  loaderGtagPath: string;
  webhookPath: string;
  powerUps: PowerUps;
  createdAt: string;
  updatedAt: string;
  domains: Domain[];
}

export interface UsageCounts {
  requests: number;
  loader: number;
  webhook: number;
  botFlagged: number;
  botDropped: number;
  errors: number;
}

export interface Usage {
  containerId: string;
  from: string;
  to: string;
  totals: UsageCounts;
  hours: (UsageCounts & { hour: string })[];
}

export interface Snippet {
  trackingHost: string;
  serverContainerUrl: string;
  customLoader: boolean;
  gtmHead: string | null;
  gtagScriptUrl: string | null;
  webhookUrl: string;
}

export interface DnsRecord {
  type: 'CNAME' | 'A';
  name: string;
  value: string;
}

export interface VerifyResult extends Domain {
  check: { ok: true; method: 'cname' | 'a'; warning?: string } | { ok: false; error: string };
}

export interface LogsResponse {
  available: boolean;
  entries: RequestLogEntry[];
}
