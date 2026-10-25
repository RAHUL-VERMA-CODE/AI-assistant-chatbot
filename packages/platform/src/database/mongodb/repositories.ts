import { MongoDatabase } from './mongo-store.ts';
import type {
  TenantDocument,
  ApiKeyDocument,
  ConnectorConfigDocument,
  CatalogDocument,
  SessionDocument,
  CartDocument,
  OrderDocument,
  CustomerPreferenceDocument,
  AuditLogDocument,
  UsageEventDocument,
} from './models.ts';

export class MongoRepositories {
  public readonly db: MongoDatabase;

  public readonly tenants;
  public readonly apiKeys;
  public readonly connectors;
  public readonly catalogs;
  public readonly sessions;
  public readonly carts;
  public readonly orders;
  public readonly preferences;
  public readonly auditLogs;
  public readonly usageEvents;

  constructor(db?: MongoDatabase) {
    this.db = db || new MongoDatabase('voice_commerce');

    this.tenants = this.db.collection<TenantDocument>('tenants');
    this.apiKeys = this.db.collection<ApiKeyDocument>('api_keys');
    this.connectors = this.db.collection<ConnectorConfigDocument>('connectors');
    this.catalogs = this.db.collection<CatalogDocument>('catalogs');
    this.sessions = this.db.collection<SessionDocument>('sessions');
    this.carts = this.db.collection<CartDocument>('carts');
    this.orders = this.db.collection<OrderDocument>('orders');
    this.preferences = this.db.collection<CustomerPreferenceDocument>('customer_preferences');
    this.auditLogs = this.db.collection<AuditLogDocument>('audit_logs');
    this.usageEvents = this.db.collection<UsageEventDocument>('usage_events');
  }

  // --- Seed Demo Tenants & Multi-Vertical Branch Catalogs ---
  public async seedDefaults(defaultCatalog?: any): Promise<void> {
    const now = new Date().toISOString();

    // 1. ARPZO (Food)
    const arpzo = await this.tenants.findOne({ tenantId: 'tenant_arpzo' });
    if (!arpzo) {
      await this.tenants.insertOne({
        tenantId: 'tenant_arpzo',
        name: 'ARPZO Demo Restaurant',
        slug: 'arpzo',
        domain: 'arpzo.com',
        vertical: 'food',
        status: 'ACTIVE',
        planTier: 'growth',
        createdAt: now,
        updatedAt: now,
      });

      if (defaultCatalog) {
        await this.catalogs.insertOne({
          tenantId: 'tenant_arpzo',
          branchId: defaultCatalog.branchId,
          branchName: defaultCatalog.branchName,
          currency: defaultCatalog.currency,
          menuVersion: defaultCatalog.menuVersion || 1,
          isOpen: true,
          items: defaultCatalog.items || [],
          updatedAt: now,
        });
      }
    }

    // 2. FreshMart (Grocery)
    const freshmart = await this.tenants.findOne({ tenantId: 'tenant_freshmart' });
    if (!freshmart) {
      await this.tenants.insertOne({
        tenantId: 'tenant_freshmart',
        name: 'FreshMart Daily Supermarket',
        slug: 'freshmart',
        domain: 'freshmart.com',
        vertical: 'grocery',
        status: 'ACTIVE',
        planTier: 'enterprise',
        createdAt: now,
        updatedAt: now,
      });
    }

    // 3. TechVault (Electronics & Retail)
    const techvault = await this.tenants.findOne({ tenantId: 'tenant_techvault' });
    if (!techvault) {
      await this.tenants.insertOne({
        tenantId: 'tenant_techvault',
        name: 'TechVault Retail Electronics',
        slug: 'techvault',
        domain: 'techvault.store',
        vertical: 'retail',
        status: 'ACTIVE',
        planTier: 'growth',
        createdAt: now,
        updatedAt: now,
      });
    }

    // 4. HealthCare Plus (Pharmacy)
    const healthcare = await this.tenants.findOne({ tenantId: 'tenant_healthcare' });
    if (!healthcare) {
      await this.tenants.insertOne({
        tenantId: 'tenant_healthcare',
        name: 'HealthCare Plus Medicos & Wellness',
        slug: 'healthcare',
        domain: 'healthcareplus.in',
        vertical: 'pharmacy',
        status: 'ACTIVE',
        planTier: 'starter',
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

// Global default singleton
export const defaultMongoDb = new MongoDatabase('voice_commerce');
export const mongoRepos = new MongoRepositories(defaultMongoDb);
