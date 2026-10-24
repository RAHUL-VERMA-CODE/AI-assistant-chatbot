import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GroupBudgetSolver } from './group-budget-solver.ts';
import { ARPZO_KORAMANGALA_CATALOG } from '../../../../tools/demo-tenant/src/seeds/arpzo-menu.ts';

describe('GroupBudgetSolver (Combinatorial Knapsack & 50ms Latency Budget)', () => {
  it('solves 3-person meal (2 veg, 1 non-veg) under 1500 INR in under 50ms', () => {
    const start = performance.now();
    const solution = GroupBudgetSolver.solve(ARPZO_KORAMANGALA_CATALOG, {
      partySize: 3,
      vegCount: 2,
      nonVegCount: 1,
      maxBudgetMinor: 150000, // INR 1500.00
    });
    const duration = performance.now() - start;

    assert.equal(solution.feasible, true);
    assert.equal(solution.allocations.length, 3);
    assert.ok(solution.totalMinor <= 150000);
    assert.equal(solution.remainingBudgetMinor, 150000 - solution.totalMinor);

    // Verify portions
    const vegAllocations = solution.allocations.filter((a) => a.dietaryType === 'VEG');
    const nonVegAllocations = solution.allocations.filter((a) => a.dietaryType === 'NON_VEG');
    assert.equal(vegAllocations.length, 2);
    assert.equal(nonVegAllocations.length, 1);

    // Verify portion adequacy notice
    assert.match(solution.adequacyNotice, /Portion adequacy depends on individual appetite/);

    // Verify latency budget <= 50ms
    assert.ok(
      duration <= 50,
      `Group budget solver exceeded 50ms latency budget (took ${duration.toFixed(2)}ms)`,
    );
  });

  it('fails gracefully when requested budget is impossibly low', () => {
    const solution = GroupBudgetSolver.solve(ARPZO_KORAMANGALA_CATALOG, {
      partySize: 3,
      vegCount: 2,
      nonVegCount: 1,
      maxBudgetMinor: 20000, // INR 200.00 (impossible for 3 main dishes)
    });

    assert.equal(solution.feasible, false);
    assert.equal(solution.allocations.length, 0);
    assert.match(solution.failureReason!, /exceeds your budget of INR 200.00/);
  });

  it('solves Jain-only group mix excluding non-Jain vegetarian items', () => {
    const solution = GroupBudgetSolver.solve(ARPZO_KORAMANGALA_CATALOG, {
      partySize: 2,
      vegCount: 2,
      nonVegCount: 0,
      maxBudgetMinor: 100000,
      isJainOnly: true,
    });

    assert.equal(solution.feasible, true);
    assert.equal(solution.allocations.length, 2);
    for (const alloc of solution.allocations) {
      assert.equal(alloc.dietaryType, 'JAIN');
      assert.equal(alloc.item.recipe?.isJain, 'TRUE');
    }
  });
});
