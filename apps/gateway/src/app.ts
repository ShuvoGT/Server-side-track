import { randomUUID } from 'node:crypto';
import type { BlockList } from 'node:net';
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { request as undiciRequest, type Dispatcher } from 'undici';
import {
  anonymizeGa4Body,
  anonymizeGa4Params,
  anonymizeIp,
  buildBlockList,
  consentFromGcs,
  cookieDomainFor,
  detectBot,
  HOP_BY_HOP_HEADERS,
  Headers,
  INTERNAL_HEADER_PREFIX,
  isGa4CollectPath,
  normalizeHost,
  parseDevice,
  planCookieKeeper,
  rewriteLoaderRequest,
  verifyWebhook,
  type ContainerRoute,
} from '@sst/shared';
import type { UsageCounters } from './counters.js';
import type { GeoLookup } from './geo.js';
import type { LoaderCache } from './loaderCache.js';
import type { GatewayMetrics, Outcome } from './metrics.js';
import { ga4EventNames, type PendingLogEntry, type RequestLogBuffer } from './requestLog.js';
import type { RouteResolver } from './routeResolver.js';

export interface GatewayOptions {
  logLevel?: string;
  trustedProxyHops: number;
  upstreamTimeoutMs: number;
  bodyLimitBytes: number;
  /**
   * Where gtag.js is fetched from when the tagging server refuses to serve it (400/404), so it is still served
   * first-party from the tracking domain. Default https://www.googletagmanager.com.
   */
  googleScriptOrigin?: string;
}

const UNCACHEABLE_SCRIPT_PARAMS = ['gtm_auth', 'gtm_preview', 'gtm_debug'];
const GOOGLE_SCRIPT_TIMEOUT_MS = 10_000;

/** gtag.js requests, whether through the custom loader's gtag path or Google's standard /gtag/js path. */
const isGtagScript = (pathAndQuery: string) => pathAndQuery.startsWith('/gtag/js');

export interface GatewayDeps {
  resolver: RouteResolver;
  counters: UsageCounters;
  loaderCache: LoaderCache;
  metrics: GatewayMetrics;
  geo: GeoLookup | null;
  /** Platform-wide bot IP lists, checked for every container that has bot detection on. */
  globalBotLists: BlockList[];
  /** Request log for the dashboard; leave out to turn logging off. */
  requestLog?: RequestLogBuffer;
  dispatcher?: Dispatcher;
}

/** What the handler learns about a request, completed with status and duration when the response is sent. */
type LogContext = Pick<PendingLogEntry, 'kind' | 'event' | 'outcome' | 'country' | 'device' | 'bot'> & {
  containerId: string;
};

/** Headers never forwarded to the tagging server: hop-by-hop, our own, and ones the gateway sets itself. */
const DROPPED_REQUEST_HEADERS = new Set([
  ...HOP_BY_HOP_HEADERS,
  'host',
  'content-length',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'cookie',
]);
const DROPPED_RESPONSE_HEADERS = new Set([...HOP_BY_HOP_HEADERS, 'content-length', 'set-cookie']);
const CACHED_LOADER_HEADERS = [
  'content-type',
  'content-encoding',
  'cache-control',
  'vary',
  'etag',
  'last-modified',
];

interface UpstreamResult {
  status: number;
  headers: Record<string, string | string[]>;
  setCookies: string[];
  body: Buffer;
}

type HeaderMap = Record<string, string>;

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}

/** Header values must be visible ASCII; city names such as "Chattogram" are, but some are not. */
function safeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : encodeURIComponent(value);
}

function preferredEncoding(acceptEncoding: string | undefined): string {
  const value = acceptEncoding ?? '';
  if (/\bbr\b/.test(value)) return 'br';
  if (/\bgzip\b/.test(value)) return 'gzip';
  return 'identity';
}

export function buildGateway(options: GatewayOptions, deps: GatewayDeps): FastifyInstance {
  const app = Fastify({
    logger: { level: options.logLevel ?? 'info' },
    // Same as a hop count: trust the nearest N proxies (Caddy) and take the address they saw.
    trustProxy: (_address: string, hop: number) => hop < options.trustedProxyHops,
    bodyLimit: options.bodyLimitBytes,
    requestIdHeader: Headers.requestId,
    genReqId: () => randomUUID(),
    // Per-request logs would be one line per tracking hit; counters and metrics cover that instead.
    logController: new LogController({ disableRequestLogging: true }),
  });

  // Every body is forwarded as bytes; the webhook signature is checked against the same bytes.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  const routeBotLists = new WeakMap<string[], BlockList>();
  const botListsFor = (route: ContainerRoute): BlockList[] => {
    const entries = route.powerUps.botDetection.blockedIps;
    if (entries.length === 0) return deps.globalBotLists;
    let list = routeBotLists.get(entries);
    if (!list) {
      list = buildBlockList(entries, (entry) =>
        app.log.warn({ containerId: route.containerId, entry }, 'invalid bot IP entry'),
      );
      routeBotLists.set(entries, list);
    }
    return [...deps.globalBotLists, list];
  };

  const logContexts = new WeakMap<FastifyRequest, LogContext>();
  const count = (req: FastifyRequest, outcome: Outcome) => {
    deps.metrics.requests.inc({ outcome });
    const context = logContexts.get(req);
    if (context) context.outcome = outcome;
  };

  if (deps.requestLog) {
    const requestLog = deps.requestLog;
    app.addHook('onResponse', async (req, reply) => {
      const context = logContexts.get(req);
      if (!context) return;
      const { containerId, ...known } = context;
      requestLog.add(containerId, {
        ...known,
        time: new Date().toISOString(),
        requestId: String(req.id),
        method: req.method,
        path: req.url.split('?')[0]!.slice(0, 200),
        status: reply.statusCode,
        durationMs: Math.round(reply.elapsedTime),
      });
    });
  }

  function baseHeaders(req: FastifyRequest, host: string, clientIp: string): HeaderMap {
    const headers: HeaderMap = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined || DROPPED_REQUEST_HEADERS.has(name) || name.startsWith(INTERNAL_HEADER_PREFIX))
        continue;
      headers[name] = headerValue(value)!;
    }
    headers.host = host;
    headers['x-forwarded-for'] = clientIp;
    headers['x-forwarded-host'] = host;
    headers['x-forwarded-proto'] = 'https';
    headers[Headers.requestId] = String(req.id);
    if (req.headers.cookie) headers.cookie = headerValue(req.headers.cookie)!;
    return headers;
  }

  async function callUpstream(
    route: ContainerRoute,
    method: string,
    pathAndQuery: string,
    headers: HeaderMap,
    body: Buffer | undefined,
    kind: string,
  ): Promise<UpstreamResult> {
    const end = deps.metrics.upstreamSeconds.startTimer({ kind });
    try {
      const response = await undiciRequest(new URL(pathAndQuery, route.upstreamUrl), {
        method: method as Dispatcher.HttpMethod,
        headers,
        body: body && body.length > 0 && method !== 'GET' && method !== 'HEAD' ? body : undefined,
        headersTimeout: options.upstreamTimeoutMs,
        bodyTimeout: options.upstreamTimeoutMs,
        dispatcher: deps.dispatcher,
      });
      const responseBody = Buffer.from(await response.body.arrayBuffer());
      const out: Record<string, string | string[]> = {};
      let setCookies: string[] = [];
      for (const [name, value] of Object.entries(response.headers)) {
        if (value === undefined) continue;
        if (name === 'set-cookie') setCookies = Array.isArray(value) ? value : [value];
        else if (!DROPPED_RESPONSE_HEADERS.has(name)) out[name] = value;
      }
      return { status: response.statusCode, headers: out, setCookies, body: responseBody };
    } finally {
      end();
    }
  }

  /**
   * Fetches a Google script straight from Google, server-side. Used when the tagging server refuses gtag.js:
   * the browser still gets it from the tracking domain, so ad blockers that match googletagmanager.com
   * do not stop it. The file is passed through unchanged.
   */
  async function fetchGoogleScript(pathAndQuery: string, headers: HeaderMap): Promise<UpstreamResult> {
    const end = deps.metrics.upstreamSeconds.startTimer({ kind: 'google_script' });
    try {
      const response = await undiciRequest(
        new URL(pathAndQuery, options.googleScriptOrigin ?? 'https://www.googletagmanager.com'),
        {
          method: 'GET',
          headers: {
            'user-agent': headers['user-agent'] ?? 'Mozilla/5.0',
            accept: '*/*',
            'accept-encoding': headers['accept-encoding'] ?? 'identity',
            ...(headers['accept-language'] && { 'accept-language': headers['accept-language'] }),
          },
          headersTimeout: GOOGLE_SCRIPT_TIMEOUT_MS,
          bodyTimeout: GOOGLE_SCRIPT_TIMEOUT_MS,
          dispatcher: deps.dispatcher,
        },
      );
      const body = Buffer.from(await response.body.arrayBuffer());
      const out: Record<string, string | string[]> = {};
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined && !DROPPED_RESPONSE_HEADERS.has(name)) out[name] = value;
      }
      out['x-sst-script-source'] = 'google';
      return { status: response.statusCode, headers: out, setCookies: [], body };
    } finally {
      end();
    }
  }

  function send(reply: FastifyReply, result: UpstreamResult, extraCookies: string[] = []): FastifyReply {
    const cookies = [...result.setCookies, ...extraCookies];
    reply.code(result.status).headers(result.headers);
    if (cookies.length) reply.header('set-cookie', cookies);
    return reply.send(result.body);
  }

  async function handleLoader(
    req: FastifyRequest,
    reply: FastifyReply,
    route: ContainerRoute,
    host: string,
    upstreamPath: string,
    cacheable: boolean,
  ) {
    logContexts.get(req)!.kind = 'loader';
    const encoding = preferredEncoding(headerValue(req.headers['accept-encoding']));
    const key = `${route.containerId}|${upstreamPath}|${encoding}`;
    deps.counters.inc(route.containerId, 'loader');
    const cached = cacheable ? deps.loaderCache.get(key) : null;
    if (cached) {
      count(req, 'loader_hit');
      return reply.code(cached.status).headers(cached.headers).header('x-sst-cache', 'HIT').send(cached.body);
    }
    const headers = baseHeaders(req, host, req.ip);
    headers['accept-encoding'] = encoding;
    delete headers.cookie; // Scripts are the same for everyone; cookies would only fragment the cache.
    let result = await callUpstream(route, req.method, upstreamPath, headers, undefined, 'loader');
    count(req, 'loader_miss');
    if (isGtagScript(upstreamPath) && (result.status === 400 || result.status === 404)) {
      // The tagging server's clients did not claim gtag.js; serve Google's own file from this domain instead.
      try {
        const fallback = await fetchGoogleScript(upstreamPath, headers);
        if (fallback.status === 200) {
          result = fallback;
          count(req, 'gtag_fallback');
        } else {
          req.log.warn({ status: fallback.status, path: upstreamPath }, 'gtag.js fallback answered non-200');
        }
      } catch (err) {
        req.log.warn({ err, path: upstreamPath }, 'gtag.js fallback failed');
      }
    }
    if (cacheable && result.status === 200 && result.setCookies.length === 0 && req.method === 'GET') {
      const keptHeaders: Record<string, string> = {};
      for (const name of CACHED_LOADER_HEADERS) {
        const value = headerValue(result.headers[name]);
        if (value) keptHeaders[name] = value;
      }
      deps.loaderCache.set(key, { status: 200, headers: keptHeaders, body: result.body });
    }
    reply.header('x-sst-cache', 'MISS');
    return send(reply, result);
  }

  async function handleWebhook(
    req: FastifyRequest,
    reply: FastifyReply,
    route: ContainerRoute,
    host: string,
  ) {
    const webhook = route.webhook!;
    logContexts.get(req)!.kind = 'webhook';
    if (req.method !== 'POST') return reply.code(405).header('allow', 'POST').send();
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const check = verifyWebhook(
      webhook.secret,
      headerValue(req.headers[Headers.webhookTimestamp]),
      headerValue(req.headers[Headers.webhookSignature]),
      body,
    );
    if (!check.ok) {
      count(req, 'webhook_rejected');
      req.log.warn({ containerId: route.containerId, reason: check.reason }, 'webhook signature rejected');
      return reply.code(401).send({ error: 'invalid_signature', reason: check.reason });
    }
    const headers = baseHeaders(req, host, req.ip);
    headers[Headers.webhookVerified] = route.containerId;
    deps.counters.inc(route.containerId, 'webhook');
    const result = await callUpstream(route, 'POST', req.url, headers, body, 'webhook');
    count(req, 'webhook');
    return send(reply, result);
  }

  async function handleTracking(
    req: FastifyRequest,
    reply: FastifyReply,
    route: ContainerRoute,
    host: string,
    url: URL,
  ) {
    const { powerUps } = route;
    const userAgent = headerValue(req.headers['user-agent']);
    const clientIp = req.ip;
    let forwardedIp = clientIp;
    const enrichment: HeaderMap = {};
    const log = logContexts.get(req)!;

    if (powerUps.botDetection.mode !== 'off') {
      const verdict = detectBot(clientIp, userAgent, botListsFor(route));
      if (verdict.isBot && powerUps.botDetection.mode === 'drop') {
        log.bot = verdict.reason;
        deps.counters.inc(route.containerId, 'bot_dropped');
        count(req, 'bot_dropped');
        return reply.code(204).send();
      }
      enrichment[Headers.bot] = verdict.isBot ? '1' : '0';
      if (verdict.reason) {
        enrichment[Headers.botReason] = verdict.reason;
        log.bot = verdict.reason;
        deps.counters.inc(route.containerId, 'bot_flagged');
      }
    }

    if (powerUps.geoHeaders && deps.geo) {
      const geo = deps.geo(clientIp);
      if (geo?.country) enrichment[Headers.geoCountry] = log.country = geo.country;
      if (geo?.region) enrichment[Headers.geoRegion] = safeHeader(geo.region);
      if (geo?.city) enrichment[Headers.geoCity] = safeHeader(geo.city);
    }

    if (powerUps.userAgentInfo) {
      const device = parseDevice(userAgent);
      if (device.browser) enrichment[Headers.deviceBrowser] = safeHeader(device.browser);
      if (device.browserVersion) enrichment[Headers.deviceBrowserVersion] = safeHeader(device.browserVersion);
      if (device.os) enrichment[Headers.deviceOs] = safeHeader(device.os);
      if (device.osVersion) enrichment[Headers.deviceOsVersion] = safeHeader(device.osVersion);
      if (device.type) enrichment[Headers.deviceType] = device.type;
      log.device = [device.browser, device.os, device.type].filter(Boolean).join(' · ') || null;
    }

    let pathAndQuery = req.url;
    let body = Buffer.isBuffer(req.body) ? req.body : undefined;
    const isCollect = isGa4CollectPath(url.pathname);
    if (isCollect) log.event = ga4EventNames(url.searchParams, body);
    if (powerUps.anonymizer.enabled && isCollect) {
      if (anonymizeGa4Params(url.searchParams, powerUps.anonymizer))
        pathAndQuery = `${url.pathname}${url.search}`;
      if (body?.length)
        body = Buffer.from(anonymizeGa4Body(body.toString('utf8'), powerUps.anonymizer), 'utf8');
      if (powerUps.anonymizer.anonymizeIp) forwardedIp = anonymizeIp(clientIp) ?? clientIp;
    }

    const consent = consentFromGcs(isCollect ? url.searchParams.get('gcs') : null);
    const keeper = planCookieKeeper(
      powerUps.cookieKeeper,
      headerValue(req.headers.cookie),
      consent,
      cookieDomainFor(host),
    );

    const headers = { ...baseHeaders(req, host, forwardedIp), ...enrichment };
    if (keeper.forwardCookieHeader) headers.cookie = keeper.forwardCookieHeader;
    else delete headers.cookie;

    deps.counters.inc(route.containerId, 'requests');
    const result = await callUpstream(route, req.method, pathAndQuery, headers, body, 'tracking');
    count(req, 'proxied');
    return send(reply, result, keeper.finalize(result.setCookies));
  }

  app.route({
    method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    url: '/*',
    handler: async (req, reply) => {
      const host = normalizeHost(headerValue(req.headers.host));
      if (!host) {
        count(req, 'bad_request');
        return reply.code(400).send({ error: 'invalid_host' });
      }
      const route = await deps.resolver.resolve(host);
      if (!route) {
        count(req, 'unknown_host');
        return reply.code(404).send({ error: 'unknown_host' });
      }
      const url = new URL(req.url, 'http://gateway.invalid');
      logContexts.set(req, {
        containerId: route.containerId,
        kind: 'tracking',
        event: null,
        outcome: 'proxied',
        country: null,
        device: null,
        bot: null,
      });
      try {
        if (req.method === 'GET' || req.method === 'HEAD') {
          const loader = rewriteLoaderRequest(route, url.pathname, url.searchParams);
          if (loader)
            return await handleLoader(req, reply, route, host, loader.upstreamPath, loader.cacheable);
          // Google tags configured with server_container_url load gtag.js from /gtag/js on the tracking domain.
          if (url.pathname === '/gtag/js') {
            const cacheable = !UNCACHEABLE_SCRIPT_PARAMS.some((name) => url.searchParams.has(name));
            return await handleLoader(req, reply, route, host, `${url.pathname}${url.search}`, cacheable);
          }
        }
        if (route.webhook && url.pathname === route.webhook.path) {
          return await handleWebhook(req, reply, route, host);
        }
        return await handleTracking(req, reply, route, host, url);
      } catch (error) {
        count(req, 'upstream_error');
        deps.counters.inc(route.containerId, 'errors');
        req.log.error({ err: error, containerId: route.containerId, host }, 'tagging server request failed');
        return reply.code(502).send({ error: 'upstream_unavailable' });
      }
    },
  });

  return app;
}
