import 'server-only';
import { env } from './env';
import type {
  Container,
  DnsRecord,
  Domain,
  LogsResponse,
  PowerUps,
  Snippet,
  Tenant,
  Usage,
  VerifyResult,
} from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Human-readable messages for the API's error codes. */
const MESSAGES: Record<string, string> = {
  invalid_container_config:
    'That Container Config was not accepted. Copy it again from GTM: Admin > Container settings > Manually provision tagging server.',
  hostname_taken: 'Another container already uses this domain.',
  invalid_hostname: 'Enter a domain name such as sst.example.com.',
  no_verified_domain: 'Verify a tracking domain first.',
  not_found: 'Not found.',
  unauthorized: 'The dashboard is not authorized to call the API. Check ADMIN_API_KEY.',
};

/**
 * Calls the control plane API with the admin key. Runs only on the server: the key never reaches the browser.
 */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(new URL(path, env().API_URL), {
      method,
      headers: {
        authorization: `Bearer ${env().ADMIN_API_KEY}`,
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(503, 'api_unreachable', 'The control plane API is not reachable. Is it running?');
  }
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof data.error === 'string' ? data.error : 'error';
    const issues = Array.isArray(data.issues)
      ? (data.issues as { path?: unknown[]; message?: string }[])
          .map((i) => `${(i.path ?? []).join('.')}: ${i.message}`)
          .join('; ')
      : null;
    const message =
      MESSAGES[code] ??
      (typeof data.message === 'string'
        ? data.message
        : issues
          ? `Invalid input (${issues})`
          : `Request failed (${response.status})`);
    throw new ApiError(response.status, code, message);
  }
  return data as T;
}

export const api = {
  platform: () => call<{ edgeHostname: string; edgeIpv4: string[] }>('GET', '/v1/platform'),
  tenants: () => call<Tenant[]>('GET', '/v1/tenants'),
  createTenant: (name: string) => call<Tenant>('POST', '/v1/tenants', { name }),

  containers: () => call<Container[]>('GET', '/v1/containers'),
  container: (id: string) => call<Container>('GET', `/v1/containers/${encodeURIComponent(id)}`),
  createContainer: (input: {
    tenantId: string;
    name: string;
    containerConfig: string;
    webContainerId: string | null;
  }) => call<Container & { webhookSecret: string }>('POST', '/v1/containers', input),
  updateContainer: (
    id: string,
    patch: {
      name?: string;
      webContainerId?: string | null;
      powerUps?: Partial<PowerUps>;
      containerConfig?: string;
    },
  ) => call<Container>('PATCH', `/v1/containers/${encodeURIComponent(id)}`, patch),
  deleteContainer: (id: string) => call<{ id: string }>('DELETE', `/v1/containers/${encodeURIComponent(id)}`),
  regenerateLoaderPaths: (id: string) =>
    call<{ loaderGtmPath: string; loaderGtagPath: string }>(
      'POST',
      `/v1/containers/${encodeURIComponent(id)}/loader-paths`,
    ),
  provision: (id: string) => call<Container>('POST', `/v1/containers/${encodeURIComponent(id)}/provision`),
  rotateWebhookSecret: (id: string) =>
    call<{ webhookPath: string; webhookSecret: string }>(
      'POST',
      `/v1/containers/${encodeURIComponent(id)}/webhook-secret`,
    ),
  snippet: (id: string) => call<Snippet>('GET', `/v1/containers/${encodeURIComponent(id)}/snippet`),
  usage: (id: string, from: Date, to: Date) =>
    call<Usage>(
      'GET',
      `/v1/containers/${encodeURIComponent(id)}/usage?from=${from.toISOString()}&to=${to.toISOString()}`,
    ),
  logs: (id: string, query: { limit: number; before?: string; from?: string; to?: string }) => {
    const params = new URLSearchParams({ limit: String(query.limit) });
    for (const key of ['before', 'from', 'to'] as const) {
      const value = query[key];
      if (value) params.set(key, value);
    }
    return call<LogsResponse>('GET', `/v1/containers/${encodeURIComponent(id)}/logs?${params}`);
  },

  addDomain: (containerId: string, hostname: string) =>
    call<Domain & { dns: { recommended: DnsRecord; alternative: DnsRecord[] } }>(
      'POST',
      `/v1/containers/${encodeURIComponent(containerId)}/domains`,
      { hostname },
    ),
  verifyDomain: (id: string) => call<VerifyResult>('POST', `/v1/domains/${encodeURIComponent(id)}/verify`),
  deleteDomain: (id: string) => call<void>('DELETE', `/v1/domains/${encodeURIComponent(id)}`),
};
