import type { ToolDefinition } from './tool-types.js';

export interface DatabasePort {
  query(req: { sql: string; params?: unknown[] }): Promise<{ rows: unknown[]; rowCount?: number } | unknown>;
}

export interface DatabaseToolsOptions {
  port: DatabasePort;
  queryToolName?: string;
  description?: string;
}

/**
 * Provider-agnostic database tool adapter.
 * Consumers decide what DB is used and enforce safety (read-only, allow-lists, etc.) in their `DatabasePort`.
 */
export function createDatabaseTools(opts: DatabaseToolsOptions): ToolDefinition[] {
  return [
    {
      name: opts.queryToolName ?? 'db_query',
      description: opts.description ?? 'Run a parameterized SQL query against an application database.',
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'SQL query text.' },
          params: { type: 'array', items: { description: 'Positional parameters.' }, description: 'Optional positional parameters.' },
        },
        required: ['sql'],
        additionalProperties: false,
      },
      capabilities: ['db:query'],
      execute: async (args: any) => {
        const sql = String(args?.sql ?? '');
        if (!sql) throw new Error('db_query: missing sql');
        const params = Array.isArray(args?.params) ? (args.params as unknown[]) : undefined;
        return opts.port.query({ sql, params });
      },
    },
  ];
}

