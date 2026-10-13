import { Prisma, PrismaClient } from '@prisma/client';
import { powerUpsSchema } from '@sst/shared';
import type { Container, Domain, UsageCounts } from './model.js';
import { DuplicateHostnameError, type ContainerPatch, type DomainPatch, type Store } from './store.js';

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

  /** WAL lets readers continue while the single writer commits; busy_timeout waits instead of failing on a lock. */
  async init() {
    await this.db.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    await this.db.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
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
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new DuplicateHostnameError(domain.hostname);
      }
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
