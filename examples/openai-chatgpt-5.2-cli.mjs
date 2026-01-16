import { UnifiedAgentSDK, NodeFsWorkspace, AllowAllToolsPolicy, CapabilityApprovalPolicy } from '../dist/esm/index.js';
import fs from 'node:fs/promises';
import path from 'node:path';

function usage() {
  return `OpenAI CLI demo (thinking callbacks + tools + file write)

Usage:
  OPENAI_API_KEY=... node examples/openai-chatgpt-5.2-cli.mjs [options]

Options:
  --model <id>           Default: openai/gpt-4o-mini (override if you have chatgpt-5.2)
  --out <path>           Workspace-relative output path (default: demo/agent-proof.txt)
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
    onThinkingDelta: args.thinking ? (delta) => process.stderr.write(delta) : undefined,
    onTextDelta: (delta) => process.stdout.write(delta),
    onEvent: (ev, api) => {
      if (ev.type === 'tool_approval_request') {
        process.stderr.write(`\n[approval] ${ev.request.call.toolName}: ${ev.request.reason}\n`);
        if (args.autoApprove) api.approveToolCall(ev.request.call.id, true);
      } else if (ev.type === 'file_change') {
        const p = ev.change.path ?? `${ev.change.fromPath} -> ${ev.change.toPath}`;
        process.stderr.write(`\n[file_change] ${ev.change.kind}: ${p}\n`);
      } else if (ev.type === 'tool_call') {
        process.stderr.write(`\n[tool_call] ${ev.call.toolName}\n`);
      } else if (ev.type === 'tool_result') {
        process.stderr.write(`\n[tool_result] ${ev.result.toolName}\n`);
      } else if (ev.type === 'error') {
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
