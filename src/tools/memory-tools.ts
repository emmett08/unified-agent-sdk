import type { ToolDefinition, ToolExecutionContext } from './tool-types.js';
import type { EventBus } from '../core/event-bus.js';

export interface MemoryToolsOptions {
  events?: EventBus;
}

export function createMemoryTools(opts: MemoryToolsOptions = {}): ToolDefinition[] {
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
        const key = String(args.key);
        const value = ctx.memory.kv.get(key);
        opts.events?.emit({ type: 'memory_read', key, value, at: Date.now() });
        return value;
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
        const key = String(args.key);
        ctx.memory.kv.set(key, args.value);
        opts.events?.emit({ type: 'memory_write', key, value: args.value, at: Date.now() });
        return { ok: true };
      }
    }
  ];
}
