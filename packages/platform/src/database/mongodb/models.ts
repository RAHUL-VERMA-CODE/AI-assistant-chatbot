import type { SubscriptionTier } from '../../billing/billing-adapter.ts';

export interface BaseMongoDocument {
  _id?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TenantDocument extends BaseMongoDocument {
  tenantId: string;
  name: string;
  slug: string;
  domain?: string;
  vertical: 'food' | 'grocery' | 'retail' | 'general';
  status: 'ACTIVE' | 'SUSPENDED';
  planTier: SubscriptionTier;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyDocument extends BaseMongoDocument {
  keyId: string;
  tenantId: string;
  label: string;
  keyPrefix: string;
  keyHash: string;
  status: 'ACTIVE' | 'REVOKED';
  createdAt: string;
  expiresAt?: string;
}

export interface ConnectorConfigDocument extends BaseMongoDocument {
  tenantId: string;
  baseUrl: string;
  signingSecret: string;
  isVerified: boolean;
  lastPingAt?: string;
  lastPingLatencyMs?: number;
}

export interface CatalogItemDocument {
  id: string;
  name: string;
  category: string;
  description?: string;
  basePriceMinor: number;
  inStock: boolean;
  active: boolean;
  attributes?: Record<string, unknown>;
  variants?: Array<{ id: string; name: string; priceMinor: number; inStock: boolean }>;
  recipe?: {
    isVeg?: boolean | 'UNKNOWN';
    isJain?: 'TRUE' | 'FALSE' | 'UNKNOWN';
    isGlutenFree?: 'TRUE' | 'FALSE' | 'UNKNOWN';
    allergensPresent?: string[];
    crossContactRisk?: 'NONE' | 'LOW' | 'HIGH' | 'UNKNOWN';
    ingredientsList?: string[];
    spiceLevel?: string;
    creaminess?: string;
  };
  nutrition?: {
    kcal?: number | null;
    proteinGrams?: number | null;
    servingSizeGrams?: number;
    isVerified?: boolean;
    source?: string;
  };
}

export interface CatalogDocument extends BaseMongoDocument {
  tenantId: string;
  branchId: string;
  branchName: string;
  currency: string;
  menuVersion: number;
  isOpen: boolean;
  items: CatalogItemDocument[];
  updatedAt: string;
}

export interface SessionDocument extends BaseMongoDocument {
  sessionId: string;
  tenantId: string;
  userRef: string;
  branchId: string;
  cartId: string;
  cartVersion: number;
  state: string;
  turns: Array<{
    turnId: string;
    role: 'user' | 'assistant';
    text: string;
    timestampIso: string;
  }>;
  activeProposal?: {
    proposalId: string;
    cartVersion: number;
    totalMinor: number;
    currency: string;
    expiresAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CartDocument extends BaseMongoDocument {
  cartId: string;
  tenantId: string;
  userRef: string;
  branchId: string;
  cartVersion: number;
  items: Array<{
    itemId: string;
    itemName: string;
    variantId?: string;
    optionIds?: string[];
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
  }>;
  totalMinor: number;
  currency: string;
  updatedAt: string;
}

export interface OrderDocument extends BaseMongoDocument {
  orderId: string;
  tenantId: string;
  userRef: string;
  branchId: string;
  branchName: string;
  currency: string;
  items: Array<{
    itemId: string;
    itemName: string;
    quantity: number;
    priceMinor: number;
  }>;
  totalPaidMinor: number;
  status: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';
  orderedAt: string;
  updatedAt: string;
  etaMinutes?: number;
}

export interface CustomerPreferenceDocument extends BaseMongoDocument {
  tenantId: string;
  userRef: string;
  isJain?: boolean;
  isVeg?: boolean;
  isGlutenFree?: boolean;
  excludedAllergens?: string[];
  consented: boolean;
  updatedAt: string;
}

export interface UsageEventDocument extends BaseMongoDocument {
  eventId: string;
  tenantId: string;
  sessionId: string;
  type: string;
  quantity: number;
  unit: string;
  costMinor: number;
  timestampIso: string;
}

export interface AuditLogDocument extends BaseMongoDocument {
  id: string;
  tenantId: string;
  action: string;
  actor: string;
  details: Record<string, unknown>;
  timestamp: string;
}
