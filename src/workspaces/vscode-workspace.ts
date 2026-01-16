import type { StatLike, WorkspacePort } from './workspace.js';

type VSCodeUri = { fsPath: string; scheme: string; path: string; toString(): string };
type VSCodeApi = {
  Uri: { file(path: string): VSCodeUri; joinPath(base: VSCodeUri, ...paths: string[]): VSCodeUri };
  workspace: {
    fs: {
      readFile(uri: VSCodeUri): Promise<Uint8Array>;
      writeFile(uri: VSCodeUri, contents: Uint8Array): Promise<void>;
      delete(uri: VSCodeUri, options: { recursive: boolean; useTrash: boolean }): Promise<void>;
      rename(oldUri: VSCodeUri, newUri: VSCodeUri, options: { overwrite: boolean }): Promise<void>;
      stat(uri: VSCodeUri): Promise<{ type: number; mtime: number; size: number }>;
    };
    applyEdit(edit: unknown): Promise<boolean>;
  };
  WorkspaceEdit: new () => { createFile(uri: VSCodeUri, options?: { overwrite?: boolean; ignoreIfExists?: boolean }): void;
    deleteFile(uri: VSCodeUri, options?: { recursive?: boolean; ignoreIfNotExists?: boolean }): void;
    replace(uri: VSCodeUri, range: unknown, newText: string): void;
    renameFile(oldUri: VSCodeUri, newUri: VSCodeUri, options?: { overwrite?: boolean; ignoreIfExists?: boolean }): void;
  };
  Range: new (startLine: number, startChar: number, endLine: number, endChar: number) => unknown;
};

export interface VSCodeWorkspaceOptions {
  vscode: VSCodeApi;
  workspaceRoot: VSCodeUri;
  /** Prefer WorkspaceEdit (updates open editors more reliably). */
  preferWorkspaceEdit?: boolean;
}

export class VSCodeWorkspace implements WorkspacePort {
  constructor(private readonly opts: VSCodeWorkspaceOptions) {}

  private uri(path: string): VSCodeUri {
    const { vscode, workspaceRoot } = this.opts;
    if (path.startsWith('/')) return vscode.Uri.file(path);
    return vscode.Uri.joinPath(workspaceRoot, ...path.split('/'));
  }

  async readFile(path: string): Promise<Uint8Array> {
    return this.opts.vscode.workspace.fs.readFile(this.uri(path));
  }

  async writeFile(path: string, contents: Uint8Array): Promise<void> {
    // In VS Code, prefer WorkspaceEdit to update open editors immediately.
    if (this.opts.preferWorkspaceEdit) {
      // Replace whole file. For incremental hunks, the patch tool writes per hunk so UI updates.
      const { vscode } = this.opts;
      const edit = new vscode.WorkspaceEdit();
      const uri = this.uri(path);
      const text = new TextDecoder('utf-8').decode(contents);
      edit.createFile(uri, { overwrite: true });
      // Replace range (0,0)-(MAX,0). VS Code doesn't expose a "whole document" range without reading it;
      // we approximate by using a large end line.
      edit.replace(uri, new vscode.Range(0, 0, 10_000_000, 0), text);
      await vscode.workspace.applyEdit(edit);
      return;
    }
    await this.opts.vscode.workspace.fs.writeFile(this.uri(path), contents);
  }

  async deletePath(path: string): Promise<void> {
    const { vscode } = this.opts;
    if (this.opts.preferWorkspaceEdit) {
      const edit = new vscode.WorkspaceEdit();
      edit.deleteFile(this.uri(path), { recursive: true, ignoreIfNotExists: true });
      await vscode.workspace.applyEdit(edit);
      return;
    }
    await vscode.workspace.fs.delete(this.uri(path), { recursive: true, useTrash: false });
  }

  async renamePath(fromPath: string, toPath: string): Promise<void> {
    const { vscode } = this.opts;
    if (this.opts.preferWorkspaceEdit) {
      const edit = new vscode.WorkspaceEdit();
      edit.renameFile(this.uri(fromPath), this.uri(toPath), { overwrite: true });
      await vscode.workspace.applyEdit(edit);
      return;
    }
    await vscode.workspace.fs.rename(this.uri(fromPath), this.uri(toPath), { overwrite: true });
  }

  async stat(path: string): Promise<StatLike | null> {
    try {
      const s = await this.opts.vscode.workspace.fs.stat(this.uri(path));
      // vscode.FileType: 1 file, 2 dir; but treat any non-zero as exists.
      const isFile = (s.type & 1) === 1;
      const isDirectory = (s.type & 2) === 2;
      return { isFile, isDirectory, mtimeMs: s.mtime, size: s.size };
    } catch {
      return null;
    }
  }
}
