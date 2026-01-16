/* eslint-disable no-console */
const path = require('node:path');

// Keep demo output clean unless the user opts into AI SDK warnings.
if (process.env.AI_SDK_LOG_WARNINGS === undefined) process.env.AI_SDK_LOG_WARNINGS = 'false';
if (globalThis.AI_SDK_LOG_WARNINGS === undefined) globalThis.AI_SDK_LOG_WARNINGS = false;

function usage() {
  return `Retrieval demo (Petri WorkspaceIndexer): use @neuralsea/workspace-indexer for embedding + indexing

Modes:
  --mode tool   : agent calls retrieve_context(...) (retriever passed to sdk.run)
  --mode app    : app calls ix.retrieve(...) then injects context into prompt

Usage:
  OPENAI_API_KEY=... node examples/retrieval-petri-workspace-indexer.cjs [options]

Options:
  --mode <tool|app>        Default: tool
  --chat-model <id>        Default: openai/gpt-4o-mini
  --embed-model <id>       Default: text-embedding-3-small
  --root <dir>             Workspace root (default: cwd)
  --profile <name>         Default: search (petri retrieval profile)
  --topk <n>               Default: 6
  --question <text>        Default: "Where is SharedMemoryPool used in this repo?"
  --help                   Show this help

Install:
  npm i -D @neuralsea/workspace-indexer
  # or from your local clone:
  npm i -D /Users/emiller/work/code/personal/petri-workspace-indexer
`;
}

function parseArgs(argv) {
  const out = {
    help: false,
    mode: 'tool',
    chatModel: 'openai/gpt-4o-mini',
    embedModel: 'text-embedding-3-small',
    root: process.cwd(),
    profile: 'search',
    topK: 6,
    question: 'Where is SharedMemoryPool used in this repo?',
  };

  const takeValue = (i, flag) => {
    if (i + 1 >= argv.length) throw new Error(`Missing value for ${flag}`);
    return argv[i + 1];
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--mode') out.mode = takeValue(i++, a);
    else if (a === '--chat-model') out.chatModel = takeValue(i++, a);
    else if (a === '--embed-model') out.embedModel = takeValue(i++, a);
    else if (a === '--root') out.root = takeValue(i++, a);
    else if (a === '--profile') out.profile = takeValue(i++, a);
    else if (a === '--topk') out.topK = Number(takeValue(i++, a));
    else if (a === '--question') out.question = takeValue(i++, a);
    else throw new Error(`Unknown arg: ${a}`);
  }

  if (out.mode !== 'tool' && out.mode !== 'app') throw new Error(`--mode must be "tool" or "app"`);
  if (!Number.isFinite(out.topK) || out.topK <= 0) throw new Error(`--topk must be a positive number`);
  return out;
}

function toRetrievedChunks(bundle) {
  const hits = bundle?.hits ?? [];
  return hits.map((h) => {
    const chunk = h.chunk ?? {};
    const id = String(chunk.id ?? `${chunk.repoRoot ?? ''}:${chunk.path ?? ''}:${chunk.startLine ?? ''}`);
    const text = String(chunk.text ?? chunk.preview ?? '');
    return {
      id,
      text,
      score: typeof h.score === 'number' ? h.score : undefined,
      metadata: {
        repoRoot: chunk.repoRoot,
        path: chunk.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        kind: chunk.kind,
        scoreBreakdown: h.scoreBreakdown,
        profile: bundle?.stats?.profile,
      },
    };
  });
}

function formatContextFromBundle(bundle) {
  const hits = bundle?.hits ?? [];
  const extra = bundle?.context ?? [];
  const blocks = [];

  for (const [i, h] of hits.entries()) {
    const c = h.chunk;
    blocks.push(
      `[#H${i + 1}] ${c.repoRoot}/${c.path}:${c.startLine}-${c.endLine} score=${h.score.toFixed(3)}\n` +
        String(c.text ?? c.preview ?? '').slice(0, 1500)
    );
  }
  for (const [i, b] of extra.entries()) {
    blocks.push(
      `[#C${i + 1}] ${b.repoRoot}/${b.path}:${b.startLine}-${b.endLine} reason=${b.reason}\n` + String(b.text).slice(0, 1500)
    );
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

  if (!process.env.OPENAI_API_KEY) {
    console.error('Missing OPENAI_API_KEY.');
    process.exit(1);
  }

  const {
    UnifiedAgentSDK,
    SharedMemoryPool,
    NodeFsWorkspace,
    AllowAllToolsPolicy,
    PetriWorkspaceIndexerRetriever,
  } = await import('../dist/esm/index.js');

  const memory = new SharedMemoryPool({ ttlMs: 60 * 60_000 });
  const sdk = new UnifiedAgentSDK({
    providers: { aiSdk: { openaiApiKey: process.env.OPENAI_API_KEY, openaiBaseUrl: process.env.OPENAI_BASE_URL } },
    memory,
  });
  const workspace = new NodeFsWorkspace(args.root);

  const retriever = new PetriWorkspaceIndexerRetriever(args.root, {
    openai: { apiKey: process.env.OPENAI_API_KEY, model: args.embedModel, baseUrl: process.env.OPENAI_BASE_URL },
    profile: args.profile,
  });

  console.error(`[petri] indexing workspace at ${args.root}`);
  await retriever.indexAll();
  console.error(`[petri] index ready (embedModel=${args.embedModel})`);

  if (args.mode === 'tool') {
    const run = sdk.run({
      provider: 'ai-sdk',
      model: args.chatModel,
      system: [
        'You are answering questions about this repository.',
        'Use retrieve_context to search; cite file paths.',
        'Store agent memory via memory_set with keys agent_memory:episodic|procedural|semantic (JSON).',
        'Keep the final answer short.',
      ].join('\n'),
      prompt: [
        `Question: ${args.question}`,
        `First call retrieve_context with query="${args.question}" and topK=${args.topK}.`,
        'Then answer using the returned snippets.',
      ].join('\n'),
      workspace,
      workspaceMode: 'live',
      policy: new AllowAllToolsPolicy(),
      retriever,
      maxSteps: 6,
      hooks: {
        onTextDelta: (d) => process.stdout.write(d),
        onEvent: (ev) => {
          if (ev.type === 'tool_call') console.error(`\n[tool_call] ${ev.call.toolName}`);
          if (ev.type === 'tool_result') console.error(`\n[tool_result] ${ev.result.toolName}`);
        },
      },
    });

    await run.result;
  } else {
    const bundle = await retriever.retrieveContextBundle(args.question, args.topK);
    const injected = formatContextFromBundle(bundle);
    console.error(`[petri] retrieved hits=${bundle.hits.length} ctx=${bundle.context.length} profile=${bundle.stats.profile}`);

    const run = sdk.run({
      provider: 'ai-sdk',
      model: args.chatModel,
      system: [
        'You are answering questions about this repository.',
        'Use the provided context snippets and cite file paths.',
        'Store agent memory via memory_set with keys agent_memory:episodic|procedural|semantic (JSON).',
        'Keep the final answer short.',
      ].join('\n'),
      prompt: [
        `Question: ${args.question}`,
        '',
        'Context snippets (retrieved by the app using Petri WorkspaceIndexer):',
        injected || '(no context)',
      ].join('\n'),
      workspace,
      workspaceMode: 'live',
      policy: new AllowAllToolsPolicy(),
      maxSteps: 4,
      hooks: { onTextDelta: (d) => process.stdout.write(d) },
    });

    await run.result;
  }

  const episodic = sdk.memory.kv.get('agent_memory:episodic');
  const procedural = sdk.memory.kv.get('agent_memory:procedural');
  const semantic = sdk.memory.kv.get('agent_memory:semantic');
  const hasAny = episodic !== undefined || procedural !== undefined || semantic !== undefined;
  console.error(`\n[memory] ${hasAny ? 'agent_memory:* set' : 'agent_memory:* missing'}`);
  if (hasAny) console.error(JSON.stringify({ episodic, procedural, semantic }, null, 2));

  await retriever.close().catch(() => {});
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
