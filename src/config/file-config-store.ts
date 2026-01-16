import fs from 'node:fs/promises';
import path from 'node:path';
import type { ConfigStore } from './config-store.js';

type JsonObject = Record<string, unknown>;

export interface FileConfigStoreOptions {
  filePath: string;
}

export class FileConfigStore implements ConfigStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(opts: FileConfigStoreOptions) {
    this.filePath = opts.filePath;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const obj = await this.readAll();
    return obj[key] as T | undefined;
  }

  async set<T = unknown>(key: string, value: T): Promise<void> {
    await this.enqueue(async () => {
      const obj = await this.readAll();
      obj[key] = value as unknown;
      await this.writeAll(obj);
    });
  }

  async delete(key: string): Promise<void> {
    await this.enqueue(async () => {
      const obj = await this.readAll();
      delete obj[key];
      await this.writeAll(obj);
    });
  }

  private async enqueue(fn: () => Promise<void>): Promise<void> {
    this.writeQueue = this.writeQueue.then(fn, fn);
    return this.writeQueue;
  }

  private async readAll(): Promise<JsonObject> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonObject) : {}) as JsonObject;
    } catch (e: any) {
      if (e?.code === 'ENOENT') return {};
      throw e;
    }
  }

  private async writeAll(obj: JsonObject): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  }
}

