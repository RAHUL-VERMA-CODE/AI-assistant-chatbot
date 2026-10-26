import type { BranchCatalog, MenuItem, MenuItemVariant } from '../../../connector-contract/src/index.ts';
import { HinglishNormalizer } from '../normalizer/hinglish-normalizer.ts';

export interface ExtractedSlots {
  readonly matchedItem?: MenuItem;
  readonly matchedVariant?: MenuItemVariant;
  readonly quantity: number;
  readonly isJain?: boolean;
  readonly isVeg?: boolean;
  readonly isGlutenFree?: boolean;
  readonly excludedAllergens: readonly string[];
  readonly isGreeting?: boolean;
  readonly isQuestion?: boolean;
  readonly isDiscovery?: boolean;
  readonly isPreferenceSave?: boolean;
  readonly isAddIntent?: boolean;
  readonly groupMix?: {
    readonly partySize: number;
    readonly vegCount: number;
    readonly nonVegCount: number;
    readonly maxBudgetMinor: number;
  };
}

export class SlotExtractor {
  /**
   * Deterministically extracts slots from normalized customer utterance.
   */
  public static extract(utterance: string, catalog: BranchCatalog): ExtractedSlots {
    const normalized = HinglishNormalizer.normalize(utterance);
    const text = normalized.normalizedText;

    // 1. Dietary flags
    const isJain = /\b(?:jain|jaina)\b/i.test(text);
    const isVegOnly = isJain || /\b(?:veg|vegetarian|shakahari)\b/i.test(text);
    const isNonVeg = /\b(?:non\s*veg|chicken|mutton|meat|fish|egg)\b/i.test(text);
    const isGlutenFree = /\b(?:gluten\s*free|no\s*gluten)\b/i.test(text);

    // Allergens
    const excludedAllergens: string[] = [];
    if (/\b(?:no\s*onion|bina\s*pyaaz|without\s*onion)\b/i.test(text)) {
      excludedAllergens.push('onion');
    }
    if (/\b(?:no\s*garlic|bina\s*lehsun|without\s*garlic)\b/i.test(text)) {
      excludedAllergens.push('garlic');
    }
    if (/\b(?:no\s*peanut|nut\s*allergy|peanut\s*allergy)\b/i.test(text)) {
      excludedAllergens.push('peanut');
    }
    if (/\b(?:no\s*dairy|lactose\s*intolerant|dairy\s*free)\b/i.test(text)) {
      excludedAllergens.push('dairy');
    }

    // 2. Quantity
    const quantity = normalized.extractedQuantities.length > 0 ? normalized.extractedQuantities[0]! : 1;

    // 3. Conversational & Query Intent Flags
    const isGreeting = /^(?:hi|hello|hey|namaste|pranam|bhook lagi hai|bhook lagi|kya hai|help)$/i.test(text.trim());
    const isQuestion = /\b(?:calorie|calories|kcal|protein|ingredient|ingredients|samagri|spice level|kitna teekha|teekha hai|allergen|allergens|allergy|safe)\b/i.test(text);
    const isDiscovery = /\b(?:dikhao|batao|options|kya milta hai|menu|list|under|below|sasta|cheap)\b/i.test(text) && !/\b(?:add|order|mangwa do|chahiye|daal do)\b/i.test(text);
    const isPreferenceSave = /\b(?:save preference|remember my preference|meri preference|preference save|hamesha veg)\b/i.test(text);
    const isAddIntent = /\b(?:add|order|mangwa do|chahiye|daal do|lelo|pack kardo|bhejo|1|2|3|4|5)\b/i.test(text) || normalized.isConfirmation;

    // 4. Group Mix detection (e.g. "for 3 people, 2 veg and 1 non veg, under 1500" or "3 logon ke liye, 2 veg 1 non-veg, 1500 ke andar")
    let groupMix: ExtractedSlots['groupMix'];
    const groupMatch = text.match(/(?:for|group of)?\s*(\d+)\s*(?:people|persons|pax|log|logon)/i) || text.match(/(\d+)\s*(?:people|persons|pax|log|logon)/i);
    const budgetMatch = text.match(/(?:under|below|budget|tak|ke\s*andar)\s+(?:inr|rs\.?|₹)?\s*(\d+)/i) || text.match(/(?:inr|rs\.?|₹)?\s*(\d+)\s*(?:ke\s*andar|tak)/i);

    if (groupMatch && budgetMatch) {
      const partySize = parseInt(groupMatch[1]!, 10);
      const budgetRupees = parseInt(budgetMatch[1]!, 10);

      const vegMatch = text.match(/(\d+)\s*veg/i);
      const nonVegMatch = text.match(/(\d+)\s*non\s*veg/i);

      const vegCount = vegMatch ? parseInt(vegMatch[1]!, 10) : partySize;
      const nonVegCount = nonVegMatch ? parseInt(nonVegMatch[1]!, 10) : 0;

      groupMix = {
        partySize,
        vegCount,
        nonVegCount,
        maxBudgetMinor: budgetRupees * 100, // convert to minor units
      };
    }

    // 4. Item match against catalog
    let matchedItem: MenuItem | undefined;
    let highestScore = 0;

    for (const item of catalog.items) {
      if (!item.inStock || !item.active) continue;

      const candidates = [item.name.toLowerCase(), ...(item.aliases || []).map((a) => a.toLowerCase())];
      for (const cand of candidates) {
        if (text.includes(cand)) {
          const score = cand.length;
          if (score > highestScore) {
            highestScore = score;
            matchedItem = item;
          }
        }
      }
    }

    // 5. Variant match (e.g. Medium vs Large)
    let matchedVariant: MenuItemVariant | undefined;
    if (matchedItem && matchedItem.variants && matchedItem.variants.length > 0) {
      for (const v of matchedItem.variants) {
        const vName = v.name.toLowerCase();
        if (text.includes(vName)) {
          matchedVariant = v;
          break;
        }
      }
      // Hindi size terms
      if (!matchedVariant) {
        if (/\b(?:bada|large)\b/i.test(text)) {
          matchedVariant = matchedItem.variants.find((v) => v.name.toLowerCase() === 'large');
        } else if (/\b(?:medium|beech\s*ka)\b/i.test(text)) {
          matchedVariant = matchedItem.variants.find((v) => v.name.toLowerCase() === 'medium');
        } else if (/\b(?:chhota|regular|small)\b/i.test(text)) {
          matchedVariant = matchedItem.variants.find(
            (v) => v.name.toLowerCase() === 'regular' || v.name.toLowerCase() === 'small',
          );
        }
      }
    }

    return {
      matchedItem,
      matchedVariant,
      quantity,
      isJain,
      isVeg: isVegOnly ? true : isNonVeg ? false : undefined,
      isGlutenFree,
      excludedAllergens,
      isGreeting,
      isQuestion,
      isDiscovery,
      isPreferenceSave,
      isAddIntent,
      groupMix,
    };
  }
}
