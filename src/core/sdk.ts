import { uuid } from '../utils/uuid.js';
import { dynamicImport } from '../utils/dynamic-import.js';
import type { AgentEvent, AgentResult, ChatMessage, ModelClass, ProviderId } from './types.js';
import { EventBus } from './event-bus.js';
import { RunController } from './run-controller.js';
import { UnifiedAgentError } from './errors.js';
import type { ToolDefinition } from '../tools/tool-types.js';
import { ToolExecutor } from '../tools/tool-executor.js';
import type { ToolPolicy } from '../policies/tool-policy.js';
import { AllowAllToolsPolicy } from '../policies/tool-policy.js';
import { SharedMemoryPool } from '../memory/shared-memory-pool.js';
import type { WorkspacePort } from '../workspaces/workspace.js';
import { PreviewWorkspace } from '../workspaces/preview-workspace.js';
import { JournalWorkspace } from '../workspaces/journal-workspace.js';
import { createFsTools, type FsToolOperation } from '../tools/fs-tools.js';
import { createMemoryTools } from '../tools/memory-tools.js';
import type { RetrieverPort } from '../retrieval/retriever.js';
import { createRetrievalTools } from '../tools/retrieval-tools.js';
import type { AuggieProviderConfig, AiSdkProviderConfig, OllamaProviderConfig } from '../providers/provider-config.js';
import { defaultModelCatalog, type ModelCatalog } from '../routing/model-catalog.js';
import { ModelRouter } from '../routing/router.js';
import { AiSdkEngine } from '../providers/ai-sdk/ai-sdk-engine.js';
import { AuggieEngine } from '../providers/auggie/auggie-engine.js';
import { OllamaEngine } from '../providers/ollama/ollama-engine.js';
import { attachSessionUpdates, type SessionUpdateHooks } from '../compat/session-updates.js';

export interface UnifiedAgentSDKConfig {
  providers: {
    auggie?: AuggieProviderConfig;
    aiSdk?: AiSdkProviderConfig;
    ollama?: OllamaProviderConfig;
  };
  memory?: SharedMemoryPool;
  /**
   * Model catalog used for routing. You can add/override models via `sdk.models.register(...)`.
   */
  models?: ModelCatalog;
}

export interface RunHooks {
  onEvent?: (ev: AgentEvent, api: ThinkingTimeApi) => void | Promise<void>;
  onThinkingDelta?: (delta: string, api: ThinkingTimeApi) => void | Promise<void>;
  onTextDelta?: (delta: string, api: ThinkingTimeApi) => void | Promise<void>;
  sessionUpdates?: SessionUpdateHooks;
}

export interface RunRouting {
  modelClass?: ModelClass;
  preferredProviders?: ProviderId[];
  allowFallback?: boolean;
}

export type CapabilityValue = boolean | 'unknown';

export interface ProviderCapabilities {
  providerId: ProviderId;
  configured: boolean;
  features: Record<string, CapabilityValue>;
  versions?: Record<string, string>;
}

export interface RunFsToolsOptions {
  toolPrefix?: 'fs_' | 'ws_';
  names?: Partial<Record<FsToolOperation, string>>;
  aliases?: Partial<Record<FsToolOperation, string[]>>;
}

export interface RunOptions {
  prompt: string | ChatMessage[];
  system?: string;
  provider?: ProviderId;
  model?: string;
  routing?: RunRouting;

  temperature?: number;
  maxTokens?: number;
  maxSteps?: number;

  workspace: WorkspacePort;
  workspaceMode?: 'live' | 'preview';

  policy?: ToolPolicy;
  tools?: ToolDefinition[];
  retriever?: RetrieverPort;
  fsTools?: RunFsToolsOptions;

  /** Provider-specific options (e.g. Ollama think level). */
  metadata?: Record<string, unknown>;

  hooks?: RunHooks;
}

export interface AgentRun {
  readonly runId: string;
  readonly events: AsyncIterable<AgentEvent>;
  readonly result: Promise<AgentResult>;

  pause(): void;
  resume(): void;
  stop(): void;
  cancel(): void;

  /** For policies that require approval. */
  approveToolCall(callId: string, allowed: boolean): boolean;

  /** Preview-mode only. */
  commitPreview?: () => Promise<void>;
  discardPreview?: () => Promise<void>;
}

export interface ThinkingTimeApi {
  pause(): void;
  resume(): void;
  stop(): void;
  cancel(): void;
  approveToolCall(callId: string, allowed: boolean): boolean;
}

export class UnifiedAgentSDK {
  readonly memory: SharedMemoryPool;
  readonly models: ModelCatalog;
  private readonly router: ModelRouter;

  constructor(private readonly config: UnifiedAgentSDKConfig) {
    this.memory = config.memory ?? new SharedMemoryPool();
    this.models = config.models ?? defaultModelCatalog();
    this.router = new ModelRouter(this.models);
  }

  getProviderCapabilities(): ProviderCapabilities[] {
    return (['ai-sdk', 'auggie', 'ollama'] as const).map((providerId) => {
      const configured =
        providerId === 'ai-sdk'
          ? Boolean(this.config.providers.aiSdk)
          : providerId === 'auggie'
            ? Boolean(this.config.providers.auggie)
            : Boolean(this.config.providers.ollama);

      return {
        providerId,
        configured,
        features: {
          streaming: true,
          tools: true,
          reasoning: 'unknown',
          vision: 'unknown',
          usage: 'unknown',
        },
      };
    });
  }

  /**
   * Optional: populate the model catalog from provider inventories.
   *
   * - Vercel AI Gateway can enumerate configured models via `gateway.getAvailableModels()`. 
   * - Ollama can list locally available models via `ollama.list()`.
   *
   * This method is safe to call even if those dependencies are not installed; it will no-op.
   */
  async syncModelCatalog(): Promise<void> {
    await Promise.all([this.syncGatewayModels(), this.syncOllamaModels()]);
  }

  private async syncGatewayModels(): Promise<void> {
    const cfg = this.config.providers.aiSdk;
    if (!cfg?.gatewayApiKey) return;

    try {
      const gwMod: any = await dynamicImport('@ai-sdk/gateway');
      const gw =
        gwMod.createGateway
          ? gwMod.createGateway({ apiKey: cfg.gatewayApiKey, baseURL: cfg.gatewayBaseUrl, headers: cfg.gatewayHeaders })
          : gwMod.gateway;

      const listFn = gw?.getAvailableModels;
      if (typeof listFn !== 'function') return;

      const models = await listFn.call(gw);
      if (!Array.isArray(models)) return;

      for (const m of models) {
        const id = String(m.id ?? m.model ?? m.name ?? '');
        if (!id) continue;
        this.models.register({
          provider: 'ai-sdk',
          id,
          displayName: m.name ?? id,
          classes: ['default'],
          notes: m.description,
        });
      }
    } catch {
      // ignore
    }
  }

  private async syncOllamaModels(): Promise<void> {
    const cfg = this.config.providers.ollama;
    if (!cfg) return;

    try {
      const mod: any = cfg.browser ? await dynamicImport('ollama/browser') : await dynamicImport('ollama');
      const client = (cfg.host || cfg.headers)
        ? new (mod.Ollama ?? mod.default?.Ollama)({ host: cfg.host, headers: cfg.headers })
        : (mod.default ?? mod);

      const list = await client.list?.();
      const models = list?.models ?? list;
      if (!Array.isArray(models)) return;

      for (const m of models) {
        const id = String(m.name ?? m.model ?? '');
        if (!id) continue;
        this.models.register({
          provider: 'ollama',
          id,
          displayName: id,
          classes: ['cheap', 'fast', 'default'],
          notes: 'Discovered from ollama.list()',
        });
      }
    } catch {
      // ignore
    }
  }
  run(opts: RunOptions): AgentRun {
    const runId = uuid();
    const controller = new RunController();
    const outerBus = new EventBus();

    const api: ThinkingTimeApi = {
      pause: () => controller.pause(),
      resume: () => controller.resume(),
      stop: () => controller.stop(),
      cancel: () => controller.cancel(),
      approveToolCall: (id, allowed) => controller.resolveApproval(id, allowed),
    };

    // Hooks
    if (opts.hooks?.onEvent) outerBus.subscribe((ev) => opts.hooks!.onEvent!(ev, api));
    if (opts.hooks?.onThinkingDelta) outerBus.subscribe((ev) => (ev.type === 'thinking_delta' ? opts.hooks!.onThinkingDelta!(ev.text, api) : undefined));
    if (opts.hooks?.onTextDelta) outerBus.subscribe((ev) => (ev.type === 'text_delta' ? opts.hooks!.onTextDelta!(ev.text, api) : undefined));
    if (opts.hooks?.sessionUpdates) attachSessionUpdates(outerBus, opts.hooks.sessionUpdates);

    // Preview workspace (stable across attempts)
    if ((opts.workspaceMode ?? 'live') === 'preview') {
      const previewWs = new PreviewWorkspace(opts.workspace);
      (opts as any).__previewWorkspace = previewWs;
    }

    const resultPromise = this.runWithFailover(runId, opts, controller, outerBus);

    const run: AgentRun = {
      runId,
      events: outerBus,
      result: resultPromise,
      pause: () => {
        controller.pause();
        outerBus.emit({ type: 'status', status: 'paused', at: Date.now() });
      },
      resume: () => {
        controller.resume();
        outerBus.emit({ type: 'status', status: 'responding', at: Date.now() });
      },
      stop: () => {
        controller.stop();
        outerBus.emit({ type: 'status', status: 'stopping', at: Date.now() });
      },
      cancel: () => {
        controller.cancel('cancelled');
        outerBus.emit({ type: 'status', status: 'stopping', detail: 'cancel', at: Date.now() });
      },
      approveToolCall: (id, allowed) => controller.resolveApproval(id, allowed),
      commitPreview: undefined,
      discardPreview: undefined,
    };

    if ((opts.workspaceMode ?? 'live') === 'preview') {
      const previewWs = (opts as any).__previewWorkspace as PreviewWorkspace;
      run.commitPreview = () => previewWs.commit();
      run.discardPreview = () => previewWs.discard();
    }

    return run;
  }

  private async runWithFailover(runId: string, opts: RunOptions, controller: RunController, bus: EventBus): Promise<AgentResult> {
    const workspaceMode = opts.workspaceMode ?? 'live';

    const baseWorkspace: WorkspacePort = workspaceMode === 'preview' ? (opts as any).__previewWorkspace : opts.workspace;

    const policy = opts.policy ?? new AllowAllToolsPolicy();

    const tools: ToolDefinition[] = [
      ...createFsTools({ events: bus, preview: workspaceMode === 'preview', ...(opts.fsTools ?? {}) }),
      ...createMemoryTools({ events: bus }),
      ...(opts.retriever ? createRetrievalTools(opts.retriever, { events: bus }) : []),
      ...(opts.tools ?? []),
    ];

    const messages: ChatMessage[] =
      typeof opts.prompt === 'string' ? ([{ role: 'user', content: opts.prompt }] as ChatMessage[]) : opts.prompt;

    const availability = this.getAvailability();

    const plan = this.router.plan(
      availability,
      {
        provider: opts.provider,
        model: opts.model,
        modelClass: opts.routing?.modelClass,
        preferredProviders: opts.routing?.preferredProviders,
        allowFallback: opts.routing?.allowFallback,
      },
      { mustStream: true, requiresTools: tools.length > 0 }
    );

    if (plan.candidates.length === 0) throw new UnifiedAgentError('No providers/models available for this request');

    bus.emit({
      type: 'status',
      status: 'initialising',
      detail: `Candidates: ${plan.candidates.map((c) => c.ref).join(', ')}`,
      at: Date.now(),
    });

    let lastError: unknown;

    for (let attempt = 0; attempt < plan.candidates.length; attempt++) {
      const c = plan.candidates[attempt]!;
      if (controller.signal.aborted) break;

      // Per-attempt workspace wrapper:
      // - preview mode: reuse overlay, discard on failure
      // - live mode: wrap with journal so we can rollback on failure
      const attemptWorkspace = workspaceMode === 'live' ? new JournalWorkspace(baseWorkspace) : baseWorkspace;

      const execContext = {
        workspace: attemptWorkspace,
        memory: this.memory,
        metadata: { runId, provider: c.provider, model: c.model, ...(opts.metadata ?? {}) },
      };

      const toolExecutor = new ToolExecutor({
        tools,
        policy,
        controller,
        events: bus,
        execContext,
        emitToolEvents: false, // Engines emit tool_call/tool_result from provider streams
      });

      const engine = this.createEngine(c.provider);

      bus.emit({
        type: 'status',
        status: 'initialising',
        detail: `Attempt ${attempt + 1}/${plan.candidates.length}: ${c.ref}`,
        at: Date.now(),
      });

      try {
        const engineRun = await engine.run(
          {
            runId,
            provider: c.provider,
            model: c.model,
            system: opts.system,
            messages: normaliseChatMessages(opts.system, messages),
            temperature: opts.temperature,
            maxTokens: opts.maxTokens,
            maxSteps: opts.maxSteps,
            metadata: opts.metadata,
          },
          { controller, toolExecutor }
        );

        // Forward engine events into the outer bus.
        const forwarder = (async () => {
          for await (const ev of engineRun.events) bus.emit(ev);
        })();

        const result = await engineRun.result;
        await forwarder.catch(() => {});
        await engineRun.close().catch(() => {});

        if (attemptWorkspace instanceof JournalWorkspace) attemptWorkspace.commit();

        return result;
      } catch (e) {
        lastError = e;
        bus.emit({ type: 'error', error: (e as Error).message || String(e), raw: e, at: Date.now() });

        if (attemptWorkspace instanceof JournalWorkspace) {
          await attemptWorkspace.rollback().catch(() => {});
        } else if (baseWorkspace instanceof PreviewWorkspace) {
          await baseWorkspace.discard().catch(() => {});
        }

        bus.emit({ type: 'status', status: 'initialising', detail: `Failover: ${c.ref} failed.`, at: Date.now() });
      }
    }

    if (controller.signal.aborted) {
      const res: AgentResult = { text: '', finishReason: 'cancelled', toolCalls: [], toolResults: [] };
      bus.emit({ type: 'run_finish', runId, reason: 'cancelled', at: Date.now() });
      bus.close();
      return res;
    }

    bus.close(lastError);
    throw new UnifiedAgentError('All provider candidates failed', lastError);
  }

  private createEngine(provider: ProviderId) {
    switch (provider) {
      case 'ai-sdk':
        if (!this.config.providers.aiSdk) throw new UnifiedAgentError('AI SDK provider not configured');
        return new AiSdkEngine(this.config.providers.aiSdk);
      case 'auggie':
        if (!this.config.providers.auggie) throw new UnifiedAgentError('Auggie provider not configured');
        return new AuggieEngine(this.config.providers.auggie);
      case 'ollama':
        if (!this.config.providers.ollama) throw new UnifiedAgentError('Ollama provider not configured');
        return new OllamaEngine(this.config.providers.ollama);
      default:
        throw new UnifiedAgentError(`Unsupported provider: ${provider}`);
    }
  }

  private getAvailability() {
    return [
      {
        provider: 'ai-sdk' as const,
        available: Boolean(
          this.config.providers.aiSdk?.openaiApiKey ||
            this.config.providers.aiSdk?.anthropicApiKey ||
            this.config.providers.aiSdk?.gatewayApiKey
        ),
        reason: 'Missing API keys',
      },
      {
        provider: 'auggie' as const,
        available: Boolean(this.config.providers.auggie?.apiKey || (globalThis as any).process?.env?.AUGMENT_API_TOKEN),
        reason: 'Missing Augment API token',
      },
      {
        provider: 'ollama' as const,
        available: Boolean(this.config.providers.ollama),
        reason: 'Missing ollama config',
      },
    ];
  }
}

function normaliseChatMessages(system: string | undefined, messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'system') continue;
    out.push(m);
  }
  return out;
}
