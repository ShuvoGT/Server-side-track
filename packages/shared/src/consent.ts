export interface ConsentState {
  adStorage: boolean | null;
  analyticsStorage: boolean | null;
}

const UNKNOWN: ConsentState = { adStorage: null, analyticsStorage: null };

/**
 * Reads Consent Mode from the GA4 `gcs` parameter, which GA4 tags send with each event: G1 followed by one digit
 * for ad_storage and one for analytics_storage (G100 = both denied, G111 = both granted). Requests without it
 * say nothing about consent.
 */
export function consentFromGcs(gcs: string | null | undefined): ConsentState {
  const match = gcs?.match(/^G1([01])([01])$/);
  if (!match) return UNKNOWN;
  return { adStorage: match[1] === '1', analyticsStorage: match[2] === '1' };
}
