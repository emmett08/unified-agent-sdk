# 02 — unified-agent-sdk Survey (0.1.0)

Source basis: `@neuralsea/unified-agent-sdk@0.1.0` repo.

## 1) Primary API
- `UnifiedAgentSDK.run(opts)` in `src/core/sdk.ts` returns an `AgentRun`:
  - `events: AsyncIterable<AgentEvent>`
  - `result: Promise<AgentResult>`
  - control methods: `pause/resume/stop/cancel`

## 2) Unified event model
- `AgentEvent` is defined in `src/core/types.ts`.
- Event types include:
  - streaming: `thinking_delta`, `text_delta`
  - tools: `tool_call`, `tool_result`, `tool_approval_request`
  - filesystem effects: `file_change` (create/update/delete/rename/patch_hunk)
  - usage: `usage`

Notably, unified-agent-sdk does **not** include:
- `agentId` / `stepId` / `workflowName` metadata on events (today).

## 3) Tools
- unified-agent-sdk ships built-in tools:
  - filesystem: `fs_read_file`, `fs_write_file`, `fs_delete_path`, `fs_rename_path`, `fs_apply_patch` (`src/tools/fs-tools.ts`)
  - memory KV: `memory_get`, `memory_set` (`src/tools/memory-tools.ts`)
  - retrieval: `retrieve_context` (`src/tools/retrieval-tools.ts`)

## 4) Providers / engines
- AI SDK engine streams deltas + parses `fullStream` for tool calls/results (`src/providers/ai-sdk/ai-sdk-engine.ts`).
- Auggie engine translates Auggie session updates into unified events (`src/providers/auggie/auggie-engine.ts`).
- Ollama engine supports tool execution loops, emits `thinking_delta`/`text_delta` and tool events (`src/providers/ollama/ollama-engine.ts`).

## 5) Routing
- `ModelRouter` (`src/routing/router.ts`) selects candidates from `ModelCatalog` (`src/routing/model-catalog.ts`).
- Routing today is simple ordering + optional `preferredProviders` and `modelClass`.

## 6) Workspace abstraction
- `WorkspacePort` and the VS Code adapter are in `src/workspaces/*`.
- VS Code implementation (`src/workspaces/vscode-workspace.ts`) uses `WorkspaceEdit` when possible to keep editor buffers updated.
