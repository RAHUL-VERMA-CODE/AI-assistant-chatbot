import type {
  BranchCatalog,
  CartItemChoice,
  PastOrder,
  OrderStatusResponse,
} from '../../../packages/connector-contract/src/index.ts';
import { ARPZO_KORAMANGALA_CATALOG } from './seeds/arpzo-menu.ts';
import {
  FRESHMART_GROCERY_CATALOG,
  TECHVAULT_RETAIL_CATALOG,
  HEALTHCARE_PHARMACY_CATALOG,
} from './seeds/multi-vertical-catalogs.ts';

export interface StoredCart {
  readonly cartId: string;
  readonly cartVersion: number;
  readonly items: CartItemChoice[];
  readonly totalMinor: number;
}

export class DemoTenantDatabase {
  private readonly catalogs = new Map<string, BranchCatalog>();
  private readonly carts = new Map<string, StoredCart>();
  private readonly pastOrders = new Map<string, PastOrder[]>();
  private readonly activeOrders = new Map<string, OrderStatusResponse>();

  constructor() {
    this.seed();
  }

  private seed(): void {
    // 1. Seed Branch Catalogs (Multi-Vertical: Food, Grocery, Retail/Electronics, Pharmacy)
    this.catalogs.set(ARPZO_KORAMANGALA_CATALOG.branchId, ARPZO_KORAMANGALA_CATALOG);
    this.catalogs.set(FRESHMART_GROCERY_CATALOG.branchId, FRESHMART_GROCERY_CATALOG);
    this.catalogs.set(TECHVAULT_RETAIL_CATALOG.branchId, TECHVAULT_RETAIL_CATALOG);
    this.catalogs.set(HEALTHCARE_PHARMACY_CATALOG.branchId, HEALTHCARE_PHARMACY_CATALOG);

    // 2. Seed Past Completed Order for customer 'usr_cust_01' (Cheese burst pizza medium + Dal)
    const samplePastOrder: PastOrder = {
      orderId: 'ord_arpzo_completed_88',
      branchId: 'branch_koramangala',
      currency: 'INR',
      orderedAt: new Date(Date.now() - 86400000 * 2).toISOString(), // 2 days ago
      totalPaidMinor: 65900, // INR 659.00
      items: [
        {
          itemId: 'pizza_cheese_burst',
          itemName: 'Cheese Burst Pizza',
          variantId: 'medium',
          variantName: 'Medium',
          optionIds: ['extra_cheese'],
          quantity: 1,
          paidUnitPriceMinor: 44900,
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
    this.pastOrders.set('usr_cust_01', [samplePastOrder]);

    // 3. Seed Active Order for live tracking ('ord_live_77')
    const activeOrder: OrderStatusResponse = {
      orderId: 'ord_live_77',
      userRef: 'usr_cust_01',
      status: 'OUT_FOR_DELIVERY',
      branchName: 'ARPZO Kitchen - Koramangala',
      itemsSummary: '1x Cheese Burst Pizza (Medium), 1x Jain Paneer Tikka',
      totalMinor: 81900,
      currency: 'INR',
      updatedAt: new Date(Date.now() - 300000).toISOString(), // 5 mins ago
      estimatedDeliveryAt: new Date(Date.now() + 600000).toISOString(), // in 10 mins
      etaMinutes: 10,
      isStale: false,
      eligibleContactActions: [
        {
          type: 'CHAT_SUPPORT',
          label: 'Chat with Rider Support',
          actionPayload: { channelId: 'chat_rider_77', tenantContext: 'arpzo_prod' },
        },
      ],
    };
    this.activeOrders.set('ord_live_77', activeOrder);
  }

  public getCatalog(branchId: string): BranchCatalog | undefined {
    return this.catalogs.get(branchId);
  }

  public getCart(userRef: string): StoredCart {
    return (
      this.carts.get(userRef) || {
        cartId: `cart_${userRef}`,
        cartVersion: 1,
        items: [],
        totalMinor: 0,
      }
    );
  }

  public setCart(userRef: string, cart: StoredCart): void {
    this.carts.set(userRef, cart);
  }

  public getLatestPastOrder(userRef: string, branchId?: string): PastOrder | undefined {
    const orders = this.pastOrders.get(userRef) || [];
    if (branchId) {
      return orders.filter((o) => o.branchId === branchId).pop();
    }
    return orders[orders.length - 1];
  }

  public getActiveOrder(orderId: string): OrderStatusResponse | undefined {
    return this.activeOrders.get(orderId);
  }
}
