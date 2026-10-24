import type { MenuItem } from '../../../connector-contract/src/index.ts';

export interface ClarificationRequest {
  readonly required: boolean;
  readonly question?: string;
  readonly options?: readonly string[];
  readonly slotName?: 'variant' | 'item' | 'diet' | 'quantity';
}

export class ClarificationPolicy {
  /**
   * Evaluates if item variant or ambiguity requires exactly ONE focused clarification question.
   */
  public static evaluateItemClarification(
    item: MenuItem,
    selectedVariantId?: string,
    currency = 'INR',
  ): ClarificationRequest {
    // 1. If item has variants and user didn't specify one
    if (item.variants && item.variants.length > 1 && !selectedVariantId) {
      const options = item.variants
        .filter((v) => v.inStock)
        .map((v) => `${v.name} (${currency} ${(v.priceMinor / 100).toFixed(2)})`);

      return {
        required: true,
        question: `Which size would you like for ${item.name}?`,
        options,
        slotName: 'variant',
      };
    }

    return { required: false };
  }

  /**
   * Evaluates multiple candidate matches.
   */
  public static evaluateMultiItemMatch(
    candidateItems: readonly MenuItem[],
    currency = 'INR',
  ): ClarificationRequest {
    if (candidateItems.length > 1) {
      const options = candidateItems
        .slice(0, 3)
        .map((i) => `${i.name} (${currency} ${(i.basePriceMinor / 100).toFixed(2)})`);

      return {
        required: true,
        question: 'We found multiple matching dishes. Which one would you prefer?',
        options,
        slotName: 'item',
      };
    }

    return { required: false };
  }
}
