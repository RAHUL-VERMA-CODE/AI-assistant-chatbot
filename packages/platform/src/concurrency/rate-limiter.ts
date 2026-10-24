/**
 * Concurrency & Rate Limiting Primitives
 * Includes TokenBucket for AI token quotas and SlidingWindow for API requests.
 */

export interface TokenBucketOptions {
  readonly capacity: number; // Maximum burst tokens
  readonly refillRatePerSecond: number; // Tokens added per second
}

export class TokenBucket {
  private readonly options: TokenBucketOptions;
  private tokens: number;
  private lastRefillTimestamp: number;

  constructor(options: TokenBucketOptions) {
    this.options = options;
    this.tokens = options.capacity;
    this.lastRefillTimestamp = Date.now();
  }

  public tryConsume(tokens = 1): boolean {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  public getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillTimestamp) / 1000;
    this.tokens = Math.min(
      this.options.capacity,
      this.tokens + elapsedSeconds * this.options.refillRatePerSecond,
    );
    this.lastRefillTimestamp = now;
  }
}

export class SlidingWindowRateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly requests = new Map<string, number[]>();

  constructor(windowMs = 60000, maxRequests = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
  }

  public isAllowed(key: string): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let timestamps = this.requests.get(key) || [];
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= this.maxRequests) {
      const oldest = timestamps[0] || now;
      const retryAfterSeconds = Math.ceil((oldest + this.windowMs - now) / 1000);
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
    }

    timestamps.push(now);
    this.requests.set(key, timestamps);
    return {
      allowed: true,
      remaining: this.maxRequests - timestamps.length,
      retryAfterSeconds: 0,
    };
  }

  public cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    for (const [key, timestamps] of this.requests.entries()) {
      const valid = timestamps.filter((t) => t > windowStart);
      if (valid.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, valid);
      }
    }
  }
}
