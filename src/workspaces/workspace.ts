import type { FileChange, FileChangeKind } from '../core/types.js';

export interface StatLike {
  isFile: boolean;
  isDirectory: boolean;
  mtimeMs?: number;
  size?: number;
}

export interface WorkspacePort {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, contents: Uint8Array): Promise<void>;
  deletePath(path: string): Promise<void>;
  renamePath(fromPath: string, toPath: string): Promise<void>;
  stat(path: string): Promise<StatLike | null>;
  /** Optional: list file paths (used by some indexing / preview UIs). */
  listFiles?(glob?: string): Promise<string[]>;
}

export interface WorkspaceOverlayCommit {
  commit(): Promise<void>;
  discard(): Promise<void>;
  getPendingChanges(): FileChange[];
}

export interface WorkspaceModeConfig {
  mode: 'live' | 'preview';
}

export function fileChange(kind: FileChangeKind, path: string, preview: boolean, extra?: Partial<FileChange>): FileChange {
  return { kind, path, preview, ...extra };
}
