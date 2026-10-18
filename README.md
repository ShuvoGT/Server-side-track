# OpenTrack

A server-side tracking platform: managed hosting for Google's server-side Tag Manager (sGTM) tagging server, built to the
_Server-Side Tracking Platform: Development Guide_ (v0.2, October 2026,
`Server-Side Tracking Platform_ Development Guide.docx`).

This repository holds the **data plane MVP plus a multi-user dashboard**: the edge gateway, the control plane API,
the provisioner, the Next.js dashboard (accounts with email/password and Google, workspaces, approvals, two-step
verification), and the deployment files for running them locally, on one server, on Openship and on k3s. Google's
tagging server image is used unchanged; everything here runs in front of it or around it.

```
apps/gateway/        edge gateway (Fastify + undici): routing, custom loader, power-ups, webhooks, counters
apps/api/            control plane API (Fastify + Prisma + PostgreSQL): accounts, workspaces, containers, domains,
                     Caddy ask, usage, request logs, email (password reset, invites, approvals)
apps/dashboard/      dashboard (Next.js): sign-in/sign-up, workspaces and members, containers, domains, power-ups,
                     usage, logs, account settings, super-admin pages
packages/shared/     route schema, power-up logic, loader paths, webhook signing, phone formats (shared)
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
   dashboard ─┘  PostgreSQL (source of truth)
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
pnpm test           # 96 tests: shared logic, gateway against a fake tagging server, API with the memory store,
                    # accounts, approvals and two-step verification (RFC 6238 test vectors)
pnpm lint && pnpm format:check
```

### Provisioner

The provisioner (`apps/provisioner`) takes jobs from the `provisioning` queue that the API writes whenever a
container is created, gets a new Container Config, is restarted from the dashboard, gets its first verified
tracking domain or loses one, or is deleted.

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
| `openship`   | Openship (live)        | services `sst-<id>-tagging`, `sst-<id>-preview` and one nginx `sst-<id>-edge-<host>` per tracking domain, via its API   |

The `openship` driver (`OPENSHIP_API_URL`, `OPENSHIP_TOKEN`, `OPENSHIP_ORGANIZATION_ID`, `OPENSHIP_PROJECT_ID`,
`OPENSHIP_SERVER_ID`, optionally `OPENSHIP_HOSTS_IP` and `OPENSHIP_COMPOSE_PATH`) only touches services named after
the container. Each one carries a hash of what was last applied (`/opentrack.spec`, since Openship masks environment
values), so a service is patched and redeployed only when that changes, when Openship reports it not running (e.g.
after a deployment that partly failed), or when the tagging server does not answer.
Openship deploys only from a source, so each deployment uploads a tiny folder with a compose file naming those
services. A tracking domain that already has an Openship domain on another service (e.g. on the gateway) is left
alone.

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

### Accounts and workspaces

Anyone can create an account on the dashboard, with an email and password or with Google ("Continue with
Google", shown when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set). Every account gets a workspace of its
own; containers belong to a workspace, and its owners invite other people under **Members**. The API enforces
this: the dashboard sends the signed-in user as `x-sst-user`, and every `/v1` request is limited to that user's
workspaces (other workspaces' containers answer 404). Requests with the admin key alone keep full access.

- An address counts as proven only when Google verified it. Invites and super-admin rights therefore apply after
  a Google sign-in with that address; a password account cannot claim someone else's invite. Signing in with
  Google to an account whose address nobody had proven drops its password, so whoever registered it first loses
  access.
- `SUPER_ADMIN_EMAILS` (API, comma-separated) see every workspace. On their first Google sign-in they become
  owners of workspaces that have no members, such as those created before accounts existed.
- **Approval.** New accounts start as _pending_ (`REQUIRE_APPROVAL=true`, the default): they can sign in but only
  see a "Waiting for approval" page, and the API refuses everything except `GET /v1/me`. Every super-admin gets an
  email with the name, email, phone number and sign-in method; the dashboard shows the request under **Members**
  (Account requests) and **All users**, with a count in the sidebar. **Approve** emails the user and gives them a
  workspace; **Reject** keeps them out (they can be approved later). Super-admins, people invited by a workspace
  owner, and accounts that existed before approvals were added are approved automatically.
- **Sign-up** asks for name, email, phone number (country code + number) and password. Google sign-ups have no
  phone number until the user adds one in Settings.
- Passwords are scrypt hashes; ten failed sign-ins for an address or client block it for 15 minutes.
- **Settings** (profile, preferences, security): name and phone; currency and time zone (every date in the
  dashboard uses it); password change, which signs out every other device; and two-step verification with an
  authenticator app (TOTP, RFC 6238) plus ten single-use recovery codes. With it on, both password and Google
  sign-ins ask for a code. Authenticator keys are stored encrypted (AES-256-GCM) with `SECRETS_KEY`, or a key
  derived from `ADMIN_API_KEY` when it is unset; changing that key means setting up two-step verification again.
- **Forgot password?** emails a link that works once, for an hour (only its SHA-256 is stored). Setting the new
  password proves the address and signs the account out everywhere else. Needs `SMTP_URL` (e.g.
  `smtps://user:password@smtp.example.com:465`), `MAIL_FROM` and `DASHBOARD_URL` on the API; without them the
  form says reset is not set up. The form answers the same for unknown addresses.
- Google OAuth client: Google Cloud Console › APIs & Services › Credentials › OAuth client ID (Web application),
  redirect URI `<DASHBOARD_URL>/api/auth/google/callback`. Google never shares the user's Google password with
  the platform: a Google account signs in with "Continue with Google", or sets a platform password in Settings.
- **Emails** (all through `SMTP_URL`): password reset links, workspace invites, "new account waiting for approval"
  to super-admins, and "your account is approved" to the user. A failed email is logged and never blocks the action.
- **Deleting.** Workspace owners delete a workspace under Members once it has no containers (and not their only
  one); members and pending invites go with it. Super-admins delete accounts under All users: workspaces shared with
  another owner stay, an empty workspace of their own goes with them, and it is refused while a workspace of theirs
  still has containers or other members without another owner. Super-admins and your own account cannot be deleted.
  Super-admins also delete any workspace under **All workspaces**, together with its containers: their routes stop
  at once and the provisioner removes their tagging servers.

Dashboard pages: **Containers**, **New container**, **Members** (invites, roles, account requests, delete
workspace), **Settings** (profile, preferences, security), and for super-admins **All users** and **All workspaces**. The sidebar has a
workspace switcher and a light/dark/system theme switch (light by default).

### Database: PostgreSQL

The API keeps its configuration in PostgreSQL (`DATABASE_URL`, e.g. `postgresql://sst:PASSWORD@postgres:5432/sst`)
and applies Prisma migrations itself at startup. Every deployment in `deploy/` runs a `postgres:17-alpine` service
with its data on the `pgdata` volume; any other PostgreSQL 13+ works too.

Earlier versions kept everything in a SQLite file. With `SQLITE_IMPORT_FILE` set (the deployments set it to
`/app/data/sst.db` on the old volume), the API copies that file into PostgreSQL once, when the
database is still empty, keeping every id. The file is left untouched; remove the `apidata` volume and the variable
once the data is confirmed in PostgreSQL.

### Without Docker (development)

Needs a Redis on `localhost:6379` (`docker run -d -p 6379:6379 redis:7-alpine`) and a PostgreSQL (the
`docker run` line is in `deploy/dev/api.env.example`). Copy each `deploy/dev/*.env.example` to `*.env` and replace `CHANGE_ME` with your own values (the same
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

### API reference

Public port (3000), `Authorization: Bearer $ADMIN_API_KEY`. The dashboard adds `x-sst-user` (and
`x-sst-session-issued-at`) for the signed-in user; the API then limits every request to that user's workspaces.
Without them the admin key has full access.

| Method           | Path                                           | Purpose                                                                     |
| ---------------- | ---------------------------------------------- | --------------------------------------------------------------------------- |
| POST             | `/v1/auth/signup`, `/v1/auth/signin`           | Email/password sign-up (with phone) and sign-in; ten failures block 15 min  |
| POST             | `/v1/auth/google`                              | Sign in with a Google identity the dashboard verified                       |
| POST             | `/v1/auth/two-factor`                          | Second step: authenticator or recovery code                                 |
| POST             | `/v1/auth/password-reset[/confirm]`            | Email a reset link; set the new password                                    |
| GET/PATCH        | `/v1/me`                                       | Signed-in user and workspaces; update profile and preferences               |
| POST             | `/v1/me/password`                              | Change (or first set) the password; ends other sessions                     |
| POST             | `/v1/me/two-factor/{setup,enable,disable}`     | Two-step verification                                                       |
| GET              | `/v1/admin/users`                              | Super-admins: every account with status and workspaces                      |
| GET              | `/v1/admin/workspaces`                         | Super-admins: every workspace with owners, member count and containers      |
| POST/DELETE      | `/v1/admin/users/:id[/approve\|/reject]`       | Super-admins: approve, reject or delete an account                          |
| GET/POST         | `/v1/tenants`                                  | List or create workspaces                                                   |
| PATCH/DELETE     | `/v1/tenants/:id`                              | Rename; delete an empty workspace (owners), or with `?containers=delete`    |
| GET/POST         | `/v1/tenants/:id/members`                      | Members and invites; add or invite by email (owners)                        |
| PATCH/DELETE     | `/v1/tenants/:id/members/:userId`              | Change role; remove (owners) or leave                                       |
| DELETE           | `/v1/tenants/:id/invites/:inviteId`            | Cancel an invite                                                            |
| GET/POST         | `/v1/containers`                               | List (`?tenantId=`) or create from a Container Config; queues provisioning  |
| GET/PATCH/DELETE | `/v1/containers/:id`                           | Read; change name, `webContainerId`, power-ups (partial, merged); delete    |
| POST             | `/v1/containers/:id/provision`                 | Restart the tagging servers                                                 |
| POST             | `/v1/containers/:id/loader-paths`              | New random custom loader paths                                              |
| POST             | `/v1/containers/:id/webhook-secret`            | Rotate the WooCommerce webhook secret                                       |
| GET              | `/v1/containers/:id/snippet`                   | GTM head snippet, server container URL, gtag URL, webhook URL               |
| GET              | `/v1/containers/:id/usage?from&to`             | Hourly request counts, including the current hour (default: last 7 days)    |
| GET              | `/v1/containers/:id/logs?limit&before&from&to` | Request log, newest first (7 days; no IPs or query strings)                 |
| GET              | `/v1/platform`                                 | Edge host name and addresses, for DNS instructions                          |
| GET/POST         | `/v1/containers/:id/domains`                   | List or add a tracking domain (returns the DNS record to create)            |
| POST             | `/v1/domains/:id/verify`                       | Check DNS; on success the route goes live and Caddy may issue a certificate |
| DELETE           | `/v1/domains/:id`                              | Remove a domain and its route                                               |
| GET              | `/healthz`, `/readyz`, `/metrics`              | Probes and Prometheus                                                       |

Internal port (3001), cluster only:

| Method | Path                              | Caller                                                                              |
| ------ | --------------------------------- | ----------------------------------------------------------------------------------- |
| GET    | `/internal/caddy/ask?domain=`     | Caddy on-demand TLS (no token; keep this port private)                              |
| GET    | `/internal/routes/:host`          | Gateway fallback (`Bearer $INTERNAL_API_TOKEN`)                                     |
| GET    | `/internal/containers/:id`        | Provisioner: full record including the Container Config                             |
| POST   | `/internal/containers/:id/status` | Provisioner: `{ "status", "message", "upstreamUrl" }`; refused (409) while deleting |
| DELETE | `/internal/containers/:id`        | Provisioner: after the namespace is gone                                            |

The gateway serves `/healthz`, `/readyz` and `/metrics` on its admin port (9090), never on the visitor port.

### Configuration

API (`apps/api`):

| Variable                                 | Purpose                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`                           | PostgreSQL connection string                                                |
| `REDIS_URL`                              | Routes, counters, request logs, provisioning queue                          |
| `ADMIN_API_KEY`, `INTERNAL_API_TOKEN`    | Public API key (dashboard) and internal token (gateway, provisioner)        |
| `EDGE_HOSTNAME`, `EDGE_IPV4`             | CNAME target and A-record addresses customers point tracking domains at     |
| `TAGGING_UPSTREAM_TEMPLATE`              | Where the gateway reaches a container's tagging server (`{id}` is replaced) |
| `SUPER_ADMIN_EMAILS`                     | Comma-separated super-admin addresses (rights after a Google sign-in)       |
| `REQUIRE_APPROVAL`                       | `true` (default): new accounts wait for a super-admin                       |
| `SMTP_URL`, `MAIL_FROM`, `DASHBOARD_URL` | Email for resets, invites and approvals; links point at the dashboard       |
| `SECRETS_KEY`                            | Encrypts two-step verification keys (default: derived from `ADMIN_API_KEY`) |
| `SQLITE_IMPORT_FILE`                     | One-time import of an earlier SQLite database                               |
| `DNS_SERVERS`                            | Resolvers for domain verification, e.g. `1.1.1.1,8.8.8.8` (default: system) |

Dashboard (`apps/dashboard`): `API_URL`, `ADMIN_API_KEY`, `SESSION_SECRET` (signs session cookies),
`DASHBOARD_URL`, and optionally `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` for Google sign-in.

## Implementation status against the guide

| Guide chapter                                            | Status                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundations, Architecture                                | Followed: data plane / control plane split, gateway keeps working without the API, PostgreSQL + Redis, Caddy on-demand TLS with an ask endpoint, per-container namespaces, health/metrics endpoints, zod-validated config, Prisma migrations.                                                                                                                                                         |
| Data plane: tagging runtime                              | Done: the provisioner runs Google's image per container. Kubernetes: `ctr-<id>` namespace, 2 tagging replicas at 0.25/1 vCPU, one preview server, `/healthy` probes, PDB, NetworkPolicy (`deploy/k8s/container-template.yaml` documents the same objects). Docker: one tagging + one preview container.                                                                                               |
| Data plane: edge gateway and custom loader               | Done (`apps/gateway`).                                                                                                                                                                                                                                                                                                                                                                                |
| Data plane: custom domains and SSL                       | Subdomain + CNAME/A verification + on-demand certificates done. Same-origin path setup (Nginx/Cloudflare snippets) not yet written.                                                                                                                                                                                                                                                                   |
| Data plane: power-ups v1                                 | Geo, user agent, bot filtering, cookie keeper, anonymizer done.                                                                                                                                                                                                                                                                                                                                       |
| Control plane: data model and API                        | Done (`apps/api`): accounts, workspaces with owners and members, invites, approvals, containers, domains; every user request scoped to its workspaces.                                                                                                                                                                                                                                                |
| Control plane: provisioning                              | Done (`apps/provisioner`): validate, deploy, wait for health, report Active with the upstream URL; roll back a new container that fails; delete. Changing the Container Config in the dashboard re-provisions. On Openship it also sets up each verified tracking domain on the edge. Custom-domain certificate checks are not part of it yet.                                                        |
| Control plane: dashboard                                 | Done (`apps/dashboard`): sign-in, containers, onboarding, domains with DNS steps, power-ups, usage chart, live request logs, settings; empty, loading and error states. Accounts with email/password and Google, two-step verification, approvals, workspaces with owners and members, account settings (time zone used everywhere), super-admin user and workspace lists.                            |
| Logging, monitoring, metering                            | Prometheus metrics, hourly usage roll-up and 7-day request logs done; Loki and alerts not done.                                                                                                                                                                                                                                                                                                       |
| Integrations (GTM playbook, WooCommerce plugin, vendors) | Not started. The gateway's webhook endpoint and signing scheme are ready for the plugin.                                                                                                                                                                                                                                                                                                              |
| Security, privacy, testing, operations, rollout          | Chapters are stubs in the guide. Already in place: namespace NetworkPolicy, timing-safe token checks, verified-only certificates, consent-aware cookie keeper, IP anonymization, scrypt passwords, sign-in limits, TOTP two-step verification with encrypted keys, session revocation on password change, gateway refuses host-like paths (`//host/…`, no SSRF), CI (lint, build, test, image build). |

## Live deployment: Openship

OpenTrack runs on Openship (`deploy.ibos.io`), server **ibos-34** (`103.197.205.34`), project
`server-side-tracking`, from `deploy/openship/docker-compose.yml`, with the dashboard at https://sst.ibos.agency.
Email goes through Google Workspace SMTP (an App Password); Google sign-in uses an OAuth client whose redirect URI
is `https://sst.ibos.agency/api/auth/google/callback`. ibos-34 is shared with other teams' apps, so
nothing gets the host's Docker socket: the provisioner runs with `DRIVER=openship` and, through Openship's API,
creates each website's Google tagging and preview servers as services of the project, plus one small nginx proxy
service per tracking domain (Openship keeps one custom domain per service port, and the gateway already has
`ss.travilo.io`).

| Public name                   | Openship routes to               | Purpose                                                      |
| ----------------------------- | -------------------------------- | ------------------------------------------------------------ |
| `sst.ibos.agency`             | `dashboard:3100`                 | Dashboard; also the CNAME target (edge) for tracking domains |
| `ss.travilo.io`               | `gateway:8080`                   | Tracking domain of travilo.io                                |
| `travilo-preview.ibos.agency` | `sst-chukjbhcigtx2-preview:8080` | GTM server Preview for travilo.io                            |
| `ss.aeroapps.io`              | `sst-ca62dr98lr5hh-edge-…:8080`  | Tracking domain of aeroapps.io (container `ca62dr98lr5hh`)   |
| `ss.ibos.io`                  | `sst-c8fu2t9nupnwu-edge-…:8080`  | Tracking domain of ibos.io (container `c8fu2t9nupnwu`)       |
| `pgadmin.ibos.agency`         | `pgadmin:80`                     | pgAdmin for the live PostgreSQL (login: Openship variables)  |
| `<id>.preview.ibos.agency`    | `sst-<id>-preview:8080`          | GTM server Preview of each newer container (wildcard DNS)    |
| any other tracking domain     | `sst-<id>-edge-<host>:8080`      | nginx proxy to `gateway:8080`, created by the provisioner    |

Secrets (`ADMIN_API_KEY`, `INTERNAL_API_TOKEN`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`/`_SECRET`, `SUPER_ADMIN_EMAILS`, `SMTP_URL`, `MAIL_FROM`, `SECRETS_KEY`, `POSTGRES_PASSWORD`,
`DATABASE_URL`, `OPENSHIP_TOKEN`) and `EDGE_HOSTNAME` / `EDGE_IPV4` are Openship project variables; the provisioner
copies each container's `CONTAINER_CONFIG` from the database into its services. None are in the repository. The
services the provisioner creates are not in the compose file, so a platform deploy must send only the services it
changes: open a folder session, upload, scan, then `deployments/build/access` with `serviceIds`, without
`projects/ensure`. Deploys are folder uploads with the compose file at the archive root (build contexts
rewritten from `../..` to `.`); redeploy only the services that changed (usually `api` and `dashboard`), never
`redis` or `postgres`. A dashboard tab opened before a deploy shows "The dashboard was updated" on its next action;
reloading fixes it.

### Adding a website

1. Dashboard: **New container** with the GTM server container's Container Config. The provisioner creates
   `sst-<id>-tagging` and `sst-<id>-preview` in Openship and deploys them; the container turns Active.
2. Dashboard: add the tracking domain (`ss.<site>`); at the site's DNS (Cloudflare: DNS only, grey cloud) add
   `ss` CNAME `sst.ibos.agency`; press **Verify**. The provisioner then creates the domain's proxy service, and
   Openship issues its certificate.
3. Dashboard: set the web container id in Power-ups. GTM Preview works at `https://<id>.preview.ibos.agency`.
4. GTM server container: Web Container client allows the web container id (with "Automatically serve all
   dependent Google scripts"), GA4 client, GA4 tag; publish. Web container: `server_container_url` on the Google
   tag; publish.
5. Website: replace the GTM snippet with the dashboard's, remove every other Google tag on the page (plugins such
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

### Lessons from the second website (aeroapps.io)

- **Use a subdomain.** The apex `aeroapps.io` is the website itself; a tracking domain is `ss.aeroapps.io`.
- **Openship keeps one custom domain per service port.** Adding a second domain to the gateway replaced
  `ss.travilo.io` and took Travilo's tracking down until it was restored. Never change the gateway's domains; the
  provisioner gives every further tracking domain its own proxy service.
- **The office DNS also has an `aeroapps.io` zone**, so domain checks from ibos-34 use public resolvers
  (`DNS_SERVERS`).
- **Two containers run side by side.** GTM Preview is one session per browser: connecting Tag Assistant to one
  server container ends the other's preview, not its tracking. Use separate browser profiles to debug both.
- **Check the web container that Google serves.** "Published" in the wrong container (server instead of web) looks
  the same in the GTM UI; `https://www.googletagmanager.com/gtm.js?id=GTM-…` shows the live version and its tags.
- **A new website needs the web container id in Power-ups**; without it the custom loader path answers 400.
- **Openship deployments can partly fail** (`partial_failure`). The provisioner deploys again whatever Openship does
  not report running; for one Openship has not verified yet, its domain's Verify (or the next automatic retry)
  issues the certificate.
