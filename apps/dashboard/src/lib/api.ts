import 'server-only';
import { redirect } from 'next/navigation';
import { env } from './env';
import { getSession } from './session';
import type {
  AdminUser,
  AdminWorkspace,
  Container,
  DnsRecord,
  Domain,
  Invite,
  LogsResponse,
  Me,
  Member,
  PowerUps,
  Role,
  Snippet,
  Tenant,
  Usage,
  VerifyResult,
  Workspace,
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
  unknown_user: 'Your account no longer exists. Sign in again.',
  session_revoked: 'Your password was changed. Sign in again.',
  invalid_request: 'Some of the values are not valid.',
};

/**
 * Calls the control plane API with the admin key. Runs only on the server: the key never reaches the browser.
 * The signed-in user goes along as x-sst-user, and the API limits the request to that user's workspaces.
 */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const session = await getSession();
  // Without x-sst-user the admin key alone would see every workspace: only sign-in calls may go without a user.
  if (!session && !path.startsWith('/v1/auth/')) redirect('/login');
  let response: Response;
  try {
    response = await fetch(new URL(path, env().API_URL), {
      method,
      headers: {
        authorization: `Bearer ${env().ADMIN_API_KEY}`,
        ...(session && {
          'x-sst-user': session.userId,
          'x-sst-session-issued-at': String(session.issuedAt),
        }),
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
    // An account that is not (or no longer) approved sees the waiting page instead of an error.
    if (code === 'account_pending' || code === 'account_rejected') redirect('/pending');
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

const ws = (id: string) => `/v1/tenants/${encodeURIComponent(id)}`;

export const api = {
  platform: () => call<{ edgeHostname: string; edgeIpv4: string[] }>('GET', '/v1/platform'),

  signUp: (input: { email: string; password: string; name: string; phoneCountry?: string; phone?: string }) =>
    call<Me>('POST', '/v1/auth/signup', input),
  signIn: (input: { email: string; password: string; clientIp?: string }) =>
    call<Me>('POST', '/v1/auth/signin', input),
  signInWithGoogle: (profile: { sub: string; email: string; emailVerified: boolean; name: string }) =>
    call<Me>('POST', '/v1/auth/google', profile),
  me: () => call<Me>('GET', '/v1/me'),
  allUsers: () => call<AdminUser[]>('GET', '/v1/admin/users'),
  allWorkspaces: () => call<AdminWorkspace[]>('GET', '/v1/admin/workspaces'),
  /** Super-admins: deletes the workspace with its containers. */
  deleteWorkspaceWithContainers: (id: string) => call<void>('DELETE', `${ws(id)}?containers=delete`),
  approveUser: (id: string) =>
    call<{ emailed: boolean }>('POST', `/v1/admin/users/${encodeURIComponent(id)}/approve`),
  rejectUser: (id: string) => call<void>('POST', `/v1/admin/users/${encodeURIComponent(id)}/reject`),
  deleteUser: (id: string) => call<void>('DELETE', `/v1/admin/users/${encodeURIComponent(id)}`),
  verifySecondFactor: (userId: string, code: string) =>
    call<Me>('POST', '/v1/auth/two-factor', { userId, code }),
  updateProfile: (patch: {
    name?: string;
    phoneCountry?: string | null;
    phone?: string | null;
    currency?: string;
    timezone?: string;
  }) => call<Me>('PATCH', '/v1/me', patch),
  changePassword: (currentPassword: string | undefined, newPassword: string) =>
    call<Me>('POST', '/v1/me/password', { currentPassword, newPassword }),
  setUpTwoFactor: () => call<{ secret: string; otpauthUrl: string }>('POST', '/v1/me/two-factor/setup'),
  enableTwoFactor: (code: string) =>
    call<{ recoveryCodes: string[] }>('POST', '/v1/me/two-factor/enable', { code }),
  disableTwoFactor: (code: string) => call<Me>('POST', '/v1/me/two-factor/disable', { code }),
  requestPasswordReset: (email: string, clientIp?: string) =>
    call<{ sent: boolean }>('POST', '/v1/auth/password-reset', { email, clientIp }),
  resetPassword: (token: string, password: string) =>
    call<Me>('POST', '/v1/auth/password-reset/confirm', { token, password }),

  workspaces: () => call<Workspace[]>('GET', '/v1/tenants'),
  createWorkspace: (name: string) => call<Tenant>('POST', '/v1/tenants', { name }),
  renameWorkspace: (id: string, name: string) => call<Tenant>('PATCH', ws(id), { name }),
  deleteWorkspace: (id: string) => call<void>('DELETE', ws(id)),
  members: (id: string) => call<{ members: Member[]; invites: Invite[] }>('GET', `${ws(id)}/members`),
  addMember: (id: string, email: string, role: Role) =>
    call<{ added?: { email: string }; invited?: Invite; emailed: boolean }>('POST', `${ws(id)}/members`, {
      email,
      role,
    }),
  changeRole: (id: string, userId: string, role: Role) =>
    call<{ userId: string; role: Role }>('PATCH', `${ws(id)}/members/${encodeURIComponent(userId)}`, {
      role,
    }),
  removeMember: (id: string, userId: string) =>
    call<void>('DELETE', `${ws(id)}/members/${encodeURIComponent(userId)}`),
  cancelInvite: (id: string, inviteId: string) =>
    call<void>('DELETE', `${ws(id)}/invites/${encodeURIComponent(inviteId)}`),

  containers: (workspaceId?: string) =>
    call<Container[]>(
      'GET',
      workspaceId ? `/v1/containers?tenantId=${encodeURIComponent(workspaceId)}` : '/v1/containers',
    ),
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
