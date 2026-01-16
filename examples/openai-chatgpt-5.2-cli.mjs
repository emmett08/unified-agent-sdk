import { UnifiedAgentSDK, NodeFsWorkspace, AllowAllToolsPolicy, CapabilityApprovalPolicy } from '../dist/esm/index.js';
import fs from 'node:fs/promises';
import path from 'node:path';

// AI SDK prints warnings by default; keep demo output clean unless the user opts in.
if (process.env.AI_SDK_LOG_WARNINGS === undefined) process.env.AI_SDK_LOG_WARNINGS = 'false';
// Some AI SDK versions also respect a global.
if (globalThis.AI_SDK_LOG_WARNINGS === undefined) globalThis.AI_SDK_LOG_WARNINGS = false;

function usage() {
  return `OpenAI CLI demo (thinking callbacks + tools + file write)

Usage:
  OPENAI_API_KEY=... node examples/openai-chatgpt-5.2-cli.mjs [options]

Options:
  --model <id>           Default: openai/gpt-4o-mini (override if you have chatgpt-5.2)
  --out <path>           Workspace-relative output path (default: demo/agent-proof.txt)
  --proof <path>         Write JSON callback proof (default: demo/agent-proof.json)
  --thinking-log <path>  Write thinking trace (default: demo/agent-thinking.log)
  --no-memory            Do not request/print agent memory (episodic/procedural/semantic)
  --root <dir>           Workspace root (default: cwd)
  --prompt <text>        User prompt (default: writes --out using tools)
  --system <text>        System prompt override
  --max-steps <n>        Default: 6
  --preview              Use preview workspace mode (no live writes until commit)
  --no-thinking          Hide thinking deltas
  --no-auto-approve      Do not auto-approve tool calls (when using approval policy)
  --no-approval          Do not require approval for fs:write
  --reasoning-tag <tag>  Extract <tag>...</tag> reasoning via AI SDK middleware
  --help                 Show this help
`;
}

function parseArgs(argv) {
  const out = {
    help: false,
    model: undefined,
    outPath: 'demo/agent-proof.txt',
    proofPath: 'demo/agent-proof.json',
    thinkingLogPath: 'demo/agent-thinking.log',
    memory: true,
    root: process.cwd(),
    prompt: undefined,
    system: undefined,
    maxSteps: 6,
    preview: false,
    thinking: true,
    autoApprove: true,
    approval: true,
    reasoningTag: undefined,
  };

  const takeValue = (i, flag) => {
    if (i + 1 >= argv.length) throw new Error(`Missing value for ${flag}`);
    return argv[i + 1];
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--model') out.model = takeValue(i++, a);
    else if (a === '--out') out.outPath = takeValue(i++, a);
    else if (a === '--proof') out.proofPath = takeValue(i++, a);
    else if (a === '--thinking-log') out.thinkingLogPath = takeValue(i++, a);
    else if (a === '--no-memory') out.memory = false;
    else if (a === '--root') out.root = takeValue(i++, a);
    else if (a === '--prompt') out.prompt = takeValue(i++, a);
    else if (a === '--system') out.system = takeValue(i++, a);
    else if (a === '--max-steps') out.maxSteps = Number(takeValue(i++, a));
    else if (a === '--preview') out.preview = true;
    else if (a === '--no-thinking') out.thinking = false;
    else if (a === '--no-auto-approve') out.autoApprove = false;
    else if (a === '--no-approval') out.approval = false;
    else if (a === '--reasoning-tag') out.reasoningTag = takeValue(i++, a);
    else throw new Error(`Unknown arg: ${a}`);
  }

  if (!Number.isFinite(out.maxSteps) || out.maxSteps <= 0) throw new Error(`--max-steps must be a positive number`);
  return out;
}

const args = (() => {
  try {
    return parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error((e instanceof Error ? e.message : String(e)) + '\n');
    console.error(usage());
    process.exit(2);
  }
})();

if (args.help) {
  process.stdout.write(usage());
  process.exit(0);
}

if (!process.env.OPENAI_API_KEY) {
  console.error(
    'Missing OPENAI_API_KEY. Install provider deps (`npm i -D ai @ai-sdk/openai`) and set OPENAI_API_KEY (or export it in your shell).'
  );
  process.exit(1);
}

const finalModel =
  args.model ??
  process.env.UASDK_MODEL ??
  (process.env.OPENAI_MODEL ? (process.env.OPENAI_MODEL.startsWith('openai/') ? process.env.OPENAI_MODEL : `openai/${process.env.OPENAI_MODEL}`) : 'openai/gpt-4o-mini');

const demoNowTool = {
  name: 'demo_now',
  description: 'Return the current time as an ISO string.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  execute: async () => ({ iso: new Date().toISOString() }),
};

const system =
  args.system ??
  [
    'You are an agent running in a CLI.',
    'Use tools when requested (especially for file writes).',
    'Keep the final response to 1-2 short sentences.',
  ].join('\n');

const prompt =
  args.prompt ??
  [
    `Use the demo_now tool to get a timestamp.`,
    `Then use fs_write_file to write the file at path "${args.outPath}" with EXACT content:`,
    `PROOF: <timestamp from demo_now.iso>`,
    `MODEL: ${finalModel}`,
    ``,
    ...(args.memory
      ? [
          `Then store "agent memory" using memory_set with these keys and JSON values:`,
          `- agent_memory:episodic => { runId, timestampIso, actionsTaken: string[] }`,
          `- agent_memory:procedural => { runId, checklist: string[] }`,
          `- agent_memory:semantic => { runId, facts: string[], tipsForOtherAgents: string[] }`,
        ]
      : []),
    ``,
    `Finally, reply with: Wrote ${args.outPath}`,
  ].join('\n');

const sdk = new UnifiedAgentSDK({
  providers: {
    aiSdk: {
      openaiApiKey: process.env.OPENAI_API_KEY,
      openaiBaseUrl: process.env.OPENAI_BASE_URL,
      reasoningTagName: args.reasoningTag ?? process.env.UASDK_REASONING_TAG,
    },
  },
});

const policy = args.approval ? new CapabilityApprovalPolicy(['fs:write']) : new AllowAllToolsPolicy();

const startedAt = Date.now();
let thinkingChunks = 0;
let thinkingChars = 0;
let textChunks = 0;
let textChars = 0;
let toolCalls = 0;
let toolResults = 0;
let approvals = 0;
let fileChanges = 0;
let errors = 0;
let thinkingBuf = '';
let textBuf = '';

const run = sdk.run({
  provider: 'ai-sdk',
  model: finalModel,
  prompt,
  system,
  maxSteps: args.maxSteps,
  workspace: new NodeFsWorkspace(args.root),
  workspaceMode: args.preview ? 'preview' : 'live',
  policy,
  tools: [demoNowTool],
  hooks: {
    onThinkingDelta: args.thinking
      ? (delta) => {
          thinkingChunks += 1;
          thinkingChars += delta.length;
          thinkingBuf += delta;
          process.stderr.write(delta);
        }
      : (delta) => {
          thinkingChunks += 1;
          thinkingChars += delta.length;
          thinkingBuf += delta;
        },
    onTextDelta: (delta) => {
      textChunks += 1;
      textChars += delta.length;
      textBuf += delta;
      process.stdout.write(delta);
    },
    onEvent: (ev, api) => {
      if (ev.type === 'tool_approval_request') {
        approvals += 1;
        process.stderr.write(`\n[approval] ${ev.request.call.toolName}: ${ev.request.reason}\n`);
        if (args.autoApprove) api.approveToolCall(ev.request.call.id, true);
      } else if (ev.type === 'file_change') {
        fileChanges += 1;
        const p = ev.change.path ?? `${ev.change.fromPath} -> ${ev.change.toPath}`;
        process.stderr.write(`\n[file_change] ${ev.change.kind}: ${p}\n`);
      } else if (ev.type === 'tool_call') {
        toolCalls += 1;
        process.stderr.write(`\n[tool_call] ${ev.call.toolName}\n`);
      } else if (ev.type === 'tool_result') {
        toolResults += 1;
        process.stderr.write(`\n[tool_result] ${ev.result.toolName}\n`);
      } else if (ev.type === 'error') {
        errors += 1;
        process.stderr.write(`\n[error] ${ev.error}\n`);
      }
    },
  },
});

let result;
try {
  result = await run.result;
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`\n[fatal] ${msg}\n`);
  process.stderr.write(`[hint] Try a different model, e.g. --model openai/gpt-4o-mini (or set OPENAI_MODEL=gpt-4o-mini)\n`);
  process.exit(1);
}

if (args.preview && run.commitPreview) {
  await run.commitPreview();
  process.stderr.write(`\n[preview] committed changes\n`);
}

// Callback proof artifacts (written by the CLI, not the model).
const proofAbs = path.isAbsolute(args.proofPath) ? args.proofPath : path.join(args.root, args.proofPath);
const thinkingAbs = path.isAbsolute(args.thinkingLogPath) ? args.thinkingLogPath : path.join(args.root, args.thinkingLogPath);
await fs.mkdir(path.dirname(proofAbs), { recursive: true });
await fs.mkdir(path.dirname(thinkingAbs), { recursive: true });
await fs.writeFile(thinkingAbs, thinkingBuf, 'utf8');
await fs.writeFile(
  proofAbs,
  JSON.stringify(
    {
      runId: run.runId,
      provider: 'ai-sdk',
      model: finalModel,
      startedAt,
      finishedAt: Date.now(),
      finishReason: result.finishReason,
      counts: {
        thinkingChunks,
        thinkingChars,
        textChunks,
        textChars,
        toolCalls,
        toolResults,
        approvals,
        fileChanges,
        errors,
      },
      samples: {
        thinkingFirst200: thinkingBuf.slice(0, 200),
        textFirst200: textBuf.slice(0, 200),
      },
    },
    null,
    2
  ),
  'utf8'
);
process.stderr.write(`\n[proof] wrote ${args.proofPath} (thinkingChunks=${thinkingChunks})\n`);
process.stderr.write(`[proof] wrote ${args.thinkingLogPath} (thinkingChars=${thinkingChars})\n`);

if (args.memory) {
  const episodic = sdk.memory.kv.get('agent_memory:episodic');
  const procedural = sdk.memory.kv.get('agent_memory:procedural');
  const semantic = sdk.memory.kv.get('agent_memory:semantic');
  const hasAny = episodic !== undefined || procedural !== undefined || semantic !== undefined;
  process.stderr.write(`\n[memory] ${hasAny ? 'from memory_set tool' : '(none set; model may not have called memory_set)'}\n`);
  if (hasAny) {
    process.stderr.write(
      JSON.stringify(
        {
          episodic,
          procedural,
          semantic,
        },
        null,
        2
      ) + '\n'
    );
  }
}

const outAbs = path.isAbsolute(args.outPath) ? args.outPath : path.join(args.root, args.outPath);
const written = await fs.readFile(outAbs, 'utf8').catch(() => null);
if (written === null) {
  process.stderr.write(`\n[verify] expected file not found: ${args.outPath}\n`);
  process.exitCode = 1;
} else {
  process.stderr.write(`\n[verify] read ${args.outPath} (${written.length} bytes)\n`);
  process.stderr.write(written.trimEnd() + '\n');
}

process.stderr.write(`\n[done] finishReason=${result.finishReason}\n`);
