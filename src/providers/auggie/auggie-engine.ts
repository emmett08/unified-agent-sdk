import { uuid } from '../../utils/uuid.js';
import { dynamicImport } from '../../utils/dynamic-import.js';
import type { AgentEngine, EngineDeps, EngineRequest, EngineRun } from '../engine.js';
import type { AgentResult, FinishReason, ToolCall, ToolResult } from '../../core/types.js';
import { EventBus } from '../../core/event-bus.js';
import type { AuggieProviderConfig } from '../provider-config.js';
import { ProviderUnavailableError, UnifiedAgentError } from '../../core/errors.js';

type AuggieModule = any;
type AiModule = any;

export class AuggieEngine implements AgentEngine {
  readonly id = 'auggie' as const;

  constructor(private cfg: AuggieProviderConfig) {}

  async run(req: EngineRequest, deps: EngineDeps): Promise<EngineRun> {
    const events = new EventBus();
    const startedAt = Date.now();
    events.emit({ type: 'run_start', runId: req.runId, provider: 'auggie', model: req.model, startedAt });

    const { Auggie } = await this.importAuggie();
    const ai = await this.importAiOptional();

    const tools = await this.toAiTools(ai, deps);

    const client = await Auggie.create({
      model: req.model,
      apiKey: this.cfg.apiKey,
      apiUrl: this.cfg.apiUrl,
      workspaceRoot: this.cfg.workspaceRoot,
      allowIndexing: this.cfg.allowIndexing,
      auggiePath: this.cfg.auggiePath,
      rules: this.cfg.rules,
      cliArgs: this.cfg.cliArgs,
      tools,
    });

    const toolCalls: ToolCall[] = [];
    const toolResults: ToolResult[] = [];
    let finalText = '';
    let finishReason: FinishReason = 'other';

    // Auggie streaming events
    if (typeof client.onSessionUpdate === 'function') {
      client.onSessionUpdate((event: any) => {
        const update = event?.update;
        const kind = update?.sessionUpdate;

        if (kind === 'agent_message_chunk') {
          const c = update?.content;
          if (c?.type === 'text' && typeof c.text === 'string') {
            finalText += c.text;
            events.emit({ type: 'status', status: 'responding', at: Date.now() });
            events.emit({ type: 'text_delta', text: c.text, at: Date.now() });
          } else if (c?.type === 'reasoning' && typeof c.text === 'string') {
            events.emit({ type: 'status', status: 'thinking', at: Date.now() });
            events.emit({ type: 'thinking_delta', text: c.text, at: Date.now() });
          }
        } else if (kind === 'tool_call') {
          const title = update?.title ?? update?.name ?? 'tool';
          const call: ToolCall = { id: uuid(), toolName: String(title), args: update?.args ?? {} };
          toolCalls.push(call);
          events.emit({ type: 'status', status: 'acting', detail: call.toolName, at: Date.now() });
          events.emit({ type: 'tool_call', call, at: Date.now() });
        } else if (kind === 'tool_call_update') {
          const title = update?.title ?? update?.name ?? 'tool';
          const tr: ToolResult = { id: uuid(), toolName: String(title), result: update?.rawOutput ?? update?.output ?? update };
          toolResults.push(tr);
          events.emit({ type: 'tool_result', result: tr, at: Date.now() });
        }
      });
    }

    const resultPromise = (async (): Promise<AgentResult> => {
      try {
        events.emit({ type: 'status', status: 'thinking', at: Date.now() });

        // Race prompt with cancellation
        const abortP = new Promise<never>((_, reject) => {
          deps.controller.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        });

        const prompt = messagesToPrompt(req.system, req.messages);
        const resp = await Promise.race([client.prompt(prompt), abortP]);

        if (typeof resp === 'string') finalText = finalText || resp;
        finishReason = deps.controller.signal.aborted ? 'cancelled' : 'stop';

        events.emit({ type: 'run_finish', runId: req.runId, reason: finishReason, at: Date.now() });
        events.close();
        return { text: finalText, finishReason, toolCalls, toolResults };
      } catch (e) {
        const aborted = deps.controller.signal.aborted;
        finishReason = aborted ? 'cancelled' : 'error';
        events.emit({ type: 'error', error: (e as Error).message || String(e), raw: e, at: Date.now() });
        events.emit({ type: 'run_finish', runId: req.runId, reason: finishReason, at: Date.now() });
        events.close(e);

        // Attempt to stop underlying session
        try { await client.close?.(); } catch {}
        throw new UnifiedAgentError((e as Error).message || String(e), e);
      } finally {
        // Close client in the background
        try { await client.close?.(); } catch {}
      }
    })();

    // Ensure abort closes the client promptly.
    deps.controller.signal.addEventListener('abort', () => { try { client.close?.(); } catch {} }, { once: true });

    return { events, result: resultPromise, close: async () => { try { await client.close?.(); } catch {} } };
  }

  private async importAuggie(): Promise<AuggieModule> {
    try {
      return await dynamicImport('@augmentcode/auggie-sdk');
    } catch {
      throw new ProviderUnavailableError('auggie', 'Install @augmentcode/auggie-sdk');
    }
  }

  private async importAiOptional(): Promise<AiModule | null> {
    try {
      return await dynamicImport('ai');
    } catch {
      return null;
    }
  }

  private async toAiTools(ai: AiModule | null, deps: EngineDeps): Promise<Record<string, any> | undefined> {
    // Auggie expects AI SDK-style tools. If `ai` is present, use tool() helper.
    if (!ai?.tool) return undefined;

    const tools: Record<string, any> = {};
    for (const name of deps.toolExecutor.getToolNames()) {
      const def = deps.toolExecutor.getTool(name)!;
      tools[name] = ai.tool({
        description: def.description,
        inputSchema: def.inputSchema,
        execute: async (args: unknown) => {
          const id = uuid();
          const res = await deps.toolExecutor.executeFromProvider(name, args, id);
          return res.result;
        },
      });
    }
    return tools;
  }
}

function messagesToPrompt(system: string | undefined, messages: Array<{ role: string; content: string }>): string {
  const parts: string[] = [];
  if (system) parts.push(`SYSTEM:\n${system}`);
  for (const m of messages) {
    if (m.role === 'system') continue;
    parts.push(`${m.role.toUpperCase()}:\n${m.content}`);
  }
  return parts.join('\n\n');
}
