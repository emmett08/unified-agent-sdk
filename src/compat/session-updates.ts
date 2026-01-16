import type { AgentEvent, AgentEventMeta, ToolCall, ToolResult } from '../core/types.js';

export interface SessionUpdateHooks {
  onMessage?: (textChunk: string) => void | Promise<void>;
  onThought?: (thoughtChunk: string) => void | Promise<void>;
  /**
   * Compatibility hook that fires once a tool call has a resolved result.
   * `argsText`/`resultText` are typically JSON strings for downstream UIs.
   */
  onToolCall?: (toolName: string, argsText?: string, resultText?: string) => void | Promise<void>;
}

export interface ToolCallAggregatorHooks {
  onToolCallResolved?: (call: ToolCall, result: ToolResult, meta?: AgentEventMeta) => void | Promise<void>;
}

/**
 * Joins `tool_call` + `tool_result` events by `id` and emits a single callback.
 * This is useful for downstream adapters that expect a "resolved tool call" shape.
 */
export class ToolCallAggregator {
  private readonly pending = new Map<string, { call: ToolCall; meta?: AgentEventMeta }>();

  constructor(private readonly hooks: ToolCallAggregatorHooks) {}

  onEvent(ev: AgentEvent): void {
    if (ev.type === 'tool_call') {
      this.pending.set(ev.call.id, { call: ev.call, meta: ev.meta });
      return;
    }

    if (ev.type !== 'tool_result') return;

    const joined = this.pending.get(ev.result.id);
    const call: ToolCall = joined?.call ?? { id: ev.result.id, toolName: ev.result.toolName, args: undefined };
    const meta = joined?.meta ?? ev.meta;
    this.pending.delete(ev.result.id);
    void Promise.resolve(this.hooks.onToolCallResolved?.(call, ev.result, meta)).catch(() => {});
  }
}

export function attachSessionUpdates(bus: { subscribe: (h: (ev: AgentEvent) => void | Promise<void>) => () => void }, hooks: SessionUpdateHooks): () => void {
  const aggregator = new ToolCallAggregator({
    onToolCallResolved: (call, result) => hooks.onToolCall?.(call.toolName, safeJson(call.args), safeJson(result.result)),
  });

  return bus.subscribe((ev) => {
    if (ev.type === 'text_delta') return hooks.onMessage?.(ev.text);
    if (ev.type === 'thinking_delta') return hooks.onThought?.(ev.text);
    aggregator.onEvent(ev);
  });
}

function safeJson(v: unknown): string | undefined {
  try {
    return JSON.stringify(v);
  } catch {
    return undefined;
  }
}

