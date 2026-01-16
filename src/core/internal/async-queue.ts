export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly buf: T[] = [];
  private readonly waiters: Array<(v: IteratorResult<T>) => void> = [];
  private closed = false;
  private closeReason: unknown;

  push(value: T): void {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value, done: false });
    else this.buf.push(value);
  }

  close(reason?: unknown): void {
    if (this.closed) return;
    this.closed = true;
    this.closeReason = reason;
    for (const w of this.waiters.splice(0)) {
      w({ value: undefined as unknown as T, done: true });
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.buf.length > 0) {
      const v = this.buf.shift()!;
      return { value: v, done: false };
    }
    if (this.closed) return { value: undefined as unknown as T, done: true };
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next(),
      return: async () => {
        this.close();
        return { value: undefined as unknown as T, done: true };
      },
      throw: async (e) => {
        this.close(e);
        throw e;
      },
    };
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get reason(): unknown {
    return this.closeReason;
  }
}
