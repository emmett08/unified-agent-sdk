import type { RetrieverPort, RetrievedChunk } from './retriever.js';
import { dynamicImport } from '../utils/dynamic-import.js';
import { UnifiedAgentError } from '../core/errors.js';

export type PetriRetrieverMode = 'tool' | 'app';

export interface PetriWorkspaceIndexerRetrieverOptions {
  /**
   * Module specifier for Petri.
   * - npm: "@neuralsea/workspace-indexer"
   * - local path: "/abs/path/to/petri-workspace-indexer"
   */
  petriModule?: string;

  /** Petri retrieval profile name (e.g. "search", "refactor", "architecture"). */
  profile?: string;

  /**
   * If true, calls `indexAll()` automatically before first retrieval.
   * Default: true.
   */
  autoIndex?: boolean;

  /**
   * If provided, uses this already-constructed Petri `EmbeddingsProvider`.
   * Otherwise, `embedder` is constructed from `openai`/`ollama`/`hash`.
   */
  embedder?: any;

  openai?: { apiKey: string; model: string; baseUrl?: string };
  ollama?: { model: string; host?: string };
  hash?: { dimension?: number };

  /** Passed through to Petri WorkspaceIndexer as config. */
  indexerConfig?: any;
}

/**
 * Adapter: Petri WorkspaceIndexer -> UnifiedAgentSDK RetrieverPort.
 *
 * This keeps `@neuralsea/workspace-indexer` as an optional dependency by loading it via dynamic import.
 */
export class PetriWorkspaceIndexerRetriever implements RetrieverPort {
  private readonly petriModule: string;
  private readonly profile?: string;
  private readonly autoIndex: boolean;

  private petri: any | null = null;
  private indexer: any | null = null;
  private indexed = false;

  constructor(
    private readonly workspaceRoot: string,
    private readonly opts: PetriWorkspaceIndexerRetrieverOptions = {}
  ) {
    this.petriModule = opts.petriModule ?? '@neuralsea/workspace-indexer';
    this.profile = opts.profile;
    this.autoIndex = opts.autoIndex ?? true;
  }

  async open(): Promise<void> {
    if (this.indexer) return;

    const petri = await dynamicImport(this.petriModule).catch((e) => {
      throw new UnifiedAgentError(
        `Failed to import Petri workspace indexer (${this.petriModule}). Install "@neuralsea/workspace-indexer" or provide opts.petriModule.`,
        e
      );
    });
    this.petri = petri;

    const embedder =
      this.opts.embedder ??
      (this.opts.openai
        ? new petri.OpenAIEmbeddingsProvider(this.opts.openai)
        : this.opts.ollama
          ? new petri.OllamaEmbeddingsProvider(this.opts.ollama)
          : new petri.HashEmbeddingsProvider(this.opts.hash?.dimension));

    this.indexer = new petri.WorkspaceIndexer(this.workspaceRoot, embedder, this.opts.indexerConfig ?? {});
  }

  async indexAll(): Promise<void> {
    await this.open();
    if (this.indexed) return;
    await this.indexer.indexAll();
    this.indexed = true;
  }

  async retrieveContextBundle(query: string, topK: number): Promise<any> {
    await this.open();
    if (this.autoIndex && !this.indexed) await this.indexAll();
    const k = Math.max(1, Math.floor(topK || 1));
    return await this.indexer.retrieve(query, {
      profile: this.profile ?? 'search',
      profileOverrides: { k },
    });
  }

  async retrieve(query: string, topK: number): Promise<RetrievedChunk[]> {
    const bundle = await this.retrieveContextBundle(query, topK);
    const hits = Array.isArray(bundle?.hits) ? bundle.hits : [];

    return hits.map((h: any) => {
      const chunk = h?.chunk ?? {};
      const id = String(chunk.id ?? `${chunk.repoRoot ?? ''}:${chunk.path ?? ''}:${chunk.startLine ?? ''}`);
      const text = String(chunk.text ?? chunk.preview ?? '');
      const score = typeof h?.score === 'number' ? h.score : undefined;
      return {
        id,
        text,
        score,
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

  async close(): Promise<void> {
    try {
      await this.indexer?.closeAsync?.();
    } catch {
      // ignore
    } finally {
      this.indexer = null;
      this.petri = null;
      this.indexed = false;
    }
  }
}

