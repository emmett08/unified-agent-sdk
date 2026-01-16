import type { ModelClass, ProviderId } from '../core/types.js';
import type { ModelCatalog, ModelProfile } from './model-catalog.js';

export interface RouteConstraints {
  mustStream: boolean;
  requiresTools: boolean;
  /** Hard filter: only consider these providers (after availability filtering). */
  allowedProviders?: ProviderId[];
  /** Hard filter: exclude these providers. */
  blockedProviders?: ProviderId[];
  /** Hard filter: require a minimum context size when the model profile specifies it. */
  minContextTokens?: number;
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

export interface RoutePlanOptions {
  /**
   * Optional score function; lower is better.
   * Used for penalty scoring / circuit breakers.
   */
  score?: (c: RoutedCandidate) => number;
  /**
   * Optional additional hard filter.
   */
  filter?: (c: RoutedCandidate) => boolean;
}

export class ModelRouter {
  constructor(private catalog: ModelCatalog) {}

  plan(availability: ProviderAvailability[], pref: RoutePreference, constraints: RouteConstraints, opts: RoutePlanOptions = {}): RoutePlan {
    const allowFallback = pref.allowFallback ?? true;

    const availableProviders = new Set(availability.filter((a) => a.available).map((a) => a.provider));

    if (constraints.allowedProviders?.length) {
      const allowed = new Set(constraints.allowedProviders);
      for (const p of [...availableProviders]) if (!allowed.has(p)) availableProviders.delete(p);
    }
    if (constraints.blockedProviders?.length) {
      const blocked = new Set(constraints.blockedProviders);
      for (const p of [...availableProviders]) if (blocked.has(p)) availableProviders.delete(p);
    }

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
    } else {
      // Otherwise, select by class per provider.
      for (const provider of orderedProviders) {
        const profiles = this.catalog.byProvider(provider).filter((p) => p.classes.includes(modelClass) || modelClass === 'default');
        const ranked = [...profiles].sort((a, b) => (a.latencyRank ?? 100) - (b.latencyRank ?? 100));
        for (const p of ranked) pushCandidate(provider, p.id, p);
      }
    }

    const hardFiltered = candidates.filter((c) => this.meetsConstraints(c, constraints) && (opts.filter?.(c) ?? true));

    if (hardFiltered.length === 0 && allowFallback) {
      // As a last resort, try anything in the catalog
      for (const p of this.catalog.list()) {
        if (availableProviders.has(p.provider)) pushCandidate(p.provider, p.id, p);
      }
    }

    const finalList = (hardFiltered.length ? hardFiltered : candidates).filter((c) => this.meetsConstraints(c, constraints) && (opts.filter?.(c) ?? true));
    const scored = opts.score ? [...finalList].sort((a, b) => opts.score!(a) - opts.score!(b)) : finalList;
    return { candidates: allowFallback ? scored : scored.slice(0, 1) };
  }

  private meetsConstraints(c: RoutedCandidate, constraints: RouteConstraints): boolean {
    const caps = c.profile?.capabilities;
    if (constraints.mustStream && caps?.streaming === false) return false;
    if (constraints.requiresTools && caps?.tools === false) return false;
    const minCtx = constraints.minContextTokens;
    if (typeof minCtx === 'number' && minCtx > 0) {
      const ctx = c.profile?.maxContextTokens;
      if (typeof ctx === 'number' && ctx > 0 && ctx < minCtx) return false;
    }
    return true;
  }
}
