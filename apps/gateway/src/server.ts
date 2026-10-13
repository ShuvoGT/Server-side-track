import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { Agent } from 'undici';
import { buildBlockList, RedisKeys } from '@sst/shared';
import { buildGateway } from './app.js';
import { loadConfig } from './config.js';
import { UsageCounters } from './counters.js';
import { openGeoLookup, type GeoLookup } from './geo.js';
import { LoaderCache } from './loaderCache.js';
import { RequestLogBuffer } from './requestLog.js';
import { createMetrics } from './metrics.js';
import { apiRouteSource, redisRouteSource, RouteResolver, type RouteSource } from './routeResolver.js';

async function main() {
  const config = loadConfig();
  const metrics = createMetrics();
  const counters = new UsageCounters();
  const requestLog = new RequestLogBuffer();

  // Fail fast while Redis is down instead of queueing: the gateway falls back to memory and the API.
  const redis = config.REDIS_URL
    ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false })
    : null;
  // The subscriber keeps the offline queue so SUBSCRIBE waits for the connection; ioredis re-subscribes after
  // reconnects. Until then, cached routes expire after ROUTE_CACHE_TTL_MS.
  const subscriber = config.REDIS_URL ? new Redis(config.REDIS_URL) : null;

  const sources: RouteSource[] = [];
  if (redis) sources.push(redisRouteSource(redis));
  sources.push(apiRouteSource(config.API_INTERNAL_URL, config.INTERNAL_API_TOKEN));

  const resolver = new RouteResolver(sources, {
    ttlMs: config.ROUTE_CACHE_TTL_MS,
    negativeTtlMs: config.ROUTE_NEGATIVE_TTL_MS,
    onSourceError: (source, err) => logger.warn({ source, err }, 'route source unavailable'),
  });

  let geo: GeoLookup | null = null;
  if (config.GEOIP_DB_PATH) geo = await openGeoLookup(config.GEOIP_DB_PATH);

  const globalBotLists = [];
  if (config.BOT_IP_LIST_PATH) {
    const lines = (await readFile(config.BOT_IP_LIST_PATH, 'utf8')).split(/\r?\n/);
    globalBotLists.push(buildBlockList(lines));
  }

  const app = buildGateway(
    {
      logLevel: config.LOG_LEVEL,
      trustedProxyHops: config.TRUSTED_PROXY_HOPS,
      upstreamTimeoutMs: config.UPSTREAM_TIMEOUT_MS,
      bodyLimitBytes: config.BODY_LIMIT_BYTES,
    },
    {
      resolver,
      counters,
      loaderCache: new LoaderCache(config.LOADER_CACHE_TTL_MS),
      metrics,
      geo,
      globalBotLists,
      // Without Redis there is nowhere to keep logs; don't collect them.
      requestLog: redis ? requestLog : undefined,
      dispatcher: new Agent({ keepAliveTimeout: 30_000, connections: 256 }),
    },
  );
  const logger = app.log;
  if (!geo) logger.warn('GEOIP_DB_PATH not set: geo headers are off');

  if (subscriber) {
    subscriber.on('message', (_channel: string, host: string) => resolver.invalidate(host));
    subscriber.on('error', (err) => logger.warn({ err }, 'redis subscriber error'));
    subscriber
      .subscribe(RedisKeys.routeInvalidateChannel)
      .catch((err) => logger.warn({ err }, 'subscribe failed'));
  }
  redis?.on('error', (err) => logger.warn({ err }, 'redis error'));

  const flush = async () => {
    if (!redis) return;
    try {
      await counters.flush(redis);
      await requestLog.flush(redis);
    } catch (err) {
      logger.warn({ err }, 'usage counters and request logs kept in memory until Redis is back');
    }
  };
  const flushTimer = setInterval(flush, config.COUNTER_FLUSH_MS);

  let ready = false;
  const admin = Fastify({ logger: false });
  admin.get('/healthz', async () => ({ status: 'ok' }));
  admin.get('/readyz', async (_req, reply) =>
    ready ? { status: 'ready' } : reply.code(503).send({ status: 'starting' }),
  );
  admin.get('/metrics', async (_req, reply) =>
    reply.header('content-type', metrics.registry.contentType).send(await metrics.registry.metrics()),
  );

  await app.listen({ host: config.HOST, port: config.PORT });
  await admin.listen({ host: config.HOST, port: config.ADMIN_PORT });
  ready = true;

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    ready = false;
    clearInterval(flushTimer);
    await app.close();
    await flush();
    await admin.close();
    subscriber?.disconnect();
    redis?.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
