import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JainValidator } from './jain-validator.ts';
import { ARPZO_KORAMANGALA_CATALOG } from '../../../../tools/demo-tenant/src/seeds/arpzo-menu.ts';
import type { MenuItem } from '../../../../packages/connector-contract/src/index.ts';

describe('JainValidator (Strict Root Veg & Verification Rules)', () => {
  const items = ARPZO_KORAMANGALA_CATALOG.items;

  it('approves restaurant-verified Jain dish with no root vegetables', () => {
    const jainPaneer = items.find((i) => i.id === 'paneer_tikka_jain')!;
    const res = JainValidator.validateItem(jainPaneer);
    assert.equal(res.isJainCompliant, true);
  });

  it('rejects non-vegetarian dishes immediately', () => {
    const chickenBiryani = items.find((i) => i.id === 'chicken_biryani_dum')!;
    const res = JainValidator.validateItem(chickenBiryani);
    assert.equal(res.isJainCompliant, false);
    assert.match(res.reason!, /non-vegetarian/);
  });

  it('rejects vegetarian dishes that contain onion, garlic, or root vegetables', () => {
    const pizza = items.find((i) => i.id === 'pizza_cheese_burst')!;
    const res = JainValidator.validateItem(pizza);
    assert.equal(res.isJainCompliant, false);
    assert.match(res.reason!, /not prepared according to Jain|contains root vegetables/);
  });

  it('rejects dishes where Jain status is UNKNOWN (cannot assume safety)', () => {
    const unverifiedItem: MenuItem = {
      id: 'veg_soup_mystery',
      name: 'Special Green Soup',
      aliases: ['green soup'],
      description: 'Soup',
      category: 'Soups',
      basePriceMinor: 15000,
      inStock: true,
      active: true,
      variants: [],
      optionGroups: [],
      recipe: {
        isVeg: true,
        isJain: 'UNKNOWN',
        containsOnionGarlic: 'UNKNOWN',
        containsRootVegetables: 'UNKNOWN',
        isGlutenFree: 'UNKNOWN',
        allergensPresent: [],
        crossContactRisk: 'UNKNOWN',
        ingredientsList: ['spinach', 'coriander', 'water'],
      },
      nutrition: {
        kcal: 100,
        proteinGrams: 2,
        servingSizeGrams: 200,
        isVerified: true,
      },
    };

    const res = JainValidator.validateItem(unverifiedItem);
    assert.equal(res.isJainCompliant, false);
    assert.match(res.unverifiedReason!, /Restaurant has not verified Jain compliance/);
  });

  it('rejects item when ingredients list root vegetables (potato, carrot, radish)', () => {
    const alooGobi: MenuItem = {
      id: 'aloo_gobi',
      name: 'Aloo Gobi',
      aliases: ['aloo gobhi'],
      description: 'Curry',
      category: 'Mains',
      basePriceMinor: 18000,
      inStock: true,
      active: true,
      variants: [],
      optionGroups: [],
      recipe: {
        isVeg: true,
        isJain: 'TRUE', // False claim on menu
        containsOnionGarlic: 'FALSE',
        containsRootVegetables: 'FALSE',
        isGlutenFree: 'TRUE',
        allergensPresent: [],
        crossContactRisk: 'FALSE',
        ingredientsList: ['cauliflower', 'potato', 'turmeric'], // Potato is root veg
      },
      nutrition: {
        kcal: 200,
        proteinGrams: 4,
        servingSizeGrams: 250,
        isVerified: true,
      },
    };

    // Defense-in-depth catches the root vegetable despite the isJain flag!
    const res = JainValidator.validateItem(alooGobi);
    assert.equal(res.isJainCompliant, false);
    assert.match(res.reason!, /contains root vegetable 'potato'/);
  });
});
