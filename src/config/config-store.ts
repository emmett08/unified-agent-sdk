export interface ConfigStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryConfigStore implements ConfigStore {
  private readonly m = new Map<string, unknown>();
  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.m.get(key) as T | undefined;
  }
  async set<T = unknown>(key: string, value: T): Promise<void> {
    this.m.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.m.delete(key);
  }
}

