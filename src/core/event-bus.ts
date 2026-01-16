import type { AgentEvent } from './types.js';
import { AsyncQueue } from './internal/async-queue.js';

export type EventHook = (ev: AgentEvent) => void | Promise<void>;

export class EventBus implements AsyncIterable<AgentEvent> {
  private readonly q = new AsyncQueue<AgentEvent>();
  private readonly hooks = new Set<EventHook>();

  emit(ev: AgentEvent): void {
    // Fire-and-forget hooks; errors are deliberately ignored to avoid destabilising the run.
    for (const h of this.hooks) void Promise.resolve(h(ev)).catch(() => {});
    this.q.push(ev);
  }

  subscribe(hook: EventHook): () => void {
    this.hooks.add(hook);
    return () => this.hooks.delete(hook);
  }

  close(reason?: unknown): void {
    this.q.close(reason);
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    return this.q[Symbol.asyncIterator]();
  }
}
