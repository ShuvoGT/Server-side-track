import type { ProvisioningJob } from '@sst/shared';
import type { ControlPlane } from './controlPlane.js';
import type { Deployment, Driver } from './drivers/types.js';

export interface Logger {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface ProcessorDeps {
  driver: Driver;
  controlPlane: ControlPlane;
  readyTimeoutMs: number;
  log: Logger;
}

const errorMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(0, 1_500);

/**
 * apply: validate, create or update the tagging and preview servers, wait until they are healthy, then report the
 * container active with its upstream URL. On failure a brand-new container is rolled back (removed); an existing
 * one keeps its previous servers, because Kubernetes only replaces pods once the new ones are ready.
 *
 * delete: remove everything, then remove the record from the control plane.
 *
 * Errors are rethrown so the queue retries with backoff (transient API or cluster problems).
 */
export async function processJob(job: ProvisioningJob, deps: ProcessorDeps): Promise<void> {
  const { driver, controlPlane, log } = deps;
  const container = await controlPlane.getContainer(job.containerId);

  if (job.type === 'delete') {
    if (container && container.status !== 'deleting') {
      log.warn(
        { containerId: job.containerId, status: container.status },
        'delete job for a container not being deleted; skipped',
      );
      return;
    }
    await driver.remove(job.containerId);
    if (container) await controlPlane.forget(job.containerId);
    log.info({ containerId: job.containerId }, 'container removed');
    return;
  }

  if (!container) {
    log.info({ containerId: job.containerId }, 'container no longer exists; nothing to apply');
    return;
  }
  if (container.status === 'deleting') {
    log.info({ containerId: container.id }, 'container is being deleted; apply skipped');
    return;
  }
  if (!container.containerConfig) {
    await controlPlane.reportStatus(container.id, {
      status: 'failed',
      message: 'The container has no Container Config.',
    });
    return;
  }

  const spec = { id: container.id, containerConfig: container.containerConfig };
  await controlPlane.reportStatus(container.id, {
    status: 'provisioning',
    message: `Starting tagging servers (${driver.name})`,
  });
  let deployment: Deployment | undefined;
  try {
    deployment = await driver.apply(spec);
    await driver.waitReady(spec, deployment, deps.readyTimeoutMs);
  } catch (error) {
    const message = errorMessage(error);
    if (deployment?.removeOnFailure) {
      await driver
        .remove(container.id)
        .catch((err) => log.warn({ err, containerId: container.id }, 'rollback failed'));
    }
    const note =
      deployment && !deployment.removeOnFailure && driver.name === 'kubernetes'
        ? ' The previous servers keep running.'
        : '';
    const sentence = /[.!?]$/.test(message) ? message : `${message}.`;
    await controlPlane.reportStatus(container.id, { status: 'failed', message: `${sentence}${note}` });
    log.error({ err: error, containerId: container.id }, 'provisioning failed');
    throw error;
  }
  await controlPlane.reportStatus(container.id, {
    status: 'active',
    message: null,
    upstreamUrl: deployment.upstreamUrl,
  });
  log.info({ containerId: container.id, upstreamUrl: deployment.upstreamUrl }, 'container active');
}
