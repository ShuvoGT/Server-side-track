import { z } from 'zod';

const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());
const csv = z.preprocess(
  (v) =>
    typeof v === 'string'
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : (v ?? []),
  z.array(z.string()),
);

const configSchema = z.object({
  HOST: z.string().default('0.0.0.0'),
  /** Public API for the dashboard and admins: /v1/*, plus /healthz, /readyz and /metrics. */
  PORT: z.coerce.number().int().default(3000),
  /** Internal API for Caddy (ask endpoint), the gateway and the provisioner. Not exposed outside the cluster. */
  INTERNAL_PORT: z.coerce.number().int().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** prisma: PostgreSQL through Prisma. memory: in-process store for tests; data is lost on restart. */
  STORE: z.enum(['prisma', 'memory']).default('prisma'),
  /** PostgreSQL connection string, e.g. postgresql://sst:PASSWORD@postgres:5432/sst */
  DATABASE_URL: z.string().default('postgresql://sst:sst@127.0.0.1:5432/sst'),
  /**
   * The SQLite file of a platform that ran before PostgreSQL. When set and the PostgreSQL database is empty, its
   * data is copied over once at startup.
   */
  SQLITE_IMPORT_FILE: optionalString,
  REDIS_URL: optionalString,
  ADMIN_API_KEY: z.string().min(24),
  INTERNAL_API_TOKEN: z.string().min(16),
  /** The host name customers point their tracking subdomain at with a CNAME, e.g. edge.example-platform.com. */
  EDGE_HOSTNAME: z.string().min(3),
  /** Public IPv4 addresses of the edge, for customers who must use an A record. */
  EDGE_IPV4: csv,
  /** Where the gateway reaches a container's tagging servers. {id} is replaced with the container id. */
  TAGGING_UPSTREAM_TEMPLATE: z.string().default('http://tagging.ctr-{id}.svc.cluster.local:8080'),
  /** Comma-separated addresses that see every workspace, once they sign in with Google. */
  SUPER_ADMIN_EMAILS: csv,
  USAGE_ROLLUP_MS: z.coerce.number().int().min(10_000).default(60_000),
  ROUTE_RESYNC_MS: z.coerce.number().int().min(10_000).default(300_000),
});

export type ApiConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) throw new Error(`Invalid API configuration:\n${z.prettifyError(result.error)}`);
  return result.data;
}
