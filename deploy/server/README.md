# Single-server installation

Runs the whole platform (API, gateway, dashboard, provisioner, Redis, Caddy) on one Linux server with Docker,
with real HTTPS certificates. It is the step before the guide's three-node k3s cluster: same images, same
settings.

## 1. Server

- Ubuntu 22.04 or 24.04 (any Linux with Docker works), a **public IPv4 address**.
- At least 2 vCPU and 4 GB RAM for the platform, plus about 0.6 vCPU and 1 GB per customer container
  (capacity plan in the guide).
- Inbound: TCP 80 and 443 (UDP 443 optional, for HTTP/3). SSH only from your network or VPN.
- Outbound HTTPS must reach Google and the vendors, **without a DNS filter that blocks tracking domains**:
  `googletagmanager.com`, `google-analytics.com`, `googleadservices.com`, `graph.facebook.com`,
  `business-api.tiktok.com`, and Let's Encrypt / ZeroSSL for certificates.
- Docker Engine with the Compose plugin: https://docs.docker.com/engine/install/ubuntu/

## 2. DNS (before running setup)

In the DNS of the platform domain (e.g. on `dns01.ibos.io` for `ibos.io`):

| Name                          | Type | Value                  | Purpose                                   |
| ----------------------------- | ---- | ---------------------- | ----------------------------------------- |
| `edge.ibos.io`                | A    | the server's public IP | customers' tracking domains CNAME to this |
| `tracking.ibos.io` (any name) | A    | the server's public IP | the dashboard                             |

## 3. Install

```bash
git clone <this repository> sst && cd sst/deploy/server
chmod +x setup.sh
./setup.sh edge.ibos.io tracking.ibos.io admin@ibos.io <server public IP>
```

The first run generates `deploy/server/.env` (API keys, dashboard password, session secret) and prints the
dashboard password. Keep `.env` private and backed up. Running `setup.sh` again later keeps the secrets and
rebuilds, e.g. after `git pull`.

## 4. Add a website

1. Open `https://tracking.ibos.io`, sign in, **New container**, paste the GTM server container's Container Config.
   The status changes to **Active** when Google's tagging server is running.
2. **Domains**: add the tracking subdomain, e.g. `sst.travilo.io`.
3. In that website's DNS (for `travilo.io`, also `dns01.ibos.io`):

   | Name             | Type  | Value          |
   | ---------------- | ----- | -------------- |
   | `sst.travilo.io` | CNAME | `edge.ibos.io` |

4. Press **Verify**. Caddy gets the certificate on the first HTTPS request (a few seconds).
5. Follow the Overview tab: `server_container_url` in GTM, then the GTM snippet on the website.

Check: `https://sst.travilo.io/healthy` answers `ok` from Google's tagging server.

## Operations

```bash
docker compose ps                         # status
docker compose logs -f gateway            # logs of one service
docker compose logs provisioner | tail    # provisioning progress and errors
./setup.sh <same arguments>               # update after git pull
```

Back up PostgreSQL (all configuration) and the `sst_caddy` volume (certificates) daily, and `deploy/server/.env`:
`docker compose exec -T postgres pg_dump -U sst sst > sst-$(date +%F).sql`. Request logs and counters in `sst_redis` can be lost without harm.
