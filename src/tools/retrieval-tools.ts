import type { ToolDefinition, ToolExecutionContext } from './tool-types.js';
import type { RetrieverPort } from '../retrieval/retriever.js';
import type { EventBus } from '../core/event-bus.js';

export interface RetrievalToolsOptions {
  events?: EventBus;
}

export function createRetrievalTools(retriever: RetrieverPort, opts: RetrievalToolsOptions = {}): ToolDefinition[] {
  return [
    {
      name: 'retrieve_context',
      description: 'Retrieve relevant context snippets for a query.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          topK: { type: 'integer', description: 'Number of snippets.' }
        },
        required: ['query'],
        additionalProperties: false
      },
      capabilities: ['retrieval:read'],
      execute: async (args: any, _ctx: ToolExecutionContext) => {
        const topK = typeof args.topK === 'number' ? args.topK : 5;
        const query = String(args.query);
        opts.events?.emit({ type: 'retrieval_query', query, topK, at: Date.now() });
        const chunks = await retriever.retrieve(query, topK);
        opts.events?.emit({ type: 'retrieval_results', query, topK, resultCount: chunks.length, at: Date.now() });
        return chunks;
      }
    }
  ];
}
