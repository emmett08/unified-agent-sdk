import type { ToolDefinition } from './tool-types.js';

export type ToolNamePolicy = 'strict' | 'sanitize';

export interface ToolNameTransformResult {
  name: string;
  displayName?: string;
}

export type ToolNameTransform = (name: string) => ToolNameTransformResult;

export interface ToolNamePolicyOptions {
  policy?: ToolNamePolicy;
  transform?: ToolNameTransform;
}

export interface ToolNameMapping {
  /** Name used with the provider/tool-call surface. */
  providerByOriginal: Map<string, string>;
  /** Name exposed back to SDK callers. */
  originalByProvider: Map<string, string>;
  /** Optional display name for UI (keyed by original tool name). */
  displayNameByOriginal: Map<string, string>;
}

const TOOL_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidToolName(name: string): boolean {
  return TOOL_NAME_RE.test(name);
}

export function applyToolNamePolicy(tools: ToolDefinition[], opts: ToolNamePolicyOptions = {}): { tools: ToolDefinition[]; mapping: ToolNameMapping } {
  const policy: ToolNamePolicy = opts.policy ?? 'strict';

  const providerByOriginal = new Map<string, string>();
  const originalByProvider = new Map<string, string>();
  const displayNameByOriginal = new Map<string, string>();

  const usedProviderNames = new Set<string>();

  const nextUnique = (base: string): string => {
    let candidate = base.slice(0, 64);
    if (!candidate) candidate = 'tool';
    if (!usedProviderNames.has(candidate)) return candidate;
    for (let i = 2; i < 10_000; i++) {
      const suffix = `_${i}`;
      const truncated = candidate.slice(0, Math.max(1, 64 - suffix.length)) + suffix;
      if (!usedProviderNames.has(truncated)) return truncated;
    }
    // Should never happen, but keep a deterministic fallback.
    return `${candidate.slice(0, 60)}_${Date.now().toString(36).slice(-3)}`.slice(0, 64);
  };

  const transformedTools: ToolDefinition[] = tools.map((tool) => {
    const originalName = tool.name;

    const transformed = opts.transform?.(originalName);
    const proposedName = transformed?.name ?? originalName;
    if (transformed?.displayName) displayNameByOriginal.set(originalName, transformed.displayName);

    let providerName = proposedName;
    if (policy === 'sanitize') {
      providerName = nextUnique(sanitizeToolName(providerName));
      usedProviderNames.add(providerName);
    } else {
      // strict: do not auto-dedupe or auto-sanitize; validate uniqueness later.
      usedProviderNames.add(providerName);
    }

    providerByOriginal.set(originalName, providerName);
    originalByProvider.set(providerName, originalName);

    if (providerName === originalName) return tool;
    return { ...tool, name: providerName };
  });

  // Strict mode: validate all provider-facing names and reject collisions.
  if (policy === 'strict') {
    const invalid: Array<{ index: number; original: string; provider: string }> = [];
    const dupes: Array<{ provider: string; originals: string[] }> = [];

    const seen = new Map<string, string[]>();
    for (const [original, provider] of providerByOriginal.entries()) {
      const list = seen.get(provider) ?? [];
      list.push(original);
      seen.set(provider, list);
    }
    for (const [provider, originals] of seen.entries()) {
      if (originals.length > 1) dupes.push({ provider, originals });
    }

    transformedTools.forEach((t, i) => {
      const provider = t.name;
      const original = originalByProvider.get(provider) ?? provider;
      if (!isValidToolName(provider)) invalid.push({ index: i, original, provider });
    });

    if (dupes.length || invalid.length) {
      const parts: string[] = [];
      if (invalid.length) {
        parts.push(
          `Invalid tool names (must match ${TOOL_NAME_RE}): ` +
            invalid.map((x) => `[${x.index}] ${JSON.stringify(x.original)} -> ${JSON.stringify(x.provider)}`).join(', ')
        );
      }
      if (dupes.length) {
        parts.push(
          `Duplicate tool names after transform: ` +
            dupes
              .map((d) => `${JSON.stringify(d.provider)} from ${d.originals.map((x) => JSON.stringify(x)).join(', ')}`)
              .join('; ')
        );
      }
      throw new Error(parts.join('\n'));
    }
  }

  return { tools: transformedTools, mapping: { providerByOriginal, originalByProvider, displayNameByOriginal } };
}

export function remapToolNameToOriginal(mapping: ToolNameMapping, providerName: string): string {
  return mapping.originalByProvider.get(providerName) ?? providerName;
}

function sanitizeToolName(name: string): string {
  const trimmed = String(name ?? '').trim();
  const replaced = trimmed.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  const shortened = replaced.slice(0, 64);
  return shortened || 'tool';
}
