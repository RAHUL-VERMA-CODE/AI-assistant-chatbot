import type { MenuItem } from '../../../connector-contract/src/index.ts';

export interface AllergenValidationResult {
  readonly isSafe: boolean;
  readonly reason?: string;
  readonly unverifiedLimitation?: string;
  readonly supportActionAvailable: boolean;
}

export class AllergenValidator {
  /**
   * Evaluates allergen and gluten-free safety based on verified recipe facts.
   * Unknown cross-contact or undisclosed allergens can NEVER be claimed safe.
   */
  public static validate(
    item: MenuItem,
    excludedAllergens: readonly string[] = [],
    requireGlutenFree = false,
  ): AllergenValidationResult {
    const recipe = item.recipe;

    // 1. Gluten-free validation
    if (requireGlutenFree) {
      if (!recipe || recipe.isGlutenFree === 'UNKNOWN') {
        return {
          isSafe: false,
          unverifiedLimitation: `Gluten-free certification is unknown for '${item.name}'. The restaurant has not published gluten data.`,
          supportActionAvailable: true,
        };
      }

      if (recipe.isGlutenFree === 'FALSE') {
        return {
          isSafe: false,
          reason: `'${item.name}' contains gluten or wheat-derived ingredients.`,
          supportActionAvailable: false,
        };
      }

      if (recipe.crossContactRisk === 'HIGH' || recipe.crossContactRisk === 'UNKNOWN') {
        return {
          isSafe: false,
          unverifiedLimitation: `'${item.name}' is made with gluten-free ingredients, but the kitchen has unverified or high cross-contact risk.`,
          supportActionAvailable: true,
        };
      }
    }

    // 2. Specific Allergen exclusions
    if (excludedAllergens.length > 0) {
      if (!recipe) {
        return {
          isSafe: false,
          unverifiedLimitation: `Allergen disclosures are unavailable from the restaurant for '${item.name}'.`,
          supportActionAvailable: true,
        };
      }

      const declaredAllergens = (recipe.allergensPresent || []).map((a) =>
        a.toLowerCase().trim(),
      );
      const ingredients = (recipe.ingredientsList || []).map((i) => i.toLowerCase().trim());
      const itemDesc = `${item.name} ${item.description || ''}`.toLowerCase();

      for (const allergen of excludedAllergens) {
        const target = allergen.toLowerCase().trim();

        // Direct declared allergen match
        const foundDeclared = declaredAllergens.some(
          (a) => a.includes(target) || target.includes(a),
        );
        if (foundDeclared) {
          return {
            isSafe: false,
            reason: `'${item.name}' contains declared allergen: '${allergen}'.`,
            supportActionAvailable: false,
          };
        }

        // Ingredient match
        const foundInIngredient = ingredients.some((ing) => ing.includes(target));
        if (foundInIngredient) {
          return {
            isSafe: false,
            reason: `'${item.name}' lists '${allergen}' in its published ingredients.`,
            supportActionAvailable: false,
          };
        }

        // Text match
        if (itemDesc.includes(target)) {
          return {
            isSafe: false,
            reason: `'${item.name}' description mentions '${allergen}'.`,
            supportActionAvailable: false,
          };
        }
      }

      // Check cross-contact risk for severe allergies
      if (recipe.crossContactRisk === 'HIGH') {
        return {
          isSafe: false,
          unverifiedLimitation: `'${item.name}' does not list '${excludedAllergens.join(', ')}' directly, but restaurant kitchen reports high shared equipment cross-contact risk.`,
          supportActionAvailable: true,
        };
      }
    }

    return {
      isSafe: true,
      supportActionAvailable: false,
    };
  }
}
