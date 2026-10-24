import { RateLimitExceededError } from '../../../core/src/index.ts';

export type RequestPriority = 'P0_VOICE' | 'P1_TEXT' | 'P2_BACKGROUND';

export interface KeyState {
  readonly apiKey: string;
  tokensRemaining: number;
  lastRefillTimestamp: number;
  isCoolingDown: boolean;
  cooldownUntil: number;
}

export class RateGovernor {
  private readonly keys: KeyState[];
  private currentKeyIndex = 0;
  private readonly maxTokensPerMinute: number;
  private readonly refillRatePerMs: number;

  constructor(apiKeys: string[], maxTokensPerMinute = 60_000) {
    if (apiKeys.length === 0) {
      throw new Error('RateGovernor requires at least one API key');
    }
    this.maxTokensPerMinute = maxTokensPerMinute;
    this.refillRatePerMs = maxTokensPerMinute / 60_000;

    const now = Date.now();
    this.keys = apiKeys.map((apiKey) => ({
      apiKey,
      tokensRemaining: maxTokensPerMinute,
      lastRefillTimestamp: now,
      isCoolingDown: false,
      cooldownUntil: 0,
    }));
  }

  /**
   * Selects an active API key, refilling its token bucket and deducting requested tokens.
   */
  public acquireKey(estimatedTokens = 500, priority: RequestPriority = 'P0_VOICE'): string {
    const now = Date.now();

    // Check all keys in round-robin order
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.currentKeyIndex + i) % this.keys.length;
      const keyState = this.keys[idx]!;

      // Handle cooldown expiration
      if (keyState.isCoolingDown && now > keyState.cooldownUntil) {
        keyState.isCoolingDown = false;
        keyState.tokensRemaining = this.maxTokensPerMinute / 2; // half capacity on recovery
        keyState.lastRefillTimestamp = now;
      }

      if (keyState.isCoolingDown) {
        continue;
      }

      // Refill tokens based on elapsed time
      const elapsed = now - keyState.lastRefillTimestamp;
      const refill = Math.floor(elapsed * this.refillRatePerMs);
      if (refill > 0) {
        keyState.tokensRemaining = Math.min(
          this.maxTokensPerMinute,
          keyState.tokensRemaining + refill,
        );
        keyState.lastRefillTimestamp = now;
      }

      // Check if key has enough tokens
      // P0_VOICE can burst up to 10% deficit; P2 cannot
      const threshold = priority === 'P0_VOICE' ? -Math.floor(this.maxTokensPerMinute * 0.1) : 0;

      if (keyState.tokensRemaining - estimatedTokens >= threshold) {
        keyState.tokensRemaining -= estimatedTokens;
        this.currentKeyIndex = (idx + 1) % this.keys.length;
        return keyState.apiKey;
      }
    }

    throw new RateLimitExceededError(5, `LLM API key capacity for priority ${priority}`);
  }

  /**
   * Reports a 429 rate limit error on a key to trigger automatic failover and temporary cooldown.
   */
  public reportRateLimit(apiKey: string, cooldownSeconds = 60): void {
    const keyState = this.keys.find((k) => k.apiKey === apiKey);
    if (keyState) {
      keyState.isCoolingDown = true;
      keyState.cooldownUntil = Date.now() + cooldownSeconds * 1000;
      keyState.tokensRemaining = 0;
    }
  }

  public getActiveKeyCount(): number {
    const now = Date.now();
    return this.keys.filter((k) => !k.isCoolingDown || now > k.cooldownUntil).length;
  }
}
