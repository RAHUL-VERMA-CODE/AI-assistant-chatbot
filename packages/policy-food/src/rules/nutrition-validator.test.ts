import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NutritionValidator } from './nutrition-validator.ts';
import { ARPZO_KORAMANGALA_CATALOG } from '../../../../tools/demo-tenant/src/seeds/arpzo-menu.ts';
import type { MenuItem } from '../../../../packages/connector-contract/src/index.ts';

describe('NutritionValidator (Zero Hallucination & Verified Thresholds)', () => {
  const items = ARPZO_KORAMANGALA_CATALOG.items;

  it('approves dish meeting high-protein threshold using verified published data', () => {
    const paneer = items.find((i) => i.id === 'paneer_tikka_jain')!; // 26g protein
    const res = NutritionValidator.validateProtein(paneer, 20);
    assert.equal(res.satisfiesConstraint, true);
    assert.equal(res.publishedProteinGrams, 26);
  });

  it('rejects dish below requested protein threshold', () => {
    const quinoa = items.find((i) => i.id === 'quinoa_avocado_salad')!; // 9g protein
    const res = NutritionValidator.validateProtein(quinoa, 20);
    assert.equal(res.satisfiesConstraint, false);
    assert.match(res.reason!, /below the requested 20g threshold/);
  });

  it('rejects dish with unavailable nutrition data and states limitation', () => {
    const khichdi = items.find((i) => i.id === 'homestyle_khichdi')!; // null protein

    const res = NutritionValidator.validateProtein(khichdi, 15);
    assert.equal(res.satisfiesConstraint, false);
    assert.equal(res.isDataUnavailable, true);
    assert.match(res.reason!, /protein data is unavailable/);
  });

  it('enforces calorie ceilings from verified menu data', () => {
    const dal = items.find((i) => i.id === 'high_protein_dal_tadka')!; // 320 kcal
    const under500 = NutritionValidator.validateMaxCalories(dal, 500);
    assert.equal(under500.satisfiesConstraint, true);

    const under300 = NutritionValidator.validateMaxCalories(dal, 300);
    assert.equal(under300.satisfiesConstraint, false);
    assert.match(under300.reason!, /exceeding the maximum limit of 300 kcal/);
  });
});
