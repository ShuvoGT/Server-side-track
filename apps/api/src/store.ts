import type { Container, Domain, Tenant, UsageCounts, UsageHour } from './model.js';

export type ContainerPatch = Partial<
  Pick<
    Container,
    | 'name'
    | 'webContainerId'
    | 'status'
    | 'statusMessage'
    | 'powerUps'
    | 'webhookSecret'
    | 'upstreamUrl'
    | 'containerConfig'
    | 'gtmContainerId'
    | 'loaderGtmPath'
    | 'loaderGtagPath'
  >
>;
export type DomainPatch = Partial<Pick<Domain, 'status' | 'verifiedAt' | 'lastCheckedAt' | 'lastError'>>;

export class DuplicateHostnameError extends Error {}

/** Persistence for the control plane. PrismaStore is used in production; MemoryStore in tests and trials. */
export interface Store {
  ping(): Promise<void>;

  createTenant(tenant: Tenant): Promise<Tenant>;
  getTenant(id: string): Promise<Tenant | null>;
  listTenants(): Promise<Tenant[]>;

  createContainer(container: Container): Promise<Container>;
  getContainer(id: string): Promise<Container | null>;
  listContainers(tenantId?: string): Promise<Container[]>;
  updateContainer(id: string, patch: ContainerPatch): Promise<Container>;
  deleteContainer(id: string): Promise<void>;

  /** Throws DuplicateHostnameError if another container already has the host name. */
  createDomain(domain: Domain): Promise<Domain>;
  getDomain(id: string): Promise<Domain | null>;
  getDomainByHostname(hostname: string): Promise<Domain | null>;
  listDomains(containerId: string): Promise<Domain[]>;
  listVerifiedDomains(): Promise<Domain[]>;
  updateDomain(id: string, patch: DomainPatch): Promise<Domain>;
  deleteDomain(id: string): Promise<void>;

  /** Adds counts to the row for (containerId, hour), creating it if needed. */
  addUsage(containerId: string, hour: Date, counts: Partial<UsageCounts>): Promise<void>;
  listUsage(containerId: string, from: Date, to: Date): Promise<UsageHour[]>;
}
