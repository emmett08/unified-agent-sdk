import type { FileChange } from '../core/types.js';
import type { StatLike, WorkspaceOverlayCommit, WorkspacePort } from './workspace.js';

type OverlayEntry =
  | { kind: 'write'; bytes: Uint8Array; existedBefore: boolean; path: string }
  | { kind: 'delete'; existedBefore: boolean; path: string }
  | { kind: 'rename'; fromPath: string; toPath: string; existedBefore: boolean };

export class PreviewWorkspace implements WorkspacePort, WorkspaceOverlayCommit {
  private readonly overlay = new Map<string, OverlayEntry>();
  private readonly pending: FileChange[] = [];

  constructor(private readonly base: WorkspacePort) {}

  getPendingChanges(): FileChange[] {
    return [...this.pending];
  }

  async commit(): Promise<void> {
    // Apply renames first.
    for (const entry of this.overlay.values()) {
      if (entry.kind === 'rename') {
        await this.base.renamePath(entry.fromPath, entry.toPath);
      }
    }
    // Then deletes/writes.
    for (const entry of this.overlay.values()) {
      if (entry.kind === 'write') {
        await this.base.writeFile(entry.path, entry.bytes);
      } else if (entry.kind === 'delete') {
        await this.base.deletePath(entry.path);
      }
    }
    this.overlay.clear();
    this.pending.length = 0;
  }

  async discard(): Promise<void> {
    this.overlay.clear();
    this.pending.length = 0;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const entry = this.overlay.get(path);
    if (entry?.kind === 'write') return entry.bytes;
    if (entry?.kind === 'delete') throw new Error(`File deleted in preview: ${path}`);
    return await this.base.readFile(path);
  }

  async writeFile(path: string, contents: Uint8Array): Promise<void> {
    const existed = (await this.base.stat(path)) !== null;
    this.overlay.set(path, { kind: 'write', bytes: contents, existedBefore: existed, path });
  }

  async deletePath(path: string): Promise<void> {
    const existed = (await this.base.stat(path)) !== null;
    this.overlay.set(path, { kind: 'delete', existedBefore: existed, path });
  }

  async renamePath(fromPath: string, toPath: string): Promise<void> {
    const existed = (await this.base.stat(fromPath)) !== null;
    this.overlay.set(`${fromPath}→${toPath}`, { kind: 'rename', fromPath, toPath, existedBefore: existed });
  }

  async stat(path: string): Promise<StatLike | null> {
    const entry = this.overlay.get(path);
    if (entry?.kind === 'delete') return null;
    if (entry?.kind === 'write') return { isFile: true, isDirectory: false, size: entry.bytes.byteLength };
    return await this.base.stat(path);
  }

  listFiles?(glob?: string): Promise<string[]> {
    return this.base.listFiles ? this.base.listFiles(glob) : Promise.resolve([]);
  }
}
