import { poll, type ContainerSpec, type Deployment, type Driver } from './types.js';

/**
 * For platforms that run the tagging servers themselves (e.g. as services in an Openship compose project, where
 * the provisioner must not get the host's Docker socket). This driver starts and removes nothing: it waits until
 * the tagging server at the upstream address answers /healthy, so the container shows Active or Failed.
 */
export class ExternalDriver implements Driver {
  readonly name = 'external';

  /** {id} is replaced with the container id, e.g. http://sst-{id}-tagging:8080 */
  constructor(private readonly upstreamTemplate: string) {}

  async apply(spec: ContainerSpec): Promise<Deployment> {
    return { upstreamUrl: this.upstreamTemplate.replaceAll('{id}', spec.id), removeOnFailure: false };
  }

  async waitReady(spec: ContainerSpec, deployment: Deployment, timeoutMs: number): Promise<void> {
    await poll(
      async () => {
        const response = await fetch(new URL('/healthy', deployment.upstreamUrl), {
          signal: AbortSignal.timeout(3_000),
        });
        return response.ok;
      },
      timeoutMs,
      5_000,
      `Tagging server for ${spec.id} (expected at ${deployment.upstreamUrl}; add its service to the deployment)`,
    );
  }

  async remove(): Promise<void> {
    // The tagging servers belong to the platform's deployment; removing them is a deployment change.
  }
}
