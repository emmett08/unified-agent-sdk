import type { ToolDefinition, ToolExecutionContext } from './tool-types.js';

export function createMemoryTools(): ToolDefinition[] {
  return [
    {
      name: 'memory_get',
      description: 'Get a value from shared memory (KV).',
      inputSchema: {
        type: 'object',
        properties: { key: { type: 'string' } },
        required: ['key'],
        additionalProperties: false
      },
      capabilities: ['memory:read'],
      execute: async (args: any, ctx: ToolExecutionContext) => {
        return ctx.memory.kv.get(String(args.key));
      }
    },
    {
      name: 'memory_set',
      description: 'Set a value in shared memory (KV).',
      inputSchema: {
        type: 'object',
        properties: { key: { type: 'string' }, value: { description: 'Any JSON-serialisable value.' } },
        required: ['key', 'value'],
        additionalProperties: false
      },
      capabilities: ['memory:write'],
      execute: async (args: any, ctx: ToolExecutionContext) => {
        ctx.memory.kv.set(String(args.key), args.value);
        return { ok: true };
      }
    }
  ];
}
