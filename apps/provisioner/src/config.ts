import { z } from 'zod';

const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

const configSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  /** /healthz, /readyz and /metrics. */
  PORT: z.coerce.number().int().default(9091),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  REDIS_URL: z.string().min(1),
  API_INTERNAL_URL: z.url(),
  INTERNAL_API_TOKEN: z.string().min(16),
  /**
   * kubernetes: one ctr-<id> namespace per container (production, k3s).
   * docker: one tagging and one preview container on the local Docker engine (development).
   * external: the tagging servers are run by the deployment platform (e.g. Openship compose services); only
   * health is checked and reported.
   * openship: creates and removes the tagging and preview servers, and one proxy per tracking domain, as services
   * of the platform's own Openship project through Openship's API.
   */
  DRIVER: z.enum(['kubernetes', 'docker', 'external', 'openship']).default('kubernetes'),
  /** external and openship: where each container's tagging server is reached. {id} is the container id. */
  EXTERNAL_UPSTREAM_TEMPLATE: z.string().default('http://sst-{id}-tagging:8080'),
  /** openship: API base, e.g. https://deploy.example.com/api/proxy/api, and a token for the workspace. */
  OPENSHIP_API_URL: optionalString,
  OPENSHIP_TOKEN: optionalString,
  OPENSHIP_ORGANIZATION_ID: optionalString,
  /** openship: the project the platform runs in, and its server. */
  OPENSHIP_PROJECT_ID: optionalString,
  OPENSHIP_SERVER_ID: optionalString,
  /** openship: the compose file's path in the project's source, as Openship knows it. */
  OPENSHIP_COMPOSE_PATH: z.string().default('deploy/openship/docker-compose.yml'),
  /** openship: the gateway inside the project; tracking domain proxies forward to it. */
  OPENSHIP_GATEWAY_URL: z.string().default('http://gateway:8080'),
  /**
   * openship: the edge address, put in each tagging server's /etc/hosts for its preview host name, for servers
   * whose resolver does not know the public preview names.
   */
  OPENSHIP_HOSTS_IP: optionalString,
  /** Google's tagging server image; in production the Harbor mirror with a dated tag. */
  TAGGING_IMAGE: z.string().default('gcr.io/cloud-tagging-10302018/gtm-cloud-image:stable'),
  /** How long a new or changed container may take to become healthy before it is marked failed. */
  READY_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(300_000),
  /**
   * Public HTTPS address of each container's preview server, e.g. https://preview-{id}.example.com. Google's image
   * refuses an internal http:// URL, so without this the tagging servers run without GTM Preview support.
   */
  PREVIEW_URL_TEMPLATE: optionalString,
  /** Kubernetes: the namespace the gateway runs in; the only one allowed to reach tagging servers. */
  GATEWAY_NAMESPACE: z.string().default('platform-system'),
  /** Kubernetes: tagging server replicas per container (the guide's minimum is 2). */
  TAGGING_REPLICAS: z.coerce.number().int().min(1).default(2),
  /**
   * Docker: network shared with the gateway (e.g. sst-local_default in docker compose). Without it, containers
   * join their own network and publish the tagging port on 127.0.0.1 for a gateway running on the host.
   */
  DOCKER_NETWORK: optionalString,
});

export type ProvisionerConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProvisionerConfig {
  const result = configSchema.safeParse(env);
  if (!result.success)
    throw new Error(`Invalid provisioner configuration:\n${z.prettifyError(result.error)}`);
  const config = result.data;
  if (config.DRIVER === 'openship') {
    const missing = (
      [
        'OPENSHIP_API_URL',
        'OPENSHIP_TOKEN',
        'OPENSHIP_ORGANIZATION_ID',
        'OPENSHIP_PROJECT_ID',
        'OPENSHIP_SERVER_ID',
      ] as const
    ).filter((key) => !config[key]);
    if (missing.length > 0) throw new Error(`DRIVER=openship needs ${missing.join(', ')}`);
  }
  return config;
}
