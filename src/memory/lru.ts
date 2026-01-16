export interface LruOptions {
  maxEntries: number;
  ttlMs?: number;
}

type Entry<V> = { value: V; expiresAt: number | null };

export class LruCache<K, V> {
  private readonly map = new Map<K, Entry<V>>();
  private readonly maxEntries: number;
  private readonly ttlMs?: number;

  constructor(opts: LruOptions) {
    this.maxEntries = Math.max(1, opts.maxEntries);
    this.ttlMs = opts.ttlMs;
  }

  get size(): number {
    this.pruneExpired();
    return this.map.size;
  }

  get(key: K): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== null && Date.now() > e.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh LRU
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: K, value: V): void {
    const expiresAt = this.ttlMs ? Date.now() + this.ttlMs : null;
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt });
    this.evictIfNeeded();
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [k, e] of this.map.entries()) {
      if (e.expiresAt !== null && now > e.expiresAt) this.map.delete(k);
    }
  }

  private evictIfNeeded(): void {
    this.pruneExpired();
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value as K | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}
