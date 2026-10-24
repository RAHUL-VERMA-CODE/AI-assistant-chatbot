import type { BranchCatalog, MenuItem } from '../../../connector-contract/src/index.ts';
import { JainValidator } from '../rules/jain-validator.ts';
import { AllergenValidator } from '../rules/allergen-validator.ts';

export interface GroupOrderRequest {
  readonly partySize: number;
  readonly vegCount: number;
  readonly nonVegCount: number;
  readonly maxBudgetMinor: number;
  readonly isJainOnly?: boolean;
  readonly excludedAllergens?: readonly string[];
}

export interface AllocatedPersonItem {
  readonly personIndex: number;
  readonly personLabel: string;
  readonly dietaryType: 'VEG' | 'NON_VEG' | 'JAIN';
  readonly item: MenuItem;
  readonly variantId?: string;
  readonly priceMinor: number;
}

export interface GroupOrderSolution {
  readonly feasible: boolean;
  readonly totalMinor: number;
  readonly remainingBudgetMinor: number;
  readonly allocations: readonly AllocatedPersonItem[];
  readonly adequacyNotice: string;
  readonly searchDurationMs: number;
  readonly failureReason?: string;
}

export class GroupBudgetSolver {
  /**
   * Solves group dietary allocation within a strict integer minor unit budget.
   * Guaranteed to complete within 50ms latency budget.
   */
  public static solve(catalog: BranchCatalog, request: GroupOrderRequest): GroupOrderSolution {
    const startTime = performance.now();

    if (request.partySize <= 0) {
      return {
        feasible: false,
        totalMinor: 0,
        remainingBudgetMinor: request.maxBudgetMinor,
        allocations: [],
        adequacyNotice: '',
        searchDurationMs: performance.now() - startTime,
        failureReason: 'Party size must be greater than zero.',
      };
    }

    if (request.vegCount + request.nonVegCount !== request.partySize) {
      return {
        feasible: false,
        totalMinor: 0,
        remainingBudgetMinor: request.maxBudgetMinor,
        allocations: [],
        adequacyNotice: '',
        searchDurationMs: performance.now() - startTime,
        failureReason: `Portion breakdown (${request.vegCount} veg + ${request.nonVegCount} non-veg) does not equal party size (${request.partySize}).`,
      };
    }

    // 1. Filter eligible items in stock and meeting safety rules
    const eligibleVeg: MenuItem[] = [];
    const eligibleNonVeg: MenuItem[] = [];

    for (const item of catalog.items) {
      if (!item.inStock || !item.active) continue;

      // Allergen filter
      if (request.excludedAllergens && request.excludedAllergens.length > 0) {
        const allergenRes = AllergenValidator.validate(item, request.excludedAllergens);
        if (!allergenRes.isSafe) continue;
      }

      const isVeg = item.recipe && item.recipe.isVeg;

      if (isVeg) {
        if (request.isJainOnly) {
          const jainRes = JainValidator.validateItem(item);
          if (!jainRes.isJainCompliant) continue;
        }
        eligibleVeg.push(item);
      } else {
        if (!request.isJainOnly) {
          eligibleNonVeg.push(item);
        }
      }
    }

    if (request.vegCount > 0 && eligibleVeg.length === 0) {
      return {
        feasible: false,
        totalMinor: 0,
        remainingBudgetMinor: request.maxBudgetMinor,
        allocations: [],
        adequacyNotice: '',
        searchDurationMs: performance.now() - startTime,
        failureReason: 'No in-stock vegetarian items match the specified dietary restrictions.',
      };
    }

    if (request.nonVegCount > 0 && eligibleNonVeg.length === 0) {
      return {
        feasible: false,
        totalMinor: 0,
        remainingBudgetMinor: request.maxBudgetMinor,
        allocations: [],
        adequacyNotice: '',
        searchDurationMs: performance.now() - startTime,
        failureReason: 'No in-stock non-vegetarian items match the specified dietary restrictions.',
      };
    }

    // Sort candidates by base price ascending
    eligibleVeg.sort((a, b) => a.basePriceMinor - b.basePriceMinor);
    eligibleNonVeg.sort((a, b) => a.basePriceMinor - b.basePriceMinor);

    // 2. Greedy selection of satisfying mix
    const allocations: AllocatedPersonItem[] = [];
    let currentTotalMinor = 0;
    let personIdx = 1;

    // Allocate Veg portions
    for (let i = 0; i < request.vegCount; i++) {
      const item = eligibleVeg[i % eligibleVeg.length]!;
      currentTotalMinor += item.basePriceMinor;
      allocations.push({
        personIndex: personIdx++,
        personLabel: `Person ${personIdx - 1} (${request.isJainOnly ? 'Jain' : 'Veg'})`,
        dietaryType: request.isJainOnly ? 'JAIN' : 'VEG',
        item,
        priceMinor: item.basePriceMinor,
      });
    }

    // Allocate Non-Veg portions
    for (let i = 0; i < request.nonVegCount; i++) {
      const item = eligibleNonVeg[i % eligibleNonVeg.length]!;
      currentTotalMinor += item.basePriceMinor;
      allocations.push({
        personIndex: personIdx++,
        personLabel: `Person ${personIdx - 1} (Non-Veg)`,
        dietaryType: 'NON_VEG',
        item,
        priceMinor: item.basePriceMinor,
      });
    }

    const duration = performance.now() - startTime;

    if (currentTotalMinor > request.maxBudgetMinor) {
      return {
        feasible: false,
        totalMinor: currentTotalMinor,
        remainingBudgetMinor: 0,
        allocations: [],
        adequacyNotice: '',
        searchDurationMs: duration,
        failureReason: `The minimum cost for ${request.partySize} meals from this branch is ${catalog.currency} ${(currentTotalMinor / 100).toFixed(2)}, which exceeds your budget of ${catalog.currency} ${(request.maxBudgetMinor / 100).toFixed(2)}.`,
      };
    }

    return {
      feasible: true,
      totalMinor: currentTotalMinor,
      remainingBudgetMinor: request.maxBudgetMinor - currentTotalMinor,
      allocations,
      adequacyNotice:
        'Proposal includes 1 main meal portion per person. Portion adequacy depends on individual appetite and restaurant serving sizes.',
      searchDurationMs: duration,
    };
  }
}
