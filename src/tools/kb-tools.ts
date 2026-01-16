import type { ToolDefinition } from './tool-types.js';

export interface KnowledgeBasePort {
  search(req: { query: string; topK: number }): Promise<unknown[]>;
}

export interface KnowledgeBaseToolsOptions {
  port: KnowledgeBasePort;
  searchToolName?: string;
  description?: string;
  defaultTopK?: number;
}

/**
 * Provider-agnostic knowledge base tool adapter (e.g. internal docs, embeddings-backed search, etc.).
 * Consumers supply the KB implementation via `KnowledgeBasePort`.
 */
export function createKnowledgeBaseTools(opts: KnowledgeBaseToolsOptions): ToolDefinition[] {
  const defaultTopK = opts.defaultTopK ?? 5;
  return [
    {
      name: opts.searchToolName ?? 'kb_search',
      description: opts.description ?? 'Search an internal knowledge base and return relevant snippets.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          topK: { type: 'integer', description: 'Number of results.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      capabilities: ['kb:read'],
      execute: async (args: any) => {
        const query = String(args?.query ?? '');
        if (!query) throw new Error('kb_search: missing query');
        const topK = typeof args?.topK === 'number' ? args.topK : defaultTopK;
        return opts.port.search({ query, topK });
      },
    },
  ];
}

