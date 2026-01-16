# 05 — Required Changes in This Repo (Where/What/Why)

This section is the “surgical map” for a zero-UX migration.

## Strategy recommendation
Keep the existing ISL runtime/step engine producing run/step events, and swap only the underlying **LLM provider execution + routing**.

That preserves:
- step lifecycle events (`step_started`, `step_completed`, etc.)
- agent status/tokens events emitted by `packages/extension/src/islRunner/engine/engineConfig.ts`

## 1) Replace the agent pool implementation behind `AgentPort`
### Where
- `packages/extension/src/islRunner/engine/createAgentPool.ts` constructs `MultiProviderAgentPool` today.

### What
Create a new implementation (or adapter) that implements `AgentPort` using unified-agent-sdk.

### Why
This isolates the migration to one “port” boundary.

## 2) Translate unified-agent-sdk events into existing session updates
### Where
- `packages/isl-runner/src/runtime/ports.ts` expects `SessionUpdateCallback`.

### What
In the adapter’s streaming path:
- map `text_delta` -> `sessionUpdates.onMessage`
- map `thinking_delta` -> `sessionUpdates.onThought`
- join `tool_call` + `tool_result` by id -> `sessionUpdates.onToolCall(toolName, JSON(args), JSON(result))`

### Why
The Events tab is UI-critical; it must keep the same semantics.

## 3) Preserve tool naming for file-write detection
### Where
- `packages/extension/src/islRunner/state/reducer.ts` checks for `agent_tool_call` with tool `ws_write_file`.

### What
Ensure that the tool name exposed to the runner remains `ws_write_file` (via unified-agent-sdk tool aliasing) OR change reducer logic.

### Why
Changing reducer logic risks UI copy/behavior drift.

## 4) Routing replacement
### Where
- Today routing/failover is inside `MultiProviderAgentPool` and `packages/isl-runner/src/router/*`.

### What
Option A (lowest risk): keep existing router and use unified-agent-sdk per-provider engines only.
Option B (full replacement): use unified-agent-sdk `ModelRouter` but extend it per `04-required-changes-unified-agent-sdk.md`.

### Why
If you change routing semantics, behavior changes even if UI doesn’t.

## 5) Provider configuration mapping
### Where
- `packages/extension/src/islRunner/engine/createAgentPool.ts` reads VS Code settings and env.

### What
Map existing settings to unified-agent-sdk provider config:
- Auggie: token/url, workspaceRoot/allowIndexing/rules
- AI SDK: openai/anthropic/gateway keys/base URLs/middleware
- Ollama: host/headers

### Why
Keeps the UX stable (users’ existing settings continue to work).
