import type { Redis } from 'ioredis';
import { hourBucket, RedisKeys, type UsageField } from '@sst/shared';

const USAGE_KEY_TTL_SECONDS = 7 * 86400;

/**
 * Request counters per container and hour. Counts are held in memory and added to Redis in batches; when Redis is
 * down they stay in memory and are written when it returns.
 */
export class UsageCounters {
  private pending = new Map<string, Map<UsageField, number>>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  inc(containerId: string, field: UsageField, by = 1): void {
    const key = RedisKeys.usage(containerId, hourBucket(this.now()));
    let fields = this.pending.get(key);
    if (!fields) {
      fields = new Map();
      this.pending.set(key, fields);
    }
    fields.set(field, (fields.get(field) ?? 0) + by);
  }

  snapshot(): Map<string, Map<UsageField, number>> {
    return this.pending;
  }

  /** Writes pending counts to Redis. On failure they are merged back for the next attempt. */
  async flush(redis: Redis): Promise<void> {
    if (this.pending.size === 0) return;
    const batch = this.pending;
    this.pending = new Map();
    try {
      const pipeline = redis.pipeline();
      for (const [key, fields] of batch) {
        for (const [field, count] of fields) pipeline.hincrby(key, field, count);
        pipeline.expire(key, USAGE_KEY_TTL_SECONDS);
      }
      const results = await pipeline.exec();
      const failed = results?.find(([error]) => error);
      if (failed) throw failed[0];
    } catch (error) {
      for (const [key, fields] of batch) {
        for (const [field, count] of fields) {
          let target = this.pending.get(key);
          if (!target) {
            target = new Map();
            this.pending.set(key, target);
          }
          target.set(field, (target.get(field) ?? 0) + count);
        }
      }
      throw error;
    }
  }
}
