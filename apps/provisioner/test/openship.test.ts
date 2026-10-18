import { describe, expect, it } from 'vitest';
import { edgeServiceName, OpenshipDriver } from '../src/drivers/openship.js';
import type {
  OpenshipApi,
  OpenshipDomain,
  OpenshipService,
  ServiceInput,
} from '../src/drivers/openshipApi.js';
import { composeFor, tar } from '../src/drivers/openshipApi.js';

/** In-memory Openship project: services, their custom domains and deployments. */
class FakeOpenship implements OpenshipApi {
  services: OpenshipService[] = [];
  domains: OpenshipDomain[] = [];
  deployments: string[][] = [];
  statuses = ['building', 'ready'];
  calls: string[] = [];
  private next = 1;

  async listServices() {
    return this.services.map((s) => structuredClone(s));
  }
  async createService(input: ServiceInput & { name: string }) {
    this.calls.push(`create ${input.name}`);
    const service = { ...input, id: `svc_${this.next++}` } as OpenshipService;
    this.services.push(service);
    if (input.customDomain)
      this.domains.push({ id: `dom_${this.next++}`, hostname: input.customDomain, serviceId: service.id });
    return structuredClone(service);
  }
  async updateService(id: string, input: ServiceInput) {
    const service = this.services.find((s) => s.id === id)!;
    this.calls.push(`update ${service.name}`);
    const environment = { ...service.environment };
    for (const [key, value] of Object.entries(input.environment ?? {})) {
      if (value === null) delete environment[key];
      else environment[key] = value;
    }
    Object.assign(service, { ...input, environment, advanced: { ...service.advanced, ...input.advanced } });
    return structuredClone(service);
  }
  async deleteService(id: string) {
    this.calls.push(`delete ${this.services.find((s) => s.id === id)?.name}`);
    this.services = this.services.filter((s) => s.id !== id);
  }
  async listDomains() {
    return this.domains;
  }
  /** Deployed services run; set stopped to simulate a deployment that did not start one. */
  stopped = new Set<string>();
  async runningServiceNames() {
    const deployed = new Set(this.deployments.flat());
    return new Set(
      this.services.filter((s) => deployed.has(s.id) && !this.stopped.has(s.name)).map((s) => s.name),
    );
  }
  async deploy(serviceIds: string[]) {
    this.deployments.push(serviceIds);
    return `dep_${this.deployments.length}`;
  }
  async deploymentStatus() {
    return { status: this.statuses.shift() ?? 'ready' };
  }
}

const options = {
  image: 'gtm-image',
  previewUrlTemplate: 'https://{id}.preview.example.com',
  upstreamTemplate: 'http://sst-{id}-tagging:8080',
  gatewayUrl: 'http://gateway:8080',
  hostsIp: '203.0.113.7',
  pollIntervalMs: 1,
  isHealthy: async () => true,
};
const spec = { id: 'cnew', containerConfig: 'CONFIG', domains: ['ss.shop.com'] };
const named = (api: FakeOpenship, name: string) => api.services.find((s) => s.name === name)!;
const file = (service: OpenshipService, path: string) =>
  service.advanced?.files?.find((f) => f.path === path)?.content;

describe('OpenshipDriver', () => {
  it('creates the tagging and preview servers and a proxy per domain, then deploys them', async () => {
    const api = new FakeOpenship();
    const deployment = await new OpenshipDriver(api, options).apply(spec);
    expect(deployment).toEqual({ upstreamUrl: 'http://sst-cnew-tagging:8080', removeOnFailure: false });

    const preview = named(api, 'sst-cnew-preview');
    expect(preview).toMatchObject({
      image: 'gtm-image',
      exposedPort: '8080',
      customDomain: 'cnew.preview.example.com',
      environment: { RUN_AS_PREVIEW_SERVER: 'true', CONTAINER_CONFIG: 'CONFIG' },
    });
    const tagging = named(api, 'sst-cnew-tagging');
    expect(tagging.environment).toEqual({
      CONTAINER_CONFIG: 'CONFIG',
      PREVIEW_SERVER_URL: 'https://cnew.preview.example.com',
    });
    expect(tagging.exposed).toBeUndefined();
    expect(file(tagging, '/etc/hosts')).toContain('203.0.113.7\tcnew.preview.example.com');

    const proxy = named(api, 'sst-cnew-edge-ss-shop-com');
    expect(proxy).toMatchObject({
      image: 'nginx:1.27-alpine',
      customDomain: 'ss.shop.com',
      exposedPort: '8080',
    });
    const conf = file(proxy, '/etc/nginx/conf.d/default.conf')!;
    expect(conf).toContain('set $gateway http://gateway:8080;');
    expect(conf).toContain('proxy_set_header Host $host;');
    expect(conf).toContain('proxy_set_header X-Forwarded-For $http_x_forwarded_for;');

    expect(api.deployments).toEqual([[preview.id, tagging.id, proxy.id]]);
  });

  it('changes and redeploys nothing when applied again unchanged', async () => {
    const api = new FakeOpenship();
    const driver = new OpenshipDriver(api, options);
    await driver.apply(spec);
    api.calls = [];
    await driver.apply(spec);
    expect(api.calls).toEqual([]);
    expect(api.deployments).toHaveLength(1);
  });

  it('redeploys only the servers whose Container Config changed', async () => {
    const api = new FakeOpenship();
    const driver = new OpenshipDriver(api, options);
    await driver.apply(spec);
    await driver.apply({ ...spec, containerConfig: 'NEW' });
    expect(named(api, 'sst-cnew-tagging').environment?.CONTAINER_CONFIG).toBe('NEW');
    expect(api.deployments[1]).toEqual([
      named(api, 'sst-cnew-preview').id,
      named(api, 'sst-cnew-tagging').id,
    ]);
  });

  it('leaves a domain served by another service alone and removes proxies of removed domains', async () => {
    const api = new FakeOpenship();
    api.services.push({ id: 'svc_gateway', name: 'gateway', customDomain: 'ss.old.com' });
    api.domains.push({ id: 'dom_old', hostname: 'ss.old.com', serviceId: 'svc_gateway' });
    const driver = new OpenshipDriver(api, options);
    await driver.apply({ ...spec, domains: ['ss.shop.com', 'ss.old.com'] });
    expect(api.services.map((s) => s.name)).not.toContain('sst-cnew-edge-ss-old-com');
    expect(api.calls).not.toContain('update gateway');

    await driver.apply({ ...spec, domains: [] });
    expect(api.calls).toContain('delete sst-cnew-edge-ss-shop-com');
    expect(api.deployments).toHaveLength(1);
  });

  it("keeps an existing preview server's own domain", async () => {
    const api = new FakeOpenship();
    api.services.push({ id: 'svc_p', name: 'sst-cnew-preview', customDomain: 'shop-preview.example.com' });
    await new OpenshipDriver(api, options).apply(spec);
    expect(named(api, 'sst-cnew-preview').customDomain).toBe('shop-preview.example.com');
    expect(named(api, 'sst-cnew-tagging').environment?.PREVIEW_SERVER_URL).toBe(
      'https://shop-preview.example.com',
    );
  });

  it('reports a failed Openship deployment', async () => {
    const api = new FakeOpenship();
    api.statuses = ['building', 'failed'];
    await expect(new OpenshipDriver(api, options).apply(spec)).rejects.toThrow('ended failed');
  });

  it('removes every service of the container and nothing else', async () => {
    const api = new FakeOpenship();
    api.services.push({ id: 'svc_other', name: 'sst-cother-tagging' }, { id: 'svc_api', name: 'api' });
    const driver = new OpenshipDriver(api, options);
    await driver.apply(spec);
    await driver.remove('cnew');
    expect(api.services.map((s) => s.name)).toEqual(['sst-cother-tagging', 'api']);
  });

  it('names proxy services after the host name', () => {
    expect(edgeServiceName('cabc', 'SS.Shop.co.uk')).toBe('sst-cabc-edge-ss-shop-co-uk');
  });

  it('uploads a compose file naming the deployed services as a valid tar archive', () => {
    const compose = composeFor([{ name: 'sst-c1-tagging', image: 'gtm:stable' }]);
    expect(compose).toContain(['  sst-c1-tagging:', '    image: "gtm:stable"'].join('\n'));
    const archive = tar({ 'docker-compose.yml': compose });
    expect(archive.length % 512).toBe(0);
    expect(archive.subarray(0, 18).toString()).toBe('docker-compose.yml');
    expect(archive.subarray(257, 262).toString()).toBe('ustar');
    const size = parseInt(archive.subarray(124, 135).toString(), 8);
    expect(archive.subarray(512, 512 + size).toString()).toBe(compose);
    // The checksum covers the header with its own field read as spaces.
    const header = Buffer.from(archive.subarray(0, 512));
    const stored = parseInt(header.subarray(148, 154).toString(), 8);
    header.fill(' ', 148, 156);
    expect(header.reduce((sum, b) => sum + b, 0)).toBe(stored);
  });

  it('deploys everything again when nothing changed but the tagging server is down', async () => {
    const api = new FakeOpenship();
    let healthy = false;
    const driver = new OpenshipDriver(api, { ...options, isHealthy: async () => healthy });
    await driver.apply(spec);
    await driver.apply(spec);
    expect(api.deployments).toHaveLength(2);
    expect(api.deployments[1]).toEqual(api.deployments[0]);
    healthy = true;
    await driver.apply(spec);
    expect(api.deployments).toHaveLength(2);
  });

  it('deploys a service again that is not running, e.g. after a failed deployment', async () => {
    const api = new FakeOpenship();
    const driver = new OpenshipDriver(api, options);
    await driver.apply(spec);
    api.stopped.add('sst-cnew-edge-ss-shop-com');
    await driver.apply(spec);
    expect(api.deployments[1]).toEqual([named(api, 'sst-cnew-edge-ss-shop-com').id]);
    api.stopped.clear();
    await driver.apply(spec);
    expect(api.deployments).toHaveLength(2);
  });

  it('still applies when the running-services lookup is refused', async () => {
    const api = new FakeOpenship();
    api.runningServiceNames = async () => {
      throw new Error('Openship answered 403');
    };
    const driver = new OpenshipDriver(api, options);
    await driver.apply(spec);
    await driver.apply(spec);
    expect(api.deployments).toHaveLength(1);
  });
});
