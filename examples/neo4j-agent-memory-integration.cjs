/* eslint-disable no-console */
const path = require('node:path');

// Keep demo output clean unless the user opts into AI SDK warnings.
if (process.env.AI_SDK_LOG_WARNINGS === undefined) process.env.AI_SDK_LOG_WARNINGS = 'false';
if (globalThis.AI_SDK_LOG_WARNINGS === undefined) globalThis.AI_SDK_LOG_WARNINGS = false;

function usage() {
  return `Neo4j agent memory integration demo (semantic/procedural/episodic)

Uses @neuralsea/neo4j-agent-memory as an external long-term memory store, while running this SDK for the agent loop.

Modes:
  --mode tool : agent calls neo4j_memory_get_context + store_* tools
  --mode app  : app fetches ContextBundle first and injects it into the prompt

Env:
  OPENAI_API_KEY=...
  NEO4J_URI=neo4j://localhost:7687
  NEO4J_USERNAME=neo4j
  NEO4J_PASSWORD=...

Usage:
  OPENAI_API_KEY=... NEO4J_URI=... NEO4J_USERNAME=... NEO4J_PASSWORD=... \\
    node examples/neo4j-agent-memory-integration.cjs [options]

Options:
  --mode <tool|app>    Default: tool
  --agent-id <id>      Default: UnifiedAgentSDK
  --chat-model <id>    Default: openai/gpt-4o-mini
  --topk <n>           Default: 6
  --prompt <text>      Default: "npm install fails with EACCES on macOS"
  --help               Show this help

Install:
  npm i -D @neuralsea/neo4j-agent-memory
  # or from your local clone:
  npm i -D /Users/emiller/work/code/personal/multi-orchestrator/neo4j-agent-memory-demo/packages/neo4j-agent-memory
`;
}

function parseArgs(argv) {
  const out = {
    help: false,
    mode: 'tool',
    agentId: 'UnifiedAgentSDK',
    chatModel: 'openai/gpt-4o-mini',
    topK: 6,
    prompt: 'npm install fails with EACCES permission denied on macOS',
  };

  const takeValue = (i, flag) => {
    if (i + 1 >= argv.length) throw new Error(`Missing value for ${flag}`);
    return argv[i + 1];
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--mode') out.mode = takeValue(i++, a);
    else if (a === '--agent-id') out.agentId = takeValue(i++, a);
    else if (a === '--chat-model') out.chatModel = takeValue(i++, a);
    else if (a === '--topk') out.topK = Number(takeValue(i++, a));
    else if (a === '--prompt') out.prompt = takeValue(i++, a);
    else throw new Error(`Unknown arg: ${a}`);
  }

  if (out.mode !== 'tool' && out.mode !== 'app') throw new Error(`--mode must be "tool" or "app"`);
  if (!Number.isFinite(out.topK) || out.topK <= 0) throw new Error(`--topk must be a positive number`);
  return out;
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function formatBundle(bundle) {
  const s = bundle?.sections ?? bundle;
  const fix = s?.fix ?? [];
  const dont = s?.doNotDo ?? s?.do_not_do ?? [];
  const blocks = [];

  for (const [i, m] of fix.entries()) {
    blocks.push(`[#FIX${i + 1}] ${m.title ?? m.id}\n${m.content ?? m.summary ?? ''}`.trim());
  }
  for (const [i, m] of dont.entries()) {
    blocks.push(`[#DONT${i + 1}] ${m.title ?? m.id}\n${m.content ?? m.summary ?? ''}`.trim());
  }
  return blocks.join('\n\n---\n\n');
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

  requireEnv('OPENAI_API_KEY');
  const neo4jUri = requireEnv('NEO4J_URI');
  const neo4jUsername = process.env.NEO4J_USERNAME ?? process.env.NEO4J_USER ?? 'neo4j';
  const neo4jPassword = requireEnv('NEO4J_PASSWORD');

  const { UnifiedAgentSDK, SharedMemoryPool, NodeFsWorkspace, AllowAllToolsPolicy } = await import('../dist/esm/index.js');

  let neo4jMem;
  try {
    neo4jMem = await import('@neuralsea/neo4j-agent-memory');
  } catch (e) {
    console.error('Failed to import @neuralsea/neo4j-agent-memory.');
    console.error('Install it with: npm i -D @neuralsea/neo4j-agent-memory');
    console.error(
      'Or from your local clone: npm i -D /Users/emiller/work/code/personal/multi-orchestrator/neo4j-agent-memory-demo/packages/neo4j-agent-memory'
    );
    throw e;
  }

  const mem = await neo4jMem.createMemoryService({
    neo4j: { uri: neo4jUri, username: neo4jUsername, password: neo4jPassword },
    autoRelate: { enabled: true },
  });

  const toolSet = neo4jMem.createMemoryTools(mem);
  const neo4jTools = Object.values(toolSet).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema, // zod schema; supported by ai-sdk-engine
    capabilities: t.name.startsWith('store_') || t.name === 'relate_concepts' ? ['memory:write'] : ['memory:read'],
    execute: (args2) => t.execute(args2),
  }));

  const neo4jGetContextTool = {
    name: 'neo4j_memory_get_context',
    description: 'Retrieve a ContextBundle from Neo4j agent memory (fix + do-not-do sections).',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        prompt: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        symptoms: { type: 'array', items: { type: 'string' } },
        topK: { type: 'integer' },
      },
      required: ['agentId', 'prompt'],
      additionalProperties: false,
    },
    capabilities: ['memory:read'],
    execute: async (input) => {
      const topK = typeof input.topK === 'number' ? input.topK : args.topK;
      const bundle = await mem.retrieveContextBundle({
        agentId: String(input.agentId),
        prompt: String(input.prompt),
        tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
        symptoms: Array.isArray(input.symptoms) ? input.symptoms.map(String) : [],
        fallback: { enabled: true, useFulltext: true, useTags: true, useVector: false },
      });
      return { sessionId: bundle.sessionId, sections: bundle.sections, stats: bundle.stats };
    },
  };

  const captureEpisodeTool = {
    name: 'neo4j_capture_episode',
    description: 'Capture an episodic memory (prompt + response + outcome) into Neo4j.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        runId: { type: 'string' },
        workflowName: { type: 'string' },
        prompt: { type: 'string' },
        response: { type: 'string' },
        outcome: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['agentId', 'runId', 'workflowName', 'prompt', 'response'],
      additionalProperties: false,
    },
    capabilities: ['memory:write'],
    execute: async (input) => {
      return mem.captureEpisode({
        agentId: String(input.agentId),
        runId: String(input.runId),
        workflowName: String(input.workflowName),
        prompt: String(input.prompt),
        response: String(input.response),
        outcome: input.outcome ? String(input.outcome) : undefined,
        tags: Array.isArray(input.tags) ? input.tags.map(String) : undefined,
      });
    },
  };

  const sdk = new UnifiedAgentSDK({
    providers: { aiSdk: { openaiApiKey: process.env.OPENAI_API_KEY, openaiBaseUrl: process.env.OPENAI_BASE_URL } },
    memory: new SharedMemoryPool({ ttlMs: 60 * 60_000 }),
  });

  const workspace = new NodeFsWorkspace(process.cwd());
  const runId = `neo4j_demo_${Date.now()}`;

  const tags = ['npm', 'macos', 'permissions'];
  const symptoms = ['EACCES', 'permission denied', 'node_modules'];

  let injected = '';
  if (args.mode === 'app') {
    const bundle = await mem.retrieveContextBundle({
      agentId: args.agentId,
      prompt: args.prompt,
      tags,
      symptoms,
      fallback: { enabled: true, useFulltext: true, useTags: true, useVector: false },
    });
    injected = formatBundle(bundle);
    console.error(`[neo4j] pre-retrieved sessionId=${bundle.sessionId} fix=${bundle.sections.fix.length} dont=${bundle.sections.doNotDo.length}`);
  }

  const prompt =
    args.mode === 'tool'
      ? [
          `Problem: ${args.prompt}`,
          '',
          `First call neo4j_memory_get_context with agentId="${args.agentId}", prompt="${args.prompt}", topK=${args.topK}, tags=${JSON.stringify(tags)}, symptoms=${JSON.stringify(symptoms)}.`,
          'Then propose a short fix plan using retrieved memories.',
          '',
          'Then store:',
          '- a procedural memory using store_skill',
          '- a semantic memory using store_concept',
          '',
          'Finally call neo4j_capture_episode with runId, workflowName="triage", prompt, and your final response text.',
        ].join('\n')
      : [
          `Problem: ${args.prompt}`,
          '',
          'Context (retrieved from Neo4j agent memory):',
          injected || '(none)',
          '',
          'Use the context above to propose a short fix plan.',
          'Then store:',
          '- a procedural memory using store_skill',
          '- a semantic memory using store_concept',
          '',
          'Finally call neo4j_capture_episode with runId, workflowName="triage", prompt, and your final response text.',
        ].join('\n');

  const run = sdk.run({
    provider: 'ai-sdk',
    model: args.chatModel,
    system: [
      'You are an agent with access to Neo4j-backed long-term memory tools.',
      'Always use tools when instructed.',
      'Keep the final response concise.',
    ].join('\n'),
    prompt,
    workspace,
    workspaceMode: 'live',
    policy: new AllowAllToolsPolicy(),
    tools: [neo4jGetContextTool, captureEpisodeTool, ...neo4jTools],
    metadata: { runId },
    hooks: {
      onTextDelta: (d) => process.stdout.write(d),
      onEvent: (ev) => {
        if (ev.type === 'tool_call') console.error(`\n[tool_call] ${ev.call.toolName}`);
        if (ev.type === 'tool_result') console.error(`\n[tool_result] ${ev.result.toolName}`);
      },
    },
  });

  const res = await run.result;
  console.error(`\n[done] finishReason=${res.finishReason}`);

  // Demonstrate follow-up retrieval after writing.
  const bundle2 = await mem.retrieveContextBundle({
    agentId: args.agentId,
    prompt: args.prompt,
    tags,
    symptoms,
    fallback: { enabled: true, useFulltext: true, useTags: true, useVector: false },
  });
  console.error(`[neo4j] post-retrieve sessionId=${bundle2.sessionId} fix=${bundle2.sections.fix.length} dont=${bundle2.sections.doNotDo.length}`);

  await mem.close().catch(() => {});
  void path; // keep require for older runtimes
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

