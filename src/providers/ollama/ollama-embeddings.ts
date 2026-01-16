import { dynamicImport } from '../../utils/dynamic-import.js';
import type { EmbeddingProvider } from '../../retrieval/embedding.js';
import type { OllamaProviderConfig } from '../provider-config.js';
import { ProviderUnavailableError } from '../../core/errors.js';

type OllamaModule = any;

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private clientPromise: Promise<any> | null = null;
  constructor(private cfg: OllamaProviderConfig, private embeddingModel: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    const client = await this.getClient();
    const out: number[][] = [];
    for (const t of texts) {
      const res = await client.embed({ model: this.embeddingModel, input: t });
      // res.embeddings can be array (multiple) or single; be permissive.
      if (Array.isArray(res.embeddings)) {
        if (Array.isArray(res.embeddings[0])) out.push(res.embeddings[0] as number[]);
        else out.push(res.embeddings as number[]);
      } else if (Array.isArray(res.embedding)) {
        out.push(res.embedding as number[]);
      } else {
        throw new Error('Unexpected Ollama embed response');
      }
    }
    return out;
  }

  private async getClient(): Promise<any> {
    if (this.clientPromise) return this.clientPromise;
    this.clientPromise = (async () => {
      const mod: OllamaModule = await dynamicImport('ollama').catch(() => { throw new ProviderUnavailableError('ollama', 'Install `ollama`'); });
      if (this.cfg.host || this.cfg.headers) {
        const Ollama = mod.Ollama ?? mod.default?.Ollama;
        if (Ollama) return new Ollama({ host: this.cfg.host, headers: this.cfg.headers });
      }
      return mod.default ?? mod;
    })();
    return this.clientPromise;
  }
}
