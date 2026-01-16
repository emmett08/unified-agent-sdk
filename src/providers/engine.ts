import type { AgentEvent, AgentResult, ChatMessage, ProviderId } from '../core/types.js';
import type { RunController } from '../core/run-controller.js';
import type { ToolExecutor } from '../tools/tool-executor.js';

export interface EngineRun {
  events: AsyncIterable<AgentEvent>;
  result: Promise<AgentResult>;
  close(): Promise<void>;
}

export interface EngineRequest {
  runId: string;
  provider: ProviderId;
  model: string;
  system?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  maxSteps?: number;
  /** Provider-specific hints. */
  metadata?: Record<string, unknown>;
}

export interface AgentEngine {
  readonly id: ProviderId;
  run(req: EngineRequest, deps: EngineDeps): Promise<EngineRun>;
}

export interface EngineDeps {
  controller: RunController;
  toolExecutor: ToolExecutor;
}
