# 04 — Required Changes to unified-agent-sdk (for zero UI/UX impact)

This section describes what to add/fix in unified-agent-sdk (and why), to make the migration safe and to enable richer UI features.

## 1) File-system tool name compatibility (MUST)
### What
Add configurable naming/aliasing for built-in FS tools in `src/tools/fs-tools.ts`.

### Why
This repo’s UI behavior depends on `ws_write_file` (see `packages/extension/src/islRunner/state/reducer.ts`).

### Suggested API
- Option A: `createFsTools({ events, preview, toolPrefix?: 'fs_' | 'ws_' })`
- Option B: `createFsTools({ events, preview, names?: Partial<Record<'readFile'|'writeFile'|'applyPatch'|'deletePath'|'renamePath', string>> })`
- Option C: `aliases: Record<string,string>` where tool definitions are registered twice.

## 2) “Session update” compatibility hook (MUST)
### What
Add an opt-in hook that emits the existing “combined” tool call shape:
- `onMessage(textChunk)`
- `onThought(thoughtChunk)`
- `onToolCall(toolName, argsText?, resultText?)` — *single call after tool result is available*

### Why
This repo’s UI events stream is built around that shape.

### Proposed mechanism
Implement a small `ToolCallAggregator` in unified-agent-sdk that:
- listens to `tool_call` and `tool_result` events
- joins them by `id`
- exposes `onToolCallResolved(toolName, args, result)`

This avoids adapters in downstream repos duplicating join logic.

## 3) Event metadata for UI exposure (SHOULD)
### What
Extend `AgentEvent` in `src/core/types.ts` with optional meta:
```ts
meta?: { agentId?: string; stepId?: string; workflowName?: string; traceId?: string }
```

### Why
Downstream UIs (like this repo) commonly want to associate LLM/tool events with a current step.

## 4) Memory/retrieval observability events (SHOULD)
### What
Emit events for memory and retrieval operations:
- memory: `memory_read`, `memory_write`
- retrieval: `retrieval_query`, `retrieval_results`

### Why
unified-agent-sdk already exposes memory + retrieval tools (`src/tools/memory-tools.ts`, `src/tools/retrieval-tools.ts`) but does not emit events specific to those operations.

### Suggested implementation
- In tool implementations, emit a structured event *in addition* to tool_call/tool_result:
  - `{ type: 'memory', op: 'get'|'set', key, at }`
  - `{ type: 'retrieval', query, topK, resultCount, at }`

This enables UI features like “memory reads/writes” and “retrieval context used” without parsing tool args.

## 5) Provider capability/introspection surface (SHOULD)
### What
Add an optional method like:
- `sdk.getProviderCapabilities(): { providerId, features: {...}, versions?: {...} }[]`

### Why
To expose provider-specific features in UI safely, you need a stable capability model (don’t guess).

**Unavailable**: provider feature matrices / newest versions were not verified here.

## 6) Routing parity improvements (MAY, depending on acceptance)
If you truly replace routing, consider adding:
- circuit breaker / penalty scoring (parity with `packages/isl-runner/src/router/circuit-breaker.ts` and `failover.ts`)
- richer constraints (mustStream, requiresTools) as hard filters
- file-backed config store to preserve existing VS Code settings semantics

## 7) Bug fix: `requireExplicitApproval` option is unused (SHOULD)
### Evidence
`ToolExecutorOptions.requireExplicitApproval` exists in `src/tools/tool-executor.ts` but is not referenced.

### Fix options
- Implement it (only block/emit approval events when flag is true), or
- Remove it to avoid misleading integrators.
