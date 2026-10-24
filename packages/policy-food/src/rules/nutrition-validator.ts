import type { MenuItem } from '../../../connector-contract/src/index.ts';

export interface NutritionValidationResult {
  readonly satisfiesConstraint: boolean;
  readonly publishedProteinGrams?: number;
  readonly publishedKcal?: number;
  readonly reason?: string;
  readonly isDataUnavailable: boolean;
}

export class NutritionValidator {
  /**
   * Validates protein requirements using only verified published restaurant facts.
   * Model estimates or guesswork are strictly prohibited.
   */
  public static validateProtein(
    item: MenuItem,
    minProteinGrams = 20,
  ): NutritionValidationResult {
    const nutrition = item.nutrition;

    if (!nutrition || nutrition.proteinGrams === undefined || nutrition.proteinGrams === null) {
      return {
        satisfiesConstraint: false,
        isDataUnavailable: true,
        reason: `Published protein data is unavailable for '${item.name}'. Unverified estimates are prohibited.`,
      };
    }

    if (nutrition.proteinGrams < minProteinGrams) {
      return {
        satisfiesConstraint: false,
        publishedProteinGrams: nutrition.proteinGrams,
        isDataUnavailable: false,
        reason: `'${item.name}' provides ${nutrition.proteinGrams}g of protein per serving, which is below the requested ${minProteinGrams}g threshold.`,
      };
    }

    return {
      satisfiesConstraint: true,
      publishedProteinGrams: nutrition.proteinGrams,
      isDataUnavailable: false,
    };
  }

  /**
   * Validates calorie ceilings from verified menu data.
   */
  public static validateMaxCalories(
    item: MenuItem,
    maxCalories: number,
  ): NutritionValidationResult {
    const nutrition = item.nutrition;

    if (!nutrition || nutrition.kcal === undefined || nutrition.kcal === null) {
      return {
        satisfiesConstraint: false,
        isDataUnavailable: true,
        reason: `Published calorie count is unavailable for '${item.name}'. Cannot verify calorie constraints.`,
      };
    }

    if (nutrition.kcal > maxCalories) {
      return {
        satisfiesConstraint: false,
        publishedKcal: nutrition.kcal,
        isDataUnavailable: false,
        reason: `'${item.name}' contains ${nutrition.kcal} kcal, exceeding the maximum limit of ${maxCalories} kcal.`,
      };
    }

    return {
      satisfiesConstraint: true,
      publishedKcal: nutrition.kcal,
      isDataUnavailable: false,
    };
  }
}
