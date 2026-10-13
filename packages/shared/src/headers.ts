/**
 * Request headers the gateway adds for the tagging server. Tags and variables in the server container read them
 * with request header variables. Any incoming header with this prefix is removed first, so visitors cannot
 * spoof them.
 */
export const INTERNAL_HEADER_PREFIX = 'x-sst-';

export const Headers = {
  requestId: 'x-request-id',
  geoCountry: 'x-sst-geo-country',
  geoRegion: 'x-sst-geo-region',
  geoCity: 'x-sst-geo-city',
  deviceBrowser: 'x-sst-device-browser',
  deviceBrowserVersion: 'x-sst-device-browser-version',
  deviceOs: 'x-sst-device-os',
  deviceOsVersion: 'x-sst-device-os-version',
  deviceType: 'x-sst-device-type',
  bot: 'x-sst-bot',
  botReason: 'x-sst-bot-reason',
  /** Set to the container id on webhook requests whose signature the gateway checked. */
  webhookVerified: 'x-sst-webhook-verified',
  webhookTimestamp: 'x-sst-timestamp',
  webhookSignature: 'x-sst-signature',
} as const;

/** Hop-by-hop headers (RFC 9110 section 7.6.1) that a proxy must not forward. */
export const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
