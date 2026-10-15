import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { collectDefaultMetrics, Registry } from 'prom-client';
import { z } from 'zod';
import {
  generateLoaderPath,
  gtmContainerIdSchema,
  gtmSnippet,
  InvalidContainerConfigError,
  normalizeHost,
  parseContainerConfig,
  powerUpsSchema,
} from '@sst/shared';
import { Accounts, MIN_PASSWORD_LENGTH, normalizeEmail, SignInLimiter } from './accounts.js';
import {
  containerView,
  newId,
  newWebhookSecret,
  routeFor,
  userView,
  type Container,
  type Domain,
  type Role,
  type Tenant,
  type UsageCounts,
  type User,
} from './model.js';
import {
  checkDomainDns,
  noLiveData,
  type DnsResolver,
  type LiveData,
  type ProvisioningQueue,
  type RoutePublisher,
} from './services.js';
import { DuplicateHostnameError, type Store } from './store.js';

export interface ApiDeps {
  store: Store;
  publisher: RoutePublisher;
  queue: ProvisioningQueue;
  dnsResolver?: DnsResolver;
  /** Request logs and not-yet-rolled-up counters from Redis. */
  liveData?: LiveData;
  adminApiKey: string;
  internalApiToken: string;
  edgeHostname: string;
  edgeIpv4: string[];
  /** {id} is replaced with the container id. */
  upstreamTemplate: string;
  logLevel?: string;
  collectDefaultMetrics?: boolean;
  /** Addresses with access to every workspace, once Google has verified them. */
  superAdminEmails?: string[];
}

/** The signed-in dashboard user a /v1 request acts for (x-sst-user), or null for the admin key alone. */
interface Actor {
  user: User;
  superAdmin: boolean;
  roles: Map<string, Role>;
}

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

const emptyCounts = (): UsageCounts => ({
  requests: 0,
  loader: 0,
  webhook: 0,
  botFlagged: 0,
  botDropped: 0,
  errors: 0,
});

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

function parseConfigOr400(value: string): string {
  try {
    return parseContainerConfig(value).id;
  } catch (error) {
    if (error instanceof InvalidContainerConfigError) {
      throw new HttpError(400, 'invalid_container_config', error.message);
    }
    throw error;
  }
}

const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`);

function tokenMatches(header: string | undefined, expected: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, '') ?? '');
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

const DEFAULT_WEBHOOK_PATH = '/sst/woocommerce';

const createTenantBody = z.object({ name: z.string().trim().min(1).max(200) });
const signUpBody = z.object({
  email: z.email().max(254),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
  name: z.string().max(100).default(''),
});
const signInBody = z.object({
  email: z.string().max(254),
  password: z.string().max(200),
  /** The browser's address as the dashboard saw it, to limit guessing per client. */
  clientIp: z.string().max(100).optional(),
});
const googleBody = z.object({
  sub: z.string().min(1).max(255),
  email: z.email().max(254),
  emailVerified: z.boolean(),
  name: z.string().max(100).default(''),
});
const roleSchema = z.enum(['owner', 'member']);
const addMemberBody = z.object({ email: z.email().max(254), role: roleSchema.default('member') });
const patchMemberBody = z.object({ role: roleSchema });
const createContainerBody = z.object({
  tenantId: z.string(),
  name: z.string().min(1).max(200),
  containerConfig: z.string().min(1),
  webContainerId: gtmContainerIdSchema.nullable().optional(),
  powerUps: z.record(z.string(), z.unknown()).optional(),
});
const patchContainerBody = z.object({
  name: z.string().min(1).max(200).optional(),
  webContainerId: gtmContainerIdSchema.nullable().optional(),
  /** Partial power-up settings, merged into the current ones. */
  powerUps: z.record(z.string(), z.unknown()).optional(),
  /** A new Container Config from GTM; the tagging servers are restarted with it. */
  containerConfig: z.string().min(1).optional(),
});
const createDomainBody = z.object({ hostname: z.string() });
const usageQuery = z.object({ from: z.iso.datetime().optional(), to: z.iso.datetime().optional() });
const logsQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(500).default(100),
    before: z
      .string()
      .regex(/^\d+-\d+$/)
      .optional(),
    /** Only requests received in this window (inclusive). */
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
  })
  .refine((q) => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to), {
    message: 'from must not be after to',
  });
const statusBody = z.object({
  status: z.enum(['provisioning', 'active', 'failed']),
  message: z.string().max(2000).nullable().optional(),
  /** Where the gateway reaches the tagging servers, as the provisioner set them up. */
  upstreamUrl: z.url().optional(),
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Merges a partial settings object into the current one; arrays and scalars are replaced. */
function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

export function buildApi(deps: ApiDeps): { app: FastifyInstance; internal: FastifyInstance } {
  const { store } = deps;
  const liveData = deps.liveData ?? noLiveData;
  const registry = new Registry();
  if (deps.collectDefaultMetrics !== false) collectDefaultMetrics({ register: registry });

  const errorHandler = (error: Error & { statusCode?: number }, req: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({ error: 'invalid_request', issues: error.issues });
    }
    if (error instanceof HttpError)
      return reply.code(error.statusCode).send({ error: error.code, message: error.message });
    if (error.statusCode && error.statusCode < 500)
      return reply.code(error.statusCode).send({ error: error.message });
    req.log.error({ err: error }, 'request failed');
    return reply.code(500).send({ error: 'internal_error' });
  };

  const accounts = new Accounts(store, deps.superAdminEmails ?? []);
  const signInLimiter = new SignInLimiter();

  // A workspace the actor may not see answers 404 like a missing one, so ids cannot be probed.
  const canSee = (req: FastifyRequest, tenantId: string) =>
    !req.actor || req.actor.superAdmin || req.actor.roles.has(tenantId);
  const canManage = (req: FastifyRequest, tenantId: string) =>
    !req.actor || req.actor.superAdmin || req.actor.roles.get(tenantId) === 'owner';
  const ownersOnly = () => new HttpError(403, 'forbidden', 'Only owners of this workspace can do that.');

  /** Without a request this is the internal API's unrestricted lookup. */
  async function getContainerOr404(id: string, req?: FastifyRequest): Promise<Container> {
    const container = await store.getContainer(id);
    if (!container || (req && !canSee(req, container.tenantId))) throw notFound('Container');
    return container;
  }

  async function getTenantOr404(id: string, req: FastifyRequest): Promise<Tenant> {
    const tenant = await store.getTenant(id);
    if (!tenant || !canSee(req, id)) throw notFound('Workspace');
    return tenant;
  }

  /** The workspaces a user works in: their memberships, or every workspace for a super-admin. */
  async function workspacesOf(user: User, superAdmin: boolean) {
    const roles = new Map((await store.listUserMemberships(user.id)).map((m) => [m.tenantId, m.role]));
    const all = await store.listTenants();
    return all
      .filter((t) => superAdmin || roles.has(t.id))
      .map((t) => ({ ...t, role: roles.get(t.id) ?? null }));
  }

  async function sessionView(user: User) {
    const superAdmin = accounts.isSuperAdmin(user);
    return { user: userView(user, superAdmin), workspaces: await workspacesOf(user, superAdmin) };
  }

  async function assertNotLastOwner(tenantId: string, userId: string) {
    const owners = (await store.listTenantMembers(tenantId)).filter((m) => m.role === 'owner');
    if (owners.length === 1 && owners[0]!.userId === userId)
      throw new HttpError(409, 'last_owner', 'A workspace needs at least one owner.');
  }

  /** Re-publishes the routes of a container's verified domains after any change that affects them. */
  async function publishContainer(container: Container): Promise<void> {
    const domains = (await store.listDomains(container.id)).filter((d) => d.status === 'verified');
    await deps.publisher.publish(domains.map((d) => routeFor(container, d)));
  }

  // -------------------------------------------------------------------------------------------------------------
  // Public API (dashboard and admins)

  const app = Fastify({ logger: { level: deps.logLevel ?? 'info' } });
  app.setErrorHandler(errorHandler);

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_req, reply) => {
    try {
      await store.ping();
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'database_unavailable' });
    }
  });
  app.get('/metrics', async (_req, reply) =>
    reply.header('content-type', registry.contentType).send(await registry.metrics()),
  );

  app.register(
    async (v1) => {
      v1.decorateRequest('actor', null);
      v1.addHook('onRequest', async (req) => {
        if (!tokenMatches(req.headers.authorization, deps.adminApiKey))
          throw new HttpError(401, 'unauthorized');
        // The dashboard names the signed-in user; the API then limits the request to that user's workspaces.
        const userId = req.headers['x-sst-user'];
        if (typeof userId === 'string' && userId) {
          const user = await store.getUser(userId);
          if (!user) throw new HttpError(401, 'unknown_user');
          const memberships = await store.listUserMemberships(user.id);
          req.actor = {
            user,
            superAdmin: accounts.isSuperAdmin(user),
            roles: new Map(memberships.map((m) => [m.tenantId, m.role])),
          };
        }
      });

      /** Settings the dashboard shows customers, e.g. in DNS instructions. */
      v1.get('/platform', async () => ({ edgeHostname: deps.edgeHostname, edgeIpv4: deps.edgeIpv4 }));

      // Accounts (called by the dashboard's sign-in pages, without x-sst-user)

      v1.post('/auth/signup', async (req, reply) => {
        const body = signUpBody.parse(req.body);
        const user = await accounts.signUp(body);
        if (user === 'email_taken')
          throw new HttpError(
            409,
            'email_taken',
            'An account with this email already exists. Sign in instead.',
          );
        return reply.code(201).send(await sessionView(user));
      });

      v1.post('/auth/signin', async (req) => {
        const body = signInBody.parse(req.body);
        const keys = [
          `email:${normalizeEmail(body.email)}`,
          ...(body.clientIp ? [`ip:${body.clientIp}`] : []),
        ];
        if (signInLimiter.blocked(...keys))
          throw new HttpError(429, 'too_many_attempts', 'Too many failed sign-ins. Try again in 15 minutes.');
        const user = await accounts.signIn(body.email, body.password);
        if (!user) {
          signInLimiter.fail(...keys);
          throw new HttpError(401, 'invalid_credentials', 'Wrong email or password.');
        }
        signInLimiter.succeed(`email:${user.email}`);
        return sessionView(user);
      });

      v1.post('/auth/google', async (req) => {
        const user = await accounts.signInWithGoogle(googleBody.parse(req.body));
        if (user === 'email_not_verified')
          throw new HttpError(403, 'email_not_verified', 'Google has not verified this email address.');
        return sessionView(user);
      });

      v1.get('/me', async (req) => {
        if (!req.actor) throw new HttpError(400, 'no_user', 'Send x-sst-user.');
        return sessionView(req.actor.user);
      });

      // Workspaces

      v1.get('/tenants', async (req) => {
        if (!req.actor) return store.listTenants();
        return workspacesOf(req.actor.user, req.actor.superAdmin);
      });
      v1.post('/tenants', async (req, reply) => {
        const body = createTenantBody.parse(req.body);
        const tenant = await store.createTenant({ id: newId('tnt'), name: body.name, createdAt: new Date() });
        if (req.actor)
          await store.putMembership({
            userId: req.actor.user.id,
            tenantId: tenant.id,
            role: 'owner',
            createdAt: new Date(),
          });
        return reply.code(201).send(tenant);
      });
      v1.patch<{ Params: { id: string } }>('/tenants/:id', async (req) => {
        const tenant = await getTenantOr404(req.params.id, req);
        if (!canManage(req, tenant.id)) throw ownersOnly();
        return store.renameTenant(tenant.id, createTenantBody.parse(req.body).name);
      });

      v1.get<{ Params: { id: string } }>('/tenants/:id/members', async (req) => {
        const tenant = await getTenantOr404(req.params.id, req);
        const members = await store.listTenantMembers(tenant.id);
        return {
          members: members.map((m) => ({
            userId: m.userId,
            role: m.role,
            createdAt: m.createdAt,
            email: m.user.email,
            name: m.user.name,
            lastLoginAt: m.user.lastLoginAt,
          })),
          invites: await store.listInvites(tenant.id),
        };
      });

      /** Adds a user whose address Google verified at once; anyone else gets an invite, accepted at sign-in. */
      v1.post<{ Params: { id: string } }>('/tenants/:id/members', async (req, reply) => {
        const tenant = await getTenantOr404(req.params.id, req);
        if (!canManage(req, tenant.id)) throw ownersOnly();
        const body = addMemberBody.parse(req.body);
        const email = normalizeEmail(body.email);
        const user = await store.getUserByEmail(email);
        if (user?.emailVerified) {
          await store.putMembership({
            userId: user.id,
            tenantId: tenant.id,
            role: body.role,
            createdAt: new Date(),
          });
          return reply.code(201).send({ added: { userId: user.id, email, role: body.role } });
        }
        const invite = await store.putInvite({
          id: newId('inv'),
          tenantId: tenant.id,
          email,
          role: body.role,
          createdAt: new Date(),
        });
        return reply.code(201).send({ invited: invite });
      });

      v1.patch<{ Params: { id: string; userId: string } }>('/tenants/:id/members/:userId', async (req) => {
        const tenant = await getTenantOr404(req.params.id, req);
        if (!canManage(req, tenant.id)) throw ownersOnly();
        const { role } = patchMemberBody.parse(req.body);
        const member = (await store.listTenantMembers(tenant.id)).find((m) => m.userId === req.params.userId);
        if (!member) throw notFound('Member');
        if (role !== 'owner') await assertNotLastOwner(tenant.id, member.userId);
        await store.putMembership({ ...member, role });
        return { userId: member.userId, role };
      });

      /** Owners remove members; anyone may leave. */
      v1.delete<{ Params: { id: string; userId: string } }>(
        '/tenants/:id/members/:userId',
        async (req, reply) => {
          const tenant = await getTenantOr404(req.params.id, req);
          if (req.actor?.user.id !== req.params.userId && !canManage(req, tenant.id)) throw ownersOnly();
          await assertNotLastOwner(tenant.id, req.params.userId);
          await store.deleteMembership(req.params.userId, tenant.id);
          return reply.code(204).send();
        },
      );

      v1.delete<{ Params: { id: string; inviteId: string } }>(
        '/tenants/:id/invites/:inviteId',
        async (req, reply) => {
          const tenant = await getTenantOr404(req.params.id, req);
          if (!canManage(req, tenant.id)) throw ownersOnly();
          const invite = (await store.listInvites(tenant.id)).find((i) => i.id === req.params.inviteId);
          if (!invite) throw notFound('Invite');
          await store.deleteInvite(invite.id);
          return reply.code(204).send();
        },
      );

      // Containers

      v1.get('/containers', async (req) => {
        const { tenantId } = z.object({ tenantId: z.string().optional() }).parse(req.query);
        if (tenantId) await getTenantOr404(tenantId, req);
        const containers = (await store.listContainers(tenantId)).filter((c) => canSee(req, c.tenantId));
        return Promise.all(containers.map(async (c) => containerView(c, await store.listDomains(c.id))));
      });

      v1.post('/containers', async (req, reply) => {
        const body = createContainerBody.parse(req.body);
        if (!(await store.getTenant(body.tenantId)) || !canSee(req, body.tenantId)) throw notFound('Tenant');
        const gtmContainerId = parseConfigOr400(body.containerConfig);
        const id = newId('c');
        const now = new Date();
        const container = await store.createContainer({
          id,
          tenantId: body.tenantId,
          name: body.name,
          gtmContainerId,
          containerConfig: body.containerConfig.trim(),
          webContainerId: body.webContainerId ?? null,
          status: 'provisioning',
          statusMessage: null,
          upstreamUrl: deps.upstreamTemplate.replaceAll('{id}', id),
          loaderGtmPath: generateLoaderPath(),
          loaderGtagPath: generateLoaderPath(),
          webhookPath: DEFAULT_WEBHOOK_PATH,
          webhookSecret: newWebhookSecret(),
          powerUps: powerUpsSchema.parse(body.powerUps ?? {}),
          createdAt: now,
          updatedAt: now,
        });
        await deps.queue.enqueue({ type: 'apply', containerId: id });
        return reply.code(201).send({ ...containerView(container), webhookSecret: container.webhookSecret });
      });

      v1.get<{ Params: { id: string } }>('/containers/:id', async (req) => {
        const container = await getContainerOr404(req.params.id, req);
        return containerView(container, await store.listDomains(container.id));
      });

      v1.patch<{ Params: { id: string } }>('/containers/:id', async (req) => {
        const body = patchContainerBody.parse(req.body);
        const current = await getContainerOr404(req.params.id, req);
        const powerUps = body.powerUps
          ? powerUpsSchema.parse(
              deepMerge(current.powerUps as unknown as Record<string, unknown>, body.powerUps),
            )
          : undefined;
        if (current.status === 'deleting') throw new HttpError(409, 'container_deleting');
        const configChanged =
          body.containerConfig !== undefined && body.containerConfig.trim() !== current.containerConfig;
        const gtmContainerId = configChanged ? parseConfigOr400(body.containerConfig!) : undefined;
        const updated = await store.updateContainer(current.id, {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.webContainerId !== undefined && { webContainerId: body.webContainerId }),
          ...(powerUps && { powerUps }),
          ...(configChanged && {
            containerConfig: body.containerConfig!.trim(),
            gtmContainerId,
            status: 'provisioning' as const,
            statusMessage: 'Waiting for the provisioner',
          }),
        });
        await publishContainer(updated);
        if (configChanged) await deps.queue.enqueue({ type: 'apply', containerId: updated.id });
        return containerView(updated, await store.listDomains(updated.id));
      });

      /** Runs provisioning again, e.g. after a failure or to restart the tagging servers on a newer image. */
      v1.post<{ Params: { id: string } }>('/containers/:id/provision', async (req, reply) => {
        const current = await getContainerOr404(req.params.id, req);
        if (current.status === 'deleting') throw new HttpError(409, 'container_deleting');
        const updated = await store.updateContainer(current.id, {
          status: 'provisioning',
          statusMessage: 'Waiting for the provisioner',
        });
        await deps.queue.enqueue({ type: 'apply', containerId: updated.id });
        return reply.code(202).send(containerView(updated, await store.listDomains(updated.id)));
      });

      v1.delete<{ Params: { id: string } }>('/containers/:id', async (req, reply) => {
        const container = await getContainerOr404(req.params.id, req);
        const domains = await store.listDomains(container.id);
        // Stop routing first, so the gateway answers 404 instead of proxying to servers being removed.
        await deps.publisher.remove(domains.map((d) => d.hostname));
        await store.updateContainer(container.id, { status: 'deleting' });
        await deps.queue.enqueue({ type: 'delete', containerId: container.id });
        return reply.code(202).send({ id: container.id, status: 'deleting' });
      });

      v1.post<{ Params: { id: string } }>('/containers/:id/webhook-secret', async (req) => {
        const container = await getContainerOr404(req.params.id, req);
        const updated = await store.updateContainer(container.id, { webhookSecret: newWebhookSecret() });
        await publishContainer(updated);
        return { webhookPath: updated.webhookPath, webhookSecret: updated.webhookSecret };
      });

      v1.get<{ Params: { id: string } }>('/containers/:id/snippet', async (req) => {
        const container = await getContainerOr404(req.params.id, req);
        const domain = (await store.listDomains(container.id)).find((d) => d.status === 'verified');
        if (!domain) throw new HttpError(409, 'no_verified_domain', 'Verify a tracking domain first.');
        const route = routeFor(container, domain);
        const loaderOn = container.powerUps.customLoader.enabled;
        return {
          trackingHost: domain.hostname,
          serverContainerUrl: `https://${domain.hostname}`,
          customLoader: loaderOn,
          gtmHead: loaderOn && container.webContainerId ? gtmSnippet(domain.hostname, route) : null,
          gtagScriptUrl: loaderOn
            ? `https://${domain.hostname}${container.loaderGtagPath}?id=G-XXXXXXXXXX`
            : null,
          webhookUrl: `https://${domain.hostname}${container.webhookPath}`,
        };
      });

      /**
       * New random custom loader paths, e.g. after an ad blocker list picked up the old ones. Websites must update
       * their GTM snippet: the old paths stop working at once.
       */
      v1.post<{ Params: { id: string } }>('/containers/:id/loader-paths', async (req) => {
        const container = await getContainerOr404(req.params.id, req);
        const updated = await store.updateContainer(container.id, {
          loaderGtmPath: generateLoaderPath(),
          loaderGtagPath: generateLoaderPath(),
        });
        await publishContainer(updated);
        return { loaderGtmPath: updated.loaderGtmPath, loaderGtagPath: updated.loaderGtagPath };
      });

      v1.get<{ Params: { id: string } }>('/containers/:id/usage', async (req) => {
        const container = await getContainerOr404(req.params.id, req);
        const query = usageQuery.parse(req.query);
        const to = query.to ? new Date(query.to) : new Date();
        const from = query.from ? new Date(query.from) : new Date(to.getTime() - 7 * 86400_000);
        const rows = new Map(
          (await store.listUsage(container.id, from, to)).map((h) => [h.hour.getTime(), { ...h }]),
        );
        // Add what is still in Redis (the current hour), so the numbers are live rather than an hour behind.
        for (const { hour, counts } of await liveData.pendingUsage(container.id)) {
          if (hour < from || hour >= to) continue;
          const row = rows.get(hour.getTime()) ?? { containerId: container.id, hour, ...emptyCounts() };
          for (const [field, value] of Object.entries(counts) as [keyof UsageCounts, number][])
            row[field] += value;
          rows.set(hour.getTime(), row);
        }
        const hours = [...rows.values()].sort((a, b) => a.hour.getTime() - b.hour.getTime());
        const totals = emptyCounts();
        for (const h of hours)
          for (const key of Object.keys(totals) as (keyof UsageCounts)[]) totals[key] += h[key];
        return { containerId: container.id, from, to, totals, hours };
      });

      v1.get<{ Params: { id: string } }>('/containers/:id/logs', async (req) => {
        const container = await getContainerOr404(req.params.id, req);
        const { from, to, ...query } = logsQuery.parse(req.query);
        const entries = await liveData.recentLogs(container.id, {
          ...query,
          from: from ? new Date(from) : undefined,
          to: to ? new Date(to) : undefined,
        });
        return { available: liveData !== noLiveData, entries };
      });

      // Domains

      v1.get<{ Params: { id: string } }>('/containers/:id/domains', async (req) => {
        await getContainerOr404(req.params.id, req);
        return store.listDomains(req.params.id);
      });

      v1.post<{ Params: { id: string } }>('/containers/:id/domains', async (req, reply) => {
        const container = await getContainerOr404(req.params.id, req);
        const hostname = normalizeHost(createDomainBody.parse(req.body).hostname);
        if (!hostname) throw new HttpError(400, 'invalid_hostname');
        if (hostname === deps.edgeHostname)
          throw new HttpError(400, 'invalid_hostname', 'That is the platform edge.');
        let domain: Domain;
        try {
          domain = await store.createDomain({
            id: newId('dom'),
            containerId: container.id,
            hostname,
            status: 'pending',
            verifiedAt: null,
            lastCheckedAt: null,
            lastError: null,
            createdAt: new Date(),
          });
        } catch (error) {
          if (error instanceof DuplicateHostnameError) throw new HttpError(409, 'hostname_taken');
          throw error;
        }
        return reply.code(201).send({
          ...domain,
          dns: {
            recommended: { type: 'CNAME', name: hostname, value: deps.edgeHostname },
            alternative: deps.edgeIpv4.map((ip) => ({ type: 'A', name: hostname, value: ip })),
          },
        });
      });

      v1.post<{ Params: { id: string } }>('/domains/:id/verify', async (req) => {
        const domain = await store.getDomain(req.params.id);
        if (!domain) throw notFound('Domain');
        const container = await getContainerOr404(domain.containerId, req);
        const check = await checkDomainDns(
          domain.hostname,
          deps.edgeHostname,
          deps.edgeIpv4,
          deps.dnsResolver,
        );
        const now = new Date();
        if (!check.ok) {
          // A domain that was verified and now fails keeps routing; DNS hiccups must not stop tracking.
          const updated = await store.updateDomain(domain.id, { lastCheckedAt: now, lastError: check.error });
          return { ...updated, check };
        }
        const updated = await store.updateDomain(domain.id, {
          status: 'verified',
          verifiedAt: domain.verifiedAt ?? now,
          lastCheckedAt: now,
          lastError: null,
        });
        await deps.publisher.publish([routeFor(container, updated)]);
        return { ...updated, check };
      });

      v1.delete<{ Params: { id: string } }>('/domains/:id', async (req, reply) => {
        const domain = await store.getDomain(req.params.id);
        if (!domain) throw notFound('Domain');
        await getContainerOr404(domain.containerId, req);
        await store.deleteDomain(domain.id);
        await deps.publisher.remove([domain.hostname]);
        return reply.code(204).send();
      });
    },
    { prefix: '/v1' },
  );

  // -------------------------------------------------------------------------------------------------------------
  // Internal API (cluster only)

  const internal = Fastify({ logger: { level: deps.logLevel ?? 'info' } });
  internal.setErrorHandler(errorHandler);

  /**
   * Caddy's on-demand TLS asks here before obtaining a certificate for a new host name. Only verified domains get
   * one, so nobody can make the platform request certificates for arbitrary names. Caddy cannot send a token, so
   * this endpoint relies on the internal port not being reachable from outside.
   */
  internal.get('/internal/caddy/ask', async (req, reply) => {
    const host = normalizeHost((req.query as Record<string, string | undefined>).domain);
    const domain = host ? await store.getDomainByHostname(host) : null;
    return domain?.status === 'verified' ? reply.code(200).send() : reply.code(404).send();
  });

  internal.register(async (authed) => {
    authed.addHook('onRequest', async (req) => {
      if (!tokenMatches(req.headers.authorization, deps.internalApiToken))
        throw new HttpError(401, 'unauthorized');
    });

    /** The gateway's last-resort route lookup when its cache and Redis have nothing. */
    authed.get<{ Params: { host: string } }>('/internal/routes/:host', async (req) => {
      const host = normalizeHost(req.params.host);
      const domain = host ? await store.getDomainByHostname(host) : null;
      if (!domain || domain.status !== 'verified') throw notFound('Route');
      const container = await store.getContainer(domain.containerId);
      if (!container || container.status === 'deleting') throw notFound('Route');
      return routeFor(container, domain);
    });

    /** Full container record for the provisioner, including the Container Config. */
    authed.get<{ Params: { id: string } }>('/internal/containers/:id', async (req) =>
      getContainerOr404(req.params.id),
    );

    /** The provisioner reports progress here. */
    authed.post<{ Params: { id: string } }>('/internal/containers/:id/status', async (req) => {
      const body = statusBody.parse(req.body);
      const container = await getContainerOr404(req.params.id);
      // A late report from an apply job must not bring back a container that is being deleted.
      if (container.status === 'deleting') throw new HttpError(409, 'container_deleting');
      const updated = await store.updateContainer(container.id, {
        status: body.status,
        statusMessage: body.message ?? null,
        ...(body.upstreamUrl && { upstreamUrl: body.upstreamUrl }),
      });
      if (body.upstreamUrl && body.upstreamUrl !== container.upstreamUrl) await publishContainer(updated);
      return updated;
    });

    /** Called by the provisioner once a container's Kubernetes objects are gone. */
    authed.delete<{ Params: { id: string } }>('/internal/containers/:id', async (req, reply) => {
      await getContainerOr404(req.params.id);
      await store.deleteContainer(req.params.id);
      return reply.code(204).send();
    });
  });

  return { app, internal };
}

/** Writes every verified route to Redis, e.g. after Redis lost its data. */
export async function resyncRoutes(store: Store, publisher: RoutePublisher): Promise<number> {
  const routes = [];
  const containers = new Map<string, Container | null>();
  for (const domain of await store.listVerifiedDomains()) {
    if (!containers.has(domain.containerId))
      containers.set(domain.containerId, await store.getContainer(domain.containerId));
    const container = containers.get(domain.containerId);
    if (container && container.status !== 'deleting') routes.push(routeFor(container, domain));
  }
  await publisher.publish(routes);
  return routes.length;
}
