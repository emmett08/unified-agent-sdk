import type { StatLike, WorkspacePort } from './workspace.js';

type JournalOp =
  | { kind: 'write'; path: string; before: Uint8Array | null }
  | { kind: 'delete'; path: string; before: Uint8Array | null }
  | { kind: 'rename'; fromPath: string; toPath: string; beforeFrom: Uint8Array | null; beforeTo: Uint8Array | null };

export class JournalWorkspace implements WorkspacePort {
  private readonly ops: JournalOp[] = [];

  constructor(private readonly base: WorkspacePort) {}

  async rollback(): Promise<void> {
    // Reverse operations
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const op = this.ops[i]!;
      if (op.kind === 'write') {
        if (op.before === null) await this.base.deletePath(op.path);
        else await this.base.writeFile(op.path, op.before);
      } else if (op.kind === 'delete') {
        if (op.before !== null) await this.base.writeFile(op.path, op.before);
      } else if (op.kind === 'rename') {
        // Undo rename: restore both sides
        await this.base.renamePath(op.toPath, op.fromPath).catch(() => {});
        if (op.beforeFrom === null) await this.base.deletePath(op.fromPath).catch(() => {});
        else await this.base.writeFile(op.fromPath, op.beforeFrom).catch(() => {});
        if (op.beforeTo === null) await this.base.deletePath(op.toPath).catch(() => {});
        else await this.base.writeFile(op.toPath, op.beforeTo).catch(() => {});
      }
    }
    this.ops.length = 0;
  }

  commit(): void {
    this.ops.length = 0;
  }

  async readFile(path: string): Promise<Uint8Array> {
    return this.base.readFile(path);
  }

  async writeFile(path: string, contents: Uint8Array): Promise<void> {
    const before = await this.base.readFile(path).catch(() => null);
    this.ops.push({ kind: 'write', path, before });
    await this.base.writeFile(path, contents);
  }

  async deletePath(path: string): Promise<void> {
    const before = await this.base.readFile(path).catch(() => null);
    this.ops.push({ kind: 'delete', path, before });
    await this.base.deletePath(path);
  }

  async renamePath(fromPath: string, toPath: string): Promise<void> {
    const beforeFrom = await this.base.readFile(fromPath).catch(() => null);
    const beforeTo = await this.base.readFile(toPath).catch(() => null);
    this.ops.push({ kind: 'rename', fromPath, toPath, beforeFrom, beforeTo });
    await this.base.renamePath(fromPath, toPath);
  }

  async stat(path: string): Promise<StatLike | null> {
    return this.base.stat(path);
  }

  listFiles?(glob?: string): Promise<string[]> {
    return this.base.listFiles ? this.base.listFiles(glob) : Promise.resolve([]);
  }
}
