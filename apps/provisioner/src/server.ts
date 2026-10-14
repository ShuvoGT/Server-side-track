import { Worker } from 'bullmq';
import Fastify from 'fastify';
import { collectDefaultMetrics, Counter, Registry } from 'prom-client';
import { RedisKeys, type ProvisioningJob } from '@sst/shared';
import { loadConfig } from './config.js';
import { HttpControlPlane } from './controlPlane.js';
import { DockerDriver } from './drivers/docker.js';
import { ExternalDriver } from './drivers/external.js';
import { KubernetesDriver } from './drivers/kubernetes.js';
import type { Driver } from './drivers/types.js';
import { processJob } from './processor.js';

async function main() {
  const config = loadConfig();
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  const log = app.log;

  const driver: Driver =
    config.DRIVER === 'external'
      ? new ExternalDriver(config.EXTERNAL_UPSTREAM_TEMPLATE)
      : config.DRIVER === 'docker'
        ? new DockerDriver({
            image: config.TAGGING_IMAGE,
            network: config.DOCKER_NETWORK,
            previewUrlTemplate: config.PREVIEW_URL_TEMPLATE,
          })
        : new KubernetesDriver({
            image: config.TAGGING_IMAGE,
            taggingReplicas: config.TAGGING_REPLICAS,
            gatewayNamespace: config.GATEWAY_NAMESPACE,
            previewUrlTemplate: config.PREVIEW_URL_TEMPLATE,
          });
  const controlPlane = new HttpControlPlane(config.API_INTERNAL_URL, config.INTERNAL_API_TOKEN);

  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  const jobs = new Counter({
    name: 'sst_provisioner_jobs_total',
    help: 'Provisioning jobs processed, by type and result.',
    labelNames: ['type', 'result'],
    registers: [registry],
  });

  // One job at a time: an apply and a delete for the same container must never run concurrently.
  const worker = new Worker<ProvisioningJob>(
    RedisKeys.provisioningQueue,
    async (job) => {
      log.info({ jobId: job.id, ...job.data, attempt: job.attemptsMade + 1 }, 'job started');
      try {
        await processJob(job.data, { driver, controlPlane, readyTimeoutMs: config.READY_TIMEOUT_MS, log });
        jobs.inc({ type: job.data.type, result: 'ok' });
      } catch (error) {
        jobs.inc({ type: job.data.type, result: 'error' });
        throw error;
      }
    },
    { connection: { url: config.REDIS_URL }, concurrency: 1 },
  );
  worker.on('failed', (job, err) =>
    log.warn({ jobId: job?.id, attempts: job?.attemptsMade, err: err.message }, 'job failed'),
  );
  worker.on('error', (err) => log.warn({ err }, 'worker error'));

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_req, reply) =>
    worker.isRunning()
      ? { status: 'ready', driver: driver.name }
      : reply.code(503).send({ status: 'starting' }),
  );
  app.get('/metrics', async (_req, reply) =>
    reply.header('content-type', registry.contentType).send(await registry.metrics()),
  );
  await app.listen({ host: config.HOST, port: config.PORT });
  log.info({ driver: driver.name, image: config.TAGGING_IMAGE }, 'provisioner started');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down; waiting for the current job');
    await worker.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
