export interface CircuitBreakerOptions {
  /**
   * Number of consecutive failures required to open the circuit.
   */
  failureThreshold?: number;
  /**
   * Base cooldown (ms) once the circuit opens. Subsequent failures increase the cooldown exponentially.
   */
  baseCooldownMs?: number;
  /**
   * Maximum cooldown (ms).
   */
  maxCooldownMs?: number;
  /**
   * Penalty score added per consecutive failure when circuit is closed.
   */
  penaltyPerFailure?: number;
  /**
   * Penalty score used while a circuit is open (effectively de-prioritises).
   */
  openCircuitPenalty?: number;
}

export interface CircuitBreakerEntry {
  consecutiveFailures: number;
  lastFailureAt?: number;
  openUntil?: number;
}

export interface CircuitBreakerSnapshot {
  version: 1;
  entries: Record<string, CircuitBreakerEntry>;
}

export class CircuitBreaker {
  private readonly byKey = new Map<string, CircuitBreakerEntry>();
  private readonly opts: Required<CircuitBreakerOptions>;

  constructor(opts: CircuitBreakerOptions = {}, snapshot?: CircuitBreakerSnapshot) {
    this.opts = {
      failureThreshold: opts.failureThreshold ?? 2,
      baseCooldownMs: opts.baseCooldownMs ?? 5 * 60_000,
      maxCooldownMs: opts.maxCooldownMs ?? 60 * 60_000,
      penaltyPerFailure: opts.penaltyPerFailure ?? 1_000,
      openCircuitPenalty: opts.openCircuitPenalty ?? 1_000_000,
    };

    if (snapshot?.version === 1 && snapshot.entries) {
      for (const [key, entry] of Object.entries(snapshot.entries)) {
        if (!entry) continue;
        this.byKey.set(key, {
          consecutiveFailures: Math.max(0, Number(entry.consecutiveFailures) || 0),
          lastFailureAt: entry.lastFailureAt ? Number(entry.lastFailureAt) : undefined,
          openUntil: entry.openUntil ? Number(entry.openUntil) : undefined,
        });
      }
    }
  }

  isOpen(key: string, now = Date.now()): boolean {
    const e = this.byKey.get(key);
    return Boolean(e?.openUntil && now < e.openUntil);
  }

  getPenalty(key: string, now = Date.now()): number {
    const e = this.byKey.get(key);
    if (!e) return 0;
    if (e.openUntil && now < e.openUntil) return this.opts.openCircuitPenalty;
    return (e.consecutiveFailures || 0) * this.opts.penaltyPerFailure;
  }

  recordSuccess(key: string): void {
    this.byKey.set(key, { consecutiveFailures: 0 });
  }

  recordFailure(key: string, now = Date.now()): void {
    const prev = this.byKey.get(key) ?? { consecutiveFailures: 0 };
    const consecutiveFailures = (prev.consecutiveFailures || 0) + 1;

    const opened = consecutiveFailures >= this.opts.failureThreshold;
    const openExponent = Math.max(0, consecutiveFailures - this.opts.failureThreshold);
    const cooldown = opened
      ? Math.min(this.opts.maxCooldownMs, this.opts.baseCooldownMs * Math.pow(2, openExponent))
      : 0;

    this.byKey.set(key, {
      consecutiveFailures,
      lastFailureAt: now,
      openUntil: opened ? now + cooldown : prev.openUntil,
    });
  }

  snapshot(): CircuitBreakerSnapshot {
    const entries: Record<string, CircuitBreakerEntry> = {};
    for (const [key, entry] of this.byKey.entries()) entries[key] = entry;
    return { version: 1, entries };
  }
}

