import type { Redis } from 'ioredis';
import { LOG_MAX_ENTRIES, LOG_RETENTION_MS, RedisKeys, type RequestLogEntry } from '@sst/shared';

export type PendingLogEntry = Omit<RequestLogEntry, 'id'>;

/** Most entries kept in memory while Redis is unreachable; the oldest are dropped first. */
const MAX_BUFFERED = 5_000;

/** GA4 event names in a /g/collect request: `en` in the query string and in each line of a batched body. */
export function ga4EventNames(query: URLSearchParams, body: Buffer | undefined): string | null {
  const names = new Set<string>();
  const add = (params: URLSearchParams) => {
    const en = params.get('en');
    if (en) names.add(en.slice(0, 40));
  };
  add(query);
  if (body?.length && body.length < 64_000) {
    for (const line of body.toString('utf8').split('\n')) if (line) add(new URLSearchParams(line));
  }
  return names.size ? [...names].slice(0, 5).join(', ') : null;
}

/** Collects request log entries and writes them to one Redis stream per container in batches. */
export class RequestLogBuffer {
  private pending: { containerId: string; entry: PendingLogEntry }[] = [];

  add(containerId: string, entry: PendingLogEntry): void {
    this.pending.push({ containerId, entry });
    if (this.pending.length > MAX_BUFFERED) this.pending.splice(0, this.pending.length - MAX_BUFFERED);
  }

  get size(): number {
    return this.pending.length;
  }

  async flush(redis: Redis, now = Date.now()): Promise<void> {
    if (this.pending.length === 0) return;
    const batch = this.pending;
    this.pending = [];
    try {
      const pipeline = redis.pipeline();
      const keys = new Set<string>();
      for (const { containerId, entry } of batch) {
        const key = RedisKeys.logs(containerId);
        keys.add(key);
        pipeline.xadd(key, 'MAXLEN', '~', LOG_MAX_ENTRIES, '*', 'e', JSON.stringify(entry));
      }
      for (const key of keys) {
        pipeline.xtrim(key, 'MINID', '~', `${now - LOG_RETENTION_MS}-0`);
        pipeline.pexpire(key, LOG_RETENTION_MS + 86400_000);
      }
      const results = await pipeline.exec();
      const failed = results?.find(([error]) => error);
      if (failed) throw failed[0];
    } catch (error) {
      this.pending = [...batch, ...this.pending].slice(-MAX_BUFFERED);
      throw error;
    }
  }
}
