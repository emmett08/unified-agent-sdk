import type { EventBus } from '../core/event-bus.js';
import type { FileChange } from '../core/types.js';
import { parseUnifiedDiff, applyHunk } from './unified-diff.js';
import type { ToolDefinition, ToolExecutionContext } from './tool-types.js';
import { fileChange } from '../workspaces/workspace.js';

function utf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}
function toBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export interface FsToolOptions {
  events: EventBus;
  preview: boolean;
}

export function createFsTools(opts: FsToolOptions): ToolDefinition[] {
  const { events, preview } = opts;

  const emitChange = (change: FileChange) => events.emit({ type: 'file_change', change, at: Date.now() });

  const tools: ToolDefinition[] = [
    {
      name: 'fs_read_file',
      description: 'Read a UTF-8 text file from the workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path.' },
          maxBytes: { type: 'integer', description: 'Optional max bytes to read.' }
        },
        required: ['path'],
        additionalProperties: false
      },
      capabilities: ['fs:read'],
      execute: async (args: any, ctx: ToolExecutionContext) => {
        const bytes = await ctx.workspace.readFile(args.path);
        const max = typeof args.maxBytes === 'number' ? args.maxBytes : undefined;
        const sliced = max ? bytes.slice(0, max) : bytes;
        return utf8(sliced);
      },
    },
    {
      name: 'fs_write_file',
      description: 'Write a UTF-8 text file to the workspace, creating directories if needed.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        },
        required: ['path', 'content'],
        additionalProperties: false
      },
      capabilities: ['fs:write'],
      execute: async (args: any, ctx: ToolExecutionContext) => {
        const existed = (await ctx.workspace.stat(args.path)) !== null;
        await ctx.workspace.writeFile(args.path, toBytes(String(args.content)));
        emitChange(fileChange(existed ? 'update' : 'create', args.path, preview));
        return { ok: true };
      },
    },
    {
      name: 'fs_delete_path',
      description: 'Delete a file or directory from the workspace.',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
        additionalProperties: false
      },
      capabilities: ['fs:delete'],
      execute: async (args: any, ctx: ToolExecutionContext) => {
        await ctx.workspace.deletePath(args.path);
        emitChange(fileChange('delete', args.path, preview));
        return { ok: true };
      },
    },
    {
      name: 'fs_rename_path',
      description: 'Rename/move a file or directory within the workspace.',
      inputSchema: {
        type: 'object',
        properties: { fromPath: { type: 'string' }, toPath: { type: 'string' } },
        required: ['fromPath', 'toPath'],
        additionalProperties: false
      },
      capabilities: ['fs:rename'],
      execute: async (args: any, ctx: ToolExecutionContext) => {
        await ctx.workspace.renamePath(args.fromPath, args.toPath);
        emitChange({ kind: 'rename', fromPath: args.fromPath, toPath: args.toPath, preview });
        return { ok: true };
      },
    },
    {
      name: 'fs_apply_patch',
      description: 'Apply a unified diff patch to files. Emits file-change events per hunk.',
      inputSchema: {
        type: 'object',
        properties: {
          patch: { type: 'string', description: 'Unified diff (git style) patch.' },
          incremental: { type: 'boolean', description: 'If true, writes and emits after each hunk.' }
        },
        required: ['patch'],
        additionalProperties: false
      },
      capabilities: ['fs:write'],
      execute: async (args: any, ctx: ToolExecutionContext) => {
        const patchText = String(args.patch);
        const incremental = Boolean(args.incremental);
        const files = parseUnifiedDiff(patchText);
        const results: Array<{ path: string; hunksApplied: number }> = [];

        for (const f of files) {
          const path = f.newPath || f.oldPath;
          let text = '';
          try {
            text = utf8(await ctx.workspace.readFile(path));
          } catch {
            text = '';
          }
          const total = f.hunks.length;
          for (let hi = 0; hi < total; hi++) {
            const h = f.hunks[hi]!;
            const applied = applyHunk(text, h);
            text = applied.text;
            if (incremental) {
              await ctx.workspace.writeFile(path, toBytes(text));
              emitChange({ kind: 'patch_hunk', path, preview, hunkIndex: hi + 1, hunkCount: total });
            }
          }
          // Final write if not incremental
          if (!incremental) {
            const existed = (await ctx.workspace.stat(path)) !== null;
            await ctx.workspace.writeFile(path, toBytes(text));
            emitChange(fileChange(existed ? 'update' : 'create', path, preview));
          }
          results.push({ path, hunksApplied: total });
        }

        return { ok: true, results };
      },
    },
  ];

  return tools;
}
