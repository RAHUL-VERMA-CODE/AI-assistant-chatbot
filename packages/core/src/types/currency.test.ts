import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Money } from './currency.ts';

describe('Money Value Object', () => {
  it('creates money and prevents non-integers', () => {
    const m = Money.of(39900, 'INR');
    assert.equal(m.minorUnits, 39900);
    assert.equal(m.currency, 'INR');

    assert.throws(() => Money.of(399.5, 'INR'), TypeError);
  });

  it('performs exact addition and subtraction without floating point errors', () => {
    const a = Money.of(19900, 'INR');
    const b = Money.of(24900, 'INR');
    const sum = a.add(b);
    assert.equal(sum.minorUnits, 44800);

    const diff = sum.subtract(a);
    assert.equal(diff.minorUnits, 24900);
  });

  it('rejects arithmetic across mismatched currencies', () => {
    const inr = Money.of(10000, 'INR');
    const usd = Money.of(1000, 'USD');
    assert.throws(() => inr.add(usd), /Currency mismatch/);
  });

  it('multiplies by non-negative integer quantities', () => {
    const m = Money.of(15000, 'INR');
    assert.equal(m.multiply(3).minorUnits, 45000);
    assert.equal(m.multiply(0).minorUnits, 0);
    assert.throws(() => m.multiply(-1), TypeError);
    assert.throws(() => m.multiply(1.5), TypeError);
  });

  it('formats human readable display strings', () => {
    assert.equal(Money.of(39900, 'INR').toDisplayString(), 'INR 399.00');
    assert.equal(Money.of(4505, 'USD').toDisplayString(), 'USD 45.05');
    assert.equal(Money.of(1500, 'JPY').toDisplayString(), 'JPY 1500');
  });
});
