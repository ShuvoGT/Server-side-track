import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Prisma, PrismaClient } from '@prisma/client';

export interface ImportResult {
  tenants: number;
  containers: number;
  domains: number;
  usageHours: number;
}

type Row = Record<string, unknown>;

/** Prisma's SQLite connector stores DateTime as epoch milliseconds; older files may hold ISO strings. */
function date(value: unknown): Date;
function date(value: unknown, nullable: true): Date | null;
function date(value: unknown, nullable?: true): Date | null {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw new Error('missing date');
  }
  return new Date(typeof value === 'number' || /^\d+$/.test(String(value)) ? Number(value) : String(value));
}

const text = (value: unknown) => String(value);
const nullableText = (value: unknown) => (value === null || value === undefined ? null : String(value));

/**
 * One-time move from the SQLite database the platform used before PostgreSQL. Copies every row with its
 * original id (tagging services, loader paths and webhook secrets depend on them), in one transaction, and only
 * when the PostgreSQL database has no tenants yet; on any later start it does nothing. The SQLite file is opened
 * read-only and left as it is, so switching back stays possible.
 */
export async function importFromSqlite(db: PrismaClient, file: string): Promise<ImportResult | null> {
  if (!existsSync(file)) return null;
  if ((await db.tenant.count()) > 0) return null;

  const sqlite = new DatabaseSync(file, { readOnly: true });
  const all = (table: string) => sqlite.prepare(`SELECT * FROM "${table}"`).all() as Row[];
  try {
    const tenants: Prisma.TenantCreateManyInput[] = all('Tenant').map((r) => ({
      id: text(r.id),
      name: text(r.name),
      createdAt: date(r.createdAt),
    }));
    const containers: Prisma.ContainerCreateManyInput[] = all('Container').map((r) => ({
      id: text(r.id),
      tenantId: text(r.tenantId),
      name: text(r.name),
      gtmContainerId: text(r.gtmContainerId),
      containerConfig: text(r.containerConfig),
      webContainerId: nullableText(r.webContainerId),
      status: text(r.status) as Prisma.ContainerCreateManyInput['status'],
      statusMessage: nullableText(r.statusMessage),
      upstreamUrl: text(r.upstreamUrl),
      loaderGtmPath: text(r.loaderGtmPath),
      loaderGtagPath: text(r.loaderGtagPath),
      webhookPath: text(r.webhookPath),
      webhookSecret: text(r.webhookSecret),
      powerUps: JSON.parse(text(r.powerUps)) as Prisma.InputJsonValue,
      createdAt: date(r.createdAt),
      updatedAt: date(r.updatedAt),
    }));
    const domains: Prisma.DomainCreateManyInput[] = all('Domain').map((r) => ({
      id: text(r.id),
      containerId: text(r.containerId),
      hostname: text(r.hostname),
      status: text(r.status) as Prisma.DomainCreateManyInput['status'],
      verifiedAt: date(r.verifiedAt, true),
      lastCheckedAt: date(r.lastCheckedAt, true),
      lastError: nullableText(r.lastError),
      createdAt: date(r.createdAt),
    }));
    const usageHours: Prisma.UsageHourCreateManyInput[] = all('UsageHour').map((r) => ({
      containerId: text(r.containerId),
      hour: date(r.hour),
      requests: Number(r.requests),
      loader: Number(r.loader),
      webhook: Number(r.webhook),
      botFlagged: Number(r.botFlagged),
      botDropped: Number(r.botDropped),
      errors: Number(r.errors),
    }));

    await db.$transaction([
      db.tenant.createMany({ data: tenants }),
      db.container.createMany({ data: containers }),
      db.domain.createMany({ data: domains }),
      db.usageHour.createMany({ data: usageHours }),
    ]);
    return {
      tenants: tenants.length,
      containers: containers.length,
      domains: domains.length,
      usageHours: usageHours.length,
    };
  } finally {
    sqlite.close();
  }
}
