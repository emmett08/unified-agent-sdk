export * from './core/types.js';
export * from './core/errors.js';
export {
  UnifiedAgentSDK,
  type UnifiedAgentSDKConfig,
  type RunOptions,
  type AgentRun,
  type ProviderCapabilities,
  type CapabilityValue,
  type RunFsToolsOptions,
} from './core/sdk.js';

export { ToolCallAggregator, attachSessionUpdates, type SessionUpdateHooks, type ToolCallAggregatorHooks } from './compat/session-updates.js';

export * from './policies/tool-policy.js';

export { SharedMemoryPool } from './memory/shared-memory-pool.js';

export { NodeFsWorkspace } from './workspaces/node-fs-workspace.js';
export { PreviewWorkspace } from './workspaces/preview-workspace.js';
export type { WorkspacePort } from './workspaces/workspace.js';

export type { ToolDefinition } from './tools/tool-types.js';
export { createFsTools } from './tools/fs-tools.js';
export { createMemoryTools } from './tools/memory-tools.js';

export type { RetrieverPort, RetrievedChunk } from './retrieval/retriever.js';
export type { EmbeddingProvider } from './retrieval/embedding.js';
export { SimpleVectorIndex } from './retrieval/simple-vector-index.js';
export { PetriWorkspaceIndexerRetriever } from './retrieval/petri-workspace-indexer-retriever.js';

export { AiSdkEmbeddingProvider } from './providers/ai-sdk/ai-sdk-embeddings.js';
export { OllamaEmbeddingProvider } from './providers/ollama/ollama-embeddings.js';

export { defaultModelCatalog, ModelCatalog } from './routing/model-catalog.js';
