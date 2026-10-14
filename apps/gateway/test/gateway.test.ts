import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  containerRouteSchema,
  RedisKeys,
  signWebhook,
  type ContainerRoute,
  type PowerUpsInput,
} from '@sst/shared';
import { buildGateway } from '../src/app.js';
import { UsageCounters } from '../src/counters.js';
import { LoaderCache } from '../src/loaderCache.js';
import { createMetrics } from '../src/metrics.js';
import { RequestLogBuffer, ga4EventNames } from '../src/requestLog.js';
import { RouteResolver, type RouteSource } from '../src/routeResolver.js';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const SECRET = 's'.repeat(40);

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

let upstream: Server;
let upstreamUrl: string;
let seen: Seen[] = [];
let gtmHits = 0;
// Stands in for www.googletagmanager.com in the gtag.js fallback.
let google: Server;
let googleUrl: string;
let googleSeen: string[] = [];

beforeAll(async () => {
  upstream = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({
        method: req.method!,
        url: req.url!,
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      });
      if (req.url!.startsWith('/gtm.js')) {
        gtmHits++;
        res.writeHead(200, {
          'content-type': 'application/javascript',
          'cache-control': 'private, max-age=900',
        });
        return res.end(`/* gtm ${req.url} */`);
      }
      if (req.url!.startsWith('/gtag/js')) {
        // The tagging server serves gtag.js only for G-SERVED; it refuses other ids, as a misconfigured client would.
        if (req.url!.includes('id=G-SERVED')) {
          res.writeHead(200, { 'content-type': 'application/javascript' });
          return res.end('/* gtag from tagging server */');
        }
        res.writeHead(400);
        return res.end();
      }
      if (req.url!.startsWith('/g/collect')) {
        res.writeHead(204, { 'set-cookie': ['FPID=abc; Path=/; HttpOnly', '_fbp=fresh; Path=/'] });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'application/json', connection: 'keep-alive' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;

  google = createServer((req, res) => {
    googleSeen.push(req.url!);
    if (req.url!.includes('id=G-UNKNOWN')) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'application/javascript; charset=UTF-8', 'set-cookie': 'NID=x' });
    res.end(`/* gtag from google ${req.url} */`);
  });
  await new Promise<void>((resolve) => google.listen(0, '127.0.0.1', resolve));
  googleUrl = `http://127.0.0.1:${(google.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  await new Promise<void>((resolve) => google.close(() => resolve()));
});

beforeEach(() => {
  seen = [];
  gtmHits = 0;
  googleSeen = [];
});

function makeRoute(powerUps: PowerUpsInput = {}, overrides: Partial<ContainerRoute> = {}): ContainerRoute {
  return containerRouteSchema.parse({
    hostname: 'sst.shop.com',
    containerId: 'ctr_1',
    gtmContainerId: 'GTM-SERVER1',
    upstreamUrl,
    loader: { webContainerId: 'GTM-WEB1234', gtmPath: '/abc123def4.js', gtagPath: '/xyz789uvw0.js' },
    webhook: { path: '/sst/woocommerce', secret: SECRET },
    powerUps,
    ...overrides,
  });
}

function setup(route: ContainerRoute | null, sourceOverride?: RouteSource) {
  const source: RouteSource = sourceOverride ?? {
    name: 'static',
    get: async (host) => (route && host === route.hostname ? route : null),
  };
  const counters = new UsageCounters(() => new Date('2026-10-13T09:00:00Z'));
  const metrics = createMetrics(false);
  const requestLog = new RequestLogBuffer();
  const app = buildGateway(
    {
      logLevel: 'silent',
      trustedProxyHops: 1,
      upstreamTimeoutMs: 30_000,
      bodyLimitBytes: 1_048_576,
      googleScriptOrigin: googleUrl,
    },
    {
      resolver: new RouteResolver([source], { ttlMs: 30_000, negativeTtlMs: 5_000 }),
      counters,
      loaderCache: new LoaderCache(60_000),
      metrics,
      geo: (ip) => (ip === '103.0.0.10' ? { country: 'BD', region: 'BD-C', city: 'Dhaka' } : null),
      globalBotLists: [],
      requestLog,
    },
  );
  const usage = () =>
    Object.fromEntries(counters.snapshot().get(RedisKeys.usage('ctr_1', '2026101309')) ?? []);
  return { app, usage, requestLog };
}

const visitor = { host: 'sst.shop.com', 'user-agent': CHROME_UA, 'x-forwarded-for': '103.0.0.10' };

describe('routing', () => {
  it('rejects unknown and invalid hosts', async () => {
    const { app } = setup(makeRoute());
    expect(
      (await app.inject({ url: '/g/collect', headers: { ...visitor, host: 'other.com' } })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: '/g/collect', headers: { ...visitor, host: 'bad_host' } })).statusCode,
    ).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it('returns 502 when the tagging server is unreachable', async () => {
    const { app, usage } = setup(makeRoute({}, { upstreamUrl: 'http://127.0.0.1:1' }));
    const res = await app.inject({ url: '/g/collect', headers: visitor });
    expect(res.statusCode).toBe(502);
    expect(usage().errors).toBe(1);
  });

  it('keeps serving the last known route when every source fails', async () => {
    let fail = false;
    let now = 0;
    const route = makeRoute();
    const resolver = new RouteResolver(
      [{ name: 'flaky', get: async () => (fail ? Promise.reject(new Error('down')) : route) }],
      { ttlMs: 10, negativeTtlMs: 10 },
      () => now,
    );
    expect(await resolver.resolve('sst.shop.com')).toBe(route);
    fail = true;
    now = 1_000;
    expect(await resolver.resolve('sst.shop.com')).toBe(route);
    expect(await resolver.resolve('unknown.com')).toBeNull();
  });
});

describe('tracking requests', () => {
  it('forwards with the original host, client IP and enrichment headers, stripping spoofed ones', async () => {
    const { app, usage } = setup(makeRoute());
    const res = await app.inject({
      method: 'POST',
      url: '/g/collect?v=2&tid=G-ABCD1234&en=page_view',
      headers: { ...visitor, 'x-sst-geo-country': 'US', 'content-type': 'text/plain' },
      payload: 'en=scroll',
    });
    expect(res.statusCode).toBe(204);
    const req = seen[0]!;
    expect(req.url).toBe('/g/collect?v=2&tid=G-ABCD1234&en=page_view');
    expect(req.body).toBe('en=scroll');
    expect(req.headers.host).toBe('sst.shop.com');
    expect(req.headers['x-forwarded-for']).toBe('103.0.0.10');
    expect(req.headers['x-sst-geo-country']).toBe('BD');
    expect(req.headers['x-sst-geo-city']).toBe('Dhaka');
    expect(req.headers['x-sst-device-browser']).toBe('Chrome');
    expect(req.headers['x-sst-device-type']).toBe('desktop');
    expect(req.headers['x-sst-bot']).toBe('0');
    expect(req.headers['x-request-id']).toBeTruthy();
    expect(res.headers['set-cookie']).toEqual(['FPID=abc; Path=/; HttpOnly', '_fbp=fresh; Path=/']);
    expect(usage()).toEqual({ requests: 1 });
  });

  it('drops or flags bots depending on the mode', async () => {
    const bot = { ...visitor, 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' };
    const drop = setup(makeRoute({ botDetection: { mode: 'drop' } }));
    const dropped = await drop.app.inject({ url: '/g/collect', headers: bot });
    expect(dropped.statusCode).toBe(204);
    expect(seen).toHaveLength(0);
    expect(drop.usage()).toEqual({ bot_dropped: 1 });

    const flag = setup(makeRoute({ botDetection: { mode: 'flag', blockedIps: ['103.0.0.0/24'] } }));
    await flag.app.inject({ url: '/g/collect', headers: visitor });
    expect(seen[0]!.headers['x-sst-bot']).toBe('1');
    expect(seen[0]!.headers['x-sst-bot-reason']).toBe('ip-list');
  });

  it('anonymizes GA4 hits when the anonymizer is on', async () => {
    const { app } = setup(makeRoute({ anonymizer: { enabled: true } }));
    await app.inject({
      method: 'POST',
      url: '/g/collect?v=2&uid=user-7&dl=https%3A%2F%2Fshop.com%2F%3Femail%3Da%2540b.com',
      headers: visitor,
      payload: 'en=login&ep.mail=a%40b.com',
    });
    const req = seen[0]!;
    const query = new URL(req.url, 'http://x').searchParams;
    expect(query.get('uid')).toBeNull();
    expect(query.get('dl')).toBe('https://shop.com/?email=%5Bredacted%5D');
    expect(req.body).toBe('en=login&ep.mail=%5Bredacted%5D');
    expect(req.headers['x-forwarded-for']).toBe('103.0.0.0');
  });

  it('keeps marketing cookies alive with the cookie keeper', async () => {
    const { app } = setup(makeRoute({ cookieKeeper: { enabled: true } }));
    const res = await app.inject({
      url: '/g/collect?v=2&gcs=G111',
      headers: { ...visitor, cookie: '_fbp=old; _fbc=fb.1.click; _ga=GA1.1.1' },
    });
    const cookies = res.headers['set-cookie'] as string[];
    // The tagging server set _fbp itself, so the gateway leaves it alone and extends the others.
    expect(cookies.filter((c) => c.startsWith('_fbp='))).toEqual(['_fbp=fresh; Path=/']);
    expect(cookies.some((c) => c.startsWith('_fbc=fb.1.click;') && c.includes('Domain=shop.com'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('_ga=GA1.1.1;') && c.includes('Max-Age=34560000'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('_sst_ck=') && c.includes('HttpOnly'))).toBe(true);
  });
});

describe('custom loader', () => {
  it('serves gtm.js for the web container from a disguised path and caches it', async () => {
    const { app, usage } = setup(makeRoute());
    const first = await app.inject({ url: '/abc123def4.js?l=myLayer', headers: visitor });
    expect(first.statusCode).toBe(200);
    expect(first.body).toBe('/* gtm /gtm.js?l=myLayer&id=GTM-WEB1234 */');
    expect(first.headers['x-sst-cache']).toBe('MISS');
    const second = await app.inject({ url: '/abc123def4.js?l=myLayer', headers: visitor });
    expect(second.headers['x-sst-cache']).toBe('HIT');
    expect(second.body).toBe(first.body);
    expect(gtmHits).toBe(1);
    expect(usage()).toEqual({ loader: 2 });
  });

  it('never caches preview builds', async () => {
    const { app } = setup(makeRoute());
    await app.inject({ url: '/abc123def4.js?gtm_auth=x&gtm_preview=env-5', headers: visitor });
    await app.inject({ url: '/abc123def4.js?gtm_auth=x&gtm_preview=env-5', headers: visitor });
    expect(gtmHits).toBe(2);
  });
});

describe('WooCommerce webhook', () => {
  const body = '{"event_name":"purchase","transaction_id":"1052"}';

  it('forwards correctly signed requests with a verified marker', async () => {
    const { app, usage } = setup(makeRoute());
    const ts = Math.floor(Date.now() / 1000);
    const res = await app.inject({
      method: 'POST',
      url: '/sst/woocommerce',
      headers: {
        ...visitor,
        'content-type': 'application/json',
        'x-sst-timestamp': String(ts),
        'x-sst-signature': signWebhook(SECRET, ts, body),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(seen[0]!.body).toBe(body);
    expect(seen[0]!.headers['x-sst-webhook-verified']).toBe('ctr_1');
    expect(seen[0]!.headers['x-sst-signature']).toBeUndefined();
    expect(usage()).toEqual({ webhook: 1 });
  });

  it('rejects bad signatures without forwarding', async () => {
    const { app } = setup(makeRoute());
    const res = await app.inject({
      method: 'POST',
      url: '/sst/woocommerce',
      headers: {
        ...visitor,
        'x-sst-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-sst-signature': 'ab'.repeat(32),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    expect(seen).toHaveLength(0);
  });
});

describe('request log', () => {
  it('records one entry per request without IPs or query strings', async () => {
    const { app, requestLog } = setup(makeRoute({ botDetection: { mode: 'drop' } }));
    await app.inject({
      method: 'POST',
      url: '/g/collect?v=2&en=page_view&dl=https%3A%2F%2Fshop.com%2F%3Femail%3Dx',
      headers: visitor,
      payload: 'en=scroll\nen=purchase',
    });
    await app.inject({ url: '/abc123def4.js', headers: visitor });
    await app.inject({ url: '/g/collect', headers: { ...visitor, 'user-agent': 'Googlebot/2.1' } });
    await new Promise((r) => setTimeout(r, 10));
    const entries = (
      requestLog as unknown as { pending: { containerId: string; entry: Record<string, unknown> }[] }
    ).pending;
    expect(entries.map((e) => e.entry.kind)).toEqual(['tracking', 'loader', 'tracking']);
    expect(entries[0]!.containerId).toBe('ctr_1');
    expect(entries[0]!.entry).toMatchObject({
      method: 'POST',
      path: '/g/collect',
      event: 'page_view, scroll, purchase',
      status: 204,
      outcome: 'proxied',
      country: 'BD',
      device: 'Chrome · Windows · desktop',
      bot: null,
    });
    expect(entries[1]!.entry).toMatchObject({ outcome: 'loader_miss', status: 200 });
    expect(entries[2]!.entry).toMatchObject({ outcome: 'bot_dropped', bot: 'user-agent', status: 204 });
    expect(JSON.stringify(entries)).not.toContain('103.0.0.10');
    expect(JSON.stringify(entries)).not.toContain('email');
  });

  it('extracts GA4 event names', () => {
    expect(ga4EventNames(new URLSearchParams('v=2'), undefined)).toBeNull();
    expect(ga4EventNames(new URLSearchParams('en=a'), Buffer.from('en=b\nen=a'))).toBe('a, b');
  });
});

describe('gtag.js', () => {
  const signed = '/gtag/js?id=G-REFUSED&cx=c&gtm=4e6ac1&sign=abc_20261014';

  it('serves gtag.js from the tagging server when it answers', async () => {
    const { app } = setup(makeRoute());
    const res = await app.inject({ url: '/gtag/js?id=G-SERVED', headers: visitor });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('/* gtag from tagging server */');
    expect(googleSeen).toEqual([]);
  });

  it('falls back to Google, unchanged, when the tagging server refuses it, and caches the result', async () => {
    const { app, requestLog } = setup(makeRoute());
    const res = await app.inject({ url: signed, headers: visitor });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(`/* gtag from google ${signed} */`);
    expect(res.headers['x-sst-script-source']).toBe('google');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(googleSeen).toEqual([signed]);

    const again = await app.inject({ url: signed, headers: visitor });
    expect(again.headers['x-sst-cache']).toBe('HIT');
    expect(googleSeen).toHaveLength(1);

    await new Promise((r) => setTimeout(r, 10));
    const entries = (requestLog as unknown as { pending: { entry: Record<string, unknown> }[] }).pending;
    expect(entries.map((e) => e.entry.outcome)).toEqual(['gtag_fallback', 'loader_hit']);
  });

  it('also covers the custom loader gtag path, and passes on the 400 when Google has no such script', async () => {
    const { app } = setup(makeRoute());
    const viaLoader = await app.inject({ url: '/xyz789uvw0.js?id=G-REFUSED', headers: visitor });
    expect(viaLoader.statusCode).toBe(200);
    expect(googleSeen).toEqual(['/gtag/js?id=G-REFUSED']);

    const unknown = await app.inject({ url: '/gtag/js?id=G-UNKNOWN', headers: visitor });
    expect(unknown.statusCode).toBe(400);
  });

  it('never caches preview builds', async () => {
    const { app } = setup(makeRoute());
    await app.inject({ url: '/gtag/js?id=G-REFUSED&gtm_debug=x', headers: visitor });
    await app.inject({ url: '/gtag/js?id=G-REFUSED&gtm_debug=x', headers: visitor });
    expect(googleSeen).toHaveLength(2);
  });
});
