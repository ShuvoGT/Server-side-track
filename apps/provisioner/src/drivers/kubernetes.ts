import {
  ApiException,
  AppsV1Api,
  CoreV1Api,
  KubeConfig,
  KubernetesObjectApi,
  PatchStrategy,
} from '@kubernetes/client-node';
import { containerManifests, namespaceFor, upstreamFor, type ManifestOptions } from './manifests.js';
import { poll, type ContainerSpec, type Deployment, type Driver } from './types.js';

const FIELD_MANAGER = 'sst-provisioner';

const isNotFound = (error: unknown) => error instanceof ApiException && error.code === 404;

/**
 * Production driver: one namespace per container on k3s. Objects are written with server-side apply, so applying
 * again only changes what differs (a new Container Config rolls the pods; nothing else restarts).
 */
export class KubernetesDriver implements Driver {
  readonly name = 'kubernetes';
  private readonly objects: KubernetesObjectApi;
  private readonly core: CoreV1Api;
  private readonly apps: AppsV1Api;

  constructor(
    private readonly options: ManifestOptions,
    kubeConfig?: KubeConfig,
  ) {
    const kc = kubeConfig ?? new KubeConfig();
    // In the cluster: the provisioner's service account. Elsewhere: ~/.kube/config or KUBECONFIG.
    if (!kubeConfig) kc.loadFromDefault();
    this.objects = KubernetesObjectApi.makeApiClient(kc);
    this.core = kc.makeApiClient(CoreV1Api);
    this.apps = kc.makeApiClient(AppsV1Api);
  }

  async apply(spec: ContainerSpec): Promise<Deployment> {
    let created = false;
    try {
      await this.core.readNamespace({ name: namespaceFor(spec.id) });
    } catch (error) {
      if (!isNotFound(error)) throw error;
      created = true;
    }
    for (const manifest of containerManifests(spec, this.options)) {
      await this.objects.patch(
        manifest,
        undefined,
        undefined,
        FIELD_MANAGER,
        true,
        PatchStrategy.ServerSideApply,
      );
    }
    return { upstreamUrl: upstreamFor(spec.id), removeOnFailure: created };
  }

  async waitReady(spec: ContainerSpec, _deployment: Deployment, timeoutMs: number): Promise<void> {
    const namespace = namespaceFor(spec.id);
    const ready = async (name: string) => {
      const d = await this.apps.readNamespacedDeployment({ name, namespace });
      const wanted = d.spec?.replicas ?? 1;
      const status = d.status;
      // Rolled out: the controller saw the latest spec, and every replica is updated and ready.
      return (
        (status?.observedGeneration ?? 0) >= (d.metadata?.generation ?? 1) &&
        (status?.updatedReplicas ?? 0) >= wanted &&
        (status?.readyReplicas ?? 0) >= wanted
      );
    };
    await poll(() => ready('tagging'), timeoutMs, 3_000, 'Tagging servers');
    await poll(() => ready('preview'), timeoutMs, 3_000, 'Preview server');
  }

  async remove(containerId: string): Promise<void> {
    const name = namespaceFor(containerId);
    try {
      await this.core.deleteNamespace({ name });
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    // Namespace deletion is asynchronous; wait until it is gone so the id is free and the record can go.
    await poll(
      async () => {
        try {
          await this.core.readNamespace({ name });
          return false;
        } catch (error) {
          return isNotFound(error);
        }
      },
      300_000,
      3_000,
      `Namespace ${name} deletion`,
    );
  }
}
