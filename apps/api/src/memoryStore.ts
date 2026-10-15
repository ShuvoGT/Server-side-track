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
import {
  DuplicateEmailError,
  DuplicateHostnameError,
  type ContainerPatch,
  type DomainPatch,
  type Store,
  type UserPatch,
} from './store.js';

function notFound(kind: string, id: string): Error {
  return new Error(`${kind} ${id} not found`);
}

export class MemoryStore implements Store {
  private tenants = new Map<string, Tenant>();
  private containers = new Map<string, Container>();
  private domains = new Map<string, Domain>();
  private usage = new Map<string, UsageHour>();
  private users = new Map<string, User>();
  /** Keyed by `${userId}|${tenantId}`. */
  private memberships = new Map<string, Membership>();
  private invites = new Map<string, Invite>();
  private passwordResets = new Map<string, PasswordReset>();

  async ping() {}

  async createTenant(tenant: Tenant) {
    this.tenants.set(tenant.id, tenant);
    return tenant;
  }
  async getTenant(id: string) {
    return this.tenants.get(id) ?? null;
  }
  async listTenants() {
    return [...this.tenants.values()];
  }
  async renameTenant(id: string, name: string) {
    const current = this.tenants.get(id);
    if (!current) throw notFound('Tenant', id);
    const next = { ...current, name };
    this.tenants.set(id, next);
    return next;
  }
  async deleteTenant(id: string) {
    this.tenants.delete(id);
    for (const [key, m] of this.memberships) if (m.tenantId === id) this.memberships.delete(key);
    for (const [key, i] of this.invites) if (i.tenantId === id) this.invites.delete(key);
  }
  async listTenantsWithoutMembers() {
    const used = new Set([...this.memberships.values()].map((m) => m.tenantId));
    return [...this.tenants.values()].filter((t) => !used.has(t.id));
  }

  async createUser(user: User) {
    if (await this.getUserByEmail(user.email)) throw new DuplicateEmailError(user.email);
    this.users.set(user.id, user);
    return user;
  }
  async getUser(id: string) {
    return this.users.get(id) ?? null;
  }
  async getUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async getUserByGoogleSub(sub: string) {
    return [...this.users.values()].find((u) => u.googleSub === sub) ?? null;
  }
  async listUsers() {
    return [...this.users.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async deleteUser(id: string) {
    this.users.delete(id);
    for (const [key, m] of this.memberships) if (m.userId === id) this.memberships.delete(key);
    for (const [key, r] of this.passwordResets) if (r.userId === id) this.passwordResets.delete(key);
  }
  async listAllMemberships() {
    return [...this.memberships.values()];
  }
  async updateUser(id: string, patch: UserPatch) {
    const current = this.users.get(id);
    if (!current) throw notFound('User', id);
    const next = { ...current, ...patch };
    this.users.set(id, next);
    return next;
  }

  async putMembership(membership: Membership) {
    const key = `${membership.userId}|${membership.tenantId}`;
    const current = this.memberships.get(key);
    this.memberships.set(key, current ? { ...current, role: membership.role } : membership);
  }
  async deleteMembership(userId: string, tenantId: string) {
    this.memberships.delete(`${userId}|${tenantId}`);
  }
  async listUserMemberships(userId: string) {
    return [...this.memberships.values()].filter((m) => m.userId === userId);
  }
  async listTenantMembers(tenantId: string) {
    return [...this.memberships.values()]
      .filter((m) => m.tenantId === tenantId)
      .map((m) => ({ ...m, user: this.users.get(m.userId)! }));
  }

  async putInvite(invite: Invite) {
    const current = [...this.invites.values()].find(
      (i) => i.tenantId === invite.tenantId && i.email === invite.email,
    );
    const next = current ? { ...current, role: invite.role } : invite;
    this.invites.set(next.id, next);
    return next;
  }
  async listInvites(tenantId: string) {
    return [...this.invites.values()].filter((i) => i.tenantId === tenantId);
  }
  async listInvitesForEmail(email: string) {
    return [...this.invites.values()].filter((i) => i.email === email);
  }
  async deleteInvite(id: string) {
    this.invites.delete(id);
  }

  async createPasswordReset(reset: PasswordReset) {
    this.passwordResets.set(reset.id, reset);
    return reset;
  }
  async getPasswordResetByTokenHash(tokenHash: string) {
    return [...this.passwordResets.values()].find((r) => r.tokenHash === tokenHash) ?? null;
  }
  async usePasswordResets(userId: string, at: Date) {
    for (const [id, r] of this.passwordResets)
      if (r.userId === userId && !r.usedAt) this.passwordResets.set(id, { ...r, usedAt: at });
  }
  async countPasswordResetsSince(userId: string, since: Date) {
    return [...this.passwordResets.values()].filter((r) => r.userId === userId && r.createdAt >= since)
      .length;
  }

  async createContainer(container: Container) {
    this.containers.set(container.id, container);
    return container;
  }
  async getContainer(id: string) {
    return this.containers.get(id) ?? null;
  }
  async listContainers(tenantId?: string) {
    return [...this.containers.values()].filter((c) => !tenantId || c.tenantId === tenantId);
  }
  async updateContainer(id: string, patch: ContainerPatch) {
    const current = this.containers.get(id);
    if (!current) throw notFound('Container', id);
    const next = { ...current, ...patch, updatedAt: new Date() };
    this.containers.set(id, next);
    return next;
  }
  async deleteContainer(id: string) {
    this.containers.delete(id);
    for (const [key, domain] of this.domains) if (domain.containerId === id) this.domains.delete(key);
    for (const [key, row] of this.usage) if (row.containerId === id) this.usage.delete(key);
  }

  async createDomain(domain: Domain) {
    if (await this.getDomainByHostname(domain.hostname)) throw new DuplicateHostnameError(domain.hostname);
    this.domains.set(domain.id, domain);
    return domain;
  }
  async getDomain(id: string) {
    return this.domains.get(id) ?? null;
  }
  async getDomainByHostname(hostname: string) {
    return [...this.domains.values()].find((d) => d.hostname === hostname) ?? null;
  }
  async listDomains(containerId: string) {
    return [...this.domains.values()].filter((d) => d.containerId === containerId);
  }
  async listVerifiedDomains() {
    return [...this.domains.values()].filter((d) => d.status === 'verified');
  }
  async updateDomain(id: string, patch: DomainPatch) {
    const current = this.domains.get(id);
    if (!current) throw notFound('Domain', id);
    const next = { ...current, ...patch };
    this.domains.set(id, next);
    return next;
  }
  async deleteDomain(id: string) {
    this.domains.delete(id);
  }

  async addUsage(containerId: string, hour: Date, counts: Partial<UsageCounts>) {
    const key = `${containerId}|${hour.toISOString()}`;
    const row = this.usage.get(key) ?? {
      containerId,
      hour,
      requests: 0,
      loader: 0,
      webhook: 0,
      botFlagged: 0,
      botDropped: 0,
      errors: 0,
    };
    for (const [field, value] of Object.entries(counts) as [keyof UsageCounts, number][]) row[field] += value;
    this.usage.set(key, row);
  }
  async listUsage(containerId: string, from: Date, to: Date) {
    return [...this.usage.values()]
      .filter((r) => r.containerId === containerId && r.hour >= from && r.hour < to)
      .sort((a, b) => a.hour.getTime() - b.hour.getTime());
  }
}
