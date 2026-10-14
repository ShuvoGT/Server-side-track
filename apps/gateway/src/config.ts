import { z } from 'zod';

const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

const configSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  /** Visitor traffic from Caddy. */
  PORT: z.coerce.number().int().default(8080),
  /** /healthz, /readyz and /metrics. Never routed by Caddy. */
  ADMIN_PORT: z.coerce.number().int().default(9090),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  API_INTERNAL_URL: z.url(),
  INTERNAL_API_TOKEN: z.string().min(16),
  REDIS_URL: optionalString,
  GEOIP_DB_PATH: optionalString,
  /** Optional file with one IP address or CIDR range per line, applied to every container. */
  BOT_IP_LIST_PATH: optionalString,
  /** Number of proxies in front of the gateway whose X-Forwarded-For entries are trusted (Caddy: 1). */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
  /** GTM preview needs more than 20 seconds. */
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(21_000).default(30_000),
  ROUTE_CACHE_TTL_MS: z.coerce.number().int().min(1_000).default(30_000),
  ROUTE_NEGATIVE_TTL_MS: z.coerce.number().int().min(1_000).default(5_000),
  LOADER_CACHE_TTL_MS: z.coerce.number().int().min(0).default(60_000),
  COUNTER_FLUSH_MS: z.coerce.number().int().min(1_000).default(10_000),
  BODY_LIMIT_BYTES: z.coerce.number().int().default(1_048_576),
  /** Where gtag.js comes from when the tagging server refuses to serve it. */
  GOOGLE_SCRIPT_ORIGIN: z.url().default('https://www.googletagmanager.com'),
});

export type GatewayConfig = z.infer<typeof configSchema>;

/** Validates the environment at startup, as the coding conventions require. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid gateway configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
