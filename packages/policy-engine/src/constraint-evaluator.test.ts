import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConstraintEvaluator } from './constraint-evaluator.ts';

describe('ConstraintEvaluator (Precedence & Dietary Safety)', () => {
  it('current turn constraint overrides saved dietary preference for this turn', () => {
    const saved = {
      isVeg: true,
      consented: true,
    };
    const current = {
      isVeg: false,
    };
    const effective = ConstraintEvaluator.resolve(current, saved);
    assert.equal(effective.isVeg, false);
    assert.equal(effective.conflictDetected, false);
    assert.equal(effective.source, 'COMBINED');
  });

  it('saved allergies remain hard exclusions when turn specifies new exclusions', () => {
    const saved = {
      excludedAllergens: ['peanut', 'dairy'],
      consented: true,
    };
    const current = {
      excludedAllergens: ['gluten'],
    };
    const effective = ConstraintEvaluator.resolve(current, saved);
    assert.deepEqual(
      effective.excludedAllergens.slice().sort(),
      ['dairy', 'gluten', 'peanut'].sort(),
    );
  });

  it('allows explicit revocation of saved allergies when user explicitly requests it', () => {
    const saved = {
      excludedAllergens: ['peanut'],
      consented: true,
    };
    const current = {
      explicitlyClearAllergies: true,
      excludedAllergens: [],
    };
    const effective = ConstraintEvaluator.resolve(current, saved);
    assert.equal(effective.excludedAllergens.length, 0);
  });

  it('detects contradiction when Jain is requested with non-veg', () => {
    const current = {
      isJain: true,
      isVeg: false,
    };
    const effective = ConstraintEvaluator.resolve(current);
    assert.equal(effective.conflictDetected, true);
    assert.match(effective.conflictReason!, /strictly vegetarian/);
  });
});
