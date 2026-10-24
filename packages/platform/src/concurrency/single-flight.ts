/**
 * Single-flight request coalescing
 * Ensures only one execution is active for any given key; concurrent callers share the identical promise.
 */

export class SingleFlight {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  public async do<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  public activeCount(): number {
    return this.inFlight.size;
  }
}
