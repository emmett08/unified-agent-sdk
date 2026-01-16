# unified-agent-sdk

A provider-agnostic agent SDK designed for editor integrations (VS Code extensions, JetBrains plugins, CLIs).

**Providers supported**
- **Augment Auggie SDK** (`@augmentcode/auggie-sdk`) — streaming via `onSessionUpdate`.  
- **Vercel AI SDK** (`ai` + `@ai-sdk/openai`/`@ai-sdk/anthropic`/`@ai-sdk/gateway`) — multi-step tool loops, streaming, middleware, embeddings.  
- **Ollama** (`ollama`) — local/Cloud Ollama with streaming, thinking traces, tool calling loop, embeddings, and abort.

**Key features**
- Unified event stream (`thinking_delta`, `text_delta`, `tool_call`, `tool_result`, `file_change`, …)
- Workspace tools: read/write/delete/rename/apply unified diff **per hunk** (Codex-like live updates)
- Policies for tool permissions (allow/deny/approval, capabilities, path rules)
- Pause / resume / stop / cancel (AbortSignal + provider-native cancellation where available)
- Shared memory pool with LRU caching (embeddings, file snapshots, arbitrary KV)
- Model routing: `default | frontier | fast | long_context | cheap` with provider/model catalog

## Install

```bash
npm i unified-agent-sdk
# and one or more provider deps:
npm i ai @ai-sdk/openai @ai-sdk/anthropic
npm i @augmentcode/auggie-sdk
npm i ollama
```

## Quick usage

```ts
import { UnifiedAgentSDK, AllowAllToolsPolicy, NodeFsWorkspace } from 'unified-agent-sdk';

const sdk = new UnifiedAgentSDK({
  providers: {
    aiSdk: {
      openaiApiKey: process.env.OPENAI_API_KEY!,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
      // optional: gatewayApiKey, middleware, etc.
    },
    auggie: { apiKey: process.env.AUGMENT_API_TOKEN, apiUrl: process.env.AUGMENT_API_URL },
    ollama: { host: 'http://127.0.0.1:11434' }
  }
});

const workspace = new NodeFsWorkspace(process.cwd());

const run = sdk.run({
  prompt: 'Refactor the project to remove duplication and update files incrementally.',
  workspace,
  workspaceMode: 'live',
  routing: { modelClass: 'frontier' },
  policy: new AllowAllToolsPolicy(),
});

for await (const ev of run.events) {
  if (ev.type === 'file_change') console.log(ev.change);
  if (ev.type === 'text_delta') process.stdout.write(ev.text);
}
```

## Demo: OpenAI CLI (thinking callbacks + file write)

This repo includes a runnable CLI demo that:
- uses `model: openai/chatgpt-5.2` (override with `--model`)
- streams `thinking_delta`/`text_delta` via `hooks`
- requires approval for `fs:write` and auto-approves in the CLI
- proves a tool-driven file write by reading the file back at the end

```bash
npm i ai @ai-sdk/openai
OPENAI_API_KEY=... npm run build
OPENAI_API_KEY=... npm run demo:openai -- --out demo/agent-proof.txt --model openai/gpt-4o-mini
```

## VS Code workspace adapter

This SDK does **not** depend on `vscode`. Use the adapter entrypoint:

```ts
import { createVSCodeWorkspace } from 'unified-agent-sdk/workspaces/vscode';
// createVSCodeWorkspace(vscodeApi, workspaceRootUri)
```

## Pause / resume / stop / cancel

```ts
run.pause();
run.resume();
run.stop();   // graceful stop at a safe boundary
run.cancel(); // immediate AbortSignal + provider abort if supported
```

## Tool policies

Tools are described with JSON Schema inputs and optional `capabilities`.
Policies decide allow/deny/require approval per tool call.

```ts
import { ToolAllowListPolicy } from 'unified-agent-sdk';

const policy = new ToolAllowListPolicy(['fs_read_file', 'fs_apply_patch']);
```

## Notes

- For *failover routing*, prefer `workspaceMode: "preview"` so the SDK can discard changes on a failed attempt.
- AI SDK tool definitions accept **Zod or JSON schema** input schemas.
- Ollama `think` output streams via `chunk.message.thinking`, separate from `chunk.message.content`.
