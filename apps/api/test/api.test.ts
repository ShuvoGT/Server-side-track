import { beforeEach, describe, expect, it } from 'vitest';
import type { ContainerRoute } from '@sst/shared';
import { buildApi, resyncRoutes } from '../src/app.js';
import { MemoryStore } from '../src/memoryStore.js';
import {
  checkDomainDns,
  LoggingProvisioningQueue,
  type DnsResolver,
  type RoutePublisher,
} from '../src/services.js';

const ADMIN = 'a'.repeat(32);
const INTERNAL = 'i'.repeat(32);
const CONFIG = Buffer.from('id=GTM-SRV1234&env=1&auth=abcDEF123').toString('base64');

class RecordingPublisher implements RoutePublisher {
  routes = new Map<string, ContainerRoute>();
  async publish(routes: ContainerRoute[]) {
    for (const r of routes) this.routes.set(r.hostname, r);
  }
  async remove(hosts: string[]) {
    for (const h of hosts) this.routes.delete(h);
  }
}

const dnsRecords: Record<string, { cname?: string[]; a?: string[] }> = {
  'sst.shop.com': { cname: ['edge.platform.test.'] },
  'sst.a-record.com': { a: ['198.51.100.7'] },
  'sst.wrong.com': { cname: ['somewhere.else.com'] },
};
const fakeDns: DnsResolver = {
  resolveCname: async (h) => dnsRecords[h]?.cname ?? Promise.reject(new Error('ENODATA')),
  resolve4: async (h) => dnsRecords[h]?.a ?? Promise.reject(new Error('ENOTFOUND')),
};

const liveData: LiveData = {
  recentLogs: async (_id, query) =>
    [
      { id: '2-0', time: '2026-10-13T09:01:00Z', path: '/g/collect' },
      { id: '1-0', time: '2026-10-13T09:00:00Z', path: '/abc.js' },
    ]
      .filter((e) => !query.before || e.id < query.before)
      .filter((e) => !query.from || new Date(e.time) >= query.from)
      .filter((e) => !query.to || new Date(e.time) <= query.to)
      .slice(0, query.limit) as never,
  pendingUsage: async () => [{ hour: new Date('2026-10-13T09:00:00Z'), counts: { requests: 4, errors: 1 } }],
};

function setup() {
  const store = new MemoryStore();
  const publisher = new RecordingPublisher();
  const queue = new LoggingProvisioningQueue();
  const { app, internal } = buildApi({
    store,
    publisher,
    queue,
    dnsResolver: fakeDns,
    liveData,
    adminApiKey: ADMIN,
    internalApiToken: INTERNAL,
    edgeHostname: 'edge.platform.test',
    edgeIpv4: ['198.51.100.7'],
    upstreamTemplate: 'http://tagging.ctr-{id}.svc.cluster.local:8080',
    logLevel: 'silent',
    collectDefaultMetrics: false,
    superAdminEmails: ['boss@ibos.io'],
  });
  const auth = { authorization: `Bearer ${ADMIN}` };
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) => {
    const res = await app.inject({ method, url, headers: auth, payload });
    return { status: res.statusCode, body: res.body ? res.json() : undefined };
  };
  return { app, internal, store, publisher, queue, call };
}

let t: ReturnType<typeof setup>;

async function createContainer(extra: object = {}) {
  const tenant = await t.call('POST', '/v1/tenants', { name: 'iBOS' });
  const res = await t.call('POST', '/v1/containers', {
    tenantId: tenant.body.id,
    name: 'Shop',
    containerConfig: CONFIG,
    webContainerId: 'GTM-WEB1234',
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.body;
}

async function addVerifiedDomain(containerId: string, hostname = 'sst.shop.com') {
  const domain = await t.call('POST', `/v1/containers/${containerId}/domains`, { hostname });
  expect(domain.status).toBe(201);
  const verified = await t.call('POST', `/v1/domains/${domain.body.id}/verify`);
  expect(verified.body.status).toBe('verified');
  return verified.body;
}

beforeEach(() => {
  t = setup();
});

describe('authentication', () => {
  it('requires the admin key on /v1 and the internal token on routes', async () => {
    expect((await t.app.inject({ url: '/v1/tenants' })).statusCode).toBe(401);
    expect(
      (await t.app.inject({ url: '/v1/tenants', headers: { authorization: 'Bearer wrong' } })).statusCode,
    ).toBe(401);
    expect((await t.app.inject({ url: '/healthz' })).statusCode).toBe(200);
    expect((await t.internal.inject({ url: '/internal/routes/sst.shop.com' })).statusCode).toBe(401);
  });
});

describe('containers', () => {
  it('creates a container from a Container Config and queues provisioning', async () => {
    const c = await createContainer();
    expect(c.id).toMatch(/^c[a-z0-9]{12}$/);
    expect(c.gtmContainerId).toBe('GTM-SRV1234');
    expect(c.status).toBe('provisioning');
    expect(c.upstreamUrl).toBe(`http://tagging.ctr-${c.id}.svc.cluster.local:8080`);
    expect(c.loaderGtmPath).toMatch(/^\/[a-z0-9]{10}\.js$/);
    expect(c.webhookSecret).toHaveLength(43);
    expect(c.containerConfig).toBeUndefined();
    expect(c.powerUps.botDetection.mode).toBe('flag');
    expect(t.queue.jobs).toEqual([{ type: 'apply', containerId: c.id }]);

    const fetched = await t.call('GET', `/v1/containers/${c.id}`);
    expect(fetched.body.webhookSecret).toBeUndefined();
  });

  it('rejects an invalid Container Config or unknown tenant', async () => {
    const tenant = await t.call('POST', '/v1/tenants', { name: 'x' });
    const bad = await t.call('POST', '/v1/containers', {
      tenantId: tenant.body.id,
      name: 'x',
      containerConfig: 'abc',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_container_config');
    const noTenant = await t.call('POST', '/v1/containers', {
      tenantId: 'nope',
      name: 'x',
      containerConfig: CONFIG,
    });
    expect(noTenant.status).toBe(404);
    const invalid = await t.call('POST', '/v1/containers', { name: 'x' });
    expect(invalid.status).toBe(400);
  });

  it('merges power-up changes and republishes routes', async () => {
    const c = await createContainer();
    await addVerifiedDomain(c.id);
    const res = await t.call('PATCH', `/v1/containers/${c.id}`, {
      powerUps: { cookieKeeper: { enabled: true }, botDetection: { mode: 'drop' } },
    });
    expect(res.status).toBe(200);
    expect(res.body.powerUps.cookieKeeper).toMatchObject({ enabled: true, maxAgeDays: 400 });
    expect(res.body.powerUps.botDetection).toEqual({ mode: 'drop', blockedIps: [] });
    expect(t.publisher.routes.get('sst.shop.com')!.powerUps.cookieKeeper.enabled).toBe(true);

    const invalid = await t.call('PATCH', `/v1/containers/${c.id}`, {
      powerUps: { botDetection: { mode: 'maybe' } },
    });
    expect(invalid.status).toBe(400);
  });

  it('replaces the Container Config and queues provisioning again', async () => {
    const c = await createContainer();
    const newConfig = Buffer.from('id=GTM-NEW5678&env=2&auth=xyz').toString('base64');
    const res = await t.call('PATCH', `/v1/containers/${c.id}`, { containerConfig: newConfig });
    expect(res.body).toMatchObject({ gtmContainerId: 'GTM-NEW5678', status: 'provisioning' });
    expect((await t.store.getContainer(c.id))!.containerConfig).toBe(newConfig);
    expect(t.queue.jobs).toEqual([
      { type: 'apply', containerId: c.id },
      { type: 'apply', containerId: c.id },
    ]);

    // The same config again changes nothing; an invalid one is refused.
    await t.call('PATCH', `/v1/containers/${c.id}`, { containerConfig: newConfig });
    expect(t.queue.jobs).toHaveLength(2);
    const bad = await t.call('PATCH', `/v1/containers/${c.id}`, { containerConfig: 'nope' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_container_config');
  });

  it('provisions again on request', async () => {
    const c = await createContainer();
    await t.internal.inject({
      method: 'POST',
      url: `/internal/containers/${c.id}/status`,
      headers: { authorization: `Bearer ${INTERNAL}` },
      payload: { status: 'failed', message: 'boom' },
    });
    const res = await t.call('POST', `/v1/containers/${c.id}/provision`);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('provisioning');
    expect(t.queue.jobs.at(-1)).toEqual({ type: 'apply', containerId: c.id });
  });

  it('removes routes and queues deletion', async () => {
    const c = await createContainer();
    await addVerifiedDomain(c.id);
    const res = await t.call('DELETE', `/v1/containers/${c.id}`);
    expect(res.status).toBe(202);
    expect(t.publisher.routes.size).toBe(0);
    expect(t.queue.jobs.at(-1)).toEqual({ type: 'delete', containerId: c.id });
    const route = await t.internal.inject({
      url: '/internal/routes/sst.shop.com',
      headers: { authorization: `Bearer ${INTERNAL}` },
    });
    expect(route.statusCode).toBe(404);
  });
});

describe('domains', () => {
  it('gives DNS instructions, verifies, publishes the route and allows a certificate', async () => {
    const c = await createContainer();
    const created = await t.call('POST', `/v1/containers/${c.id}/domains`, { hostname: 'SST.Shop.com' });
    expect(created.body.hostname).toBe('sst.shop.com');
    expect(created.body.status).toBe('pending');
    expect(created.body.dns.recommended).toEqual({
      type: 'CNAME',
      name: 'sst.shop.com',
      value: 'edge.platform.test',
    });

    const ask = () => t.internal.inject({ url: '/internal/caddy/ask?domain=sst.shop.com' });
    expect((await ask()).statusCode).toBe(404);

    const verified = await t.call('POST', `/v1/domains/${created.body.id}/verify`);
    expect(verified.body.check).toEqual({ ok: true, method: 'cname' });
    expect((await ask()).statusCode).toBe(200);

    const route = t.publisher.routes.get('sst.shop.com')!;
    expect(route).toMatchObject({
      containerId: c.id,
      upstreamUrl: c.upstreamUrl,
      loader: { webContainerId: 'GTM-WEB1234' },
    });

    const internalRoute = await t.internal.inject({
      url: '/internal/routes/sst.shop.com',
      headers: { authorization: `Bearer ${INTERNAL}` },
    });
    expect(internalRoute.json()).toEqual(route);
  });

  it('keeps a domain pending when DNS is wrong, and refuses duplicates', async () => {
    const c = await createContainer();
    const d = await t.call('POST', `/v1/containers/${c.id}/domains`, { hostname: 'sst.wrong.com' });
    const res = await t.call('POST', `/v1/domains/${d.body.id}/verify`);
    expect(res.body.status).toBe('pending');
    expect(res.body.lastError).toContain('expected edge.platform.test');
    expect(t.publisher.routes.size).toBe(0);

    const dup = await t.call('POST', `/v1/containers/${c.id}/domains`, { hostname: 'sst.wrong.com' });
    expect(dup.status).toBe(409);
    const bad = await t.call('POST', `/v1/containers/${c.id}/domains`, { hostname: 'not a host' });
    expect(bad.status).toBe(400);
  });

  it('deletes a domain and its route', async () => {
    const c = await createContainer();
    const d = await addVerifiedDomain(c.id);
    expect((await t.call('DELETE', `/v1/domains/${d.id}`)).status).toBe(204);
    expect(t.publisher.routes.size).toBe(0);
  });
});

describe('checkDomainDns', () => {
  it('accepts A records on edge addresses with a warning', async () => {
    const res = await checkDomainDns('sst.a-record.com', 'edge.platform.test', ['198.51.100.7'], fakeDns);
    expect(res).toMatchObject({ ok: true, method: 'a' });
    expect(await checkDomainDns('missing.com', 'edge.platform.test', [], fakeDns)).toMatchObject({
      ok: false,
    });
  });
});

describe('snippet, webhook secret, usage and provisioner status', () => {
  it('returns the GTM snippet for the verified domain', async () => {
    const c = await createContainer();
    expect((await t.call('GET', `/v1/containers/${c.id}/snippet`)).status).toBe(409);
    await addVerifiedDomain(c.id);
    const res = await t.call('GET', `/v1/containers/${c.id}/snippet`);
    expect(res.body.serverContainerUrl).toBe('https://sst.shop.com');
    expect(res.body.gtmHead).toContain(`https://sst.shop.com${c.loaderGtmPath}`);
    expect(res.body.webhookUrl).toBe('https://sst.shop.com/sst/woocommerce');
  });

  it('generates new loader paths and respects the custom loader switch', async () => {
    const c = await createContainer();
    await addVerifiedDomain(c.id);
    const res = await t.call('POST', `/v1/containers/${c.id}/loader-paths`);
    expect(res.body.loaderGtmPath).toMatch(/^[/][a-z0-9]{10}[.]js$/);
    expect(res.body.loaderGtmPath).not.toBe(c.loaderGtmPath);
    expect(t.publisher.routes.get('sst.shop.com')!.loader.gtmPath).toBe(res.body.loaderGtmPath);

    await t.call('PATCH', `/v1/containers/${c.id}`, { powerUps: { customLoader: { enabled: false } } });
    const snippet = await t.call('GET', `/v1/containers/${c.id}/snippet`);
    expect(snippet.body).toMatchObject({ customLoader: false, gtmHead: null, gtagScriptUrl: null });
    expect(t.publisher.routes.get('sst.shop.com')!.powerUps.customLoader.enabled).toBe(false);
  });

  it('rotates the webhook secret and republishes', async () => {
    const c = await createContainer();
    await addVerifiedDomain(c.id);
    const res = await t.call('POST', `/v1/containers/${c.id}/webhook-secret`);
    expect(res.body.webhookSecret).not.toBe(c.webhookSecret);
    expect(t.publisher.routes.get('sst.shop.com')!.webhook!.secret).toBe(res.body.webhookSecret);
  });

  it('reports usage totals', async () => {
    const c = await createContainer();
    await t.store.addUsage(c.id, new Date('2026-10-13T08:00:00Z'), { requests: 10, loader: 2 });
    await t.store.addUsage(c.id, new Date('2026-10-13T09:00:00Z'), { requests: 5 });
    await t.store.addUsage(c.id, new Date('2026-10-13T09:00:00Z'), { requests: 1, botDropped: 3 });
    const res = await t.call(
      'GET',
      `/v1/containers/${c.id}/usage?from=2026-10-13T00:00:00Z&to=2026-10-14T00:00:00Z`,
    );
    // 16 rolled up, plus 4 requests and 1 error still in Redis for 09:00.
    expect(res.body.totals).toEqual({
      requests: 20,
      loader: 2,
      webhook: 0,
      botFlagged: 0,
      botDropped: 3,
      errors: 1,
    });
    expect(res.body.hours).toHaveLength(2);
  });

  it('returns request logs newest first, with paging', async () => {
    const c = await createContainer();
    const res = await t.call('GET', `/v1/containers/${c.id}/logs?limit=1`);
    expect(res.body.available).toBe(true);
    expect(res.body.entries.map((e: { id: string }) => e.id)).toEqual(['2-0']);
    const next = await t.call('GET', `/v1/containers/${c.id}/logs?before=2-0`);
    expect(next.body.entries.map((e: { id: string }) => e.id)).toEqual(['1-0']);
    expect((await t.call('GET', `/v1/containers/${c.id}/logs?before=bad`)).status).toBe(400);
  });

  it('filters request logs by a time window', async () => {
    const c = await createContainer();
    const logs = (q: string) => t.call('GET', `/v1/containers/${c.id}/logs?${q}`);
    const ids = (res: { body: { entries: { id: string }[] } }) => res.body.entries.map((e) => e.id);
    expect(ids(await logs('from=2026-10-13T09:00:30Z'))).toEqual(['2-0']);
    expect(ids(await logs('to=2026-10-13T09:00:30Z'))).toEqual(['1-0']);
    expect(ids(await logs('from=2026-10-13T09:00:00Z&to=2026-10-13T09:01:00Z'))).toEqual(['2-0', '1-0']);
    expect((await logs('from=2026-10-13T10:00:00Z&to=2026-10-13T09:00:00Z')).status).toBe(400);
    expect((await logs('from=yesterday')).status).toBe(400);
  });

  it('lets the provisioner report status and resync routes', async () => {
    const c = await createContainer();
    await addVerifiedDomain(c.id);
    const res = await t.internal.inject({
      method: 'POST',
      url: `/internal/containers/${c.id}/status`,
      headers: { authorization: `Bearer ${INTERNAL}` },
      payload: { status: 'active' },
    });
    expect(res.json().status).toBe('active');
    t.publisher.routes.clear();
    expect(await resyncRoutes(t.store, t.publisher)).toBe(1);
    expect(t.publisher.routes.has('sst.shop.com')).toBe(true);
  });

  it('takes the upstream URL from the provisioner and republishes the route', async () => {
    const c = await createContainer();
    await addVerifiedDomain(c.id);
    const report = (payload: object) =>
      t.internal.inject({
        method: 'POST',
        url: `/internal/containers/${c.id}/status`,
        headers: { authorization: `Bearer ${INTERNAL}` },
        payload,
      });
    const res = await report({ status: 'active', upstreamUrl: 'http://127.0.0.1:49153' });
    expect(res.json().upstreamUrl).toBe('http://127.0.0.1:49153');
    expect(t.publisher.routes.get('sst.shop.com')!.upstreamUrl).toBe('http://127.0.0.1:49153');

    // Once deletion has started, late reports from an apply job are refused.
    await t.call('DELETE', `/v1/containers/${c.id}`);
    expect((await report({ status: 'active' })).statusCode).toBe(409);
  });
});

describe('accounts and workspaces', () => {
  const as = async (
    userId: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) => {
    const res = await t.app.inject({
      method,
      url,
      payload,
      headers: { authorization: `Bearer ${ADMIN}`, 'x-sst-user': userId },
    });
    return { status: res.statusCode, body: res.body ? res.json() : undefined };
  };
  const signUp = async (email: string, password = 'correct horse') => {
    const res = await t.call('POST', '/v1/auth/signup', { email, password, name: email.split('@')[0] });
    expect(res.status).toBe(201);
    return res.body as {
      user: { id: string; superAdmin: boolean };
      workspaces: { id: string; role: string }[];
    };
  };
  const signIn = (email: string, password: string) => t.call('POST', '/v1/auth/signin', { email, password });
  const google = (sub: string, email: string, emailVerified = true) =>
    t.call('POST', '/v1/auth/google', { sub, email, emailVerified, name: 'G User' });
  const newContainer = (userId: string, tenantId: string) =>
    as(userId, 'POST', '/v1/containers', { tenantId, name: 'Site', containerConfig: CONFIG });

  it('signs up with a workspace of its own, and signs in', async () => {
    const a = await signUp('Ana@Example.com');
    expect(a.workspaces).toHaveLength(1);
    expect(a.workspaces[0]!.role).toBe('owner');
    const again = await t.call('POST', '/v1/auth/signup', {
      email: 'ana@example.com',
      password: 'another pw',
    });
    expect(again.status).toBe(409);
    const short = await t.call('POST', '/v1/auth/signup', { email: 'b@example.com', password: 'short' });
    expect(short.status).toBe(400);

    expect((await signIn('ana@example.com', 'nope nope')).status).toBe(401);
    const ok = await signIn(' ANA@example.com', 'correct horse');
    expect(ok.status).toBe(200);
    expect(ok.body.user.id).toBe(a.user.id);
    expect(ok.body.user.passwordHash).toBeUndefined();
  });

  it('blocks an address after ten failed sign-ins', async () => {
    await signUp('c@example.com');
    for (let i = 0; i < 10; i++) await signIn('c@example.com', 'wrong guess');
    expect((await signIn('c@example.com', 'correct horse')).status).toBe(429);
  });

  it('keeps the containers of a workspace to its members', async () => {
    const a = await signUp('a@example.com');
    const b = await signUp('b@example.com');
    const wsA = a.workspaces[0]!.id;
    const created = await newContainer(a.user.id, wsA);
    expect(created.status).toBe(201);
    const id = created.body.id;

    expect((await as(a.user.id, 'GET', `/v1/containers/${id}`)).status).toBe(200);
    expect((await as(b.user.id, 'GET', `/v1/containers/${id}`)).status).toBe(404);
    expect((await as(b.user.id, 'GET', `/v1/containers/${id}/logs`)).status).toBe(404);
    expect(
      (await as(b.user.id, 'POST', `/v1/containers/${id}/domains`, { hostname: 'x.b.com' })).status,
    ).toBe(404);
    expect((await as(b.user.id, 'DELETE', `/v1/containers/${id}`)).status).toBe(404);
    expect((await as(b.user.id, 'GET', '/v1/containers')).body).toEqual([]);
    expect((await as(b.user.id, 'GET', `/v1/containers?tenantId=${wsA}`)).status).toBe(404);
    expect((await newContainer(b.user.id, wsA)).status).toBe(404);
    const visible = (await as(b.user.id, 'GET', '/v1/tenants')).body as { id: string }[];
    expect(visible.map((w) => w.id)).toEqual([b.workspaces[0]!.id]);

    const domain = await as(a.user.id, 'POST', `/v1/containers/${id}/domains`, { hostname: 'sst.a.com' });
    expect((await as(b.user.id, 'POST', `/v1/domains/${domain.body.id}/verify`)).status).toBe(404);
    expect((await as(b.user.id, 'DELETE', `/v1/domains/${domain.body.id}`)).status).toBe(404);
    expect(await t.store.getDomain(domain.body.id)).not.toBeNull();
  });

  it('links Google to an account by verified address, and takes over unproven ones', async () => {
    const squatter = await signUp('victim@example.com', 'squatter pw');
    const g = await google('g-1', 'victim@example.com');
    expect(g.status).toBe(200);
    expect(g.body.user.id).toBe(squatter.user.id);
    expect(g.body.user.hasPassword).toBe(false);
    expect((await signIn('victim@example.com', 'squatter pw')).status).toBe(401);

    expect((await google('g-2', 'new@example.com', false)).status).toBe(403);
    expect((await google('g-3', 'new@example.com')).body.workspaces).toHaveLength(1);
  });

  it('adds verified users at once and invites others, accepted at a Google sign-in', async () => {
    const owner = await signUp('owner@example.com');
    const ws = owner.workspaces[0]!.id;
    const invited = await as(owner.user.id, 'POST', `/v1/tenants/${ws}/members`, {
      email: 'Guest@Example.com',
    });
    expect(invited.body.invited.email).toBe('guest@example.com');

    // A password sign-up cannot prove the address, so it does not get the invite.
    const pw = await signUp('guest@example.com');
    expect(pw.workspaces.map((w) => w.id)).not.toContain(ws);
    const g = await google('g-guest', 'guest@example.com');
    expect(g.body.workspaces.map((w: { id: string }) => w.id)).toContain(ws);

    const members = await as(owner.user.id, 'GET', `/v1/tenants/${ws}/members`);
    expect(members.body.members.map((m: { email: string }) => m.email).sort()).toEqual([
      'guest@example.com',
      'owner@example.com',
    ]);
    expect(members.body.invites).toEqual([]);

    // Members cannot manage the workspace; the last owner cannot leave.
    const guestId = g.body.user.id;
    expect((await as(guestId, 'POST', `/v1/tenants/${ws}/members`, { email: 'x@example.com' })).status).toBe(
      403,
    );
    expect((await as(owner.user.id, 'DELETE', `/v1/tenants/${ws}/members/${owner.user.id}`)).status).toBe(
      409,
    );
    expect((await as(guestId, 'DELETE', `/v1/tenants/${ws}/members/${guestId}`)).status).toBe(204);
  });

  it('gives super-admins every workspace once Google verified them, and the ones nobody owned', async () => {
    const legacy = await t.call('POST', '/v1/tenants', { name: 'From before accounts' });
    const other = await signUp('someone@example.com');

    const pw = await signUp('boss@ibos.io');
    expect(pw.user.superAdmin).toBe(false);
    expect(pw.workspaces.map((w) => w.id)).not.toContain(legacy.body.id);

    const g = await google('g-boss', 'boss@ibos.io');
    expect(g.body.user.superAdmin).toBe(true);
    const workspaces = g.body.workspaces as { id: string; role: string | null }[];
    expect(workspaces.map((w) => w.id)).toEqual(
      expect.arrayContaining([legacy.body.id, other.workspaces[0]!.id]),
    );
    expect(workspaces.find((w) => w.id === legacy.body.id)!.role).toBe('owner');
    expect((await newContainer(g.body.user.id, other.workspaces[0]!.id)).status).toBe(201);
  });
});
