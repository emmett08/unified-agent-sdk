import type { EventBus } from '../core/event-bus.js';
import type { ToolCall, ToolResult } from '../core/types.js';
import type { ToolDefinition, ToolExecutionContext } from './tool-types.js';
import type { ToolPolicy } from '../policies/tool-policy.js';
import { ToolDeniedError } from '../core/errors.js';
import { RunController } from '../core/run-controller.js';

export interface ToolExecutorOptions {
  tools: ToolDefinition[];
  policy: ToolPolicy;
  controller: RunController;
  events: EventBus;
  execContext: ToolExecutionContext;
  /**
   * If true, any tool that a policy marks as `ask` will emit `tool_approval_request`
   * and block until `run.approveToolCall(id, allowed)` is called.
   */
  requireExplicitApproval?: boolean;
  /** If false, this executor will not emit tool_call/tool_result events (use provider-native tool events instead). */
  emitToolEvents?: boolean;
}

export class ToolExecutor {
  private readonly byName = new Map<string, ToolDefinition>();
  private readonly emitToolEvents: boolean;

  constructor(private readonly opts: ToolExecutorOptions) {
    for (const t of opts.tools) this.byName.set(t.name, t);
    this.emitToolEvents = opts.emitToolEvents ?? true;
  }

  getToolNames(): string[] {
    return [...this.byName.keys()];
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.byName.get(name);
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    return this.executeFromProvider(call.toolName, call.args, call.id);
  }

  async executeFromProvider(toolName: string, args: unknown, callId: string): Promise<ToolResult> {
    const tool = this.byName.get(toolName);
    if (!tool) throw new ToolDeniedError(toolName, 'Unknown tool');
    await this.opts.controller.guardToolExecution(tool.name);

    const caps = tool.capabilities ?? [];
    const call: ToolCall = { id: callId, toolName: tool.name, args };

    const decision = await this.opts.policy.decide({ tool, call, capabilities: caps });
    if (decision.kind === 'deny') throw new ToolDeniedError(tool.name, decision.reason);

    if (decision.kind === 'ask') {
      this.opts.events.emit({
        type: 'tool_approval_request',
        request: { call, reason: decision.reason, policy: this.opts.policy.name },
        at: Date.now(),
      });
      const allowed = await this.opts.controller.requestApproval(call.id);
      if (!allowed) throw new ToolDeniedError(tool.name, 'User denied tool call');
    }

    if (this.emitToolEvents) this.opts.events.emit({ type: 'tool_call', call, at: Date.now() });

    try {
      const result = await tool.execute(args, this.opts.execContext);
      const toolResult: ToolResult = { id: call.id, toolName: tool.name, result };
      if (this.emitToolEvents) this.opts.events.emit({ type: 'tool_result', result: toolResult, at: Date.now() });
      return toolResult;
    } catch (e) {
      const toolResult: ToolResult = { id: call.id, toolName: tool.name, result: (e as Error).message || String(e), isError: true };
      if (this.emitToolEvents) this.opts.events.emit({ type: 'tool_result', result: toolResult, at: Date.now() });
      return toolResult;
    }
  }
}
