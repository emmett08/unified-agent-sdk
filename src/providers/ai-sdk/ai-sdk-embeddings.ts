import { dynamicImport } from '../../utils/dynamic-import.js';
import type { EmbeddingProvider } from '../../retrieval/embedding.js';
import type { AiSdkProviderConfig } from '../provider-config.js';
import { ProviderUnavailableError } from '../../core/errors.js';

type AiModule = any;

export class AiSdkEmbeddingProvider implements EmbeddingProvider {
  constructor(private cfg: AiSdkProviderConfig, private embeddingModel: string) {}

  async embed(texts: string[]): Promise<number[][]> {
    const ai: AiModule = await dynamicImport('ai').catch(() => { throw new ProviderUnavailableError('ai-sdk', 'Install ai'); });

    // Choose embedding model. In AI SDK, embedMany expects a model.
    const model = await this.createModel(ai, this.embeddingModel);
    // Prefer calling the embedding model directly.
    // Some AI SDK versions assume `warnings` is always present in `embedMany` results; some providers omit it.
    // Calling doEmbed avoids that aggregation path.
    if (model?.doEmbed) {
      const res = await model.doEmbed({ values: texts });
      const embeddings = res?.embeddings ?? res?.values ?? res;
      return (embeddings ?? []).map((e: any) => e.embedding ?? e);
    }

    // Fallback: AI SDK helper.
    if (!ai.embedMany) throw new ProviderUnavailableError('ai-sdk', 'embedMany unavailable in installed ai version');
    const res = await ai.embedMany({ model, values: texts });
    return (res.embeddings ?? res).map((e: any) => e.embedding ?? e);
  }

  private async createModel(ai: AiModule, modelId: string): Promise<any> {
    if (this.cfg.gatewayApiKey) {
      try {
        const gwMod = await dynamicImport('@ai-sdk/gateway');
        const gw = gwMod.createGateway
          ? gwMod.createGateway({ apiKey: this.cfg.gatewayApiKey, baseURL: this.cfg.gatewayBaseUrl, headers: this.cfg.gatewayHeaders })
          : gwMod.gateway;
        return typeof gw === 'function' ? gw(modelId) : gw;
      } catch {
        // fall through
      }
    }
    if (modelId.startsWith('openai/')) {
      const { createOpenAI } = await dynamicImport('@ai-sdk/openai').catch(() => { throw new ProviderUnavailableError('ai-sdk', 'Install @ai-sdk/openai'); });
      const openai = createOpenAI({ apiKey: this.cfg.openaiApiKey, baseURL: this.cfg.openaiBaseUrl });
      const id = modelId.replace(/^openai\//, '');
      // AI SDK v6: embeddings require `openai.embedding(...)` / `openai.textEmbeddingModel(...)`,
      // not the language-model factory.
      if (typeof openai.textEmbeddingModel === 'function') return openai.textEmbeddingModel(id);
      if (typeof openai.embedding === 'function') return openai.embedding(id);
      // Best-effort fallback for older/newer variants.
      if (typeof openai.textEmbedding === 'function') return openai.textEmbedding(id);
      return openai(id);
    }
    return modelId;
  }
}
