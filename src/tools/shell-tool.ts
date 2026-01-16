import type { ToolDefinition } from './tool-types.js';

export interface ShellPort {
  run(req: { command: string[]; cwd?: string; env?: Record<string, string> }): Promise<{ stdout: string; stderr?: string; exitCode?: number }>;
}

export interface ShellToolOptions {
  port: ShellPort;
  name?: string;
  description?: string;
}

/**
 * Provider-agnostic "shell" tool adapter.
 * Consumers supply the actual sandbox/runner via `ShellPort`.
 */
export function createShellTool(opts: ShellToolOptions): ToolDefinition {
  return {
    name: opts.name ?? 'shell',
    description: opts.description ?? 'Run a command in a sandboxed shell environment.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'object',
          properties: {
            command: { type: 'array', items: { type: 'string' }, description: 'Command argv, e.g. [\"ls\",\"-la\"].' },
            cwd: { type: 'string', description: 'Optional working directory.' },
            env: { type: 'object', description: 'Optional environment variables.' },
          },
          required: ['command'],
          additionalProperties: false,
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    capabilities: ['system:shell'],
    execute: async (args: any) => {
      const action = args?.action ?? {};
      const command = Array.isArray(action.command) ? action.command.map(String) : [];
      if (!command.length) throw new Error('shell: missing action.command');
      const cwd = typeof action.cwd === 'string' ? action.cwd : undefined;
      const env = action.env && typeof action.env === 'object' ? (action.env as Record<string, string>) : undefined;
      return opts.port.run({ command, cwd, env });
    },
  };
}

