/* eslint-disable no-console */
const fs = require('node:fs/promises');
const path = require('node:path');

function usage() {
  return `Memory demo: repo scan + SharedMemoryPool reuse

Runs 2 agent passes in the same process:
  1) scans repository and stores a compact audit in shared memory (memory_set)
  2) generates a markdown report from shared memory (memory_get) + writes it to disk

Usage:
  OPENAI_API_KEY=... node examples/memory-repo-audit.cjs [options]

Options:
  --model <id>     Default: openai/gpt-4o-mini
  --root <dir>     Workspace root (default: cwd)
  --out <path>     Output report path (default: demo/memory-repo-audit.md)
  --max-steps <n>  Default: 10
  --help           Show this help
`;
}

function parseArgs(argv) {
  const out = {
    help: false,
    model: 'openai/gpt-4o-mini',
    root: process.cwd(),
    outPath: 'demo/memory-repo-audit.md',
    maxSteps: 10,
  };

  const takeValue = (i, flag) => {
    if (i + 1 >= argv.length) throw new Error(`Missing value for ${flag}`);
    return argv[i + 1];
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--model') out.model = takeValue(i++, a);
    else if (a === '--root') out.root = takeValue(i++, a);
    else if (a === '--out') out.outPath = takeValue(i++, a);
    else if (a === '--max-steps') out.maxSteps = Number(takeValue(i++, a));
    else throw new Error(`Unknown arg: ${a}`);
  }

  if (!Number.isFinite(out.maxSteps) || out.maxSteps <= 0) throw new Error(`--max-steps must be a positive number`);
  return out;
}

async function listRepoFiles(rootDir) {
  const ignore = new Set(['node_modules', 'dist', '.git', '.DS_Store']);
  const out = [];

  async function walk(rel) {
    const abs = path.join(rootDir, rel);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    for (const e of entries) {
      if (ignore.has(e.name)) continue;
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(childRel);
      else if (e.isFile()) out.push(childRel);
    }
  }

  await walk('');
  return out.sort();
}

(async () => {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error((e instanceof Error ? e.message : String(e)) + '\n');
    console.error(usage());
    process.exit(2);
  }

  if (args.help) {
    process.stdout.write(usage());
    process.exit(0);
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY.');
    process.exit(1);
  }

  const {
    UnifiedAgentSDK,
    SharedMemoryPool,
    NodeFsWorkspace,
    AllowAllToolsPolicy,
    CapabilityApprovalPolicy,
  } = await import('../dist/esm/index.js');

  const memory = new SharedMemoryPool({ ttlMs: 60 * 60_000 });
  const sdk = new UnifiedAgentSDK({
    providers: {
      aiSdk: { openaiApiKey: process.env.OPENAI_API_KEY, openaiBaseUrl: process.env.OPENAI_BASE_URL },
    },
    memory,
  });

  const repoListTool = {
    name: 'repo_list_files',
    description: 'List repository files relative to workspace root (best-effort; ignores node_modules/dist/.git).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async () => ({ root: args.root, files: await listRepoFiles(args.root) }),
  };

  const system = [
    'You are auditing a TypeScript/Node repository.',
    'Use tools. Prefer calling repo_list_files first.',
    'For reading source, use fs_read_file with maxBytes when unsure about file size.',
    'When writing the report, use fs_write_file.',
    'Keep any stored memory payload small (compact JSON).',
  ].join('\n');

  const policy = new CapabilityApprovalPolicy(['fs:write']);

  async function runOnce(label, prompt) {
    const started = Date.now();
    const run = sdk.run({
      provider: 'ai-sdk',
      model: args.model,
      system,
      prompt,
      workspace: new NodeFsWorkspace(args.root),
      workspaceMode: 'live',
      maxSteps: args.maxSteps,
      policy,
      tools: [repoListTool],
      hooks: {
        onThinkingDelta: (d) => process.stderr.write(d),
        onTextDelta: (d) => process.stdout.write(d),
        onEvent: (ev, api) => {
          if (ev.type === 'tool_approval_request') api.approveToolCall(ev.request.call.id, true);
        },
      },
    });

    const res = await run.result;
    const elapsedMs = Date.now() - started;
    process.stderr.write(`\n[${label}] finishReason=${res.finishReason} elapsedMs=${elapsedMs}\n`);
    return { res, elapsedMs };
  }

  const scanPrompt = [
    'Call repo_list_files to get the full file list.',
    'Then figure out how SharedMemoryPool is currently integrated into the SDK.',
    'Focus on: where it is constructed, how tools access it, and what is (not yet) using it.',
    'Read only the minimum files needed, but use the file list to ensure you considered the whole repo structure.',
    '',
    'Also store agent memory using memory_set with these keys and JSON values:',
    '- agent_memory:episodic => { runId, summary: string, actionsTaken: string[] }',
    '- agent_memory:procedural => { runId, checklist: string[] }',
    '- agent_memory:semantic => { runId, facts: string[], tipsForOtherAgents: string[] }',
    '',
    'Store a compact JSON object in shared memory under key "repo:memory_audit" with fields:',
    '- filesConsideredCount (number)',
    '- keyFiles (string[])',
    '- currentIntegration (string)',
    '- suggestedImprovements (string[])',
    '',
    'Do not write any files in this pass.',
  ].join('\n');

  const reportPrompt = [
    'Retrieve "repo:memory_audit" using memory_get.',
    'Also retrieve agent_memory:episodic, agent_memory:procedural, agent_memory:semantic using memory_get.',
    `Write a markdown report to "${args.outPath}" via fs_write_file.`,
    'The report should include:',
    '- A short summary of current SharedMemoryPool integration',
    '- Concrete improvement ideas (bulleted)',
    '- One small recommended next patch target file path',
    '',
    'Only read files if the memory payload is missing or clearly insufficient.',
    `Finish with exactly: Wrote ${args.outPath}`,
  ].join('\n');

  const run1 = await runOnce('scan', scanPrompt);
  process.stdout.write('\n\n');
  const run2 = await runOnce('report', reportPrompt);

  const episodic = sdk.memory.kv.get('agent_memory:episodic');
  const procedural = sdk.memory.kv.get('agent_memory:procedural');
  const semantic = sdk.memory.kv.get('agent_memory:semantic');
  const hasAny = episodic !== undefined || procedural !== undefined || semantic !== undefined;
  process.stderr.write(`\n[memory] ${hasAny ? 'agent_memory:* set' : 'agent_memory:* missing'}\n`);
  if (hasAny) process.stderr.write(JSON.stringify({ episodic, procedural, semantic }, null, 2) + '\n');

  const kvSize = sdk.memory.kv.size;
  const snapSize = sdk.memory.fileSnapshots.size;
  process.stderr.write(`[memory] kv.size=${kvSize} fileSnapshots.size=${snapSize}\n`);

  // Verify report exists
  const outAbs = path.isAbsolute(args.outPath) ? args.outPath : path.join(args.root, args.outPath);
  const written = await fs.readFile(outAbs, 'utf8').catch(() => null);
  if (written == null) {
    process.stderr.write(`[verify] missing ${args.outPath}\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write(`[verify] read ${args.outPath} (${written.length} bytes)\n`);
  }

  // Keep process alive only as needed; no dangling awaits.
  void run1;
  void run2;
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
