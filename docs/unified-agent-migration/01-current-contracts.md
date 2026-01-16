# 01 — Current Contracts (This Repo)

## 1) Execution port contract (ISL runner)
- `AgentPort.prompt()` and related types live in `packages/isl-runner/src/runtime/ports.ts`.
- UI-visible streaming is mediated via:
  - `PromptConfig.onStreamUpdate?: (update: StreamUpdate) => void`
  - `PromptConfig.sessionUpdates?: SessionUpdateCallback`

`SessionUpdateCallback` is the most UI-coupled contract:
- `onMessage(messageChunk)`
- `onThought(thoughtChunk)`
- `onToolCall(toolName, argsText?, resultText?)`

## 2) Provider interface (multi-provider pool)
- Provider interface is in `packages/isl-runner/src/agent/provider-interface.ts`.
- `GenerateRequest.sessionCallback?: ProviderSessionCallback` mirrors `SessionUpdateCallback`.

## 3) Multi-provider execution + routing
- Execution (including streaming collection and failover) is in `packages/isl-runner/src/agent/multi-provider-pool.ts`.
- Routing plan selection is in `packages/isl-runner/src/router/router.ts` and related files in `packages/isl-runner/src/router/*`.

## 4) UI protocol: what the webviews expect
- Runner UI protocol types are in `packages/extension/src/islRunner/protocol.ts`.
- Key UI-visible event types (subset):
  - `agent_tool_call`, `agent_thought`, `agent_message`
  - `tokens_used`
  - step/run lifecycle events

## 5) A concrete UI behavior coupled to tool names
- `packages/extension/src/islRunner/state/reducer.ts` sets run status to `completed` vs `noop` using:
  - “did any `agent_tool_call` occur with `toolName === 'ws_write_file'`?”

This is a hard compatibility requirement unless we also change the reducer + any UI copy.
