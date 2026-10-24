import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PairingRecommender } from './pairing-recommender.ts';
import { ARPZO_KORAMANGALA_CATALOG } from '../../../../tools/demo-tenant/src/seeds/arpzo-menu.ts';

describe('PairingRecommender (Optional Add-On Suggestions)', () => {
  it('recommends at most 1 relevant in-stock beverage/side matching cart diet', () => {
    const currentCart = [{ itemId: 'pizza_cheese_burst', quantity: 1, optionIds: [] }];

    const suggestion = PairingRecommender.recommendPairing(
      ARPZO_KORAMANGALA_CATALOG,
      currentCart,
      { isVegOnly: true },
    );

    assert.ok(suggestion);
    assert.equal(suggestion.item.recipe.isVeg, true);
    assert.match(suggestion.suggestionPrompt, /Would you like to add a .* for INR/);
  });

  it('respects Jain restrictions when recommending add-ons', () => {
    const currentCart = [{ itemId: 'paneer_tikka_jain', quantity: 1, optionIds: [] }];

    const suggestion = PairingRecommender.recommendPairing(
      ARPZO_KORAMANGALA_CATALOG,
      currentCart,
      { isJainOnly: true },
    );

    assert.ok(suggestion);
    assert.equal(suggestion.item.recipe?.isJain, 'TRUE');
  });

  it('returns null if cart is empty', () => {
    const suggestion = PairingRecommender.recommendPairing(ARPZO_KORAMANGALA_CATALOG, []);
    assert.equal(suggestion, null);
  });
});
