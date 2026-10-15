import type {
  Container,
  Domain,
  Invite,
  Membership,
  PasswordReset,
  Tenant,
  UsageCounts,
  UsageHour,
  User,
} from './model.js';

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

export type UserPatch = Partial<
  Pick<User, 'name' | 'passwordHash' | 'googleSub' | 'emailVerified' | 'lastLoginAt' | 'passwordChangedAt'>
>;

export class DuplicateHostnameError extends Error {}
export class DuplicateEmailError extends Error {}

/** Persistence for the control plane. PrismaStore is used in production; MemoryStore in tests and trials. */
export interface Store {
  ping(): Promise<void>;

  createTenant(tenant: Tenant): Promise<Tenant>;
  getTenant(id: string): Promise<Tenant | null>;
  listTenants(): Promise<Tenant[]>;
  renameTenant(id: string, name: string): Promise<Tenant>;
  /** Workspaces nobody belongs to, e.g. created before user accounts existed. */
  listTenantsWithoutMembers(): Promise<Tenant[]>;

  /** Throws DuplicateEmailError if the address is taken. */
  createUser(user: User): Promise<User>;
  getUser(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserByGoogleSub(sub: string): Promise<User | null>;
  updateUser(id: string, patch: UserPatch): Promise<User>;

  /** Adds the membership, or changes the role of an existing one. */
  putMembership(membership: Membership): Promise<void>;
  deleteMembership(userId: string, tenantId: string): Promise<void>;
  listUserMemberships(userId: string): Promise<Membership[]>;
  listTenantMembers(tenantId: string): Promise<(Membership & { user: User })[]>;

  /** One invite per workspace and address: inviting again updates the role. */
  putInvite(invite: Invite): Promise<Invite>;
  listInvites(tenantId: string): Promise<Invite[]>;
  listInvitesForEmail(email: string): Promise<Invite[]>;
  deleteInvite(id: string): Promise<void>;

  createPasswordReset(reset: PasswordReset): Promise<PasswordReset>;
  getPasswordResetByTokenHash(tokenHash: string): Promise<PasswordReset | null>;
  /** Marks every unused reset link of the user as used. */
  usePasswordResets(userId: string, at: Date): Promise<void>;
  /** Links created for the user since the given time, for rate limiting. */
  countPasswordResetsSince(userId: string, since: Date): Promise<number>;

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
