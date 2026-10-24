import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ok, err } from './result.ts';

describe('Result Monad', () => {
  it('maps and unwraps ok values', () => {
    const res = ok(10).map((n) => n * 2);
    assert.equal(res.isOk, true);
    assert.equal(res.isErr, false);
    assert.equal(res.unwrap(), 20);
  });

  it('handles error flow without throwing until unwrap', () => {
    const res = err<number, string>('invalid').map((n) => n * 2);
    assert.equal(res.isOk, false);
    assert.equal(res.isErr, true);
    assert.equal(res.unwrapOr(99), 99);
    assert.throws(() => res.unwrap(), /invalid/);
  });

  it('matches pattern arms exhaustively', () => {
    const res = ok('item_pizza');
    const matched = res.match({
      ok: (val) => `Found ${val}`,
      err: (e) => `Error: ${e}`,
    });
    assert.equal(matched, 'Found item_pizza');
  });
});
