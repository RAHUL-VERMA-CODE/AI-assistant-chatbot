/**
 * Database Document Schemas for Voice Commerce Assistant
 * Fully typed MongoDB collection documents.
 */

export interface TenantDocument {
  tenantId: string;
  name: string;
  slug: string;
  domain: string;
  vertical: 'food' | 'grocery' | 'retail' | 'pharmacy' | 'custom';
  status: 'ACTIVE' | 'SUSPENDED' | 'PROVISIONING';
  planTier: 'starter' | 'growth' | 'enterprise';
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface ApiKeyDocument {
  keyId: string;
  tenantId: string;
  hashedSecret: string;
  label: string;
  status: 'ACTIVE' | 'REVOKED';
  expiresAt: string | null;
  createdAt: string;
}

export interface ConnectorConfigDocument {
  tenantId: string;
  baseUrl: string;
  encryptedSigningSecret: string;
  concurrencyLimit: number;
  timeoutMs: number;
  circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  updatedAt: string;
}

export interface CatalogDocument {
  tenantId: string;
  branchId: string;
  branchName: string;
  currency: string;
  menuVersion: number;
  isOpen: boolean;
  items: unknown[];
  updatedAt: string;
}

export interface SessionDocument {
  sessionId: string;
  tenantId: string;
  userRef: string;
  branchId: string;
  createdAt: string;
  lastActiveAt: string;
  turnsCount: number;
  conversationSummary?: string;
}

export interface CartDocument {
  cartId: string;
  tenantId: string;
  branchId: string;
  userRef: string;
  cartVersion: number;
  items: unknown[];
  totalMinor: number;
  currency: string;
  updatedAt: string;
}

export interface OrderDocument {
  orderId: string;
  tenantId: string;
  branchId: string;
  userRef: string;
  items: unknown[];
  totalMinor: number;
  currency: string;
  status: 'PROPOSED' | 'CONFIRMED' | 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
}

export interface CustomerPreferenceDocument {
  tenantId: string;
  userRef: string;
  preferences: {
    isVeg?: boolean;
    isJain?: boolean;
    isGlutenFree?: boolean;
    excludedAllergens?: string[];
    favoriteCategory?: string;
    consented: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogDocument {
  tenantId: string;
  userRef?: string;
  action: string;
  resource: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export interface UsageEventDocument {
  eventId: string;
  tenantId: string;
  sessionId: string;
  turnType: 'voice' | 'text';
  sttDurationSec?: number;
  llmTokens?: { prompt: number; completion: number; total: number };
  ttsChars?: number;
  timestamp: string;
}
