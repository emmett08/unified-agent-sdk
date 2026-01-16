/* eslint-disable no-console */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

// AI SDK prints warnings by default; keep demo output clean unless the user opts in.
if (process.env.AI_SDK_LOG_WARNINGS === undefined) process.env.AI_SDK_LOG_WARNINGS = 'false';
if (globalThis.AI_SDK_LOG_WARNINGS === undefined) globalThis.AI_SDK_LOG_WARNINGS = false;

function usage() {
  return `Retrieval demo (app-driven): pre-retrieve + prepend context

This builds a SimpleVectorIndex over repo files. Then YOUR APP calls:
  retriever.retrieve(question, topK)
and injects the results into the agent prompt/system. The model never needs to call a tool.

Usage:
  OPENAI_API_KEY=... node examples/retrieval-preload-context.cjs [options]

Options:
  --chat-model <id>        Default: openai/gpt-4o-mini
  --embed-model <id>       Default: openai/text-embedding-3-small
  --root <dir>             Workspace root (default: cwd)
  --max-files <n>          Default: 80
  --chunk-chars <n>        Default: 1200
  --topk <n>               Default: 6
  --question <text>        Default: "How is SharedMemoryPool used in this repo?"
  --help                   Show this help
`;
}

function parseArgs(argv) {
  const out = {
    help: false,
    chatModel: 'openai/gpt-4o-mini',
    embedModel: 'openai/text-embedding-3-small',
    root: process.cwd(),
    maxFiles: 80,
    chunkChars: 1200,
    topK: 6,
    question: 'How is SharedMemoryPool used in this repo?',
  };

  const takeValue = (i, flag) => {
    if (i + 1 >= argv.length) throw new Error(`Missing value for ${flag}`);
    return argv[i + 1];
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--chat-model') out.chatModel = takeValue(i++, a);
    else if (a === '--embed-model') out.embedModel = takeValue(i++, a);
    else if (a === '--root') out.root = takeValue(i++, a);
    else if (a === '--max-files') out.maxFiles = Number(takeValue(i++, a));
    else if (a === '--chunk-chars') out.chunkChars = Number(takeValue(i++, a));
    else if (a === '--topk') out.topK = Number(takeValue(i++, a));
    else if (a === '--question') out.question = takeValue(i++, a);
    else throw new Error(`Unknown arg: ${a}`);
  }

  return out;
}

async function listRepoFilesFallback(rootDir) {
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

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function chunkText(text, chunkChars) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkChars) chunks.push(text.slice(i, i + chunkChars));
  return chunks;
}

function formatChunks(chunks) {
  return chunks
    .map((c, i) => {
      const p = c.metadata?.path ?? c.id;
      const score = typeof c.score === 'number' ? ` score=${c.score.toFixed(3)}` : '';
      return `[#${i + 1}] ${p}${score}\n${String(c.text).slice(0, 1200)}`;
    })
    .join('\n\n---\n\n');
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
    SimpleVectorIndex,
    AiSdkEmbeddingProvider,
  } = await import('../dist/esm/index.js');

  const memory = new SharedMemoryPool({ ttlMs: 60 * 60_000 });
  const sdk = new UnifiedAgentSDK({
    providers: { aiSdk: { openaiApiKey: process.env.OPENAI_API_KEY, openaiBaseUrl: process.env.OPENAI_BASE_URL } },
    memory,
  });

  const workspace = new NodeFsWorkspace(args.root);

  const baseEmbedder = new AiSdkEmbeddingProvider(
    { openaiApiKey: process.env.OPENAI_API_KEY, openaiBaseUrl: process.env.OPENAI_BASE_URL },
    args.embedModel
  );
  const embedder = {
    embed: async (texts) => {
      const out = new Array(texts.length);
      const toCompute = [];
      const mapIdx = [];
      for (let i = 0; i < texts.length; i++) {
        const key = `emb:${args.embedModel}:${sha256(texts[i])}`;
        const cached = sdk.memory.embeddings.get(key);
        if (cached) out[i] = cached;
        else {
          toCompute.push(texts[i]);
          mapIdx.push({ i, key });
        }
      }
      if (toCompute.length) {
        const computed = await baseEmbedder.embed(toCompute);
        for (let j = 0; j < computed.length; j++) {
          const { i, key } = mapIdx[j];
          out[i] = computed[j];
          sdk.memory.embeddings.set(key, computed[j]);
        }
      }
      return out;
    },
  };

  const index = new SimpleVectorIndex(embedder);

  const fileList = await listRepoFilesFallback(args.root);
  const candidateFiles = fileList
    .filter((p) => p.startsWith('src/') || p.startsWith('examples/') || p === 'README.md' || p.startsWith('scripts/'))
    .slice(0, Math.max(1, args.maxFiles));

  const docs = [];
  for (const rel of candidateFiles) {
    const bytes = await workspace.readFile(rel).catch(() => null);
    if (!bytes) continue;
    const text = new TextDecoder('utf-8').decode(bytes);
    for (const [ci, chunk] of chunkText(text, args.chunkChars).entries()) {
      docs.push({ id: `${rel}#${ci + 1}`, text: chunk, metadata: { path: rel, chunk: ci + 1 } });
    }
  }

  console.error(`[index] files=${candidateFiles.length} chunks=${docs.length} embedModel=${args.embedModel}`);
  await index.addDocuments(docs);
  console.error(`[index] ready`);

  // App-driven retrieval: retrieve first, then inject into prompt/system.
  const chunks = await index.retrieve(args.question, args.topK);
  console.error(`[retrieve] topK=${args.topK} returned=${chunks.length}`);

  const injectedContext = formatChunks(chunks);

  const run = sdk.run({
    provider: 'ai-sdk',
    model: args.chatModel,
    system: [
      'You are answering questions about this repository.',
      'Use the provided context snippets. If you need more, say what to retrieve next (but do not call tools).',
      'Keep the final answer short and include file paths.',
    ].join('\n'),
    prompt: [
      `Question: ${args.question}`,
      '',
      'Context snippets (retrieved by the app using embeddings):',
      injectedContext || '(no context)',
      '',
      'Also store agent memory using memory_set with these keys and JSON values:',
      '- agent_memory:episodic => { question: string, retrievedPaths: string[], summary: string }',
      '- agent_memory:procedural => { checklist: string[] }',
      '- agent_memory:semantic => { facts: string[], tipsForOtherAgents: string[] }',
    ].join('\n'),
    workspace,
    workspaceMode: 'live',
    policy: new AllowAllToolsPolicy(),
    // Notice: no `retriever` passed here; the model is not using tools for retrieval in this pattern.
    maxSteps: 3,
    hooks: { onTextDelta: (d) => process.stdout.write(d) },
  });

  await run.result;
  process.stdout.write('\n\n');

  // Follow-up pass: reuse stored memory for a related question (no retrieval tools).
  const follow = sdk.run({
    provider: 'ai-sdk',
    model: args.chatModel,
    system: [
      'You are continuing a prior session and must reuse stored memory.',
      'First call memory_get for agent_memory:episodic, agent_memory:procedural, agent_memory:semantic.',
      'Answer the question using that memory. Do not call any retrieval tools.',
      'Keep the final answer short.',
    ].join('\n'),
    prompt: `Related question: Summarise how to use this app-driven retrieval pattern in one checklist.`,
    workspace,
    workspaceMode: 'live',
    policy: new AllowAllToolsPolicy(),
    maxSteps: 3,
    hooks: { onTextDelta: (d) => process.stdout.write(d) },
  });

  await follow.result;

  const episodic = sdk.memory.kv.get('agent_memory:episodic');
  const procedural = sdk.memory.kv.get('agent_memory:procedural');
  const semantic = sdk.memory.kv.get('agent_memory:semantic');
  const hasAny = episodic !== undefined || procedural !== undefined || semantic !== undefined;
  console.error(`\n[memory] ${hasAny ? 'agent_memory:* set' : 'agent_memory:* missing'}`);
  if (hasAny) console.error(JSON.stringify({ episodic, procedural, semantic }, null, 2));
  console.error(`\n[memory] embeddings.size=${sdk.memory.embeddings.size}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
