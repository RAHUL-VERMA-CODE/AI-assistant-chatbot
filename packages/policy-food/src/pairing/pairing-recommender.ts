import type {
  BranchCatalog,
  MenuItem,
  LineItemChoice,
} from '../../../connector-contract/src/index.ts';
import { JainValidator } from '../rules/jain-validator.ts';
import { AllergenValidator } from '../rules/allergen-validator.ts';

export interface PairingSuggestion {
  readonly item: MenuItem;
  readonly priceMinor: number;
  readonly currency: string;
  readonly suggestionPrompt: string;
}

export class PairingRecommender {
  /**
   * Proposes at most ONE dietary-compatible add-on per order.
   * Never silently adds an item to the cart.
   */
  public static recommendPairing(
    catalog: BranchCatalog,
    currentCartChoices: readonly LineItemChoice[],
    options: {
      isJainOnly?: boolean;
      isVegOnly?: boolean;
      excludedAllergens?: readonly string[];
    } = {},
  ): PairingSuggestion | null {
    if (currentCartChoices.length === 0) {
      return null;
    }

    const cartItemIds = new Set(currentCartChoices.map((c) => c.itemId));

    // Look for complementary categories: beverages, desserts, starters, or sides
    const candidates = catalog.items.filter((item) => {
      if (!item.inStock || !item.active) return false;
      if (cartItemIds.has(item.id)) return false;

      // Category match
      const cat = (item.category || '').toLowerCase();
      const isComplementary =
        cat.includes('beverage') ||
        cat.includes('drink') ||
        cat.includes('dessert') ||
        cat.includes('sweet') ||
        cat.includes('starter') ||
        cat.includes('side');
      if (!isComplementary) return false;

      // Dietary filter
      const isVeg = item.recipe && item.recipe.isVeg;
      if (options.isVegOnly && !isVeg) return false;
      if (options.isJainOnly) {
        const jainRes = JainValidator.validateItem(item);
        if (!jainRes.isJainCompliant) return false;
      }

      // Allergen filter
      if (options.excludedAllergens && options.excludedAllergens.length > 0) {
        const allergenRes = AllergenValidator.validate(item, options.excludedAllergens);
        if (!allergenRes.isSafe) return false;
      }

      return true;
    });

    if (candidates.length === 0) {
      return null;
    }

    // Pick the most affordable popular candidate
    candidates.sort((a, b) => a.basePriceMinor - b.basePriceMinor);
    const chosen = candidates[0]!;

    const formattedPrice = `${catalog.currency} ${(chosen.basePriceMinor / 100).toFixed(2)}`;
    const prompt = `Would you like to add a ${chosen.name} for ${formattedPrice}?`;

    return {
      item: chosen,
      priceMinor: chosen.basePriceMinor,
      currency: catalog.currency,
      suggestionPrompt: prompt,
    };
  }
}
