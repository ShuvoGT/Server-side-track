import Docker from 'dockerode';
import { poll, PollAbort, previewUrlFor, type ContainerSpec, type Deployment, type Driver } from './types.js';

const LABEL = 'sst.platform/container-id';
const OWN_NETWORK = 'sst-provisioned';

export interface DockerDriverOptions {
  image: string;
  /** Network shared with the gateway. Without it, the tagging port is published on 127.0.0.1. */
  network?: string;
  /** Public https:// preview server address; {id} is the container id. Omitted: no GTM Preview. */
  previewUrlTemplate?: string;
  docker?: Docker;
}

/**
 * Turns the tagging server's last log lines into a message an operator can act on. Google's image downloads the
 * container from googletagmanager.com at startup; networks that block tracking domains answer that name with
 * 0.0.0.0, which shows up as a refused connection to 0.0.0.0:443.
 */
export function explainCrash(logs: string): string {
  if (/0\.0\.0\.0:443|::\]?:443/.test(logs) && /ECONNREFUSED/.test(logs)) {
    return (
      'It cannot reach Google: this network resolves Google tag domains (www.googletagmanager.com, ' +
      'www.google-analytics.com) to 0.0.0.0. Allow those domains in the network or DNS filter.'
    );
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(logs))
    return 'It cannot resolve Google domains; check the DNS of the Docker host.';
  if (/container config|CONTAINER_CONFIG|invalid.*config/i.test(logs)) {
    return 'Google rejected the Container Config; copy it again from GTM.';
  }
  const lines = logs.trim().split('\n').filter(Boolean);
  return `Last log lines: ${lines.slice(-4).join(' | ')}`;
}

const names = (id: string) => ({ tagging: `sst-${id}-tagging`, preview: `sst-${id}-preview` });

/**
 * Development driver: Google's image as two Docker containers per platform container (one tagging server, one
 * preview server). Same behaviour as the Kubernetes driver, minus replicas and resource limits.
 */
export class DockerDriver implements Driver {
  readonly name = 'docker';
  private readonly docker: Docker;
  private readonly network: string;

  constructor(private readonly options: DockerDriverOptions) {
    // Without options dockerode uses DOCKER_HOST, /var/run/docker.sock, or the Windows named pipe.
    this.docker = options.docker ?? new Docker();
    this.network = options.network ?? OWN_NETWORK;
  }

  private async ensureImage(): Promise<void> {
    try {
      await this.docker.getImage(this.options.image).inspect();
      return;
    } catch {
      // Not present yet: pull it.
    }
    const stream = await this.docker.pull(this.options.image);
    await new Promise<void>((resolve, reject) =>
      this.docker.modem.followProgress(stream, (error) => (error ? reject(error) : resolve())),
    );
  }

  private async ensureNetwork(): Promise<void> {
    const existing = await this.docker.listNetworks({ filters: { name: [this.network] } });
    if (existing.some((n) => n.Name === this.network)) return;
    if (this.options.network) throw new Error(`Docker network ${this.network} does not exist`);
    await this.docker.createNetwork({
      Name: this.network,
      Labels: { 'app.kubernetes.io/managed-by': 'sst' },
    });
  }

  private async inspect(name: string) {
    try {
      return await this.docker.getContainer(name).inspect();
    } catch {
      return null;
    }
  }

  /** Keeps a healthy container whose image and environment already match; otherwise (re)creates it. */
  private async ensureContainer(
    name: string,
    id: string,
    env: string[],
    publish: boolean,
  ): Promise<{ info: Docker.ContainerInspectInfo; replaced: boolean }> {
    const current = await this.inspect(name);
    const matches =
      current?.State.Running &&
      !current.State.Restarting &&
      current.RestartCount === 0 &&
      current.Config.Image === this.options.image &&
      env.every((e) => current.Config.Env.includes(e));
    if (current && matches) return { info: current, replaced: false };
    if (current) await this.docker.getContainer(name).remove({ force: true });

    const container = await this.docker.createContainer({
      name,
      Image: this.options.image,
      Env: env,
      Labels: { [LABEL]: id },
      ExposedPorts: { '8080/tcp': {} },
      HostConfig: {
        NetworkMode: this.network,
        RestartPolicy: { Name: 'unless-stopped' },
        ...(publish && { PortBindings: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }] } }),
      },
    });
    await container.start();
    return { info: await container.inspect(), replaced: true };
  }

  async apply(spec: ContainerSpec): Promise<Deployment> {
    await this.ensureImage();
    await this.ensureNetwork();
    const n = names(spec.id);
    const config = `CONTAINER_CONFIG=${spec.containerConfig}`;
    const preview = await this.ensureContainer(
      n.preview,
      spec.id,
      [config, 'RUN_AS_PREVIEW_SERVER=true'],
      false,
    );
    const publish = !this.options.network;
    const previewUrl = previewUrlFor(this.options.previewUrlTemplate, spec.id);
    const tagging = await this.ensureContainer(
      n.tagging,
      spec.id,
      previewUrl ? [config, `PREVIEW_SERVER_URL=${previewUrl}`] : [config],
      publish,
    );
    // Nothing older is kept running in Docker, so whatever this apply started is removed again on failure.
    const removeOnFailure = preview.replaced || tagging.replaced;
    if (!publish) return { upstreamUrl: `http://${n.tagging}:8080`, removeOnFailure };
    const port = tagging.info.NetworkSettings.Ports['8080/tcp']?.[0]?.HostPort;
    if (!port) throw new Error(`No host port published for ${n.tagging}`);
    return { upstreamUrl: `http://127.0.0.1:${port}`, removeOnFailure };
  }

  async waitReady(spec: ContainerSpec, deployment: Deployment, timeoutMs: number): Promise<void> {
    const n = names(spec.id);
    await poll(
      async () => {
        const info = await this.inspect(n.tagging);
        // With a restart policy, a crashing server shows as Running while Docker waits to restart it.
        if (info && (!info.State.Running || info.State.Restarting || info.RestartCount > 0)) {
          const logs = await this.docker
            .getContainer(n.tagging)
            .logs({ stdout: true, stderr: true, tail: 20 });
          // Docker frames each log line with a binary header; keep only the printable text.
          const text = [...logs.toString('utf8')].filter((ch) => ch.charCodeAt(0) > 8).join('');
          const code = info.State.ExitCode ? ` (exit ${info.State.ExitCode})` : '';
          throw new PollAbort(`Tagging server keeps crashing${code}. ${explainCrash(text)}`);
        }
        const response = await fetch(new URL('/healthy', deployment.upstreamUrl), {
          signal: AbortSignal.timeout(3_000),
        });
        return response.ok;
      },
      timeoutMs,
      2_000,
      'Tagging server',
    );
  }

  async remove(containerId: string): Promise<void> {
    const containers = await this.docker.listContainers({
      all: true,
      filters: { label: [`${LABEL}=${containerId}`] },
    });
    for (const c of containers) await this.docker.getContainer(c.Id).remove({ force: true });
  }
}
