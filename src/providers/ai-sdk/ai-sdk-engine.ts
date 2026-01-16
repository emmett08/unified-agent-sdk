import { uuid } from '../../utils/uuid.js';
import { dynamicImport } from '../../utils/dynamic-import.js';
import type { AgentEngine, EngineDeps, EngineRequest, EngineRun } from '../engine.js';
import type { AgentEvent, AgentResult, FinishReason, ToolCall, ToolResult } from '../../core/types.js';
import { EventBus } from '../../core/event-bus.js';
import type { AiSdkProviderConfig } from '../provider-config.js';
import { UnifiedAgentError, ProviderUnavailableError } from '../../core/errors.js';

type AiModule = any;

function hashToolCall(toolName: string, args: unknown): string {
  return `${toolName}:${stableJson(args)}`;
}
function stableJson(v: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (x: any): any => {
    if (x === null || typeof x !== 'object') return x;
    if (seen.has(x)) return '[Circular]';
    seen.add(x);
    if (Array.isArray(x)) return x.map(walk);
    const keys = Object.keys(x).sort();
    const out: any = {};
    for (const k of keys) out[k] = walk(x[k]);
    return out;
  };
  return JSON.stringify(walk(v));
}

export class AiSdkEngine implements AgentEngine {
  readonly id = 'ai-sdk' as const;

  constructor(private cfg: AiSdkProviderConfig) {}

  private toAiSchema(ai: AiModule, inputSchema: any): any {
    // AI SDK expects a "Vercel schema" object (from `jsonSchema()` / zod / standard schema).
    // Our SDK uses plain JSON Schema objects, so wrap them to avoid "schema is not a function".
    if (!inputSchema) return inputSchema;
    if (typeof inputSchema === 'function') return inputSchema;

    // Already an AI SDK schema wrapper
    const schemaSym = Symbol.for('vercel.ai.schema');
    if (typeof inputSchema === 'object' && inputSchema && (inputSchema as any)[schemaSym] === true) return inputSchema;

    // Zod schema (common in tool adapters). Prefer wrapping via ai.zodSchema if available.
    if (typeof inputSchema === 'object' && inputSchema && typeof (inputSchema as any).safeParse === 'function') {
      if (ai?.zodSchema) return ai.zodSchema(inputSchema);
      return inputSchema;
    }

    if (typeof inputSchema === 'object' && ai?.jsonSchema) return ai.jsonSchema(inputSchema);
    return inputSchema;
  }

  async run(req: EngineRequest, deps: EngineDeps): Promise<EngineRun> {
    const events = new EventBus();
    const startedAt = Date.now();
    events.emit({ type: 'run_start', runId: req.runId, provider: 'ai-sdk', model: req.model, startedAt });

    // Late import: keep this SDK decoupled.
    const ai = await this.importAi();

    const model = await this.createModel(ai, req.model);

    const stopWhen = req.maxSteps ? await this.stepCountIs(ai, req.maxSteps) : undefined;

    // Tools object for AI SDK
    const toolNameToDef = new Map(deps.toolExecutor.getToolNames().map((n) => [n, deps.toolExecutor.getTool(n)!]));
    const pendingIdsByHash = new Map<string, string[]>();

    const tools: Record<string, any> = {};
    for (const [name, def] of toolNameToDef.entries()) {
      tools[name] = ai.tool({
        description: def.description,
        inputSchema: this.toAiSchema(ai, def.inputSchema),
        execute: async (args: unknown) => {
          const h = hashToolCall(name, args);
          const q = pendingIdsByHash.get(h);
          const callId = q && q.length > 0 ? q.shift()! : uuid();
          try {
            const res = await deps.toolExecutor.executeFromProvider(name, args, callId);
            return res.result;
          } catch (e) {
            // Don't throw: return an error object to keep the loop stable.
            return { error: (e as Error).message || String(e) };
          }
        },
      });
    }

    let finalText = '';
    const toolCalls: ToolCall[] = [];
    const toolResults: ToolResult[] = [];
    let finishReason: FinishReason = 'other';

    const resultPromise = (async (): Promise<AgentResult> => {
      try {
        events.emit({ type: 'status', status: 'thinking', at: Date.now() });

        const streamResult = ai.streamText({
          model,
          system: req.system,
          messages: req.messages,
          tools,
          temperature: req.temperature,
          maxOutputTokens: req.maxTokens,
          stopWhen,
          abortSignal: deps.controller.signal,
          onStepFinish: async (step: any) => {
            events.emit({
              type: 'step_finish',
              step: {
                index: step.step ?? step.stepIndex ?? (step.steps?.length ? step.steps.length - 1 : 0),
                stepType: step.stepType,
                finishReason: step.finishReason,
                toolCalls: (step.toolCalls ?? []).map((c: any) => ({ toolName: c.toolName, args: c.args })),
                toolResults: (step.toolResults ?? []).map((r: any) => ({ toolName: r.toolName, result: r.result })),
              },
              at: Date.now(),
            });

            if (deps.controller.isStopRequested) {
              // Graceful boundary: abort after finishing current step.
              deps.controller.cancel('stop');
            }
          },
          onAbort: async () => {
            finishReason = 'cancelled';
          },
          onError: ({ error }: any) => {
            events.emit({ type: 'error', error: (error as Error).message || String(error), raw: error, at: Date.now() });
          },
        });

        // fullStream includes tool call/result events, text deltas, errors, etc.
        if (streamResult.fullStream) {
          for await (const part of streamResult.fullStream as AsyncIterable<any>) {
            await deps.controller.waitIfPaused();
            if (deps.controller.signal.aborted) break;

            if (!part || typeof part !== 'object') continue;
            const t = part.type;
            if (t === 'text' || t === 'text-delta') {
              const text = part.text ?? part.delta ?? '';
              if (text) {
                finalText += text;
                events.emit({ type: 'text_delta', text, at: Date.now() });
              }
            } else if (t === 'reasoning' || t === 'reasoning-delta') {
              const text = part.text ?? part.delta ?? part.reasoning ?? '';
              if (text) events.emit({ type: 'thinking_delta', text, at: Date.now() });
            } else if (t === 'tool-call') {
              const toolName = part.toolName ?? part.toolCall?.toolName ?? part.name ?? part.tool?.name;
              const args = part.args ?? part.toolCall?.args ?? part.input ?? {};
              const id = part.toolCallId ?? part.id ?? uuid();
              if (toolName) {
                const h = hashToolCall(toolName, args);
                const q = pendingIdsByHash.get(h) ?? [];
                q.push(id);
                pendingIdsByHash.set(h, q);

                const call: ToolCall = { id, toolName, args };
                toolCalls.push(call);
                events.emit({ type: 'tool_call', call, at: Date.now() });
                events.emit({ type: 'status', status: 'acting', detail: toolName, at: Date.now() });
              }
            } else if (t === 'tool-result') {
              const toolName = part.toolName ?? part.toolCall?.toolName ?? part.name ?? part.tool?.name;
              const id = part.toolCallId ?? part.id ?? uuid();
              const result = part.result ?? part.output ?? part.data;
              if (toolName) {
                const tr: ToolResult = { id, toolName, result, isError: Boolean(part.isError) };
                toolResults.push(tr);
                events.emit({ type: 'tool_result', result: tr, at: Date.now() });
              }
            } else if (t === 'error') {
              const msg = part.error?.message ?? part.message ?? 'Stream error';
              events.emit({ type: 'error', error: msg, raw: part, at: Date.now() });
              finishReason = 'error';
            }
          }
        } else if (streamResult.textStream) {
          for await (const chunk of streamResult.textStream as AsyncIterable<string>) {
            await deps.controller.waitIfPaused();
            if (deps.controller.signal.aborted) break;
            finalText += chunk;
            events.emit({ type: 'text_delta', text: chunk, at: Date.now() });
          }
        }

        const final = await streamResult;
        const fr = final.finishReason ?? final.rawFinishReason;
        finishReason = normaliseFinishReason(fr, deps.controller.signal.aborted);

        const usage = final.totalUsage ?? final.usage;
        if (usage) events.emit({ type: 'usage', usage: normaliseUsage(usage), at: Date.now() });

        events.emit({ type: 'run_finish', runId: req.runId, reason: finishReason, at: Date.now() });
        events.close();

        return {
          text: finalText,
          finishReason,
          usage: usage ? normaliseUsage(usage) : undefined,
          toolCalls,
          toolResults,
        };
      } catch (e) {
        const msg = (e as Error).message || String(e);
        events.emit({ type: 'error', error: msg, raw: e, at: Date.now() });
        events.emit({ type: 'run_finish', runId: req.runId, reason: deps.controller.signal.aborted ? 'cancelled' : 'error', at: Date.now() });
        events.close(e);
        throw new UnifiedAgentError(msg, e);
      }
    })();

    return {
      events,
      result: resultPromise,
      close: async () => {},
    };
  }

  private async importAi(): Promise<AiModule> {
    try {
      return await dynamicImport('ai');
    } catch (e) {
      throw new ProviderUnavailableError('ai-sdk', 'Install `ai` and a provider package (e.g. @ai-sdk/openai).');
    }
  }

  private async createModel(ai: AiModule, modelId: string): Promise<any> {
    // If gateway is configured, prefer it.
    if (this.cfg.gatewayApiKey) {
      try {
        const gwMod = await dynamicImport('@ai-sdk/gateway');
        const gw = gwMod.createGateway
          ? gwMod.createGateway({ apiKey: this.cfg.gatewayApiKey, baseURL: this.cfg.gatewayBaseUrl, headers: this.cfg.gatewayHeaders })
          : gwMod.gateway;
        const baseModel = typeof gw === 'function' ? gw(modelId) : gw;
        return this.wrapWithMiddleware(ai, baseModel);
      } catch {
        // Fall through to direct providers
      }
    }

    if (modelId.startsWith('openai/')) {
      if (!this.cfg.openaiApiKey) throw new ProviderUnavailableError('ai-sdk', 'Missing openaiApiKey');
      const { createOpenAI } = await dynamicImport('@ai-sdk/openai').catch(() => { throw new ProviderUnavailableError('ai-sdk', 'Install @ai-sdk/openai'); });
      const openai = createOpenAI({ apiKey: this.cfg.openaiApiKey, baseURL: this.cfg.openaiBaseUrl });
      return this.wrapWithMiddleware(ai, openai(modelId.replace(/^openai\//, '')));
    }

    if (modelId.startsWith('anthropic/')) {
      if (!this.cfg.anthropicApiKey) throw new ProviderUnavailableError('ai-sdk', 'Missing anthropicApiKey');
      const { createAnthropic } = await dynamicImport('@ai-sdk/anthropic').catch(() => { throw new ProviderUnavailableError('ai-sdk', 'Install @ai-sdk/anthropic'); });
      const anthropic = createAnthropic({ apiKey: this.cfg.anthropicApiKey, baseURL: this.cfg.anthropicBaseUrl });
      return this.wrapWithMiddleware(ai, anthropic(modelId.replace(/^anthropic\//, '')));
    }

    // Fallback: AI SDK can accept a model string for some environments; try directly.
    return this.wrapWithMiddleware(ai, modelId);
  }

  private wrapWithMiddleware(ai: AiModule, baseModel: any): any {
    const middleware: any[] = [];
    if (this.cfg.middleware?.length) middleware.push(...this.cfg.middleware);

    if (this.cfg.reasoningTagName) {
      // Extract <think> or custom-tag reasoning into result.reasoning; useful for models that include tags.
      // See AI SDK middleware docs.
      if (ai.extractReasoningMiddleware) middleware.push(ai.extractReasoningMiddleware({ tagName: this.cfg.reasoningTagName }));
    }

    if (middleware.length === 0) return baseModel;

    if (ai.wrapLanguageModel) {
      return ai.wrapLanguageModel({ model: baseModel, middleware });
    }
    return baseModel;
  }

  private async stepCountIs(ai: AiModule, maxSteps: number): Promise<any> {
    try {
      return ai.stepCountIs(maxSteps);
    } catch {
      return undefined;
    }
  }
}

function normaliseFinishReason(fr: string | undefined, aborted: boolean): FinishReason {
  if (aborted) return 'cancelled';
  switch (fr) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool-calls':
    case 'tool_calls':
      return 'tool_calls';
    case 'error':
      return 'error';
    default:
      return 'other';
  }
}

function normaliseUsage(u: any) {
  // AI SDK uses inputTokens/outputTokens
  const inputTokens = u.inputTokens ?? u.promptTokens ?? u.prompt_eval_count;
  const outputTokens = u.outputTokens ?? u.completionTokens ?? u.eval_count;
  const totalTokens = u.totalTokens ?? (typeof inputTokens === 'number' && typeof outputTokens === 'number' ? inputTokens + outputTokens : undefined);
  return { inputTokens, outputTokens, totalTokens };
}
