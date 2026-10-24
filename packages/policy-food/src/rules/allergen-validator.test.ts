import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AllergenValidator } from './allergen-validator.ts';
import { ARPZO_KORAMANGALA_CATALOG } from '../../../../tools/demo-tenant/src/seeds/arpzo-menu.ts';
import type { MenuItem } from '../../../../packages/connector-contract/src/index.ts';

describe('AllergenValidator (Strict Cross-Contact & Unknown Defense)', () => {
  const items = ARPZO_KORAMANGALA_CATALOG.items;

  it('rejects dish with declared target allergen', () => {
    const paneer = items.find((i) => i.id === 'paneer_tikka_jain')!; // Contains Dairy
    const res = AllergenValidator.validate(paneer, ['dairy']);
    assert.equal(res.isSafe, false);
    assert.match(res.reason!, /contains declared allergen: 'dairy'/);
  });

  it('approves dish that is free from specified allergens with low cross-contact risk', () => {
    const khichdi = items.find((i) => i.id === 'homestyle_khichdi')!;
    const res = AllergenValidator.validate(khichdi, ['peanut', 'soy', 'shellfish']);
    assert.equal(res.isSafe, true);
  });

  it('rejects gluten when gluten-free requested on wheat-containing dish', () => {
    const pizza = items.find((i) => i.id === 'pizza_cheese_burst')!;
    const res = AllergenValidator.validate(pizza, [], true);
    assert.equal(res.isSafe, false);
    assert.match(res.reason!, /contains gluten/);
  });

  it('rejects gluten-free claim when gluten status is UNKNOWN', () => {
    const unknownItem: MenuItem = {
      id: 'corn_snack',
      name: 'Roasted Corn',
      aliases: ['corn'],
      description: 'Corn',
      category: 'Snacks',
      basePriceMinor: 10000,
      inStock: true,
      active: true,
      variants: [],
      optionGroups: [],
      recipe: {
        isVeg: true,
        isJain: 'TRUE',
        containsOnionGarlic: 'FALSE',
        containsRootVegetables: 'FALSE',
        isGlutenFree: 'UNKNOWN',
        allergensPresent: [],
        crossContactRisk: 'UNKNOWN',
        ingredientsList: ['corn', 'salt'],
      },
      nutrition: {
        kcal: 120,
        proteinGrams: 3,
        servingSizeGrams: 100,
        isVerified: true,
      },
    };

    const res = AllergenValidator.validate(unknownItem, [], true);
    assert.equal(res.isSafe, false);
    assert.equal(res.supportActionAvailable, true);
    assert.match(res.unverifiedLimitation!, /Gluten-free certification is unknown/);
  });

  it('rejects gluten-free claim if cross-contact risk is HIGH despite gluten-free ingredients', () => {
    const crossContactItem: MenuItem = {
      id: 'rice_fry',
      name: 'Steamed Basmati Rice',
      aliases: ['rice'],
      description: 'Rice',
      category: 'Mains',
      basePriceMinor: 12000,
      inStock: true,
      active: true,
      variants: [],
      optionGroups: [],
      recipe: {
        isVeg: true,
        isJain: 'TRUE',
        containsOnionGarlic: 'FALSE',
        containsRootVegetables: 'FALSE',
        isGlutenFree: 'TRUE',
        allergensPresent: [],
        crossContactRisk: 'HIGH', // Shared fryer/cookware
        ingredientsList: ['rice', 'water'],
      },
      nutrition: {
        kcal: 200,
        proteinGrams: 4,
        servingSizeGrams: 150,
        isVerified: true,
      },
    };

    const res = AllergenValidator.validate(crossContactItem, [], true);
    assert.equal(res.isSafe, false);
    assert.equal(res.supportActionAvailable, true);
    assert.match(res.unverifiedLimitation!, /kitchen has unverified or high cross-contact risk/);
  });
});
