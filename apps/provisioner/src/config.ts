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
   */
  DRIVER: z.enum(['kubernetes', 'docker']).default('kubernetes'),
  /** Google's tagging server image; in production the Harbor mirror with a dated tag. */
  TAGGING_IMAGE: z.string().default('gcr.io/cloud-tagging-10302018/gtm-cloud-image:stable'),
  /** How long a new or changed container may take to become healthy before it is marked failed. */
  READY_TIMEOUT_MS: z.coerce.number().int().min(10_000).default(300_000),
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
  return result.data;
}
