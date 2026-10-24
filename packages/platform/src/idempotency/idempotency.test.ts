import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IdempotencyStore } from './idempotency-store.ts';

describe('IdempotencyStore', () => {
  it('acquires lock on first attempt and returns cached response on repeat', async () => {
    const store = new IdempotencyStore(60);
    const key = 'ik_test_123';
    const payload = { proposalId: 'cp_9', cartVersion: 4 };

    // Attempt 1: Acquire
    const att1 = await store.acquire(key, payload);
    assert.equal(att1.isFirstAttempt, true);

    // Complete attempt 1 with committed cart
    const responseBody = { cartVersion: 5, totalMinor: 39900 };
    await store.complete(key, 200, responseBody);

    // Attempt 2: Repeat with identical key and payload
    const att2 = await store.acquire(key, payload);
    assert.equal(att2.isFirstAttempt, false);
    assert.deepEqual(att2.cachedResponse, responseBody);
  });

  it('rejects duplicate key with mismatched payload with ConflictError', async () => {
    const store = new IdempotencyStore(60);
    const key = 'ik_test_mismatch';

    await store.acquire(key, { amount: 100 });
    await store.complete(key, 200, { success: true });

    // Different payload with same key
    await assert.rejects(
      async () => store.acquire(key, { amount: 200 }),
      /previously used with a different request payload/,
    );
  });

  it('rejects concurrent request while still processing', async () => {
    const store = new IdempotencyStore(60);
    const key = 'ik_test_processing';

    await store.acquire(key, { item: 'pizza' });

    // Second request while in-flight
    await assert.rejects(
      async () => store.acquire(key, { item: 'pizza' }),
      /is currently being processed/,
    );
  });
});
