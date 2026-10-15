import { Prisma, PrismaClient } from '@prisma/client';
import { powerUpsSchema } from '@sst/shared';
import type { Container, Domain, Invite, Membership, PasswordReset, UsageCounts, User } from './model.js';
import { importFromSqlite } from './sqliteImport.js';
import {
  DuplicateEmailError,
  DuplicateHostnameError,
  type ContainerPatch,
  type DomainPatch,
  type Store,
  type UserPatch,
} from './store.js';

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

type ContainerRow = Prisma.ContainerGetPayload<object>;

function toContainer(row: ContainerRow): Container {
  return { ...row, powerUps: powerUpsSchema.parse(row.powerUps) };
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export class PrismaStore implements Store {
  private readonly db: PrismaClient;

  constructor(databaseUrl: string) {
    this.db = new PrismaClient({ datasourceUrl: databaseUrl });
  }

  /** Copies the data of the earlier SQLite database once, into an empty PostgreSQL database. */
  importFromSqlite(file: string) {
    return importFromSqlite(this.db, file);
  }

  async ping() {
    await this.db.$queryRaw`SELECT 1`;
  }

  async disconnect() {
    await this.db.$disconnect();
  }

  createTenant(tenant: Parameters<Store['createTenant']>[0]) {
    return this.db.tenant.create({ data: tenant });
  }
  getTenant(id: string) {
    return this.db.tenant.findUnique({ where: { id } });
  }
  listTenants() {
    return this.db.tenant.findMany({ orderBy: { createdAt: 'asc' } });
  }
  renameTenant(id: string, name: string) {
    return this.db.tenant.update({ where: { id }, data: { name } });
  }
  async deleteTenant(id: string) {
    // Memberships and invites go with it (onDelete: Cascade).
    await this.db.tenant.delete({ where: { id } });
  }
  listTenantsWithoutMembers() {
    return this.db.tenant.findMany({ where: { memberships: { none: {} } }, orderBy: { createdAt: 'asc' } });
  }

  async createUser(user: User) {
    try {
      return await this.db.user.create({ data: user });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateEmailError(user.email);
      throw error;
    }
  }
  getUser(id: string) {
    return this.db.user.findUnique({ where: { id } });
  }
  getUserByEmail(email: string) {
    return this.db.user.findUnique({ where: { email } });
  }
  getUserByGoogleSub(sub: string) {
    return this.db.user.findUnique({ where: { googleSub: sub } });
  }
  listUsers() {
    return this.db.user.findMany({ orderBy: { createdAt: 'desc' } });
  }
  async deleteUser(id: string) {
    // Memberships and password reset links go with it (onDelete: Cascade).
    await this.db.user.delete({ where: { id } });
  }
  listAllMemberships() {
    return this.db.membership.findMany();
  }
  updateUser(id: string, patch: UserPatch) {
    return this.db.user.update({ where: { id }, data: patch });
  }

  async putMembership(membership: Membership) {
    await this.db.membership.upsert({
      where: { userId_tenantId: { userId: membership.userId, tenantId: membership.tenantId } },
      create: membership,
      update: { role: membership.role },
    });
  }
  async deleteMembership(userId: string, tenantId: string) {
    await this.db.membership.deleteMany({ where: { userId, tenantId } });
  }
  listUserMemberships(userId: string) {
    return this.db.membership.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
  }
  listTenantMembers(tenantId: string) {
    return this.db.membership.findMany({
      where: { tenantId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  putInvite(invite: Invite) {
    return this.db.invite.upsert({
      where: { tenantId_email: { tenantId: invite.tenantId, email: invite.email } },
      create: invite,
      update: { role: invite.role },
    });
  }
  listInvites(tenantId: string) {
    return this.db.invite.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });
  }
  listInvitesForEmail(email: string) {
    return this.db.invite.findMany({ where: { email } });
  }
  async deleteInvite(id: string) {
    await this.db.invite.deleteMany({ where: { id } });
  }

  createPasswordReset(reset: PasswordReset) {
    return this.db.passwordReset.create({ data: reset });
  }
  getPasswordResetByTokenHash(tokenHash: string) {
    return this.db.passwordReset.findUnique({ where: { tokenHash } });
  }
  async usePasswordResets(userId: string, at: Date) {
    await this.db.passwordReset.updateMany({ where: { userId, usedAt: null }, data: { usedAt: at } });
  }
  countPasswordResetsSince(userId: string, since: Date) {
    return this.db.passwordReset.count({ where: { userId, createdAt: { gte: since } } });
  }

  async createContainer(container: Container) {
    return toContainer(
      await this.db.container.create({ data: { ...container, powerUps: toJson(container.powerUps) } }),
    );
  }
  async getContainer(id: string) {
    const row = await this.db.container.findUnique({ where: { id } });
    return row ? toContainer(row) : null;
  }
  async listContainers(tenantId?: string) {
    const rows = await this.db.container.findMany({
      where: tenantId ? { tenantId } : {},
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toContainer);
  }
  async updateContainer(id: string, patch: ContainerPatch) {
    const { powerUps, ...rest } = patch;
    const data: Prisma.ContainerUpdateInput = { ...rest };
    if (powerUps) data.powerUps = toJson(powerUps);
    return toContainer(await this.db.container.update({ where: { id }, data }));
  }
  async deleteContainer(id: string) {
    await this.db.container.delete({ where: { id } });
  }

  async createDomain(domain: Domain) {
    try {
      return await this.db.domain.create({ data: domain });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DuplicateHostnameError(domain.hostname);
      throw error;
    }
  }
  getDomain(id: string) {
    return this.db.domain.findUnique({ where: { id } });
  }
  getDomainByHostname(hostname: string) {
    return this.db.domain.findUnique({ where: { hostname } });
  }
  listDomains(containerId: string) {
    return this.db.domain.findMany({ where: { containerId }, orderBy: { createdAt: 'asc' } });
  }
  listVerifiedDomains() {
    return this.db.domain.findMany({ where: { status: 'verified' } });
  }
  updateDomain(id: string, patch: DomainPatch) {
    return this.db.domain.update({ where: { id }, data: patch });
  }
  async deleteDomain(id: string) {
    await this.db.domain.delete({ where: { id } });
  }

  async addUsage(containerId: string, hour: Date, counts: Partial<UsageCounts>) {
    const increments = Object.fromEntries(
      Object.entries(counts).map(([field, n]) => [field, { increment: n }]),
    );
    await this.db.usageHour.upsert({
      where: { containerId_hour: { containerId, hour } },
      create: { containerId, hour, ...counts },
      update: increments,
    });
  }
  listUsage(containerId: string, from: Date, to: Date) {
    return this.db.usageHour.findMany({
      where: { containerId, hour: { gte: from, lt: to } },
      orderBy: { hour: 'asc' },
    });
  }
}
