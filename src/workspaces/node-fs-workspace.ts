import type { StatLike, WorkspacePort } from './workspace.js';
import { dynamicImport } from '../utils/dynamic-import.js';

export class NodeFsWorkspace implements WorkspacePort {
  constructor(private rootDir: string) {}

  private resolve(path: string): string {
    if (path.startsWith('/')) return path;
    return `${this.rootDir.replace(/\/$/, '')}/${path}`;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const fs = await dynamicImport('node:fs/promises');
    return await fs.readFile(this.resolve(path));
  }

  async writeFile(path: string, contents: Uint8Array): Promise<void> {
    const fs = await dynamicImport('node:fs/promises');
    const p = await dynamicImport('node:path');
    const abs = this.resolve(path);
    await fs.mkdir(p.dirname(abs), { recursive: true });
    await fs.writeFile(abs, contents);
  }

  async deletePath(path: string): Promise<void> {
    const fs = await dynamicImport('node:fs/promises');
    await fs.rm(this.resolve(path), { force: true, recursive: true });
  }

  async renamePath(fromPath: string, toPath: string): Promise<void> {
    const fs = await dynamicImport('node:fs/promises');
    const p = await dynamicImport('node:path');
    const fromAbs = this.resolve(fromPath);
    const toAbs = this.resolve(toPath);
    await fs.mkdir(p.dirname(toAbs), { recursive: true });
    await fs.rename(fromAbs, toAbs);
  }

  async stat(path: string): Promise<StatLike | null> {
    const fs = await dynamicImport('node:fs/promises');
    try {
      const s = await fs.stat(this.resolve(path));
      return { isFile: s.isFile(), isDirectory: s.isDirectory(), mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      return null;
    }
  }
}
