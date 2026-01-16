import { LruCache } from './lru.js';

export interface SharedMemoryPoolOptions {
  kvMaxEntries?: number;
  embeddingMaxEntries?: number;
  fileSnapshotMaxEntries?: number;
  ttlMs?: number;
}

export class SharedMemoryPool {
  readonly kv: LruCache<string, unknown>;
  readonly embeddings: LruCache<string, number[]>;
  readonly fileSnapshots: LruCache<string, { hash: string; bytes: Uint8Array }>;

  constructor(opts: SharedMemoryPoolOptions = {}) {
    const ttlMs = opts.ttlMs ?? 15 * 60_000;
    this.kv = new LruCache({ maxEntries: opts.kvMaxEntries ?? 1024, ttlMs });
    this.embeddings = new LruCache({ maxEntries: opts.embeddingMaxEntries ?? 4096, ttlMs });
    this.fileSnapshots = new LruCache({ maxEntries: opts.fileSnapshotMaxEntries ?? 1024, ttlMs });
  }

  scoped(namespace: string): ScopedMemory {
    const prefix = namespace.endsWith(':') ? namespace : `${namespace}:`;
    return new ScopedMemory(this, prefix);
  }
}

export class ScopedMemory {
  constructor(private base: SharedMemoryPool, private prefix: string) {}

  get<T>(key: string): T | undefined {
    return this.base.kv.get(this.prefix + key) as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.base.kv.set(this.prefix + key, value);
  }

  getEmbedding(key: string): number[] | undefined {
    return this.base.embeddings.get(this.prefix + key);
  }

  setEmbedding(key: string, value: number[]): void {
    this.base.embeddings.set(this.prefix + key, value);
  }
}
