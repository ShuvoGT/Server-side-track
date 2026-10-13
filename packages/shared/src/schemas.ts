import { z } from 'zod';

/** Marketing cookies the cookie keeper extends and restores by default. A trailing `*` matches a prefix. */
export const DEFAULT_KEPT_COOKIES = [
  '_ga',
  '_ga_*',
  '_gcl_au',
  '_gcl_aw',
  '_gcl_dc',
  '_gcl_gb',
  '_fbp',
  '_fbc',
  '_ttp',
];

/** Chrome caps cookie lifetime at 400 days; other browsers accept longer, but there is no gain in asking. */
export const MAX_COOKIE_AGE_DAYS = 400;

export const botModeSchema = z.enum(['off', 'flag', 'drop']);
export type BotMode = z.infer<typeof botModeSchema>;

export const powerUpsSchema = z.object({
  customLoader: z
    .object({
      /**
       * Serves gtm.js (for the container's web container id) and gtag.js from the tracking domain under random
       * paths, so ad blockers that match googletagmanager.com or /gtm.js do not stop them.
       */
      enabled: z.boolean().default(true),
    })
    .prefault({}),
  /** Adds x-sst-geo-* headers from the GeoLite2 City database. */
  geoHeaders: z.boolean().default(true),
  /** Adds x-sst-device-* headers parsed from the User-Agent. */
  userAgentInfo: z.boolean().default(true),
  botDetection: z
    .object({
      /** off: no checks. flag: add x-sst-bot headers. drop: answer 204 without forwarding. */
      mode: botModeSchema.default('flag'),
      /** Extra IP addresses or CIDR ranges treated as bots. */
      blockedIps: z.array(z.string()).default([]),
    })
    .prefault({}),
  cookieKeeper: z
    .object({
      enabled: z.boolean().default(false),
      cookies: z.array(z.string().min(1)).default(DEFAULT_KEPT_COOKIES),
      maxAgeDays: z.number().int().min(1).max(MAX_COOKIE_AGE_DAYS).default(MAX_COOKIE_AGE_DAYS),
    })
    .prefault({}),
  anonymizer: z
    .object({
      enabled: z.boolean().default(false),
      /** IPv4: last octet zeroed. IPv6: last 80 bits zeroed. */
      anonymizeIp: z.boolean().default(true),
      /** Drops the GA4 user id (uid) parameter. */
      removeUserId: z.boolean().default(true),
      /** Masks email addresses and personal query parameters in URLs and event parameters. */
      redactPii: z.boolean().default(true),
    })
    .prefault({}),
});
export type PowerUps = z.infer<typeof powerUpsSchema>;
export type PowerUpsInput = z.input<typeof powerUpsSchema>;

export const gtmContainerIdSchema = z
  .string()
  .regex(/^GTM-[A-Z0-9]{4,12}$/, 'Expected a GTM container ID like GTM-ABC1234');

const loaderPathSchema = z.string().regex(/^\/[a-z0-9]{6,32}\.js$/, 'Loader paths look like /abc123def.js');

/**
 * Everything the edge gateway needs to serve one host name. The control plane writes one route per verified
 * domain; several hosts may point at the same container.
 */
export const containerRouteSchema = z.object({
  hostname: z.string(),
  containerId: z.string(),
  /** The server container's GTM id, from the Container Config. */
  gtmContainerId: gtmContainerIdSchema,
  /** Base URL of the container's tagging server service, e.g. http://tagging.ctr-abc.svc.cluster.local:8080 */
  upstreamUrl: z.url(),
  loader: z.object({
    /** The web container whose gtm.js the custom loader serves. Null turns the gtm.js path off. */
    webContainerId: gtmContainerIdSchema.nullable(),
    gtmPath: loaderPathSchema,
    gtagPath: loaderPathSchema,
  }),
  webhook: z
    .object({
      path: z.string().regex(/^\/[A-Za-z0-9/_-]+$/),
      secret: z.string().min(32),
    })
    .nullable(),
  powerUps: powerUpsSchema,
});
export type ContainerRoute = z.infer<typeof containerRouteSchema>;
