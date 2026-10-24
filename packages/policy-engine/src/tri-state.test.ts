import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TriState } from './tri-state.ts';

describe('TriState (Kleene 3-Valued Logic)', () => {
  it('correctly computes Kleene AND truth table', () => {
    assert.equal(TriState.and('TRUE', 'TRUE'), 'TRUE');
    assert.equal(TriState.and('TRUE', 'FALSE'), 'FALSE');
    assert.equal(TriState.and('FALSE', 'TRUE'), 'FALSE');
    assert.equal(TriState.and('FALSE', 'FALSE'), 'FALSE');
    assert.equal(TriState.and('TRUE', 'UNKNOWN'), 'UNKNOWN');
    assert.equal(TriState.and('UNKNOWN', 'TRUE'), 'UNKNOWN');
    assert.equal(TriState.and('FALSE', 'UNKNOWN'), 'FALSE');
    assert.equal(TriState.and('UNKNOWN', 'FALSE'), 'FALSE');
    assert.equal(TriState.and('UNKNOWN', 'UNKNOWN'), 'UNKNOWN');
  });

  it('correctly computes Kleene OR truth table', () => {
    assert.equal(TriState.or('TRUE', 'TRUE'), 'TRUE');
    assert.equal(TriState.or('TRUE', 'FALSE'), 'TRUE');
    assert.equal(TriState.or('FALSE', 'TRUE'), 'TRUE');
    assert.equal(TriState.or('FALSE', 'FALSE'), 'FALSE');
    assert.equal(TriState.or('TRUE', 'UNKNOWN'), 'TRUE');
    assert.equal(TriState.or('UNKNOWN', 'TRUE'), 'TRUE');
    assert.equal(TriState.or('FALSE', 'UNKNOWN'), 'UNKNOWN');
    assert.equal(TriState.or('UNKNOWN', 'FALSE'), 'UNKNOWN');
    assert.equal(TriState.or('UNKNOWN', 'UNKNOWN'), 'UNKNOWN');
  });

  it('correctly computes Kleene NOT truth table', () => {
    assert.equal(TriState.not('TRUE'), 'FALSE');
    assert.equal(TriState.not('FALSE'), 'TRUE');
    assert.equal(TriState.not('UNKNOWN'), 'UNKNOWN');
  });

  it('evaluates safety and never treats UNKNOWN as safe', () => {
    const trueSafety = TriState.evaluateSafety('TRUE', 'Jain');
    assert.equal(trueSafety.safe, true);
    assert.equal(trueSafety.limitation, undefined);

    const unknownSafety = TriState.evaluateSafety('UNKNOWN', 'Gluten-Free');
    assert.equal(unknownSafety.safe, false);
    assert.match(unknownSafety.limitation!, /unverified cross-contact/);

    const falseSafety = TriState.evaluateSafety('FALSE', 'Vegan');
    assert.equal(falseSafety.safe, false);
    assert.match(falseSafety.limitation!, /Item is explicitly not Vegan/);
  });
});
