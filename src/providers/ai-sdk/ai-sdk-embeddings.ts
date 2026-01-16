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
      return openai(modelId.replace(/^openai\//, ''));
    }
    return modelId;
  }
}
