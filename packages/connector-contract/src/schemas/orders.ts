import type { IsoCurrencyCode } from '../../../core/src/index.ts';
import type { CartItemChoice } from './cart.ts';

export type OrderLifecycleStatus =
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED';

export interface PastOrderLineItem {
  readonly itemId: string;
  readonly itemName: string;
  readonly variantId?: string;
  readonly variantName?: string;
  readonly optionIds: string[];
  readonly quantity: number;
  readonly paidUnitPriceMinor: number;
}

export interface PastOrder {
  readonly orderId: string;
  readonly branchId: string;
  readonly items: PastOrderLineItem[];
  readonly totalPaidMinor: number;
  readonly currency: IsoCurrencyCode;
  readonly orderedAt: string; // ISO 8601 UTC
}

export interface ReorderMappingResult {
  readonly canReorderFully: boolean;
  readonly liveItems: CartItemChoice[];
  readonly missingItemNames: string[];
  readonly priceChanges: Array<{
    readonly itemName: string;
    readonly oldPriceMinor: number;
    readonly newPriceMinor: number;
  }>;
}

export interface EligibleContactAction {
  readonly type: 'CALL_RESTAURANT' | 'CHAT_SUPPORT';
  readonly label: string;
  readonly actionPayload: Record<string, unknown>; // Opaque payload passed to tenant app
}

export interface OrderStatusResponse {
  readonly orderId: string;
  readonly userRef: string;
  readonly status: OrderLifecycleStatus;
  readonly branchName: string;
  readonly itemsSummary: string;
  readonly totalMinor: number;
  readonly currency: IsoCurrencyCode;
  readonly updatedAt: string; // ISO 8601 UTC
  readonly estimatedDeliveryAt?: string; // ISO 8601 UTC
  readonly etaMinutes?: number;
  readonly isStale: boolean; // Flagged true if no update for > 15 mins while active
  readonly eligibleContactActions: EligibleContactAction[];
}
