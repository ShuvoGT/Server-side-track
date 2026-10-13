import type { KubernetesObject } from '@kubernetes/client-node';
import type { ContainerSpec } from './types.js';

export interface ManifestOptions {
  image: string;
  taggingReplicas: number;
  /** Namespace the gateway runs in; the only one allowed to reach the tagging servers. */
  gatewayNamespace: string;
}

export const namespaceFor = (id: string) => `ctr-${id}`;
export const upstreamFor = (id: string) => `http://tagging.${namespaceFor(id)}.svc.cluster.local:8080`;

const LABEL = 'sst.platform/container-id';

/**
 * Kubernetes objects for one container, following the capacity plan: tagging servers at 0.25 vCPU / 384 MiB
 * requested and 1 vCPU / 512 MiB limit (Google advises at most 1 vCPU per instance), exactly one preview server
 * that is never scaled, /healthy probes, a PodDisruptionBudget and a NetworkPolicy that only lets the gateway in.
 * Same content as deploy/k8s/container-template.yaml.
 */
export function containerManifests(spec: ContainerSpec, options: ManifestOptions): KubernetesObject[] {
  const namespace = namespaceFor(spec.id);
  const labels = { [LABEL]: spec.id, 'app.kubernetes.io/managed-by': 'sst-provisioner' };
  const configEnv = {
    name: 'CONTAINER_CONFIG',
    valueFrom: { secretKeyRef: { name: 'gtm-config', key: 'CONTAINER_CONFIG' } },
  };
  const probe = (initialDelaySeconds: number, periodSeconds: number) => ({
    httpGet: { path: '/healthy', port: 'http' },
    initialDelaySeconds,
    periodSeconds,
  });
  const pod = (app: string, env: object[], resources: object, probes: object) => ({
    metadata: { labels: { app, ...labels } },
    spec: {
      automountServiceAccountToken: false,
      containers: [
        {
          name: app,
          image: options.image,
          ports: [{ name: 'http', containerPort: 8080 }],
          env,
          resources,
          ...probes,
        },
      ],
    },
  });
  const service = (name: string): KubernetesObject =>
    ({
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name, namespace, labels },
      spec: { selector: { app: name }, ports: [{ name: 'http', port: 8080, targetPort: 'http' }] },
    }) as KubernetesObject;

  const taggingTemplate = pod(
    'tagging',
    [configEnv, { name: 'PREVIEW_SERVER_URL', value: `http://preview.${namespace}.svc.cluster.local:8080` }],
    { requests: { cpu: '250m', memory: '384Mi' }, limits: { cpu: '1', memory: '512Mi' } },
    { readinessProbe: probe(0, 5), livenessProbe: probe(15, 10) },
  );
  // Spread the tagging servers over nodes, so losing one server node does not stop the container.
  Object.assign(taggingTemplate.spec, {
    topologySpreadConstraints: [
      {
        maxSkew: 1,
        topologyKey: 'kubernetes.io/hostname',
        whenUnsatisfiable: 'ScheduleAnyway',
        labelSelector: { matchLabels: { app: 'tagging' } },
      },
    ],
  });

  return [
    { apiVersion: 'v1', kind: 'Namespace', metadata: { name: namespace, labels } },
    {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: { name: 'gtm-config', namespace, labels },
      type: 'Opaque',
      stringData: { CONTAINER_CONFIG: spec.containerConfig },
    } as KubernetesObject,
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'tagging', namespace, labels },
      spec: {
        replicas: options.taggingReplicas,
        selector: { matchLabels: { app: 'tagging' } },
        strategy: { rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
        template: taggingTemplate,
      },
    } as KubernetesObject,
    {
      apiVersion: 'policy/v1',
      kind: 'PodDisruptionBudget',
      metadata: { name: 'tagging', namespace, labels },
      spec: { minAvailable: 1, selector: { matchLabels: { app: 'tagging' } } },
    } as KubernetesObject,
    service('tagging'),
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'preview', namespace, labels },
      spec: {
        replicas: 1,
        strategy: { type: 'Recreate' },
        selector: { matchLabels: { app: 'preview' } },
        template: pod(
          'preview',
          [configEnv, { name: 'RUN_AS_PREVIEW_SERVER', value: 'true' }],
          { requests: { cpu: '100m', memory: '256Mi' }, limits: { memory: '512Mi' } },
          { livenessProbe: probe(15, 10) },
        ),
      },
    } as KubernetesObject,
    service('preview'),
    {
      apiVersion: 'networking.k8s.io/v1',
      kind: 'NetworkPolicy',
      metadata: { name: 'ingress-from-gateway', namespace, labels },
      spec: {
        podSelector: {},
        policyTypes: ['Ingress'],
        ingress: [
          {
            from: [
              {
                namespaceSelector: {
                  matchLabels: { 'kubernetes.io/metadata.name': options.gatewayNamespace },
                },
              },
              { podSelector: {} },
            ],
            ports: [{ port: 8080 }],
          },
        ],
      },
    } as KubernetesObject,
  ];
}
