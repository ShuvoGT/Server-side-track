export interface ContainerSpec {
  /** Platform container id; names the namespace (ctr-<id>) or Docker containers (sst-<id>-…). */
  id: string;
  /** Base64 Container Config from GTM, passed to Google's image as CONTAINER_CONFIG. */
  containerConfig: string;
}

/**
 * PREVIEW_SERVER_URL for a container, or null. Google's tagging server only accepts a public https:// address
 * (an internal http://preview:8080 makes it exit with "Invalid preview server URL").
 */
export function previewUrlFor(template: string | undefined, id: string): string | null {
  return template ? template.replaceAll('{id}', id) : null;
}

export interface Deployment {
  /** Where the gateway reaches the tagging servers. */
  upstreamUrl: string;
  /**
   * True if a failure leaves nothing worth keeping, so the provisioner rolls back by removing everything:
   * a brand-new Kubernetes namespace, or Docker containers that this apply (re)created.
   */
  removeOnFailure: boolean;
}

/** Runs Google's tagging and preview servers for one container somewhere. */
export interface Driver {
  readonly name: string;
  /** Creates or updates the resources. Idempotent: applying the same spec twice changes nothing. */
  apply(spec: ContainerSpec): Promise<Deployment>;
  /** Resolves once the tagging servers answer health checks; rejects after the timeout. */
  waitReady(spec: ContainerSpec, deployment: Deployment, timeoutMs: number): Promise<void>;
  /** Removes everything for the container. Succeeds if nothing is there. */
  remove(containerId: string): Promise<void>;
}

/** Thrown from a poll check to stop waiting at once (e.g. the server crashed), instead of at the timeout. */
export class PollAbort extends Error {}

/** Calls check until it returns true. Other errors count as "not yet" (e.g. connection refused while starting). */
export async function poll(
  check: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs: number,
  what: string,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const done = await check().catch((error: unknown) => {
      if (error instanceof PollAbort) throw error;
      return false;
    });
    if (done) return;
    if (Date.now() + intervalMs > deadline) {
      throw new Error(`${what} not ready after ${Math.round(timeoutMs / 1000)} s`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
