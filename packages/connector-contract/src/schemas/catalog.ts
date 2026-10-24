import type { IsoCurrencyCode } from '../../../core/src/index.ts';

/**
 * Tri-state logic for safety and dietary claims:
 * - 'TRUE': Deterministically verified by restaurant recipe audit.
 * - 'FALSE': Deterministically verified absent.
 * - 'UNKNOWN': Missing or unverified data. CANNOT be treated as safe.
 */
export type TriState = 'TRUE' | 'FALSE' | 'UNKNOWN';

export interface NutritionFacts {
  readonly kcal: number | null;
  readonly proteinGrams: number | null;
  readonly servingSizeGrams: number | null;
  readonly isVerified: boolean;
  readonly source?: string;
}

export interface RecipeFacts {
  readonly isVeg: boolean;
  readonly isJain: TriState;
  readonly jainRuleVersion?: string; // e.g. "jain-v1:excludes-all-root-veg"
  readonly containsOnionGarlic: TriState;
  readonly containsRootVegetables: TriState; // potato, carrot, radish, onion, garlic
  readonly isGlutenFree: TriState;
  readonly allergensPresent: string[]; // e.g. ['dairy', 'nuts', 'soy']
  readonly crossContactRisk: TriState;
  readonly spiceLevel?: 'MILD' | 'MEDIUM' | 'HOT' | 'EXTRA_HOT';
  readonly creaminess?: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly ingredientsList: string[];
}

export interface MenuItemOption {
  readonly id: string;
  readonly name: string;
  readonly priceDeltaMinor: number; // in integer minor units (e.g. 5000 = INR 50.00)
  readonly inStock: boolean;
  readonly modifiesRecipe?: Partial<RecipeFacts>;
}

export interface MenuItemOptionGroup {
  readonly id: string;
  readonly name: string;
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly options: MenuItemOption[];
}

export interface MenuItemVariant {
  readonly id: string;
  readonly name: string; // e.g. "Regular", "Medium", "Large"
  readonly priceMinor: number;
  readonly inStock: boolean;
}

export interface MenuItem {
  readonly id: string;
  readonly name: string;
  readonly aliases: string[]; // Hinglish & colloquial synonyms (e.g. ['paneer pizza', 'cheese burst'])
  readonly description: string;
  readonly category: string;
  readonly basePriceMinor: number;
  readonly inStock: boolean;
  readonly variants: MenuItemVariant[];
  readonly optionGroups: MenuItemOptionGroup[];
  readonly recipe: RecipeFacts;
  readonly nutrition: NutritionFacts;
  readonly active: boolean;
}

export interface BranchCatalog {
  readonly tenantId: string;
  readonly branchId: string;
  readonly branchName: string;
  readonly currency: IsoCurrencyCode;
  readonly menuVersion: number;
  readonly isOpen: boolean;
  readonly timezone: string; // IANA e.g. "Asia/Kolkata"
  readonly items: MenuItem[];
  readonly updatedAt: string; // ISO 8601 UTC
}
