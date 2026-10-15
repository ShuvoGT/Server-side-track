import { gzipSync } from 'node:zlib';

/** The parts of an Openship service the driver reads and writes. Environment values read back masked. */
export interface OpenshipService {
  id: string;
  name: string;
  image?: string | null;
  exposed?: boolean;
  exposedPort?: string | null;
  customDomain?: string | null;
  environment?: Record<string, string>;
  advanced?: { files?: { path: string; content: string }[] | null } | null;
}

export interface OpenshipDomain {
  id: string;
  hostname: string;
  serviceId: string | null;
}

export type ServiceInput = {
  name?: string;
  kind?: 'compose';
  image?: string;
  restart?: 'unless-stopped';
  environment?: Record<string, string | null>;
  exposed?: boolean;
  exposedPort?: string;
  domainType?: 'custom' | 'free';
  customDomain?: string | null;
  dependsOn?: string[];
  advanced?: { files?: { path: string; content: string }[] | null };
};

/** Openship's REST API, as far as the provisioner needs it. */
export interface OpenshipApi {
  listServices(): Promise<OpenshipService[]>;
  createService(input: ServiceInput & { name: string }): Promise<OpenshipService>;
  updateService(id: string, input: ServiceInput): Promise<OpenshipService>;
  deleteService(id: string): Promise<void>;
  listDomains(): Promise<OpenshipDomain[]>;
  /** Starts a deployment of these services only; every other service keeps running untouched. */
  deploy(serviceIds: string[]): Promise<string>;
  /** ready, failed, building, ... as Openship reports it. */
  deploymentStatus(deploymentId: string): Promise<{ status: string; message?: string }>;
}

export interface OpenshipApiOptions {
  /** e.g. https://deploy.example.com/api/proxy/api */
  baseUrl: string;
  token: string;
  organizationId: string;
  projectId: string;
  /** The server the project runs on. */
  serverId: string;
  /** Where the project's compose file is in its source, if not at the root, e.g. deploy/openship/docker-compose.yml */
  composePath?: string;
  fetch?: typeof fetch;
}

export class OpenshipHttpApi implements OpenshipApi {
  private readonly fetch: typeof fetch;

  constructor(private readonly options: OpenshipApiOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetch(`${this.options.baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.options.token}`,
        'x-organization-id': this.options.organizationId,
        'x-openship-scope': 'fixed',
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Openship answered ${response.status} to ${method} ${path}: ${text.slice(0, 300)}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  private get project() {
    return `/projects/${encodeURIComponent(this.options.projectId)}`;
  }

  async listServices() {
    const body = await this.call<{ services: OpenshipService[] }>('GET', `${this.project}/services`);
    return body.services ?? [];
  }

  async createService(input: ServiceInput & { name: string }) {
    const body = await this.call<{ service: OpenshipService }>('POST', `${this.project}/services`, input);
    return body.service;
  }

  async updateService(id: string, input: ServiceInput) {
    const body = await this.call<{ service: OpenshipService }>(
      'PATCH',
      `${this.project}/services/${encodeURIComponent(id)}`,
      input,
    );
    return body.service;
  }

  async deleteService(id: string) {
    await this.call('DELETE', `${this.project}/services/${encodeURIComponent(id)}`);
  }

  async listDomains() {
    const body = await this.call<{ data: OpenshipDomain[] }>(
      'GET',
      `/domains?projectId=${encodeURIComponent(this.options.projectId)}`,
    );
    return body.data ?? [];
  }

  /**
   * Openship only deploys from a source (git or an uploaded folder), even for services that run a ready image. So
   * each deployment uploads a tiny folder with a compose file naming just these services; their stored settings
   * (environment, files, domains) are what Openship runs, and every other service carries forward untouched.
   */
  async deploy(serviceIds: string[]) {
    const services = (await this.listServices()).filter((s) => serviceIds.includes(s.id));
    const compose = composeFor(services);
    const session = await this.call<{
      sessionId: string;
      upload: { url: string; absoluteUrl?: string; headers?: Record<string, string> };
    }>('POST', '/projects/folder/session', { projectId: this.options.projectId, name: 'opentrack-services' });
    const uploadUrl =
      session.upload.absoluteUrl ?? `${this.options.baseUrl.replace(/\/$/, '')}/${session.upload.url}`;
    const upload = await this.fetch(uploadUrl, {
      method: 'POST',
      headers: {
        ...session.upload.headers,
        authorization: `Bearer ${this.options.token}`,
        'x-organization-id': this.options.organizationId,
        'x-openship-scope': 'fixed',
        'content-type': 'application/gzip',
      },
      body: gzipSync(
        tar({
          'docker-compose.yml': compose,
          ...(this.options.composePath && { [this.options.composePath]: compose }),
        }),
      ),
      signal: AbortSignal.timeout(60_000),
    });
    if (!upload.ok) throw new Error(`Openship answered ${upload.status} to the source upload`);
    await this.call('POST', `/projects/folder/scan/${encodeURIComponent(session.sessionId)}`, {});

    const body = await this.call<{ deployment_id?: string; deploymentId?: string }>(
      'POST',
      '/deployments/build/access',
      {
        projectId: this.options.projectId,
        serverId: this.options.serverId,
        uploadSessionId: session.sessionId,
        serviceIds,
      },
    );
    const id = body.deployment_id ?? body.deploymentId;
    if (!id) throw new Error('Openship started no deployment');
    return id;
  }

  async deploymentStatus(deploymentId: string) {
    const body = await this.call<Record<string, unknown>>(
      'GET',
      `/deployments/${encodeURIComponent(deploymentId)}`,
    );
    // The record is either the body itself or wrapped in data / deployment.
    const record = (body.data ?? body.deployment ?? body) as Record<string, unknown>;
    const status = typeof record.status === 'string' ? record.status : 'unknown';
    const message =
      typeof record.errorMessage === 'string'
        ? record.errorMessage
        : typeof record.error === 'string'
          ? record.error
          : undefined;
    return { status, message };
  }
}

/** A compose file naming image services, for the source of a deployment. */
export function composeFor(services: Pick<OpenshipService, 'name' | 'image'>[]): string {
  const lines = [
    '# Uploaded by the OpenTrack provisioner; Openship runs these services from their stored settings.',
  ];
  lines.push('services:');
  for (const s of services) {
    lines.push(`  ${s.name}:`, `    image: ${JSON.stringify(s.image ?? '')}`, '    restart: unless-stopped');
  }
  return `${lines.join('\n')}\n`;
}

/** A minimal ustar archive of regular files. */
export function tar(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const header = Buffer.alloc(512);
    const put = (value: string, offset: number, length: number) =>
      header.write(value, offset, Math.min(Buffer.byteLength(value), length), 'utf8');
    const octal = (value: number, length: number) => value.toString(8).padStart(length - 1, '0');
    put(name, 0, 100);
    put(octal(0o644, 8), 100, 8);
    put(octal(0, 8), 108, 8);
    put(octal(0, 8), 116, 8);
    put(octal(data.length, 12), 124, 12);
    put(octal(Math.floor(Date.now() / 1000), 12), 136, 12);
    header.fill(' ', 148, 156);
    put('0', 156, 1);
    put('ustar\u000000', 257, 8);
    let sum = 0;
    for (const byte of header) sum += byte;
    put(`${sum.toString(8).padStart(6, '0')}\u0000 `, 148, 8);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
