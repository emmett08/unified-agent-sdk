import type { ToolCall } from '../core/types.js';
import type { ToolDefinition } from '../tools/tool-types.js';

export type ToolPolicyDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason: string };

export interface ToolPolicyContext {
  tool: ToolDefinition;
  call: ToolCall;
  /** Free-form tags/capabilities the tool claims (e.g. "system:exec"). */
  capabilities: string[];
}

export interface ToolPolicy {
  readonly name: string;
  decide(ctx: ToolPolicyContext): Promise<ToolPolicyDecision> | ToolPolicyDecision;
}

export class AllowAllToolsPolicy implements ToolPolicy {
  readonly name = 'allow_all';
  decide(): ToolPolicyDecision { return { kind: 'allow' }; }
}

export class DenyAllToolsPolicy implements ToolPolicy {
  readonly name = 'deny_all';
  decide(ctx: ToolPolicyContext): ToolPolicyDecision { return { kind: 'deny', reason: `Denied by policy ${this.name}` }; }
}

export class ToolAllowListPolicy implements ToolPolicy {
  readonly name = 'tool_allow_list';
  constructor(private allowed: string[]) {}
  decide(ctx: ToolPolicyContext): ToolPolicyDecision {
    return this.allowed.includes(ctx.tool.name) ? { kind: 'allow' } : { kind: 'deny', reason: `Tool not on allow-list` };
  }
}

export class ToolDenyListPolicy implements ToolPolicy {
  readonly name = 'tool_deny_list';
  constructor(private denied: string[]) {}
  decide(ctx: ToolPolicyContext): ToolPolicyDecision {
    return this.denied.includes(ctx.tool.name) ? { kind: 'deny', reason: `Tool denied` } : { kind: 'allow' };
  }
}

export class CapabilityDenyListPolicy implements ToolPolicy {
  readonly name = 'capability_deny_list';
  constructor(private deniedCaps: string[]) {}
  decide(ctx: ToolPolicyContext): ToolPolicyDecision {
    for (const c of ctx.capabilities) {
      if (this.deniedCaps.includes(c)) return { kind: 'deny', reason: `Capability denied: ${c}` };
    }
    return { kind: 'allow' };
  }
}

export class CapabilityApprovalPolicy implements ToolPolicy {
  readonly name = 'capability_approval';
  constructor(private capsRequiringApproval: string[]) {}
  decide(ctx: ToolPolicyContext): ToolPolicyDecision {
    for (const c of ctx.capabilities) {
      if (this.capsRequiringApproval.includes(c)) return { kind: 'ask', reason: `Capability requires approval: ${c}` };
    }
    return { kind: 'allow' };
  }
}

export class CompositePolicy implements ToolPolicy {
  readonly name = 'composite';
  constructor(private policies: ToolPolicy[]) {}
  async decide(ctx: ToolPolicyContext): Promise<ToolPolicyDecision> {
    for (const p of this.policies) {
      const d = await p.decide(ctx);
      if (d.kind !== 'allow') return { ...d, reason: `${d.reason} (via ${p.name})` };
    }
    return { kind: 'allow' };
  }
}
