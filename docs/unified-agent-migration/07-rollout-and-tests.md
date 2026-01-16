# 07 — Rollout and Tests

## 1) Rollout plan (zero UI/UX risk)
1. Land unified-agent-sdk compat additions (tool aliasing, session-update hook, memory/retrieval events).
2. Add a feature flag in this repo (setting or env) to select execution backend:
   - default: existing MultiProviderAgentPool
   - opt-in: unified-agent-sdk adapter
3. Run both backends in a controlled dev environment and compare:
   - emitted `RunnerEvent` sequences
   - outputs and file changes
4. Switch default only after parity is validated.

## 2) Tests to add/run
Constraints: user requested **no VS Code extension-host tests**.

### Unit tests (recommended)
- Adapter event translation:
  - tool_call + tool_result => single `onToolCall(tool,args,result)`
  - thinking/text streaming => `onThought`/`onMessage`
- Tool name compatibility:
  - ensure file-write detection still sees `ws_write_file`
- Routing parity tests (if routing is replaced):
  - preferred provider honored
  - fallback ordering stable

### Commands (this repo)
- `npm -w packages/isl-runner test`
- `npm -w packages/isl-runner run build`
- `npm -w packages/extension run build`

## 3) Verification checklist
- No changes required to UI components/webviews.
- Runner event log still shows:
  - agent messages, tool calls/results, thinking deltas
  - tokens used / usage data (where available)
- Run status detection works (completed vs noop).
