import type { Redis } from 'ioredis';
import { containerRouteSchema, RedisKeys, type ContainerRoute } from '@sst/shared';

/** A place routes can be read from. Throws when the source is unavailable; returns null when it has no route. */
export interface RouteSource {
  name: string;
  get(host: string): Promise<ContainerRoute | null>;
}

interface Entry {
  route: ContainerRoute | null;
  fetchedAt: number;
}

export interface RouteResolverOptions {
  ttlMs: number;
  negativeTtlMs: number;
  maxEntries?: number;
  onSourceError?: (source: string, error: unknown) => void;
}

/**
 * Finds the container for a host name: memory cache first, then Redis, then the control plane API. When every
 * source fails, the last known route is served even if it is stale, so tracking keeps working while the control
 * plane is down.
 */
export class RouteResolver {
  private readonly cache = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<ContainerRoute | null>>();

  constructor(
    private readonly sources: RouteSource[],
    private readonly options: RouteResolverOptions,
    private readonly now: () => number = Date.now,
  ) {}

  async resolve(host: string): Promise<ContainerRoute | null> {
    const entry = this.cache.get(host);
    if (entry) {
      const ttl = entry.route ? this.options.ttlMs : this.options.negativeTtlMs;
      if (this.now() - entry.fetchedAt < ttl) return entry.route;
    }
    let pending = this.inflight.get(host);
    if (!pending) {
      pending = this.load(host, entry).finally(() => this.inflight.delete(host));
      this.inflight.set(host, pending);
    }
    return pending;
  }

  invalidate(host: string): void {
    this.cache.delete(host);
  }

  private async load(host: string, stale: Entry | undefined): Promise<ContainerRoute | null> {
    let failures = 0;
    for (const source of this.sources) {
      try {
        const route = await source.get(host);
        if (route) {
          this.store(host, route);
          return route;
        }
      } catch (error) {
        failures++;
        this.options.onSourceError?.(source.name, error);
      }
    }
    if (failures > 0) {
      if (!stale) return null; // A source that might know the host failed; don't cache a guess.
      // Keep the stale route, but check again after the TTL instead of on every request.
      stale.fetchedAt = this.now();
      return stale.route;
    }
    this.store(host, null);
    return null;
  }

  private store(host: string, route: ContainerRoute | null): void {
    this.cache.delete(host);
    this.cache.set(host, { route, fetchedAt: this.now() });
    const max = this.options.maxEntries ?? 10_000;
    if (this.cache.size > max) this.cache.delete(this.cache.keys().next().value!);
  }
}

export function redisRouteSource(redis: Redis): RouteSource {
  return {
    name: 'redis',
    async get(host) {
      const raw = await redis.get(RedisKeys.route(host));
      return raw ? containerRouteSchema.parse(JSON.parse(raw)) : null;
    },
  };
}

export function apiRouteSource(baseUrl: string, token: string, timeoutMs = 2_000): RouteSource {
  return {
    name: 'api',
    async get(host) {
      const response = await fetch(new URL(`/internal/routes/${encodeURIComponent(host)}`, baseUrl), {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Route API answered ${response.status}`);
      return containerRouteSchema.parse(await response.json());
    },
  };
}
