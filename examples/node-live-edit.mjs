import { UnifiedAgentSDK, AllowAllToolsPolicy, NodeFsWorkspace } from '../dist/esm/index.js';

const sdk = new UnifiedAgentSDK({
  providers: {
    aiSdk: {
      openaiApiKey: process.env.OPENAI_API_KEY,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    },
    ollama: { host: process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434' },
    auggie: { apiKey: process.env.AUGMENT_API_TOKEN, apiUrl: process.env.AUGMENT_API_URL }
  }
});

const run = sdk.run({
  prompt: 'Create a file hello.txt that says hello, then patch it to say hello world.',
  workspace: new NodeFsWorkspace(process.cwd()),
  workspaceMode: 'live',
  routing: { modelClass: 'fast' },
  policy: new AllowAllToolsPolicy(),
  maxSteps: 6,
});

for await (const ev of run.events) {
  if (ev.type === 'thinking_delta') process.stderr.write(ev.text);
  if (ev.type === 'text_delta') process.stdout.write(ev.text);
  if (ev.type === 'file_change') console.log('\nFILE CHANGE', ev.change);
  if (ev.type === 'tool_approval_request') {
    // auto-approve in example
    run.approveToolCall(ev.request.call.id, true);
  }
}

await run.result;
