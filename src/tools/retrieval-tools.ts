import type { ToolDefinition, ToolExecutionContext } from './tool-types.js';
import type { RetrieverPort } from '../retrieval/retriever.js';

export function createRetrievalTools(retriever: RetrieverPort): ToolDefinition[] {
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
        const chunks = await retriever.retrieve(String(args.query), topK);
        return chunks;
      }
    }
  ];
}
