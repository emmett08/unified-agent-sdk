import { UnifiedAgentSDK, AllowAllToolsPolicy, NodeFsWorkspace } from '../dist/esm/index.js';

const sdk = new UnifiedAgentSDK({
  providers: {
    aiSdk: {
      openaiApiKey: process.env.OPENAI_API_KEY,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    },
    // Enable Ollama only when explicitly configured; otherwise this demo will prefer AI SDK providers.
    ...(process.env.OLLAMA_HOST ? { ollama: { host: process.env.OLLAMA_HOST } } : {}),
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

try {
  // Attach a rejection handler immediately to avoid Node treating early failures as unhandled.
  let runError;
  const resultPromise = run.result.catch((e) => {
    runError = e;
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
  await resultPromise;
  if (runError) throw runError;
} catch (e) {
  console.error('\n[demo] Run failed:', e && typeof e === 'object' && 'message' in e ? e.message : String(e));
  if (e && typeof e === 'object' && 'cause' in e && e.cause) {
    console.error('[demo] Cause:', e.cause?.message ?? String(e.cause));
  }
  console.error('\n[demo] Tip: set OPENAI_API_KEY (or AUGMENT_API_TOKEN). For Ollama, set OLLAMA_HOST and install `ollama`.');
  process.exitCode = 1;
}
