import type {
  BranchCatalog,
  PastOrder,
  LineItemChoice,
} from '../../../connector-contract/src/index.ts';

export interface ReorderPriceChange {
  readonly itemId: string;
  readonly itemName: string;
  readonly oldPaidPriceMinor: number;
  readonly currentPriceMinor: number;
  readonly diffMinor: number;
}

export interface UnavailableReorderItem {
  readonly itemId: string;
  readonly itemName: string;
  readonly reason: 'OUT_OF_STOCK' | 'DISCONTINUED' | 'VARIANT_UNAVAILABLE' | 'OPTION_UNAVAILABLE';
}

export interface ReorderMappingResult {
  readonly originalOrderId: string;
  readonly isFullyAvailable: boolean;
  readonly availableChoices: readonly LineItemChoice[];
  readonly unavailableItems: readonly UnavailableReorderItem[];
  readonly priceChanges: readonly ReorderPriceChange[];
  readonly estimatedSubtotalMinor: number;
  readonly currency: string;
  readonly summaryMessage: string;
}

export class ReorderMapper {
  /**
   * Maps past order history against live branch catalog.
   * Never silently reuses old cart or outdated prices.
   */
  public static mapToCurrentCatalog(
    pastOrder: PastOrder,
    currentCatalog: BranchCatalog,
  ): ReorderMappingResult {
    const availableChoices: LineItemChoice[] = [];
    const unavailableItems: UnavailableReorderItem[] = [];
    const priceChanges: ReorderPriceChange[] = [];
    let estimatedSubtotalMinor = 0;

    for (const pastItem of pastOrder.items) {
      const liveItem = currentCatalog.items.find((i) => i.id === pastItem.itemId);

      if (!liveItem || !liveItem.active) {
        unavailableItems.push({
          itemId: pastItem.itemId,
          itemName: pastItem.itemName,
          reason: 'DISCONTINUED',
        });
        continue;
      }

      if (!liveItem.inStock) {
        unavailableItems.push({
          itemId: pastItem.itemId,
          itemName: pastItem.itemName,
          reason: 'OUT_OF_STOCK',
        });
        continue;
      }

      // Check variant if applicable
      let currentItemPrice = liveItem.basePriceMinor;
      if (pastItem.variantId) {
        const liveVariant = liveItem.variants.find((v) => v.id === pastItem.variantId);
        if (!liveVariant || !liveVariant.inStock) {
          unavailableItems.push({
            itemId: pastItem.itemId,
            itemName: `${pastItem.itemName} (${pastItem.variantName || pastItem.variantId})`,
            reason: 'VARIANT_UNAVAILABLE',
          });
          continue;
        }
        currentItemPrice = liveVariant.priceMinor;
      }

      // Check options
      const validOptions: string[] = [];
      let optionsValid = true;

      for (const optId of pastItem.optionIds) {
        let optionFound = false;
        for (const group of liveItem.optionGroups || []) {
          const opt = group.options.find((o) => o.id === optId);
          if (opt && opt.inStock) {
            optionFound = true;
            validOptions.push(opt.id);
            currentItemPrice += opt.priceDeltaMinor;
            break;
          }
        }
        if (!optionFound) {
          optionsValid = false;
          unavailableItems.push({
            itemId: pastItem.itemId,
            itemName: `${pastItem.itemName} (Customization '${optId}' no longer available)`,
            reason: 'OPTION_UNAVAILABLE',
          });
          break;
        }
      }

      if (!optionsValid) {
        continue;
      }

      // Check for price changes
      const currentUnitTotal = currentItemPrice;
      const oldUnitTotal = pastItem.paidUnitPriceMinor;
      if (currentUnitTotal !== oldUnitTotal) {
        priceChanges.push({
          itemId: pastItem.itemId,
          itemName: pastItem.itemName,
          oldPaidPriceMinor: oldUnitTotal,
          currentPriceMinor: currentUnitTotal,
          diffMinor: currentUnitTotal - oldUnitTotal,
        });
      }

      estimatedSubtotalMinor += currentUnitTotal * pastItem.quantity;
      availableChoices.push({
        itemId: pastItem.itemId,
        variantId: pastItem.variantId,
        optionIds: validOptions,
        quantity: pastItem.quantity,
      });
    }

    // Build human-readable summary
    const parts: string[] = [];
    if (availableChoices.length === 0) {
      parts.push('None of the items from your past order are currently available at this branch.');
    } else {
      parts.push(`Loaded ${availableChoices.length} item(s) from your past order.`);

      if (unavailableItems.length > 0) {
        const unavailableNames = unavailableItems.map((u) => u.itemName).join(', ');
        parts.push(
          `Note: ${unavailableNames} cannot be added (${unavailableItems[0]?.reason.toLowerCase().replace(/_/g, ' ')}).`,
        );
      }

      if (priceChanges.length > 0) {
        for (const change of priceChanges) {
          const oldFormatted = `${currentCatalog.currency} ${(change.oldPaidPriceMinor / 100).toFixed(2)}`;
          const newFormatted = `${currentCatalog.currency} ${(change.currentPriceMinor / 100).toFixed(2)}`;
          parts.push(
            `Price update: ${change.itemName} is now ${newFormatted} (was ${oldFormatted}).`,
          );
        }
      }

      parts.push(
        `Total for available items: ${currentCatalog.currency} ${(estimatedSubtotalMinor / 100).toFixed(2)}. Add to your cart?`,
      );
    }

    return {
      originalOrderId: pastOrder.orderId,
      isFullyAvailable: unavailableItems.length === 0 && availableChoices.length > 0,
      availableChoices,
      unavailableItems,
      priceChanges,
      estimatedSubtotalMinor,
      currency: currentCatalog.currency,
      summaryMessage: parts.join(' '),
    };
  }
}
