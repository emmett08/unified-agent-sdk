import type { JsonSchema } from '../core/types.js';
import type { WorkspacePort } from '../workspaces/workspace.js';
import type { SharedMemoryPool } from '../memory/shared-memory-pool.js';

export interface ToolExecutionContext {
  workspace: WorkspacePort;
  memory: SharedMemoryPool;
  /** Arbitrary run-scoped metadata. */
  metadata: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  capabilities?: string[];
  execute(args: unknown, ctx: ToolExecutionContext): Promise<unknown> | unknown;
}
