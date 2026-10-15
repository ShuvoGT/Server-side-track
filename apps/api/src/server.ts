import { Redis } from 'ioredis';
import { buildApi, resyncRoutes } from './app.js';
import { loadConfig } from './config.js';
import { MemoryStore } from './memoryStore.js';
import { migrateDatabase } from './migrate.js';
import { PrismaStore } from './prismaStore.js';
import {
  BullProvisioningQueue,
  LoggingProvisioningQueue,
  noopRoutePublisher,
  RedisLiveData,
  RedisRoutePublisher,
  rollUpUsage,
  type ProvisioningQueue,
} from './services.js';
import type { Store } from './store.js';

async function main() {
  const config = loadConfig();
  let store: Store = new MemoryStore();
  let imported: Awaited<ReturnType<PrismaStore['importFromSqlite']>> = null;
  if (config.STORE === 'prisma') {
    await migrateDatabase(config.DATABASE_URL);
    const prismaStore = new PrismaStore(config.DATABASE_URL);
    if (config.SQLITE_IMPORT_FILE) imported = await prismaStore.importFromSqlite(config.SQLITE_IMPORT_FILE);
    store = prismaStore;
  }
  const redis = config.REDIS_URL ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2 }) : null;
  const publisher = redis ? new RedisRoutePublisher(redis) : noopRoutePublisher;
  const queue: ProvisioningQueue = config.REDIS_URL
    ? new BullProvisioningQueue(config.REDIS_URL)
    : new LoggingProvisioningQueue((job) =>
        logger.warn({ job }, 'no REDIS_URL: provisioning job not queued'),
      );

  const { app, internal } = buildApi({
    store,
    publisher,
    queue,
    liveData: redis ? new RedisLiveData(redis) : undefined,
    adminApiKey: config.ADMIN_API_KEY,
    internalApiToken: config.INTERNAL_API_TOKEN,
    edgeHostname: config.EDGE_HOSTNAME,
    edgeIpv4: config.EDGE_IPV4,
    upstreamTemplate: config.TAGGING_UPSTREAM_TEMPLATE,
    logLevel: config.LOG_LEVEL,
  });
  const logger = app.log;
  if (!redis) logger.warn('no REDIS_URL: routes are served to the gateway from the internal API only');
  if (config.STORE === 'memory') logger.warn('STORE=memory: configuration is lost on restart');
  if (imported)
    logger.info(imported, `copied the SQLite database ${config.SQLITE_IMPORT_FILE} into PostgreSQL`);
  redis?.on('error', (err) => logger.warn({ err }, 'redis error'));

  const timers: NodeJS.Timeout[] = [];
  if (redis) {
    const resync = () =>
      resyncRoutes(store, publisher)
        .then((count) => logger.debug({ count }, 'routes resynced'))
        .catch((err) => logger.warn({ err }, 'route resync failed'));
    const rollup = () =>
      rollUpUsage(redis, store)
        .then((count) => count && logger.info({ count }, 'usage rolled up'))
        .catch((err) => logger.warn({ err }, 'usage roll-up failed'));
    void resync();
    timers.push(setInterval(resync, config.ROUTE_RESYNC_MS), setInterval(rollup, config.USAGE_ROLLUP_MS));
  }

  await app.listen({ host: config.HOST, port: config.PORT });
  await internal.listen({ host: config.HOST, port: config.INTERNAL_PORT });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    timers.forEach(clearInterval);
    await app.close();
    await internal.close();
    await queue.close();
    redis?.disconnect();
    if (store instanceof PrismaStore) await store.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
