import type { ModelClass, ProviderId } from '../core/types.js';

export interface ModelProfile {
  provider: ProviderId;
  id: string; // provider-specific model id
  classes: ModelClass[];
  displayName?: string;
  maxContextTokens?: number;
  notes?: string;
  // Preferences: smaller is preferred
  latencyRank?: number;
  costRank?: number;
}

export class ModelCatalog {
  private readonly profiles: ModelProfile[] = [];

  register(profile: ModelProfile): void {
    this.profiles.push(profile);
  }

  registerMany(profiles: ModelProfile[]): void {
    for (const p of profiles) this.register(p);
  }

  list(): ModelProfile[] {
    return [...this.profiles];
  }

  byClass(modelClass: ModelClass): ModelProfile[] {
    return this.profiles.filter((p) => p.classes.includes(modelClass) || (modelClass === 'default' && p.classes.length > 0));
  }

  byProvider(provider: ProviderId): ModelProfile[] {
    return this.profiles.filter((p) => p.provider === provider);
  }

  find(provider: ProviderId, id: string): ModelProfile | undefined {
    return this.profiles.find((p) => p.provider === provider && p.id === id);
  }
}

/**
 * Intentionally conservative defaults. You should register the models you actually want to expose.
 */
export function defaultModelCatalog(): ModelCatalog {
  const cat = new ModelCatalog();
  // Provider-agnostic placeholders; users should override.
  cat.registerMany([
    { provider: 'ai-sdk', id: 'openai/gpt-4.1-mini', classes: ['fast', 'default'], latencyRank: 1 },
    { provider: 'ai-sdk', id: 'openai/gpt-4.1', classes: ['frontier', 'default'], latencyRank: 3, costRank: 3 },
    { provider: 'ai-sdk', id: 'anthropic/claude-sonnet-4.5', classes: ['frontier', 'default'], latencyRank: 2, costRank: 4 },
    { provider: 'ai-sdk', id: 'anthropic/claude-haiku-4.5', classes: ['fast', 'cheap'], latencyRank: 1, costRank: 1 },
    { provider: 'auggie', id: 'sonnet4.5', classes: ['frontier', 'default'], latencyRank: 2 },
    { provider: 'auggie', id: 'haiku4.5', classes: ['fast', 'cheap'], latencyRank: 1 },
    { provider: 'ollama', id: 'llama3.1', classes: ['cheap', 'fast'], latencyRank: 1, costRank: 0 },
    { provider: 'ollama', id: 'qwen3', classes: ['fast', 'default'], latencyRank: 2 },
    { provider: 'ollama', id: 'deepseek-r1', classes: ['frontier', 'long_context'], latencyRank: 4 }
  ]);
  return cat;
}
