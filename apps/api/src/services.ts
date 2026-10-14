import { promises as dns } from 'node:dns';
import type { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import {
  parseHourBucket,
  RedisKeys,
  type ContainerRoute,
  type ProvisioningJob,
  type RequestLogEntry,
  type UsageField,
} from '@sst/shared';
import type { UsageCounts } from './model.js';
import type { Store } from './store.js';

// ---------------------------------------------------------------------------------------------------------------
// DNS verification

export type DnsCheck = { ok: true; method: 'cname' | 'a'; warning?: string } | { ok: false; error: string };

export interface DnsResolver {
  resolveCname(host: string): Promise<string[]>;
  resolve4(host: string): Promise<string[]>;
}

/**
 * A tracking domain is verified when it is a CNAME to the edge host name, or, for customers who cannot use a
 * CNAME, when all its A records are edge addresses.
 */
export async function checkDomainDns(
  hostname: string,
  edgeHostname: string,
  edgeIpv4: string[],
  resolver: DnsResolver = dns,
): Promise<DnsCheck> {
  const strip = (name: string) => name.toLowerCase().replace(/\.$/, '');
  try {
    const cnames = await resolver.resolveCname(hostname);
    if (cnames.some((c) => strip(c) === strip(edgeHostname))) return { ok: true, method: 'cname' };
    return { ok: false, error: `CNAME points to ${cnames.join(', ')}, expected ${edgeHostname}` };
  } catch {
    // No CNAME record; try A records.
  }
  try {
    const addresses = await resolver.resolve4(hostname);
    if (addresses.length > 0 && edgeIpv4.length > 0 && addresses.every((a) => edgeIpv4.includes(a))) {
      return {
        ok: true,
        method: 'a',
        warning: `A records work, but must be updated if the platform's addresses change. A CNAME to ${edgeHostname} is preferred.`,
      };
    }
    return {
      ok: false,
      error: `${hostname} resolves to ${addresses.join(', ') || 'nothing'}; add a CNAME to ${edgeHostname}`,
    };
  } catch {
    return { ok: false, error: `No DNS record found for ${hostname}; add a CNAME to ${edgeHostname}` };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Route publishing

/** Pushes routes to where the gateway reads them. */
export interface RoutePublisher {
  publish(routes: ContainerRoute[]): Promise<void>;
  remove(hosts: string[]): Promise<void>;
}

export class RedisRoutePublisher implements RoutePublisher {
  constructor(private readonly redis: Redis) {}

  async publish(routes: ContainerRoute[]) {
    if (routes.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const route of routes) {
      pipeline.set(RedisKeys.route(route.hostname), JSON.stringify(route));
      pipeline.publish(RedisKeys.routeInvalidateChannel, route.hostname);
    }
    await pipeline.exec();
  }

  async remove(hosts: string[]) {
    if (hosts.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const host of hosts) {
      pipeline.del(RedisKeys.route(host));
      pipeline.publish(RedisKeys.routeInvalidateChannel, host);
    }
    await pipeline.exec();
  }
}

/** Without Redis the gateway asks the API directly; there is nothing to push. */
export const noopRoutePublisher: RoutePublisher = {
  publish: async () => {},
  remove: async () => {},
};

// ---------------------------------------------------------------------------------------------------------------
// Provisioning jobs

export type { ProvisioningJob };

/** Hands Kubernetes changes to the provisioner, which applies them and reports status back. */
export interface ProvisioningQueue {
  enqueue(job: ProvisioningJob): Promise<void>;
  close(): Promise<void>;
}

export class BullProvisioningQueue implements ProvisioningQueue {
  private readonly queue: Queue;

  constructor(redisUrl: string) {
    this.queue = new Queue(RedisKeys.provisioningQueue, { connection: { url: redisUrl } });
  }

  async enqueue(job: ProvisioningJob) {
    // Jobs carry only the container id: the provisioner always applies the container's current state.
    await this.queue.add(job.type, job, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    });
  }

  close() {
    return this.queue.close();
  }
}

export class LoggingProvisioningQueue implements ProvisioningQueue {
  readonly jobs: ProvisioningJob[] = [];
  constructor(private readonly log?: (job: ProvisioningJob) => void) {}
  async enqueue(job: ProvisioningJob) {
    this.jobs.push(job);
    this.log?.(job);
  }
  async close() {}
}

// ---------------------------------------------------------------------------------------------------------------
// Usage roll-up

const FIELD_MAP: Record<UsageField, keyof UsageCounts> = {
  requests: 'requests',
  loader: 'loader',
  webhook: 'webhook',
  bot_flagged: 'botFlagged',
  bot_dropped: 'botDropped',
  errors: 'errors',
};

const ROLLUP_LOCK_KEY = 'sst:usage-rollup-lock';
const USAGE_KEY_RE = /^sst:usage:([a-z0-9]+):(\d{10})(:rollup)?$/;

/**
 * Moves the gateway's hourly Redis counters into PostgreSQL. Each key is renamed first, so increments that arrive
 * during the roll-up land in a fresh key and are picked up next time. A lock keeps API replicas from running it
 * at the same time, which also makes it safe to finish keys a crashed run had already claimed.
 * Returns the number of keys rolled up, or null if another replica holds the lock.
 */
export async function rollUpUsage(redis: Redis, store: Store, now = new Date()): Promise<number | null> {
  const token = `${process.pid}-${now.getTime()}`;
  if ((await redis.set(ROLLUP_LOCK_KEY, token, 'PX', 120_000, 'NX')) !== 'OK') return null;
  try {
    return await rollUpLocked(redis, store, now);
  } finally {
    if ((await redis.get(ROLLUP_LOCK_KEY)) === token) await redis.del(ROLLUP_LOCK_KEY);
  }
}

async function rollUpLocked(redis: Redis, store: Store, now: Date): Promise<number> {
  let cursor = '0';
  let rolled = 0;
  const currentHour = now.toISOString().slice(0, 13).replace(/[-T]/g, '');
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', RedisKeys.usagePattern, 'COUNT', 200);
    cursor = next;
    for (const key of keys) {
      const match = USAGE_KEY_RE.exec(key);
      if (!match) continue;
      const [, containerId, hour, alreadyClaimed] = match as unknown as [string, string, string, string?];
      const original = RedisKeys.usage(containerId, hour);
      let claimed = key;
      if (!alreadyClaimed) {
        if (hour >= currentHour) continue; // Still being written.
        claimed = `${key}:rollup`;
        if ((await redis.renamenx(key, claimed)) !== 1) continue; // A claimed copy is left over; next run.
      }
      const raw = await redis.hgetall(claimed);
      const counts: Partial<UsageCounts> = {};
      for (const [field, value] of Object.entries(raw)) {
        const target = FIELD_MAP[field as UsageField];
        if (target) counts[target] = Number(value);
      }
      try {
        if (await store.getContainer(containerId))
          await store.addUsage(containerId, parseHourBucket(hour), counts);
        await redis.del(claimed);
        rolled++;
      } catch (error) {
        // Put the counts back for the next run rather than losing them.
        const pipeline = redis.pipeline();
        for (const [field, value] of Object.entries(raw)) pipeline.hincrby(original, field, Number(value));
        pipeline.del(claimed);
        await pipeline.exec();
        throw error;
      }
    }
  } while (cursor !== '0');
  return rolled;
}

// ---------------------------------------------------------------------------------------------------------------
// Live data from Redis: request logs and counters not yet rolled up

export interface LogQuery {
  limit: number;
  /** Stream id; returns entries older than this one (for paging). */
  before?: string;
  /** Only entries received in this window, inclusive. */
  from?: Date;
  to?: Date;
}

export interface LiveData {
  recentLogs(containerId: string, query: LogQuery): Promise<RequestLogEntry[]>;
  /** Counts still in Redis, per hour: the current hour, and any hour the roll-up has not reached yet. */
  pendingUsage(containerId: string): Promise<{ hour: Date; counts: Partial<UsageCounts> }[]>;
}

export class RedisLiveData implements LiveData {
  constructor(private readonly redis: Redis) {}

  async recentLogs(containerId: string, query: LogQuery): Promise<RequestLogEntry[]> {
    // Stream ids start with the time in ms, so a time window is an id range. A bare "<ms>" means "<ms>-0" as the
    // lower bound and "<ms>-<max>" as the upper one, which makes both ends inclusive.
    const start = query.before ? `(${query.before}` : query.to ? String(query.to.getTime()) : '+';
    const end = query.from ? String(query.from.getTime()) : '-';
    const rows = await this.redis.xrevrange(RedisKeys.logs(containerId), start, end, 'COUNT', query.limit);
    const entries: RequestLogEntry[] = [];
    for (const [id, fields] of rows) {
      const raw = fields[fields.indexOf('e') + 1];
      if (!raw) continue;
      try {
        entries.push({ ...(JSON.parse(raw) as Omit<RequestLogEntry, 'id'>), id });
      } catch {
        // Skip entries written by an incompatible gateway version.
      }
    }
    return entries;
  }

  async pendingUsage(containerId: string) {
    const byHour = new Map<string, Partial<UsageCounts>>();
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', `sst:usage:${containerId}:*`, 'COUNT', 200);
      cursor = next;
      for (const key of keys) {
        const match = USAGE_KEY_RE.exec(key);
        if (!match || match[1] !== containerId) continue;
        const counts = byHour.get(match[2]!) ?? {};
        for (const [field, value] of Object.entries(await this.redis.hgetall(key))) {
          const target = FIELD_MAP[field as UsageField];
          if (target) counts[target] = (counts[target] ?? 0) + Number(value);
        }
        byHour.set(match[2]!, counts);
      }
    } while (cursor !== '0');
    return [...byHour].map(([hour, counts]) => ({ hour: parseHourBucket(hour), counts }));
  }
}

export const noLiveData: LiveData = {
  recentLogs: async () => [],
  pendingUsage: async () => [],
};
