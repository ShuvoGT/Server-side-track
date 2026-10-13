import { randomBytes } from 'node:crypto';
import type { ContainerRoute, PowerUps } from '@sst/shared';

export type ContainerStatus = 'pending' | 'provisioning' | 'active' | 'failed' | 'deleting';
export type DomainStatus = 'pending' | 'verified' | 'failed';

export interface Tenant {
  id: string;
  name: string;
  createdAt: Date;
}

export interface Container {
  id: string;
  tenantId: string;
  name: string;
  gtmContainerId: string;
  containerConfig: string;
  webContainerId: string | null;
  status: ContainerStatus;
  statusMessage: string | null;
  upstreamUrl: string;
  loaderGtmPath: string;
  loaderGtagPath: string;
  webhookPath: string;
  webhookSecret: string;
  powerUps: PowerUps;
  createdAt: Date;
  updatedAt: Date;
}

export interface Domain {
  id: string;
  containerId: string;
  hostname: string;
  status: DomainStatus;
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
}

export interface UsageHour {
  containerId: string;
  hour: Date;
  requests: number;
  loader: number;
  webhook: number;
  botFlagged: number;
  botDropped: number;
  errors: number;
}

export type UsageCounts = Omit<UsageHour, 'containerId' | 'hour'>;

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Prefixed random ids. Container ids also name Kubernetes namespaces (ctr-<id>), so they stay lower-case
 * alphanumeric and short.
 */
export function newId(prefix: 'tnt' | 'c' | 'dom'): string {
  let id = '';
  for (const byte of randomBytes(12)) id += ID_ALPHABET[byte % ID_ALPHABET.length];
  return `${prefix}${id}`;
}

export function newWebhookSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** The gateway's view of one verified domain. */
export function routeFor(container: Container, domain: Domain): ContainerRoute {
  return {
    hostname: domain.hostname,
    containerId: container.id,
    gtmContainerId: container.gtmContainerId,
    upstreamUrl: container.upstreamUrl,
    loader: {
      webContainerId: container.webContainerId,
      gtmPath: container.loaderGtmPath,
      gtagPath: container.loaderGtagPath,
    },
    webhook: { path: container.webhookPath, secret: container.webhookSecret },
    powerUps: container.powerUps,
  };
}

/** Public representation. The Container Config and webhook secret are only returned when created or rotated. */
export function containerView(container: Container, domains: Domain[] = []) {
  const { containerConfig: _config, webhookSecret: _secret, ...rest } = container;
  return { ...rest, domains };
}
