export type ProviderId = 'auggie' | 'ai-sdk' | 'ollama';

export type ModelClass = 'default' | 'frontier' | 'fast' | 'long_context' | 'cheap';

export type RunStatus = 'initialising' | 'thinking' | 'responding' | 'acting' | 'paused' | 'stopping' | 'finished' | 'error';

export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'cancelled' | 'error' | 'other';

export type JsonSchema =
  | { type: 'object'; properties?: Record<string, JsonSchema>; required?: string[]; additionalProperties?: boolean | JsonSchema; description?: string }
  | { type: 'array'; items: JsonSchema; description?: string }
  | { type: 'string'; enum?: string[]; description?: string }
  | { type: 'number'; description?: string }
  | { type: 'integer'; description?: string }
  | { type: 'boolean'; description?: string }
  | { type: 'null'; description?: string }
  | { anyOf: JsonSchema[]; description?: string }
  | { oneOf: JsonSchema[]; description?: string }
  | { allOf: JsonSchema[]; description?: string }
  | { description?: string; [k: string]: unknown };

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolName?: string;
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  toolName: string;
  args: unknown;
}

export interface ToolResult {
  id: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
}

export type FileChangeKind = 'create' | 'update' | 'delete' | 'rename' | 'patch_hunk';

export interface FileChange {
  kind: FileChangeKind;
  path?: string;
  fromPath?: string;
  toPath?: string;
  preview: boolean;
  // If kind=patch_hunk
  hunkIndex?: number;
  hunkCount?: number;
}

export interface AgentEventMeta {
  agentId?: string;
  stepId?: string;
  workflowName?: string;
  traceId?: string;
}

type AgentEventCore =
  | { type: 'run_start'; runId: string; provider: ProviderId; model: string; startedAt: number }
  | { type: 'status'; status: RunStatus; detail?: string; at: number }
  | { type: 'thinking_delta'; text: string; at: number }
  | { type: 'text_delta'; text: string; at: number }
  | { type: 'tool_call'; call: ToolCall; at: number }
  | { type: 'tool_result'; result: ToolResult; at: number }
  | { type: 'tool_approval_request'; request: ToolApprovalRequest; at: number }
  | { type: 'file_change'; change: FileChange; at: number }
  | { type: 'memory_read'; key: string; value?: unknown; at: number }
  | { type: 'memory_write'; key: string; value: unknown; at: number }
  | { type: 'retrieval_query'; query: string; topK: number; at: number }
  | { type: 'retrieval_results'; query: string; topK: number; resultCount: number; at: number }
  | { type: 'step_finish'; step: StepFinish; at: number }
  | { type: 'usage'; usage: Usage; at: number }
  | { type: 'error'; error: string; raw?: unknown; at: number }
  | { type: 'run_finish'; runId: string; reason: FinishReason; at: number };

export type AgentEvent = AgentEventCore & { meta?: AgentEventMeta };

export interface StepFinish {
  index: number;
  stepType?: string;
  finishReason?: string;
  toolCalls?: Array<{ toolName: string; args: unknown }>;
  toolResults?: Array<{ toolName: string; result: unknown }>;
}

export interface ToolApprovalRequest {
  call: ToolCall;
  reason: string;
  // The policy that requested approval (useful for UI)
  policy?: string;
}

export interface AgentResult {
  text: string;
  finishReason: FinishReason;
  usage?: Usage;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
}
