import type { MenuItem, MenuItemOption } from '../../../connector-contract/src/index.ts';

export const FORBIDDEN_JAIN_ROOT_VEGETABLES = [
  'onion',
  'pyaaz',
  'pyaz',
  'garlic',
  'lehsun',
  'potato',
  'aloo',
  'alu',
  'carrot',
  'gajar',
  'radish',
  'mooli',
  'beetroot',
  'chukandar',
  'ginger',
  'adrak',
  'turnip',
  'shalgam',
  'yam',
  'jimikand',
  'suran',
  'sweet potato',
  'shakarkand',
] as const;

export interface JainValidationResult {
  readonly isJainCompliant: boolean;
  readonly reason?: string;
  readonly unverifiedReason?: string;
}

export class JainValidator {
  /**
   * Validates whether a catalog item and chosen options strictly comply with Jain dietary rules.
   */
  public static validateItem(
    item: MenuItem,
    selectedOptionIds: readonly string[] = [],
  ): JainValidationResult {
    const recipe = item.recipe;

    // 1. Must be vegetarian first
    if (!recipe || !recipe.isVeg) {
      return {
        isJainCompliant: false,
        reason: `'${item.name}' is non-vegetarian and cannot be Jain.`,
      };
    }

    // 2. Check restaurant recipe verification
    if (recipe.isJain === 'UNKNOWN') {
      return {
        isJainCompliant: false,
        unverifiedReason: `Restaurant has not verified Jain compliance for '${item.name}'. Root vegetable & cross-contact status is unknown.`,
      };
    }

    if (recipe.isJain === 'FALSE') {
      return {
        isJainCompliant: false,
        reason: `'${item.name}' is explicitly not prepared according to Jain dietary rules.`,
      };
    }

    // 3. Check explicit root vegetables / onion garlic flags
    if (recipe.containsRootVegetables === 'TRUE' || recipe.containsOnionGarlic === 'TRUE') {
      return {
        isJainCompliant: false,
        reason: `'${item.name}' contains root vegetables or onion/garlic.`,
      };
    }

    // 4. Defense-in-depth: check ingredient list for forbidden root vegetables
    const ingredients = (recipe.ingredientsList || []).map((i) => i.toLowerCase());
    const itemText = `${item.name} ${item.description || ''}`.toLowerCase();

    for (const rootVeg of FORBIDDEN_JAIN_ROOT_VEGETABLES) {
      const hasInIngredients = ingredients.some((ing) => ing.includes(rootVeg));
      const hasInText = itemText.includes(rootVeg);

      if (hasInIngredients || hasInText) {
        return {
          isJainCompliant: false,
          reason: `'${item.name}' contains root vegetable '${rootVeg}', which is strictly excluded from Jain food.`,
        };
      }
    }

    // 5. Check selected options/modifiers
    for (const group of item.optionGroups || []) {
      for (const option of group.options) {
        if (selectedOptionIds.includes(option.id)) {
          const optResult = this.validateOption(option, item.name);
          if (!optResult.isJainCompliant) {
            return optResult;
          }
        }
      }
    }

    return { isJainCompliant: true };
  }

  private static validateOption(option: MenuItemOption, parentName: string): JainValidationResult {
    const optText = option.name.toLowerCase();
    for (const rootVeg of FORBIDDEN_JAIN_ROOT_VEGETABLES) {
      if (optText.includes(rootVeg)) {
        return {
          isJainCompliant: false,
          reason: `Selected option '${option.name}' for '${parentName}' contains root vegetable '${rootVeg}'.`,
        };
      }
    }
    return { isJainCompliant: true };
  }
}
