/**
 * Constraint evaluator enforcing strict precedence:
 * Current Turn Constraints > Consented Saved Preferences
 * Allergies remain hard exclusions until customer explicitly updates the recorded restriction.
 * Conflicting requests trigger clarification; never silently remove a restriction.
 */

export interface CustomerPreferences {
  readonly isVeg?: boolean;
  readonly isJain?: boolean;
  readonly isGlutenFree?: boolean;
  readonly excludedAllergens?: readonly string[];
  readonly highProteinOnly?: boolean;
  readonly minProteinGrams?: number;
  readonly consented: boolean;
}

export interface TurnConstraints {
  readonly isVeg?: boolean;
  readonly isJain?: boolean;
  readonly isGlutenFree?: boolean;
  readonly excludedAllergens?: readonly string[];
  readonly explicitlyClearAllergies?: boolean;
  readonly highProteinOnly?: boolean;
  readonly minProteinGrams?: number;
  readonly maxBudgetMinor?: number;
  readonly partySize?: number;
  readonly vegCount?: number;
  readonly nonVegCount?: number;
}

export interface EffectiveConstraints {
  readonly isVeg?: boolean;
  readonly isJain?: boolean;
  readonly isGlutenFree?: boolean;
  readonly excludedAllergens: readonly string[];
  readonly highProteinOnly?: boolean;
  readonly minProteinGrams?: number;
  readonly maxBudgetMinor?: number;
  readonly partySize?: number;
  readonly vegCount?: number;
  readonly nonVegCount?: number;
  readonly conflictDetected: boolean;
  readonly conflictReason?: string;
  readonly source: 'TURN_OVERRIDE' | 'PREFERENCE_DEFAULT' | 'COMBINED';
}

export class ConstraintEvaluator {
  /**
   * Resolves final constraints by merging current turn requests with consented customer preferences.
   */
  public static resolve(
    currentTurn?: TurnConstraints,
    savedPrefs?: CustomerPreferences,
  ): EffectiveConstraints {
    const hasConsentedPrefs = savedPrefs && savedPrefs.consented;

    // 1. Dietary precedence (Current Turn overrides Saved Preferences for this order)
    let isVeg = currentTurn?.isVeg !== undefined ? currentTurn.isVeg : (hasConsentedPrefs ? savedPrefs.isVeg : undefined);
    let isJain = currentTurn?.isJain !== undefined ? currentTurn.isJain : (hasConsentedPrefs ? savedPrefs.isJain : undefined);
    let isGlutenFree =
      currentTurn?.isGlutenFree !== undefined
        ? currentTurn.isGlutenFree
        : (hasConsentedPrefs ? savedPrefs.isGlutenFree : undefined);

    // A4 Rule: Jain implies Veg. If isJain is true, isVeg cannot be false.
    if (isJain && isVeg === false) {
      return {
        isVeg: false,
        isJain: true,
        excludedAllergens: [],
        conflictDetected: true,
        conflictReason:
          'Contradiction: Request is marked both Jain and Non-Vegetarian. Jain food is strictly vegetarian.',
        source: hasConsentedPrefs ? 'COMBINED' : 'TURN_OVERRIDE',
      };
    }
    if (isJain) {
      isVeg = true;
    }

    // 2. Allergen Precedence (Allergies remain hard exclusions unless explicitly revoked)
    const turnAllergens = currentTurn?.excludedAllergens || [];
    const savedAllergens = (hasConsentedPrefs && savedPrefs.excludedAllergens) || [];

    let combinedAllergens: string[];
    if (currentTurn?.explicitlyClearAllergies) {
      combinedAllergens = [...turnAllergens];
    } else {
      // Union of saved and turn allergens (case-insensitive deduplication)
      const set = new Set<string>();
      for (const a of savedAllergens) set.add(a.trim().toLowerCase());
      for (const a of turnAllergens) set.add(a.trim().toLowerCase());
      combinedAllergens = Array.from(set);
    }

    // 3. Nutrition precedence
    const highProteinOnly =
      currentTurn?.highProteinOnly !== undefined
        ? currentTurn.highProteinOnly
        : (hasConsentedPrefs ? savedPrefs.highProteinOnly : undefined);
    const minProteinGrams =
      currentTurn?.minProteinGrams !== undefined
        ? currentTurn.minProteinGrams
        : (hasConsentedPrefs ? savedPrefs.minProteinGrams : undefined);

    const source = !hasConsentedPrefs
      ? 'TURN_OVERRIDE'
      : (currentTurn && Object.keys(currentTurn).length > 0
        ? 'COMBINED'
        : 'PREFERENCE_DEFAULT');

    return {
      isVeg,
      isJain,
      isGlutenFree,
      excludedAllergens: combinedAllergens,
      highProteinOnly,
      minProteinGrams,
      maxBudgetMinor: currentTurn?.maxBudgetMinor,
      partySize: currentTurn?.partySize,
      vegCount: currentTurn?.vegCount,
      nonVegCount: currentTurn?.nonVegCount,
      conflictDetected: false,
      source,
    };
  }
}
