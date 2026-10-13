export interface CachedResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  expiresAt: number;
}

/** Short-lived cache for gtm.js and gtag.js responses, which every page view requests. */
export class LoaderCache {
  private readonly entries = new Map<string, CachedResponse>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 2_000,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): CachedResponse | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  set(key: string, value: Omit<CachedResponse, 'expiresAt'>): void {
    if (this.ttlMs <= 0) return;
    this.entries.delete(key);
    this.entries.set(key, { ...value, expiresAt: this.now() + this.ttlMs });
    if (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
  }
}
