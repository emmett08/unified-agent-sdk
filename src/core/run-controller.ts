import { ToolCancelledError } from './errors.js';

type GateWaiter = { resolve: () => void; reject: (e: unknown) => void };

export class RunController {
  private readonly abortController = new AbortController();

  private paused = false;
  private stopRequested = false;

  private pauseWaiters: GateWaiter[] = [];

  private readonly approvals = new Map<string, { resolve: (allowed: boolean) => void; requestedAt: number }>();

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isStopRequested(): boolean {
    return this.stopRequested;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    for (const w of this.pauseWaiters.splice(0)) w.resolve();
  }

  stop(): void {
    this.stopRequested = true;
  }

  cancel(reason?: string): void {
    this.abortController.abort(reason ?? 'cancelled');
    // Unblock any pausers.
    this.resume();
    // Reject any outstanding approvals.
    for (const [id, p] of this.approvals.entries()) {
      p.resolve(false);
      this.approvals.delete(id);
    }
  }

  async waitIfPaused(): Promise<void> {
    if (!this.paused) return;
    await new Promise<void>((resolve, reject) => this.pauseWaiters.push({ resolve, reject }));
  }

  requestApproval(callId: string): Promise<boolean> {
    if (this.signal.aborted) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      this.approvals.set(callId, { resolve, requestedAt: Date.now() });
    });
  }

  resolveApproval(callId: string, allowed: boolean): boolean {
    const p = this.approvals.get(callId);
    if (!p) return false;
    p.resolve(allowed);
    this.approvals.delete(callId);
    return true;
  }

  async guardToolExecution(toolName: string): Promise<void> {
    if (this.signal.aborted) throw new ToolCancelledError(toolName);
    await this.waitIfPaused();
    if (this.signal.aborted) throw new ToolCancelledError(toolName);
  }
}
