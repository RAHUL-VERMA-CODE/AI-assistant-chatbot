import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from './circuit-breaker.ts';
import { SingleFlight } from './single-flight.ts';
import { TokenBucket, SlidingWindowRateLimiter } from './rate-limiter.ts';

describe('Concurrency Primitives', () => {
  it('CircuitBreaker trips to OPEN after threshold and recovers in HALF_OPEN', async () => {
    const cb = new CircuitBreaker('test-service', {
      failureThreshold: 2,
      cooldownMs: 50,
      halfOpenMaxAttempts: 1,
    });

    assert.equal(cb.getState(), 'CLOSED');

    // Failure 1
    await assert.rejects(() => cb.execute(() => Promise.reject(new Error('fail 1'))));
    assert.equal(cb.getState(), 'CLOSED');

    // Failure 2 -> trips circuit
    await assert.rejects(() => cb.execute(() => Promise.reject(new Error('fail 2'))));
    assert.equal(cb.getState(), 'OPEN');

    // Fast-fails immediately while OPEN
    await assert.rejects(() => cb.execute(() => Promise.resolve('ok')), /is OPEN/);

    // Wait for cooldown
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(cb.getState(), 'HALF_OPEN');

    // Successful probe closes the circuit
    const result = await cb.execute(() => Promise.resolve('recovered'));
    assert.equal(result, 'recovered');
    assert.equal(cb.getState(), 'CLOSED');
  });

  it('SingleFlight coalesces concurrent executions into one call', async () => {
    const sf = new SingleFlight();
    let executionCount = 0;

    const fn = async () => {
      executionCount++;
      await new Promise((r) => setTimeout(r, 20));
      return 'item_pizza_12';
    };

    // Trigger 5 concurrent requests with identical key
    const promises = Array.from({ length: 5 }, () => sf.do('menu_branch_1', fn));
    const results = await Promise.all(promises);

    assert.equal(results.length, 5);
    assert.deepEqual(results, ['item_pizza_12', 'item_pizza_12', 'item_pizza_12', 'item_pizza_12', 'item_pizza_12']);
    assert.equal(executionCount, 1); // Exactly 1 call was made!
  });

  it('TokenBucket limits rate and refills smoothly', () => {
    const bucket = new TokenBucket({ capacity: 5, refillRatePerSecond: 10 });
    assert.equal(bucket.tryConsume(3), true);
    assert.equal(bucket.tryConsume(2), true);
    assert.equal(bucket.tryConsume(1), false); // Empty
  });

  it('SlidingWindowRateLimiter calculates remaining allowance and retry-after', () => {
    const limiter = new SlidingWindowRateLimiter(1000, 2);
    const r1 = limiter.isAllowed('user_1');
    assert.equal(r1.allowed, true);
    assert.equal(r1.remaining, 1);

    const r2 = limiter.isAllowed('user_1');
    assert.equal(r2.allowed, true);
    assert.equal(r2.remaining, 0);

    const r3 = limiter.isAllowed('user_1');
    assert.equal(r3.allowed, false);
    assert.ok(r3.retryAfterSeconds >= 1);
  });
});
