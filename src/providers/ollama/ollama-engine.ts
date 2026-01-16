import { uuid } from '../../utils/uuid.js';
import { dynamicImport } from '../../utils/dynamic-import.js';
import type { AgentEngine, EngineDeps, EngineRequest, EngineRun } from '../engine.js';
import type { AgentResult, FinishReason, ToolCall, ToolResult } from '../../core/types.js';
import { EventBus } from '../../core/event-bus.js';
import type { OllamaProviderConfig } from '../provider-config.js';
import { ProviderUnavailableError, UnifiedAgentError } from '../../core/errors.js';

type OllamaModule = any;

function toToolSchema(def: { name: string; description: string; inputSchema: any }): any {
  return {
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: def.inputSchema,
    },
  };
}

export class OllamaEngine implements AgentEngine {
  readonly id = 'ollama' as const;

  constructor(private cfg: OllamaProviderConfig) {}

  async run(req: EngineRequest, deps: EngineDeps): Promise<EngineRun> {
    const events = new EventBus();
    const startedAt = Date.now();
    events.emit({ type: 'run_start', runId: req.runId, provider: 'ollama', model: req.model, startedAt });

    const ollama = await this.createClient();

    const tools = deps.toolExecutor.getToolNames().map((name) => {
      const def = deps.toolExecutor.getTool(name)!;
      return toToolSchema(def);
    });

    const messages = normaliseMessages(req.system, req.messages);

    const toolCalls: ToolCall[] = [];
    const toolResults: ToolResult[] = [];
    let finalText = '';
    let finishReason: FinishReason = 'other';

    const think = (req.metadata?.think ?? true) as any;
    const maxSteps = req.maxSteps ?? 8;

    const resultPromise = (async (): Promise<AgentResult> => {
      try {
        for (let step = 0; step < maxSteps; step++) {
          if (deps.controller.signal.aborted) {
            finishReason = 'cancelled';
            break;
          }
          if (deps.controller.isStopRequested) {
            finishReason = 'stop';
            break;
          }

          events.emit({ type: 'status', status: 'thinking', at: Date.now() });

          // Streaming chat
          const stream = await ollama.chat({
            model: req.model,
            messages,
            tools,
            stream: true,
            think,
          });

          let content = '';
          let thinking = '';
          let lastToolCalls: any[] = [];

          for await (const part of stream as AsyncIterable<any>) {
            await deps.controller.waitIfPaused();
            if (deps.controller.signal.aborted) {
              try { ollama.abort?.(); } catch {}
              finishReason = 'cancelled';
              break;
            }

            const msg = part?.message;
            const td = msg?.thinking;
            const cd = msg?.content;
            const tc = msg?.tool_calls;

            if (typeof td === 'string' && td.length) {
              thinking += td;
              events.emit({ type: 'thinking_delta', text: td, at: Date.now() });
            }
            if (typeof cd === 'string' && cd.length) {
              content += cd;
              finalText += cd;
              events.emit({ type: 'text_delta', text: cd, at: Date.now() });
            }
            if (Array.isArray(tc) && tc.length) {
              lastToolCalls = tc;
            }
          }

          // Append assistant turn
          const assistantMsg: any = { role: 'assistant', content };
          if (thinking) assistantMsg.thinking = thinking;
          if (lastToolCalls.length) assistantMsg.tool_calls = lastToolCalls;
          messages.push(assistantMsg);

          // If no tool calls, finish.
          if (!lastToolCalls.length) {
            finishReason = 'stop';
            break;
          }

          // Execute tools and append tool results.
          events.emit({ type: 'status', status: 'acting', at: Date.now() });

          for (let i = 0; i < lastToolCalls.length; i++) {
            const call = lastToolCalls[i];
            const fn = call?.function;
            const toolName = fn?.name;
            const args = fn?.arguments ?? {};
            if (!toolName) continue;

            const id = `${step}-${i}-${uuid()}`;
            const tcEvent: ToolCall = { id, toolName, args };
            toolCalls.push(tcEvent);
            events.emit({ type: 'tool_call', call: tcEvent, at: Date.now() });

            const res = await deps.toolExecutor.executeFromProvider(toolName, args, id);
            const trEvent: ToolResult = { id, toolName, result: res.result, isError: res.isError };
            toolResults.push(trEvent);
            events.emit({ type: 'tool_result', result: trEvent, at: Date.now() });

            messages.push({ role: 'tool', tool_name: toolName, content: stringifyToolResult(res.result) });
          }
        }

        if (deps.controller.signal.aborted && finishReason !== 'cancelled') finishReason = 'cancelled';

        events.emit({ type: 'run_finish', runId: req.runId, reason: finishReason, at: Date.now() });
        events.close();
        return { text: finalText, finishReason, toolCalls, toolResults };
      } catch (e) {
        const aborted = deps.controller.signal.aborted;
        finishReason = aborted ? 'cancelled' : 'error';
        events.emit({ type: 'error', error: (e as Error).message || String(e), raw: e, at: Date.now() });
        events.emit({ type: 'run_finish', runId: req.runId, reason: finishReason, at: Date.now() });
        events.close(e);
        throw new UnifiedAgentError((e as Error).message || String(e), e);
      }
    })();

    deps.controller.signal.addEventListener('abort', () => { try { ollama.abort?.(); } catch {} }, { once: true });

    return { events, result: resultPromise, close: async () => { try { ollama.abort?.(); } catch {} } };
  }

  private async createClient(): Promise<any> {
    const mod: OllamaModule = await this.importOllama();
    // ollama-js exports default client and class.
    if (this.cfg.host || this.cfg.headers) {
      const Ollama = mod.Ollama ?? mod.default?.Ollama;
      if (Ollama) return new Ollama({ host: this.cfg.host, headers: this.cfg.headers });
    }
    return mod.default ?? mod;
  }

  private async importOllama(): Promise<OllamaModule> {
    try {
      if (this.cfg.browser) return await dynamicImport('ollama/browser');
      return await dynamicImport('ollama');
    } catch {
      throw new ProviderUnavailableError('ollama', 'Install `ollama` (ollama-js)');
    }
  }
}

function stringifyToolResult(result: unknown): string {
  if (typeof result === 'string') return result;
  try { return JSON.stringify(result); } catch { return String(result); }
}

function normaliseMessages(system: string | undefined, msgs: Array<{ role: string; content: string }>): any[] {
  const out: any[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of msgs) {
    if (m.role === 'system') continue;
    out.push({ role: m.role, content: m.content });
  }
  return out;
}
