# 06 — UI-Exposable Features (Provider + SDK)

Goal: identify additional features you can expose in the VS Code UI once unified-agent-sdk is in place.

This section separates:
- **Verified** features (seen in source)
- **Unavailable** features (would require checking provider SDK docs/versions)

## A) Verified today in unified-agent-sdk (0.1.0)

### 1) Reasoning vs text streaming
- AI SDK engine emits `thinking_delta` and `text_delta` (`src/providers/ai-sdk/ai-sdk-engine.ts`).
- Auggie engine emits `thinking_delta` and `text_delta` from session updates (`src/providers/auggie/auggie-engine.ts`).
- Ollama engine emits `thinking_delta` from `message.thinking` and `text_delta` from `message.content` (`src/providers/ollama/ollama-engine.ts`).

UI idea:
- Add a “Reasoning” toggle in the Events tab that shows/hides `thinking_delta`.

### 2) Tool approvals
- unified-agent-sdk supports `ToolPolicy` decisions including `ask` and emits `tool_approval_request` (`src/tools/tool-executor.ts`).

UI idea:
- A tool approval UI surface that allows per-call approve/deny via `run.approveToolCall(callId, allowed)`.

### 3) Workspace edits / file change notifications
- FS tools emit `file_change` events (`src/tools/fs-tools.ts`).

UI idea:
- Show a “Files changed” list per run, with per-hunk progress when patches are applied (`patch_hunk`).

### 4) Retrieval (Petri workspace indexer)
- `PetriWorkspaceIndexerRetriever` can index and retrieve and returns scored chunks (`src/retrieval/petri-workspace-indexer-retriever.ts`).

UI idea:
- Add a “Context” panel showing retrieved chunks, with click-to-open file/line support.

### 5) Memory KV tools
- `memory_get`/`memory_set` exist and are tagged with capabilities `memory:read`/`memory:write` (`src/tools/memory-tools.ts`).

UI idea:
- Expose a “Memory KV” inspector for debugging and determinism.

## B) Additions recommended to enable richer UX

### 1) Memory/retrieval events (recommended)
Currently, memory/retrieval are only visible indirectly via tool args.

Add structured events:
- memory: `{ type: 'memory', op, key, size?, at }`
- retrieval: `{ type: 'retrieval', query, topK, hits, at }`

This enables first-class UI elements without parsing args.

### 2) Provider capability model (recommended)
Add a stable, queryable capability surface:
- streaming reasoning available?
- tool calling supported?
- supports structured outputs / JSON schema?
- supports model listing?
- supports token usage/cost?

This allows the UI to show/hide feature toggles safely.

**Unavailable**: exact feature sets per provider version were not verified in this review.

### 3) Usage + cost normalization (recommended)
- unified-agent-sdk has `usage` events for AI SDK (`src/providers/ai-sdk/ai-sdk-engine.ts`).
- Auggie/Ollama usage is not emitted (in reviewed code).

Add a normalized `usage` event across all providers when data is available.

**Unavailable**: whether Ollama/Auggie provide accurate token counts in the current SDKs without additional calls.

### 4) Structured output support
This repo’s current runner can pass `outputSchema` (zod) down to providers.

unified-agent-sdk uses JSON schema for tools, but does not expose an output-schema run option.

Recommended addition:
- `RunOptions.outputSchema?: JsonSchema | ZodSchema` (with optional dep)
- and engine support where providers permit it.

## C) Provider-specific UI knobs (mechanisms)

### AI SDK (Vercel)
Verified:
- Middleware support + reasoning extraction via `reasoningTagName` in provider config (`src/providers/provider-config.ts`, `src/providers/ai-sdk/ai-sdk-engine.ts`).

UI knobs:
- model selector by class
- “extract reasoning” toggle (tag name)
- maxTokens, temperature, maxSteps

### Auggie
Verified:
- config supports `workspaceRoot`, `allowIndexing`, `rules`, `cliArgs` (`src/providers/provider-config.ts`).

UI knobs:
- indexing toggle
- rule set selection

### Ollama
Verified:
- `metadata.think` is read (default true) (`src/providers/ollama/ollama-engine.ts`).

UI knobs:
- think on/off
- host + headers

**Unavailable**: additional Ollama provider features (structured output, tool calling quirks per model) not verified here.
