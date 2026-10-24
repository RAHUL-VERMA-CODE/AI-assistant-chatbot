import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ReorderMapper } from './reorder-mapper.ts';
import { ARPZO_KORAMANGALA_CATALOG } from '../../../../tools/demo-tenant/src/seeds/arpzo-menu.ts';
import type { PastOrder } from '../../../../packages/connector-contract/src/index.ts';

describe('ReorderMapper (Live Price Diff & Availability Verification)', () => {
  it('maps completed past order, identifies price changes, and creates summary', () => {
    const pastOrder: PastOrder = {
      orderId: 'ord_sample_past_1',
      branchId: 'branch_koramangala',
      currency: 'INR',
      orderedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      totalPaidMinor: 60900,
      items: [
        {
          itemId: 'pizza_cheese_burst',
          itemName: 'Cheese Burst Pizza',
          variantId: 'medium',
          variantName: 'Medium',
          optionIds: ['extra_cheese'],
          quantity: 1,
          paidUnitPriceMinor: 40000, // Old price was 400, live is 399 + 50 = 44900
        },
        {
          itemId: 'homestyle_khichdi',
          itemName: 'Homestyle Moong Khichdi',
          optionIds: [],
          quantity: 1,
          paidUnitPriceMinor: 20900, // Old price was 209, live is 21000
        },
      ],
    };

    const mapped = ReorderMapper.mapToCurrentCatalog(pastOrder, ARPZO_KORAMANGALA_CATALOG);

    assert.equal(mapped.isFullyAvailable, true);
    assert.equal(mapped.availableChoices.length, 2);
    assert.equal(mapped.priceChanges.length, 2);

    // Pizza changed price
    const pizzaChange = mapped.priceChanges.find((p) => p.itemId === 'pizza_cheese_burst')!;
    assert.equal(pizzaChange.oldPaidPriceMinor, 40000);
    assert.equal(pizzaChange.currentPriceMinor, 44900); // 399 base medium + 50 cheese

    assert.match(mapped.summaryMessage, /Price update: Cheese Burst Pizza is now INR 449.00/);
    assert.match(mapped.summaryMessage, /Add to your cart\?/);
  });

  it('identifies discontinued or out-of-stock items gracefully', () => {
    const pastOrder: PastOrder = {
      orderId: 'ord_sample_past_2',
      branchId: 'branch_koramangala',
      currency: 'INR',
      orderedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
      totalPaidMinor: 45000,
      items: [
        {
          itemId: 'discontinued_mango_shake',
          itemName: 'Seasonal Mango Shake',
          optionIds: [],
          quantity: 1,
          paidUnitPriceMinor: 15000,
        },
        {
          itemId: 'homestyle_khichdi',
          itemName: 'Homestyle Moong Khichdi',
          optionIds: [],
          quantity: 1,
          paidUnitPriceMinor: 21000,
        },
      ],
    };

    const mapped = ReorderMapper.mapToCurrentCatalog(pastOrder, ARPZO_KORAMANGALA_CATALOG);

    assert.equal(mapped.isFullyAvailable, false);
    assert.equal(mapped.availableChoices.length, 1);
    assert.equal(mapped.unavailableItems.length, 1);
    assert.equal(mapped.unavailableItems[0]!.reason, 'DISCONTINUED');
    assert.match(mapped.summaryMessage, /Seasonal Mango Shake cannot be added/);
  });
});
