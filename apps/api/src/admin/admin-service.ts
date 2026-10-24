import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SubscriptionTier } from '../../../../packages/platform/src/billing/billing-adapter.ts';
import { ConnectorClient } from '../../../../packages/connector-sdk/src/client.ts';
import { ValidationError, NotFoundError, AppError } from '../../../../packages/core/src/index.ts';

export type TenantStatus = 'ACTIVE' | 'SUSPENDED';

export interface TenantRecord {
  readonly tenantId: string;
  readonly name: string;
  readonly slug: string;
  readonly domain?: string;
  readonly status: TenantStatus;
  readonly planTier: SubscriptionTier;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ApiKeyRecord {
  readonly keyId: string;
  readonly tenantId: string;
  readonly label: string;
  readonly keyPrefix: string;
  readonly keyHash: string;
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly createdAt: string;
  readonly expiresAt?: string;
}

export interface ConnectorConfig {
  readonly tenantId: string;
  readonly baseUrl: string;
  readonly signingSecret: string;
  readonly isVerified: boolean;
  readonly lastPingAt?: string;
  readonly lastPingLatencyMs?: number;
}

export interface AuditLogEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly action: string;
  readonly actor: string;
  readonly details: Record<string, any>;
  readonly timestamp: string;
}

export class AdminService {
  private readonly tenants = new Map<string, TenantRecord>();
  private readonly tenantsBySlug = new Map<string, string>();
  private readonly apiKeys = new Map<string, ApiKeyRecord>();
  private readonly connectors = new Map<string, ConnectorConfig>();
  private readonly auditLogs: AuditLogEntry[] = [];

  constructor() {
    // Seed default ARPZO demo tenant
    this.createTenant({
      name: 'ARPZO Demo Restaurant',
      slug: 'arpzo',
      domain: 'arpzo.com',
      planTier: 'growth',
    });
  }

  // --- Tenants ---

  public createTenant(params: {
    name: string;
    slug: string;
    domain?: string;
    planTier?: SubscriptionTier;
  }): TenantRecord {
    const slug = params.slug.toLowerCase().trim().replace(/[^a-z0-9-]/g, '');
    if (!slug) throw new ValidationError('Invalid tenant slug');
    if (this.tenantsBySlug.has(slug)) {
      throw new ValidationError(`Tenant with slug "${slug}" already exists`);
    }

    const tenantId = `tenant_${slug}`;
    const now = new Date().toISOString();
    const record: TenantRecord = {
      tenantId,
      name: params.name.trim(),
      slug,
      domain: params.domain,
      status: 'ACTIVE',
      planTier: params.planTier || 'starter',
      createdAt: now,
      updatedAt: now,
    };

    this.tenants.set(tenantId, record);
    this.tenantsBySlug.set(slug, tenantId);

    this.recordAudit({
      tenantId,
      action: 'TENANT_CREATED',
      actor: 'admin',
      details: { name: record.name, planTier: record.planTier },
    });

    return record;
  }

  public getTenant(tenantId: string): TenantRecord {
    const tenant = this.tenants.get(tenantId);
    if (!tenant) throw new NotFoundError(`Tenant ${tenantId} not found`);
    return tenant;
  }

  public listTenants(): TenantRecord[] {
    return Array.from(this.tenants.values());
  }

  public updateTenant(
    tenantId: string,
    updates: Partial<Pick<TenantRecord, 'name' | 'status' | 'planTier' | 'domain'>>,
  ): TenantRecord {
    const tenant = this.getTenant(tenantId);
    const updated: TenantRecord = {
      ...tenant,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.tenants.set(tenantId, updated);

    this.recordAudit({
      tenantId,
      action: 'TENANT_UPDATED',
      actor: 'admin',
      details: updates,
    });

    return updated;
  }

  // --- API Keys ---

  public createApiKey(
    tenantId: string,
    params: { label: string; expiresInDays?: number },
  ): { keyId: string; rawSecret: string; keyPrefix: string } {
    this.getTenant(tenantId); // Ensure tenant exists

    const keyId = `key_${randomUUID()}`;
    const secretRandom = randomBytes(24).toString('hex');
    const rawSecret = `vca_live_${secretRandom}`;
    const keyPrefix = rawSecret.slice(0, 13); // e.g. "vca_live_abcd"
    const keyHash = createHash('sha256').update(rawSecret).digest('hex');

    const now = new Date();
    const expiresAt = params.expiresInDays
      ? new Date(now.getTime() + params.expiresInDays * 86400000).toISOString()
      : undefined;

    const record: ApiKeyRecord = {
      keyId,
      tenantId,
      label: params.label || 'Default API Key',
      keyPrefix,
      keyHash,
      status: 'ACTIVE',
      createdAt: now.toISOString(),
      expiresAt,
    };

    this.apiKeys.set(keyId, record);

    this.recordAudit({
      tenantId,
      action: 'API_KEY_CREATED',
      actor: 'admin',
      details: { keyId, keyPrefix, label: record.label },
    });

    // Return the plaintext secret ONLY ONCE
    return { keyId, rawSecret, keyPrefix };
  }

  public listApiKeys(tenantId: string): Omit<ApiKeyRecord, 'keyHash'>[] {
    this.getTenant(tenantId);
    return Array.from(this.apiKeys.values())
      .filter((k) => k.tenantId === tenantId)
      .map(({ keyHash, ...rest }) => rest);
  }

  public revokeApiKey(tenantId: string, keyId: string): void {
    const key = this.apiKeys.get(keyId);
    if (!key || key.tenantId !== tenantId) {
      throw new NotFoundError(`API Key ${keyId} not found for tenant ${tenantId}`);
    }

    const updated: ApiKeyRecord = { ...key, status: 'REVOKED' };
    this.apiKeys.set(keyId, updated);

    this.recordAudit({
      tenantId,
      action: 'API_KEY_REVOKED',
      actor: 'admin',
      details: { keyId, keyPrefix: key.keyPrefix },
    });
  }

  public validateApiKey(rawKey: string): { tenantId: string; keyId: string } | null {
    const hash = createHash('sha256').update(rawKey).digest('hex');
    for (const key of this.apiKeys.values()) {
      if (key.keyHash === hash && key.status === 'ACTIVE') {
        if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
          return null; // Expired
        }
        return { tenantId: key.tenantId, keyId: key.keyId };
      }
    }
    return null;
  }

  // --- Connectors ---

  public configureConnector(
    tenantId: string,
    params: { baseUrl: string; signingSecret: string },
  ): ConnectorConfig {
    this.getTenant(tenantId);

    const config: ConnectorConfig = {
      tenantId,
      baseUrl: params.baseUrl.trim(),
      signingSecret: params.signingSecret.trim(),
      isVerified: false,
    };
    this.connectors.set(tenantId, config);

    this.recordAudit({
      tenantId,
      action: 'CONNECTOR_CONFIGURED',
      actor: 'admin',
      details: { baseUrl: config.baseUrl },
    });

    return config;
  }

  public getConnectorConfig(tenantId: string): Omit<ConnectorConfig, 'signingSecret'> {
    this.getTenant(tenantId);
    const config = this.connectors.get(tenantId);
    if (!config) throw new NotFoundError(`No connector configured for tenant ${tenantId}`);
    const { signingSecret, ...safeConfig } = config;
    return safeConfig;
  }

  public async pingConnector(
    tenantId: string,
    branchId = 'branch_koramangala',
  ): Promise<{
    success: boolean;
    latencyMs: number;
    error?: string;
  }> {
    const config = this.connectors.get(tenantId);
    if (!config) throw new NotFoundError(`No connector configured for tenant ${tenantId}`);

    const client = new ConnectorClient({
      baseUrl: config.baseUrl,
      signingSecret: config.signingSecret,
      allowLocalhostForTesting: true,
    });

    const start = Date.now();
    try {
      // Test fetching catalog for branch
      await client.getCatalog(branchId);
      const latencyMs = Date.now() - start;

      const verifiedConfig: ConnectorConfig = {
        ...config,
        isVerified: true,
        lastPingAt: new Date().toISOString(),
        lastPingLatencyMs: latencyMs,
      };
      this.connectors.set(tenantId, verifiedConfig);

      this.recordAudit({
        tenantId,
        action: 'CONNECTOR_PING_SUCCESS',
        actor: 'admin',
        details: { latencyMs, branchId },
      });

      return { success: true, latencyMs };
    } catch (err: any) {
      const latencyMs = Date.now() - start;
      return { success: false, latencyMs, error: err.message };
    }
  }

  // --- Audit Log ---

  public getAuditLog(tenantId: string): AuditLogEntry[] {
    this.getTenant(tenantId);
    return this.auditLogs.filter((l) => l.tenantId === tenantId);
  }

  private recordAudit(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): void {
    this.auditLogs.push({
      ...entry,
      id: `aud_${randomUUID()}`,
      timestamp: new Date().toISOString(),
    });
  }
}
