import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** HMAC-SHA256 over `${timestamp}.${body}`, hex encoded. The WooCommerce plugin signs the same way. */
export function signWebhook(secret: string, timestamp: number, body: string | Buffer): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
}

export type WebhookCheck = { ok: true } | { ok: false; reason: 'missing' | 'stale' | 'mismatch' };

export function verifyWebhook(
  secret: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  body: Buffer,
  nowSeconds = Math.floor(Date.now() / 1000),
): WebhookCheck {
  if (!timestampHeader || !signatureHeader) return { ok: false, reason: 'missing' };
  const timestamp = Number(timestampHeader);
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'stale' };
  }
  const expected = Buffer.from(signWebhook(secret, timestamp, body), 'hex');
  const given = Buffer.from(signatureHeader.trim().toLowerCase(), 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return { ok: false, reason: 'mismatch' };
  return { ok: true };
}
