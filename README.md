# Server-side tracking platform

Managed hosting for Google's server-side Tag Manager (sGTM) tagging server, built to the
_Server-Side Tracking Platform: Development Guide_ (v0.2, October 2026,
`Server-Side Tracking Platform_ Development Guide.docx`).

This repository holds the **data plane MVP plus the dashboard**: the edge gateway, the control plane API, the
Next.js dashboard, and the deployment files for running them locally and on k3s. Google's tagging server image is
used unchanged; everything here runs in front of it or around it.

```
apps/gateway/        edge gateway (Fastify + undici): routing, custom loader, power-ups, webhooks, counters
apps/api/            control plane API (Fastify + Prisma + SQLite): tenants, containers, domains, Caddy ask,
                     usage, request logs
apps/dashboard/      dashboard (Next.js): onboarding, domains, power-ups, usage, logs, settings
packages/shared/     route schema, power-up logic, loader paths, webhook signing (shared by both apps)
apps/provisioner/    provisioner (BullMQ worker): starts Google's tagging + preview servers per container
deploy/local/        docker compose stack: Redis, API, gateway, dashboard, provisioner, Caddy
deploy/server/       production on one internet-facing server: real certificates, setup.sh (see its README)
deploy/openship/     compose file for Openship (core services behind its HTTPS edge; secrets as Openship env vars)
deploy/dev/          example env files and a fake tagging server for running the services without Docker
deploy/k8s/          per-container Kubernetes template, production Caddyfile
Dockerfile           API, gateway and provisioner images: --build-arg APP=api|gateway|provisioner
                     (dashboard: apps/dashboard/Dockerfile)
```

## How a request flows

```
browser ──TLS──▶ Caddy ──▶ gateway ──▶ tagging server (Google's image) ──▶ GA4, Meta CAPI, Google Ads...
                  │          │  ▲
       ask: may I │          │  └ route by Host: memory cache → Redis → API (stale route kept if all are down)
       get a cert?▼          ▼
               API ◀──── Redis (routes, invalidation pub/sub, counters, request logs, provisioning queue)
              ▲  │
   dashboard ─┘  SQLite (source of truth)
```

The gateway, for each request to a customer's tracking host (e.g. `sst.shop.com`):

1. Finds the container for the host. Unknown hosts get 404.
2. **Custom loader**: a random path such as `/k3x9q2mf7a.js` is rewritten to `/gtm.js?id=<web container>` (or
   `/gtag/js?id=G-…` for the gtag path), fetched from the tagging server's Web Container client and cached for 60 s.
   Preview builds (`gtm_auth`, `gtm_preview`, `gtm_debug`) are never cached.
3. **gtag.js** (`/gtag/js?id=G-…`, which Google tags with `server_container_url` load from the tracking domain):
   served by the tagging server like the loader. If the tagging server refuses it (400/404, e.g. no client claims
   it), the gateway fetches the same file from `www.googletagmanager.com` server-side and serves it unchanged from
   the tracking domain (`x-sst-script-source: google`), so it stays first-party. Google's cookies are not passed on.
4. **Webhook** (`POST /sst/woocommerce`): checks `x-sst-timestamp` and `x-sst-signature`
   (HMAC-SHA256 of `"<timestamp>.<body>"` with the container's secret, 5 minute tolerance) and forwards with
   `x-sst-webhook-verified: <container id>`.
5. Everything else is a tracking request. Power-ups run, then the request goes to the tagging server with the
   original `Host`, the visitor's IP in `X-Forwarded-For` and the enrichment headers below.

Request headers added for the server container (read them with _Request Header_ variables in GTM). Incoming
`x-sst-*` headers are always removed first, so visitors cannot spoof them.

| Header                                                                    | Power-up      | Example                                     |
| ------------------------------------------------------------------------- | ------------- | ------------------------------------------- |
| `x-sst-geo-country`, `x-sst-geo-region`, `x-sst-geo-city`                 | geoHeaders    | `BD`, `BD-C`, `Dhaka`                       |
| `x-sst-device-browser`, `-browser-version`, `-os`, `-os-version`, `-type` | userAgentInfo | `Chrome`, `Android`, `mobile`               |
| `x-sst-bot` (`0`/`1`), `x-sst-bot-reason`                                 | botDetection  | `user-agent`, `ip-list`, `empty-user-agent` |
| `x-sst-webhook-verified`                                                  | (webhooks)    | `c6439rs9qcbvi`                             |

### Power-ups (per container, `PATCH /v1/containers/:id`)

| Power-up        | Default | Behaviour                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customLoader`  | on      | Serves gtm.js (for the container's web container id) and gtag.js from the tracking domain under random paths. Off: those paths are not served, so the website must use Google's standard snippet. The dashboard can generate new paths if a blocker list learns them.                                                                                                                             |
| `geoHeaders`    | on      | MaxMind GeoLite2 City lookup. Off automatically if `GEOIP_DB_PATH` is not set.                                                                                                                                                                                                                                                                                                                    |
| `userAgentInfo` | on      | bowser (MIT). ua-parser-js 2.x is avoided because of its AGPL licence.                                                                                                                                                                                                                                                                                                                            |
| `botDetection`  | `flag`  | `off`, `flag` (headers only) or `drop` (answers 204, nothing forwarded). isbot patterns, empty user agents, a platform-wide IP list (`BOT_IP_LIST_PATH`) and per-container `blockedIps` (addresses or CIDRs).                                                                                                                                                                                     |
| `cookieKeeper`  | off     | Re-sets marketing cookies (`_ga`, `_ga_*`, `_gcl_*`, `_fbp`, `_fbc`, `_ttp`) as server-set cookies on the registrable domain for up to 400 days, and keeps an HttpOnly backup (`_sst_ck`) to restore them. Never creates a cookie the browser did not already have. Restoring needs a GA4 hit that grants `ad_storage` (`gcs=G11x`); a hit that denies it deletes the backup and extends nothing. |
| `anonymizer`    | off     | On GA4 `/g/collect` hits only: removes `uid` and `_uip`, masks emails and personal URL parameters (`email`, `phone`, `name`…) in `dl`, `dr`, `dt`, `ep.*`, `up.*`, and zeroes the last IPv4 octet / last 80 IPv6 bits of the forwarded IP. Every tag fed by that request (including Meta CAPI) sees the anonymized data.                                                                          |

## Running it

Requirements: Node.js 22+ (24 recommended), pnpm 9 (`npx pnpm@9.15.9` works without installing), Docker.

```bash
pnpm install
pnpm build          # also runs prisma generate and next build
pnpm test           # 50 tests: shared logic, gateway against a fake tagging server, API with the memory store
pnpm lint && pnpm format:check
```

### Provisioner

The provisioner (`apps/provisioner`) takes jobs from the `provisioning` queue that the API writes whenever a
container is created, gets a new Container Config, is restarted from the dashboard, or is deleted.

- **apply**: reads the container from the API, starts Google's tagging and preview servers, waits until
  `/healthy` answers, then reports the container **Active** together with the address the gateway should use.
  A crash is detected within seconds and reported with a readable reason. A brand-new container that fails is
  removed again; on Kubernetes an existing container keeps its previous pods.
- **delete**: removes the servers, then the container record.
- Jobs run one at a time and are retried 5 times with backoff.

Drivers (`DRIVER`):

| Driver       | Where                  | What it creates                                                                                                         |
| ------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `kubernetes` | production (k3s)       | namespace `ctr-<id>` with secret, deployments, services, PDB, NetworkPolicy; RBAC in `deploy/k8s/provisioner-rbac.yaml` |
| `docker`     | docker compose, dev    | containers `sst-<id>-tagging` and `sst-<id>-preview` on the local Docker engine                                         |
| `external`   | Openship, shared hosts | nothing: the tagging servers are services of the deployment; only checks `/healthy` and reports Active or Failed        |

`PREVIEW_URL_TEMPLATE` (e.g. `https://preview-{id}.example.com`) gives tagging servers the public HTTPS address of
their preview server. Google's image exits on an internal `http://` preview URL, so without it GTM Preview is off
and live tracking still works.

The Container Config is entered in the dashboard (New container, or Settings to replace it). It never goes in
`.env`.

**Network requirement:** Google's image downloads the container from `www.googletagmanager.com` when it starts,
and its tags call `www.google-analytics.com` and other vendor domains. Networks that block tracking domains
(DNS answering `0.0.0.0`) make the tagging server crash; the dashboard then shows "this network resolves Google
tag domains to 0.0.0.0". Allow at least `googletagmanager.com`, `google-analytics.com`, `googleadservices.com`,
`graph.facebook.com` and `business-api.tiktok.com` for the servers that run tagging servers.

### Database: SQLite

The API keeps its configuration in one SQLite file (default `apps/api/data/sst.db`, set with `DATABASE_URL`, e.g.
`file:/app/data/sst.db`) and applies Prisma migrations itself at startup. SQLite allows one writer, so run **one
API replica** with the file on a persistent, backed-up volume. The guide's design used PostgreSQL; moving to it
later means changing the Prisma `provider` and generating a new migration, nothing else.

### Without Docker (development)

Needs a Redis on `localhost:6379` (`docker run -d -p 6379:6379 redis:7-alpine`). Copy each `deploy/dev/*.env.example` to `*.env` and replace `CHANGE_ME` with your own values (the same
`INTERNAL_API_TOKEN` in all three; `ADMIN_API_KEY` at least 24 characters). Build once (`pnpm build`), then:

```bash
node deploy/dev/fake-tagging-server.mjs                                   # stands in for Google's image
node --env-file=deploy/dev/api.env apps/api/dist/server.js         # API :3000, internal :3001
node --env-file=deploy/dev/gateway.env apps/gateway/dist/server.js # gateway :8080
```

For the dashboard, copy `apps/dashboard/.env.example` to `apps/dashboard/.env.local` (with `ADMIN_API_KEY` from
`deploy/dev/api.env`) and run `pnpm --dir apps/dashboard dev`, then open http://localhost:3100.

### Local stack

```bash
cd deploy/local
cp .env.example .env                     # fill in keys and passwords
docker compose up -d --build             # Redis, API :3000, gateway :8080, dashboard :3100, Caddy :443
```

Try it (`sst.localtest.me` resolves to 127.0.0.1 in public DNS, so set `EDGE_IPV4=127.0.0.1` in `.env`):

```bash
A="Authorization: Bearer $ADMIN_API_KEY"
curl -X POST localhost:3000/v1/tenants -H "$A" -H 'content-type: application/json' -d '{"name":"iBOS"}'
curl -X POST localhost:3000/v1/containers -H "$A" -H 'content-type: application/json' \
  -d '{"tenantId":"<tenant id>","name":"Shop","containerConfig":"<from GTM>","webContainerId":"GTM-XXXXXXX"}'
curl -X POST localhost:3000/v1/containers/<id>/domains -H "$A" -H 'content-type: application/json' \
  -d '{"hostname":"sst.localtest.me"}'
curl -X POST localhost:3000/v1/domains/<domain id>/verify -H "$A"
curl localhost:3000/v1/containers/<id>/snippet -H "$A"          # GTM snippet with the custom loader
curl -i 'localhost:8080/g/collect?v=2&en=page_view' -H 'Host: sst.localtest.me' -H 'User-Agent: Mozilla/5.0 Chrome/141'
```

### API reference (MVP)

Public port (3000), `Authorization: Bearer $ADMIN_API_KEY`:

| Method           | Path                                   | Purpose                                                                     |
| ---------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| GET/POST         | `/v1/tenants`                          | List or create tenants                                                      |
| GET/POST         | `/v1/containers`                       | List (`?tenantId=`) or create from a Container Config; queues provisioning  |
| GET/PATCH/DELETE | `/v1/containers/:id`                   | Read; change name, `webContainerId`, power-ups (partial, merged); delete    |
| POST             | `/v1/containers/:id/webhook-secret`    | Rotate the WooCommerce webhook secret                                       |
| GET              | `/v1/containers/:id/snippet`           | GTM head snippet, server container URL, gtag URL, webhook URL               |
| GET              | `/v1/containers/:id/usage?from&to`     | Hourly request counts, including the current hour (default: last 7 days)    |
| GET              | `/v1/containers/:id/logs?limit&before` | Request log, newest first (7 days; no IPs or query strings)                 |
| GET              | `/v1/platform`                         | Edge host name and addresses, for DNS instructions                          |
| GET/POST         | `/v1/containers/:id/domains`           | List or add a tracking domain (returns the DNS record to create)            |
| POST             | `/v1/domains/:id/verify`               | Check DNS; on success the route goes live and Caddy may issue a certificate |
| DELETE           | `/v1/domains/:id`                      | Remove a domain and its route                                               |
| GET              | `/healthz`, `/readyz`, `/metrics`      | Probes and Prometheus                                                       |

Internal port (3001), cluster only:

| Method | Path                              | Caller                                                                              |
| ------ | --------------------------------- | ----------------------------------------------------------------------------------- |
| GET    | `/internal/caddy/ask?domain=`     | Caddy on-demand TLS (no token; keep this port private)                              |
| GET    | `/internal/routes/:host`          | Gateway fallback (`Bearer $INTERNAL_API_TOKEN`)                                     |
| GET    | `/internal/containers/:id`        | Provisioner: full record including the Container Config                             |
| POST   | `/internal/containers/:id/status` | Provisioner: `{ "status", "message", "upstreamUrl" }`; refused (409) while deleting |
| DELETE | `/internal/containers/:id`        | Provisioner: after the namespace is gone                                            |

The gateway serves `/healthz`, `/readyz` and `/metrics` on its admin port (9090), never on the visitor port.

## Implementation status against the guide

| Guide chapter                                            | Status                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundations, Architecture                                | Followed: data plane / control plane split, gateway keeps working without the API, SQLite (by decision, instead of PostgreSQL) + Redis, Caddy on-demand TLS with an ask endpoint, per-container namespaces, health/metrics endpoints, zod-validated config, Prisma migrations.                          |
| Data plane: tagging runtime                              | Done: the provisioner runs Google's image per container. Kubernetes: `ctr-<id>` namespace, 2 tagging replicas at 0.25/1 vCPU, one preview server, `/healthy` probes, PDB, NetworkPolicy (`deploy/k8s/container-template.yaml` documents the same objects). Docker: one tagging + one preview container. |
| Data plane: edge gateway and custom loader               | Done (`apps/gateway`).                                                                                                                                                                                                                                                                                  |
| Data plane: custom domains and SSL                       | Subdomain + CNAME/A verification + on-demand certificates done. Same-origin path setup (Nginx/Cloudflare snippets) not yet written.                                                                                                                                                                     |
| Data plane: power-ups v1                                 | Geo, user agent, bot filtering, cookie keeper, anonymizer done.                                                                                                                                                                                                                                         |
| Control plane: data model and API                        | MVP done (`apps/api`), admin key auth only.                                                                                                                                                                                                                                                             |
| Control plane: provisioning                              | Done (`apps/provisioner`): validate, deploy, wait for health, report Active with the upstream URL; roll back a new container that fails; delete. Changing the Container Config in the dashboard re-provisions. Custom-domain certificate checks are not part of it yet.                                 |
| Control plane: dashboard                                 | Done (`apps/dashboard`): sign-in, containers, onboarding, domains with DNS steps, power-ups, usage chart, live request logs, settings; empty, loading and error states. One shared admin password for the internal MVP; per-user accounts come with the SaaS phase.                                     |
| Logging, monitoring, metering                            | Prometheus metrics, hourly usage roll-up and 7-day request logs done; Loki and alerts not done.                                                                                                                                                                                                         |
| Integrations (GTM playbook, WooCommerce plugin, vendors) | Not started. The gateway's webhook endpoint and signing scheme are ready for the plugin.                                                                                                                                                                                                                |
| Security, privacy, testing, operations, rollout          | Chapters are stubs in the guide. Already in place: namespace NetworkPolicy, timing-safe token checks, verified-only certificates, consent-aware cookie keeper, IP anonymization, CI (lint, build, test, image build).                                                                                   |

## Live deployment: Openship

The platform runs on Openship (`deploy.ibos.io`), server **ibos-34** (`103.197.205.34`), project
`server-side-tracking`, from `deploy/openship/docker-compose.yml`. ibos-34 is shared with other teams' apps, so
nothing gets the host's Docker socket: the provisioner runs with `DRIVER=external`, and each website's Google
tagging and preview servers are services of the project.

| Public name                   | Openship routes to               | Purpose                                                      |
| ----------------------------- | -------------------------------- | ------------------------------------------------------------ |
| `sst.ibos.agency`             | `dashboard:3100`                 | Dashboard; also the CNAME target (edge) for tracking domains |
| `ss.travilo.io`               | `gateway:8080`                   | Tracking domain of travilo.io                                |
| `travilo-preview.ibos.agency` | `sst-chukjbhcigtx2-preview:8080` | GTM server Preview for travilo.io                            |

Secrets (`ADMIN_API_KEY`, `INTERNAL_API_TOKEN`, `DASHBOARD_PASSWORD`, `SESSION_SECRET`) and `EDGE_HOSTNAME` /
`EDGE_IPV4` are Openship project variables; each tagging service's `CONTAINER_CONFIG` is a service variable. None
are in the repository. Deploys are folder uploads with the compose file at the archive root (build contexts
rewritten from `../..` to `.`); redeploy only the services that changed, never `redis`.

### Adding a website

1. Dashboard: **New container** with the GTM server container's Container Config; note the container id.
2. Compose: add `sst-<id>-tagging` and `sst-<id>-preview` (copy the Travilo pair), deploy, and set
   `CONTAINER_CONFIG` on both as a service variable.
3. Cloudflare (DNS only, grey cloud): `ss.<site>` CNAME `sst.ibos.agency`, and `<site>-preview.ibos.agency`
   CNAME `sst.ibos.agency`.
4. Openship: custom domain `ss.<site>` on `gateway` (8080), `<site>-preview.ibos.agency` on the preview service
   (8080); set `PREVIEW_SERVER_URL=https://<site>-preview.ibos.agency` on the tagging service.
5. Dashboard: add and verify the domain, set the web container id in Power-ups.
6. GTM server container: Web Container client allows the web container id (with "Automatically serve all
   dependent Google scripts"), GA4 client, GA4 tag; publish. Web container: `server_container_url` on the Google
   tag; publish.
7. Website: replace the GTM snippet with the dashboard's, remove every other Google tag on the page (plugins such
   as Site Kit or GTM4WP), purge every cache, and check in a browser that `/g/collect` goes to `ss.<site>`.

### Lessons from the first website (travilo.io)

- **Google's image refuses an internal preview URL.** `PREVIEW_SERVER_URL` must be public HTTPS; see above.
- **The office DNS (dns01, `10.209.99.2`) hosts its own `ibos.agency` and `travilo.io` zones**, so ibos-34 and
  office PCs get "not found" for names that exist only in Cloudflare. Until IT adds them to dns01 (or forwards
  those zones), the Travilo tagging service has a mounted `/etc/hosts` line for `travilo-preview.ibos.agency`
  (Openship service file). Remove it once dns01 knows the name. Chrome's Secure DNS hides this on office PCs.
- **The server container refused `gtag.js`** for the GA4 tag with a 400 even with the client settings above;
  the gateway's gtag.js fallback covers it (dashboard log: "Loader (gtag.js via Google)").
- **A second Google tag on the page wins.** Site Kit placed `GT-55JPMHN4` without `server_container_url`, and GA4
  hits went straight to Google until it was removed.
- **Page caches serve old snippets.** LiteSpeed kept the old homepage after the plugins changed; AirLift serves
  its own optimized copy. Purge all of them after every change, and exclude the tracking domain from "delay JS".
- **Test as a visitor.** Logged-in WordPress admins get a different page (and Site Kit's own `G-EQDN3BWDSD`
  telemetry), which confuses Tag Assistant; use an incognito window.
- An occasional `502 Tagging server error` on `/gtm/get_memo` is a slow GTM Preview poll (over the gateway's 30 s
  limit), not lost data. A 502 on `/g/collect` or a loader path is a real outage.
