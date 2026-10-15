/** The parts of a container the provisioner needs, from the API's internal port. */
export interface ContainerRecord {
  id: string;
  name: string;
  gtmContainerId: string;
  containerConfig: string;
  status: 'pending' | 'provisioning' | 'active' | 'failed' | 'deleting';
  upstreamUrl: string;
  /** Verified tracking domains. */
  domains?: string[];
}

export interface StatusReport {
  status: 'provisioning' | 'active' | 'failed';
  message?: string | null;
  upstreamUrl?: string;
}

/** Reads containers and reports progress to the control plane API. */
export interface ControlPlane {
  getContainer(id: string): Promise<ContainerRecord | null>;
  reportStatus(id: string, report: StatusReport): Promise<void>;
  /** Removes the container record once its resources are gone. */
  forget(id: string): Promise<void>;
}

export class HttpControlPlane implements ControlPlane {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(new URL(path, this.baseUrl), {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  }

  async getContainer(id: string) {
    const response = await this.call('GET', `/internal/containers/${encodeURIComponent(id)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`API answered ${response.status} reading container ${id}`);
    return (await response.json()) as ContainerRecord;
  }

  async reportStatus(id: string, report: StatusReport) {
    const response = await this.call('POST', `/internal/containers/${encodeURIComponent(id)}/status`, report);
    // 404: deleted meanwhile. 409: being deleted. Neither needs a report.
    if (response.status === 404 || response.status === 409) return;
    if (!response.ok) throw new Error(`API answered ${response.status} to a status report for ${id}`);
  }

  async forget(id: string) {
    const response = await this.call('DELETE', `/internal/containers/${encodeURIComponent(id)}`);
    if (!response.ok && response.status !== 404)
      throw new Error(`API answered ${response.status} deleting ${id}`);
  }
}
