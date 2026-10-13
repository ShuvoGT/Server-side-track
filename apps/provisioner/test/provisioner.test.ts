import { describe, expect, it } from 'vitest';
import type { ContainerRecord, ControlPlane, StatusReport } from '../src/controlPlane.js';
import { explainCrash } from '../src/drivers/docker.js';
import { containerManifests, upstreamFor } from '../src/drivers/manifests.js';
import { poll, PollAbort, type ContainerSpec, type Deployment, type Driver } from '../src/drivers/types.js';
import { processJob, type Logger } from '../src/processor.js';

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/* eslint-disable @typescript-eslint/no-explicit-any */
describe('containerManifests', () => {
  const objects = containerManifests(
    { id: 'cabc123', containerConfig: 'aWQ9R1RNLVg=' },
    {
      image: 'harbor.internal/gtm/gtm-cloud-image:2026-10-13',
      taggingReplicas: 2,
      gatewayNamespace: 'platform-system',
    },
  ) as any[];
  const byKind = (kind: string, name?: string) =>
    objects.find((o) => o.kind === kind && (!name || o.metadata.name === name));

  it('puts everything in the ctr-<id> namespace', () => {
    expect(byKind('Namespace').metadata.name).toBe('ctr-cabc123');
    for (const o of objects.filter((o) => o.kind !== 'Namespace'))
      expect(o.metadata.namespace).toBe('ctr-cabc123');
    expect(upstreamFor('cabc123')).toBe('http://tagging.ctr-cabc123.svc.cluster.local:8080');
  });

  it('keeps the Container Config in a secret', () => {
    expect(byKind('Secret').stringData).toEqual({ CONTAINER_CONFIG: 'aWQ9R1RNLVg=' });
    const env = byKind('Deployment', 'tagging').spec.template.spec.containers[0].env;
    expect(env[0].valueFrom.secretKeyRef).toEqual({ name: 'gtm-config', key: 'CONTAINER_CONFIG' });
  });

  it('sizes tagging servers by the capacity plan and points them at the preview server', () => {
    const tagging = byKind('Deployment', 'tagging');
    const c = tagging.spec.template.spec.containers[0];
    expect(tagging.spec.replicas).toBe(2);
    expect(c.image).toBe('harbor.internal/gtm/gtm-cloud-image:2026-10-13');
    expect(c.resources).toEqual({
      requests: { cpu: '250m', memory: '384Mi' },
      limits: { cpu: '1', memory: '512Mi' },
    });
    expect(c.readinessProbe.httpGet.path).toBe('/healthy');
    expect(c.env).toContainEqual({
      name: 'PREVIEW_SERVER_URL',
      value: 'http://preview.ctr-cabc123.svc.cluster.local:8080',
    });
    expect(tagging.spec.template.spec.topologySpreadConstraints).toHaveLength(1);
  });

  it('runs exactly one preview server in preview mode', () => {
    const preview = byKind('Deployment', 'preview');
    expect(preview.spec.replicas).toBe(1);
    expect(preview.spec.strategy.type).toBe('Recreate');
    expect(preview.spec.template.spec.containers[0].env).toContainEqual({
      name: 'RUN_AS_PREVIEW_SERVER',
      value: 'true',
    });
  });

  it('only lets the gateway namespace in', () => {
    const from = byKind('NetworkPolicy').spec.ingress[0].from;
    expect(from[0].namespaceSelector.matchLabels).toEqual({
      'kubernetes.io/metadata.name': 'platform-system',
    });
    expect(byKind('PodDisruptionBudget').spec.minAvailable).toBe(1);
  });
});

class FakeControlPlane implements ControlPlane {
  reports: StatusReport[] = [];
  forgotten: string[] = [];
  constructor(public record: ContainerRecord | null) {}
  async getContainer() {
    return this.record;
  }
  async reportStatus(_id: string, report: StatusReport) {
    this.reports.push(report);
  }
  async forget(id: string) {
    this.forgotten.push(id);
  }
}

class FakeDriver implements Driver {
  readonly name: string;
  calls: string[] = [];
  constructor(
    private readonly behaviour: { removeOnFailure?: boolean; failReady?: boolean } = {},
    name = 'kubernetes',
  ) {
    this.name = name;
  }
  async apply(spec: ContainerSpec): Promise<Deployment> {
    this.calls.push(`apply:${spec.id}`);
    return {
      upstreamUrl: `http://tagging.ctr-${spec.id}:8080`,
      removeOnFailure: this.behaviour.removeOnFailure ?? true,
    };
  }
  async waitReady() {
    this.calls.push('waitReady');
    if (this.behaviour.failReady) throw new Error('Tagging servers not ready after 300 s');
  }
  async remove(id: string) {
    this.calls.push(`remove:${id}`);
  }
}

const record = (status: ContainerRecord['status'] = 'provisioning'): ContainerRecord => ({
  id: 'c1',
  name: 'Shop',
  gtmContainerId: 'GTM-SRV1234',
  containerConfig: 'aWQ9R1RNLVg=',
  status,
  upstreamUrl: 'http://old:8080',
});

describe('processJob', () => {
  const deps = (driver: Driver, controlPlane: ControlPlane) => ({
    driver,
    controlPlane,
    readyTimeoutMs: 1_000,
    log: silent,
  });

  it('applies, waits for health and reports the container active with its upstream', async () => {
    const cp = new FakeControlPlane(record());
    const driver = new FakeDriver();
    await processJob({ type: 'apply', containerId: 'c1' }, deps(driver, cp));
    expect(driver.calls).toEqual(['apply:c1', 'waitReady']);
    expect(cp.reports.map((r) => r.status)).toEqual(['provisioning', 'active']);
    expect(cp.reports[1]).toEqual({
      status: 'active',
      message: null,
      upstreamUrl: 'http://tagging.ctr-c1:8080',
    });
  });

  it('rolls back a new container that never became healthy, and rethrows for a retry', async () => {
    const cp = new FakeControlPlane(record());
    const driver = new FakeDriver({ removeOnFailure: true, failReady: true });
    await expect(processJob({ type: 'apply', containerId: 'c1' }, deps(driver, cp))).rejects.toThrow(
      'not ready',
    );
    expect(driver.calls).toEqual(['apply:c1', 'waitReady', 'remove:c1']);
    expect(cp.reports.at(-1)).toMatchObject({
      status: 'failed',
      message: 'Tagging servers not ready after 300 s.',
    });
  });

  it('keeps an existing container running when an update fails', async () => {
    const cp = new FakeControlPlane(record('active'));
    const driver = new FakeDriver({ removeOnFailure: false, failReady: true });
    await expect(processJob({ type: 'apply', containerId: 'c1' }, deps(driver, cp))).rejects.toThrow();
    expect(driver.calls).not.toContain('remove:c1');
    expect(cp.reports.at(-1)!.message).toContain('previous servers keep running');
  });

  it('skips containers that are gone or being deleted', async () => {
    for (const cp of [new FakeControlPlane(null), new FakeControlPlane(record('deleting'))]) {
      const driver = new FakeDriver();
      await processJob({ type: 'apply', containerId: 'c1' }, deps(driver, cp));
      expect(driver.calls).toEqual([]);
      expect(cp.reports).toEqual([]);
    }
  });

  it('deletes resources, then the record', async () => {
    const cp = new FakeControlPlane(record('deleting'));
    const driver = new FakeDriver();
    await processJob({ type: 'delete', containerId: 'c1' }, deps(driver, cp));
    expect(driver.calls).toEqual(['remove:c1']);
    expect(cp.forgotten).toEqual(['c1']);
  });

  it('ignores a delete job for a container that is not being deleted', async () => {
    const cp = new FakeControlPlane(record('active'));
    const driver = new FakeDriver();
    await processJob({ type: 'delete', containerId: 'c1' }, deps(driver, cp));
    expect(driver.calls).toEqual([]);
    expect(cp.forgotten).toEqual([]);
  });
});

describe('poll', () => {
  it('retries until ready, times out, and stops at once on PollAbort', async () => {
    let n = 0;
    await poll(async () => ++n >= 3, 1_000, 1, 'thing');
    expect(n).toBe(3);
    await expect(poll(async () => false, 20, 5, 'thing')).rejects.toThrow('thing not ready');
    const started = Date.now();
    await expect(
      poll(
        async () => {
          throw new PollAbort('crashed');
        },
        10_000,
        5,
        'thing',
      ),
    ).rejects.toThrow('crashed');
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('explainCrash', () => {
  it('recognises a network that blocks Google tag domains', () => {
    const logs = ['Error: connect ECONNREFUSED 0.0.0.0:443', '    at TCPConnectWrap.afterConnect'].join('\n');
    expect(explainCrash(logs)).toContain('resolves Google tag domains');
  });

  it('falls back to the last log lines', () => {
    expect(explainCrash(['a', 'b', 'something odd'].join('\n'))).toBe(
      'Last log lines: a | b | something odd',
    );
  });
});
