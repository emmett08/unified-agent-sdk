import type { ModelClass, ProviderId } from '../core/types.js';
import type { ModelCatalog, ModelProfile } from './model-catalog.js';

export interface RouteConstraints {
  mustStream: boolean;
  requiresTools: boolean;
}

export interface RoutePreference {
  provider?: ProviderId;
  model?: string;
  modelClass?: ModelClass;
  preferredProviders?: ProviderId[];
  allowFallback?: boolean;
}

export interface RoutedCandidate {
  provider: ProviderId;
  model: string;
  ref: string;
  profile?: ModelProfile;
}

export interface RoutePlan {
  candidates: RoutedCandidate[];
}

export interface ProviderAvailability {
  provider: ProviderId;
  available: boolean;
  reason?: string;
}

export class ModelRouter {
  constructor(private catalog: ModelCatalog) {}

  plan(availability: ProviderAvailability[], pref: RoutePreference, constraints: RouteConstraints): RoutePlan {
    const allowFallback = pref.allowFallback ?? true;

    const availableProviders = new Set(
      availability.filter((a) => a.available).map((a) => a.provider)
    );

    const preferredProviders = pref.preferredProviders?.filter((p) => availableProviders.has(p)) ?? [];

    const orderedProviders =
      pref.provider && availableProviders.has(pref.provider)
        ? [pref.provider, ...preferredProviders.filter((p) => p !== pref.provider), ...[...availableProviders].filter((p) => p !== pref.provider && !preferredProviders.includes(p))]
        : [...preferredProviders, ...[...availableProviders].filter((p) => !preferredProviders.includes(p))];

    const modelClass: ModelClass = pref.modelClass ?? 'default';

    const candidates: RoutedCandidate[] = [];
    const pushCandidate = (provider: ProviderId, model: string, profile?: ModelProfile) => {
      const ref = `${provider}:${model}`;
      candidates.push({ provider, model, ref, profile });
    };

    // If an explicit model was requested, try each provider in order for that model.
    if (pref.model) {
      for (const provider of orderedProviders) pushCandidate(provider, pref.model, this.catalog.find(provider, pref.model));
      return { candidates: allowFallback ? candidates : candidates.slice(0, 1) };
    }

    // Otherwise, select by class per provider.
    for (const provider of orderedProviders) {
      const profiles = this.catalog.byProvider(provider).filter((p) => p.classes.includes(modelClass) || modelClass === 'default');
      const ranked = [...profiles].sort((a, b) => (a.latencyRank ?? 100) - (b.latencyRank ?? 100));
      for (const p of ranked) pushCandidate(provider, p.id, p);
    }

    // Constraints hook: if requiresTools, bias toward providers that handle tools well.
    // (For now: keep ordering; users can register profiles with latencyRank/costRank tuned.)
    void constraints;

    if (candidates.length === 0 && allowFallback) {
      // As a last resort, try anything in the catalog
      for (const p of this.catalog.list()) {
        if (availableProviders.has(p.provider)) pushCandidate(p.provider, p.id, p);
      }
    }

    return { candidates: allowFallback ? candidates : candidates.slice(0, 1) };
  }
}
