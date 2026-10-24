/**
 * Three-state Circuit Breaker
 * Protects downstream services (AI APIs, Tenant Connectors) from cascading failures.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  readonly failureThreshold: number; // e.g. 3 failures
  readonly cooldownMs: number; // e.g. 10000ms before HALF_OPEN probe
  readonly halfOpenMaxAttempts: number; // e.g. 1 probe attempt
}

export class CircuitBreaker {
  public readonly name: string;
  private readonly options: CircuitBreakerOptions;
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;

  constructor(
    name: string,
    options: CircuitBreakerOptions = {
      failureThreshold: 3,
      cooldownMs: 10000,
      halfOpenMaxAttempts: 1,
    },
  ) {
    this.name = name;
    this.options = options;
  }

  public getState(): CircuitState {
    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now - this.lastFailureTime >= this.options.cooldownMs) {
        this.state = 'HALF_OPEN';
        this.halfOpenAttempts = 0;
      }
    }
    return this.state;
  }

  public async execute<T>(
    fn: () => Promise<T>,
    isFailure?: (err: unknown) => boolean,
  ): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'OPEN') {
      throw new Error(`CircuitBreaker '${this.name}' is OPEN. Fast-failing request.`);
    }

    if (currentState === 'HALF_OPEN') {
      if (this.halfOpenAttempts >= this.options.halfOpenMaxAttempts) {
        throw new Error(`CircuitBreaker '${this.name}' is HALF_OPEN and testing capacity. Fast-failing.`);
      }
      this.halfOpenAttempts++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      const countsAsFailure = isFailure ? isFailure(err) : true;
      if (countsAsFailure) {
        this.onFailure();
      }
      throw err;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN' || this.failureCount >= this.options.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  public reset(): void {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.halfOpenAttempts = 0;
  }
}
