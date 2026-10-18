import { createHash } from 'node:crypto';
import type { OpenshipApi, OpenshipService, ServiceInput } from './openshipApi.js';
import { poll, PollAbort, previewUrlFor, type ContainerSpec, type Deployment, type Driver } from './types.js';

export interface OpenshipDriverOptions {
  /** Google's tagging server image. */
  image: string;
  /** Public preview address per container, e.g. https://{id}.preview.example.com (a wildcard CNAME to the edge). */
  previewUrlTemplate?: string;
  /** Where the tagging server is reached inside the project, e.g. http://sst-{id}-tagging:8080 */
  upstreamTemplate: string;
  /** The gateway inside the project; the tracking domain proxies forward to it. */
  gatewayUrl: string;
  /**
   * The edge address, written to the tagging server's /etc/hosts for its preview host name. For servers whose DNS
   * does not know the public preview names (e.g. an office resolver with its own copy of the zone).
   */
  hostsIp?: string;
  /** Image of the tracking domain proxies. */
  proxyImage?: string;
  /** How long an Openship deployment may take. */
  deployTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Whether a tagging server answers /healthy; replaceable in tests. */
  isHealthy?: (upstreamUrl: string) => Promise<boolean>;
}

async function answersHealthy(upstreamUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL('/healthy', upstreamUrl), { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
}

const SPEC_FILE = '/opentrack.spec';
const OK_STATUSES = new Set(['ready', 'success', 'active', 'running']);
const BUSY_STATUSES = new Set(['pending', 'queued', 'building', 'deploying', 'starting', 'unknown']);

/** Openship service names for a container: sst-<id>-tagging, sst-<id>-preview and sst-<id>-edge-<host>. */
export const serviceNames = (id: string) => ({
  tagging: `sst-${id}-tagging`,
  preview: `sst-${id}-preview`,
  edgePrefix: `sst-${id}-edge-`,
});

export const edgeServiceName = (id: string, hostname: string) =>
  `${serviceNames(id).edgePrefix}${hostname.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`.slice(0, 120);

const hostOf = (url: string) => new URL(url).hostname;

/** nginx configuration of a tracking domain proxy: passes everything to the gateway, headers unchanged. */
export function proxyConfig(gatewayUrl: string): string {
  return [
    '# OpenTrack tracking domain proxy. Openship keeps one custom domain per service port, so each tracking',
    "# domain gets this pass-through to the gateway. The edge's X-Forwarded-* headers are forwarded unchanged,",
    "# so the gateway's TRUSTED_PROXY_HOPS and the visitor's address stay as for a domain on the gateway itself.",
    'server {',
    '  listen 8080;',
    '  client_max_body_size 10m;',
    // Docker's DNS, re-resolved so a redeployed gateway (new address) is found again.
    '  resolver 127.0.0.11 valid=10s ipv6=off;',
    `  set $gateway ${gatewayUrl};`,
    '  location / {',
    '    proxy_pass $gateway;',
    '    proxy_http_version 1.1;',
    '    proxy_set_header Connection "";',
    '    proxy_set_header Host $host;',
    '    proxy_set_header X-Forwarded-For $http_x_forwarded_for;',
    '    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;',
    '    proxy_set_header X-Real-IP $http_x_real_ip;',
    '    proxy_buffering off;',
    '    proxy_read_timeout 60s;',
    '  }',
    '}',
    '',
  ].join('\n');
}

const hostsFile = (ip: string, host: string) =>
  [
    '127.0.0.1\tlocalhost',
    '::1\tlocalhost ip6-localhost ip6-loopback',
    '# Written by OpenTrack: this server resolves the public preview name to the edge directly.',
    `${ip}\t${host}`,
    '',
  ].join('\n');

const specHash = (value: unknown) =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

const fileContent = (service: OpenshipService | undefined, path: string) =>
  service?.advanced?.files?.find((f) => f.path === path)?.content;

/**
 * Runs the tagging and preview servers, and one proxy per tracking domain, as services of an Openship project,
 * through Openship's API. Only services named after the container are created, changed or removed; others in the
 * project (the platform itself, other teams' names) are never touched.
 *
 * Environment values read back masked from Openship, so each managed service carries a hash of what was last
 * applied in a small file (/opentrack.spec); a service is only patched and redeployed when that hash changes.
 */
export class OpenshipDriver implements Driver {
  readonly name = 'openship';

  constructor(
    private readonly api: OpenshipApi,
    private readonly options: OpenshipDriverOptions,
  ) {}

  async apply(spec: ContainerSpec): Promise<Deployment> {
    const names = serviceNames(spec.id);
    const services = await this.api.listServices();
    const byName = new Map(services.map((s) => [s.name, s]));
    const toDeploy: string[] = [];

    // Preview server. An existing one keeps its domain (it may predate the template, e.g. a hand-made one).
    const currentPreview = byName.get(names.preview);
    const templateUrl = previewUrlFor(this.options.previewUrlTemplate, spec.id);
    const previewHost = currentPreview?.customDomain || (templateUrl ? hostOf(templateUrl) : null);
    const previewInput: ServiceInput = {
      image: this.options.image,
      environment: { RUN_AS_PREVIEW_SERVER: 'true', CONTAINER_CONFIG: spec.containerConfig },
      ...(previewHost && {
        exposed: true,
        exposedPort: '8080',
        domainType: 'custom' as const,
        customDomain: previewHost,
      }),
    };
    const preview = await this.ensure(names.preview, previewInput, currentPreview);
    if (preview.changed) toDeploy.push(preview.service.id);

    // Tagging server.
    const currentTagging = byName.get(names.tagging);
    const files: { path: string; content: string }[] = [];
    if (previewHost && this.options.hostsIp)
      files.push({ path: '/etc/hosts', content: hostsFile(this.options.hostsIp, previewHost) });
    const taggingInput: ServiceInput = {
      image: this.options.image,
      environment: {
        CONTAINER_CONFIG: spec.containerConfig,
        // Google's image refuses an internal or http:// preview address.
        PREVIEW_SERVER_URL: previewHost ? `https://${previewHost}` : null,
      },
      ...(files.length > 0 && { advanced: { files } }),
    };
    const tagging = await this.ensure(names.tagging, taggingInput, currentTagging);
    if (tagging.changed) toDeploy.push(tagging.service.id);
    const managed = [preview.service.id, tagging.service.id];

    // Tracking domain proxies. A host name that already has an Openship domain on another service (e.g. one set
    // up by hand on the gateway) is left alone.
    const domains = await this.api.listDomains();
    const wanted = new Map<string, string>();
    for (const hostname of spec.domains ?? []) {
      const name = edgeServiceName(spec.id, hostname);
      const existing = domains.find((d) => d.hostname === hostname);
      const owner = existing?.serviceId ? services.find((s) => s.id === existing.serviceId) : undefined;
      if (owner && owner.name !== name) continue;
      wanted.set(name, hostname);
    }
    for (const [name, hostname] of wanted) {
      const proxy = await this.ensure(
        name,
        {
          image: this.options.proxyImage ?? 'nginx:1.27-alpine',
          exposed: true,
          exposedPort: '8080',
          domainType: 'custom',
          customDomain: hostname,
          advanced: {
            files: [
              { path: '/etc/nginx/conf.d/default.conf', content: proxyConfig(this.options.gatewayUrl) },
            ],
          },
        },
        byName.get(name),
      );
      if (proxy.changed) toDeploy.push(proxy.service.id);
      managed.push(proxy.service.id);
    }
    for (const service of services) {
      if (service.name.startsWith(names.edgePrefix) && !wanted.has(service.name))
        await this.api.deleteService(service.id);
    }

    const upstreamUrl = this.options.upstreamTemplate.replaceAll('{id}', spec.id);
    // A deployment that failed after the settings were saved leaves nothing changed but something not running
    // (e.g. a retry, or "Restart tagging servers"): deploy every service that is not running, and everything if
    // the tagging server does not answer.
    const running = await this.api.runningServiceNames();
    const byId = new Map([...services, preview.service, tagging.service].map((s) => [s.id, s.name]));
    for (const id of managed)
      if (!toDeploy.includes(id) && !running.has(byId.get(id) ?? '')) toDeploy.push(id);
    if (toDeploy.length === 0 && !(await (this.options.isHealthy ?? answersHealthy)(upstreamUrl)))
      toDeploy.push(...managed);
    if (toDeploy.length > 0) await this.deploy(toDeploy, spec.id);
    return { upstreamUrl, removeOnFailure: false };
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
      `Tagging server for ${spec.id} (${deployment.upstreamUrl})`,
    );
  }

  async remove(containerId: string): Promise<void> {
    const prefix = `sst-${containerId}-`;
    for (const service of await this.api.listServices()) {
      if (service.name.startsWith(prefix)) await this.api.deleteService(service.id);
    }
  }

  /** Creates the service, or patches it when what is wanted differs from what was last applied. */
  private async ensure(
    name: string,
    input: ServiceInput,
    current: OpenshipService | undefined,
  ): Promise<{ service: OpenshipService; changed: boolean }> {
    const hash = specHash(input);
    const files = [...(input.advanced?.files ?? []), { path: SPEC_FILE, content: hash }];
    const full: ServiceInput = { ...input, advanced: { ...input.advanced, files } };
    if (!current) {
      const environment = Object.fromEntries(
        Object.entries(input.environment ?? {}).filter((e): e is [string, string] => e[1] !== null),
      );
      const service = await this.api.createService({
        ...full,
        environment,
        name,
        kind: 'compose',
        restart: 'unless-stopped',
      });
      return { service, changed: true };
    }
    if (fileContent(current, SPEC_FILE) === hash) return { service: current, changed: false };
    // Files replace the stored list; keep files this driver does not manage.
    const kept = (current.advanced?.files ?? []).filter((f) => !files.some((w) => w.path === f.path));
    const service = await this.api.updateService(current.id, {
      ...full,
      advanced: { files: [...kept, ...files] },
    });
    return { service, changed: true };
  }

  private async deploy(serviceIds: string[], containerId: string) {
    const deploymentId = await this.api.deploy(serviceIds);
    await poll(
      async () => {
        const { status, message } = await this.api.deploymentStatus(deploymentId);
        if (OK_STATUSES.has(status)) return true;
        if (BUSY_STATUSES.has(status)) return false;
        throw new PollAbort(
          `Openship deployment ${deploymentId} for ${containerId} ended ${status}${message ? `: ${message}` : ''}`,
        );
      },
      this.options.deployTimeoutMs ?? 600_000,
      this.options.pollIntervalMs ?? 5_000,
      `Openship deployment ${deploymentId}`,
    );
  }
}
