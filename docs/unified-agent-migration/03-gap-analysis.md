# 03 — Gap Analysis (What would break UI/UX)

## Gap A: Tool naming mismatch impacts run status
- This repo’s UI treats a run as “completed” (not “noop”) if the tool `ws_write_file` was called.
  - Evidence: `packages/extension/src/islRunner/state/reducer.ts`.
- unified-agent-sdk filesystem tool is `fs_write_file`.

If you swap execution without aliasing tool names, the UI will incorrectly show runs as `noop` even when files were written.

## Gap B: Event shape mismatch (agent_* events)
- This repo expects `RunnerEvent` types including `agent_message`, `agent_thought`, `agent_tool_call`.
  - Evidence: `packages/extension/src/islRunner/protocol.ts`.
- unified-agent-sdk emits `text_delta`, `thinking_delta`, and split `tool_call` / `tool_result`.

A compatibility adapter must translate unified events into the existing `RunnerEvent` protocol.

## Gap C: Step/workflow context
- Runner UI events include `workflowName`, `stepId`, and agent identity.
- unified-agent-sdk events do not include these context fields.

A zero-UX approach either:
- keeps the existing ISL runtime/engine producing step events (and uses unified-agent-sdk *only* for LLM calls), or
- extends unified-agent-sdk events with optional metadata fields so the adapter can preserve context.

## Gap D: Routing semantics
- This repo’s router has richer constraints + health/failover mechanisms (`packages/isl-runner/src/router/*`).
- unified-agent-sdk routing is simpler and does not include a circuit breaker.

Even if UI is stable, behavior could change (different models selected, different fallback ordering) unless routing is extended or you preserve your routing config semantics.
