import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

export type Outcome =
  | 'proxied'
  | 'loader_hit'
  | 'loader_miss'
  | 'gtag_fallback'
  | 'webhook'
  | 'webhook_rejected'
  | 'bot_dropped'
  | 'unknown_host'
  | 'bad_request'
  | 'upstream_error';

export interface GatewayMetrics {
  registry: Registry;
  requests: Counter<'outcome'>;
  upstreamSeconds: Histogram<'kind'>;
}

export function createMetrics(withDefaults = true): GatewayMetrics {
  const registry = new Registry();
  if (withDefaults) collectDefaultMetrics({ register: registry });
  return {
    registry,
    requests: new Counter({
      name: 'sst_gateway_requests_total',
      help: 'Requests handled by the edge gateway, by outcome.',
      labelNames: ['outcome'],
      registers: [registry],
    }),
    upstreamSeconds: new Histogram({
      name: 'sst_gateway_upstream_duration_seconds',
      help: 'Time waiting for the tagging server.',
      labelNames: ['kind'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 0.8, 1.5, 3, 10, 30],
      registers: [registry],
    }),
  };
}
