import type { IsoCurrencyCode } from '../../../core/src/index.ts';

export interface CartItemChoice {
  readonly itemId: string;
  readonly variantId?: string;
  readonly optionIds: string[];
  readonly quantity: number;
}

export interface ValidatedLineItem {
  readonly itemId: string;
  readonly itemName: string;
  readonly variantId?: string;
  readonly variantName?: string;
  readonly optionIds: string[];
  readonly optionNames: string[];
  readonly quantity: number;
  readonly unitPriceMinor: number;
  readonly totalMinor: number;
  readonly inStock: boolean;
  readonly warnings: string[];
}

export interface CartValidateRequest {
  readonly branchId: string;
  readonly userRef: string;
  readonly items: CartItemChoice[];
}

export interface CartValidateResponse {
  readonly valid: boolean;
  readonly currency: IsoCurrencyCode;
  readonly subtotalMinor: number;
  readonly taxesMinor: number;
  readonly packagingFeeMinor: number;
  readonly deliveryFeeMinor: number;
  readonly totalMinor: number;
  readonly lineItems: ValidatedLineItem[];
  readonly menuVersion: number;
  readonly cartVersion: number;
  readonly warnings: string[];
}

export interface CartCommitRequest {
  readonly branchId: string;
  readonly userRef: string;
  readonly proposalId: string;
  readonly expectedCartVersion: number;
  readonly items: CartItemChoice[];
  readonly idempotencyKey: string;
}

export interface CartCommitResponse {
  readonly success: boolean;
  readonly cartId: string;
  readonly newCartVersion: number;
  readonly totalMinor: number;
  readonly currency: IsoCurrencyCode;
  readonly committedAt: string; // ISO 8601 UTC
}
