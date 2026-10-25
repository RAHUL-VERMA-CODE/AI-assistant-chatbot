import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');

export type FilterQuery<T> = {
  [P in keyof T]?: T[P] | {
    $eq?: T[P];
    $ne?: T[P];
    $in?: Array<any>;
    $nin?: Array<any>;
    $gt?: number | string;
    $gte?: number | string;
    $lt?: number | string;
    $lte?: number | string;
    $regex?: string | RegExp;
    $exists?: boolean;
  };
} & Record<string, any>;

export type UpdateQuery<T> = {
  $set?: Partial<T> & Record<string, any>;
  $unset?: Record<string, any>;
  $inc?: Record<string, number>;
  $push?: Record<string, any>;
  $pull?: Record<string, any>;
};

export class MongoCollection<T extends Record<string, any>> {
  public readonly name: string;
  private readonly filePath: string;
  private documents: T[] = [];
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor(collectionName: string) {
    this.name = collectionName;
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    this.filePath = path.join(DATA_DIR, `${collectionName}.json`);
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.documents = JSON.parse(raw);
      } catch (e) {
        this.documents = [];
      }
    } else {
      this.documents = [];
    }
  }

  private persist(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      try {
        fs.writeFileSync(this.filePath, JSON.stringify(this.documents, null, 2), 'utf8');
      } catch (err) {
        console.error(`[MongoCollection:${this.name}] Write error:`, err);
      }
    }, 50);
  }

  private matchesFilter(doc: T, filter: FilterQuery<T>): boolean {
    for (const [key, expected] of Object.entries(filter)) {
      if (key.startsWith('$')) continue;

      let actual: any;
      if (key.includes('.')) {
        const parts = key.split('.');
        actual = doc;
        for (const p of parts) {
          actual = actual?.[p];
        }
      } else {
        actual = doc[key];
      }

      if (expected !== null && typeof expected === 'object' && !Array.isArray(expected) && !(expected instanceof RegExp)) {
        for (const [op, val] of Object.entries(expected)) {
          if (op === '$eq' && actual !== val) return false;
          if (op === '$ne' && actual === val) return false;
          if (op === '$gt' && !(actual > (val as any))) return false;
          if (op === '$gte' && !(actual >= (val as any))) return false;
          if (op === '$lt' && !(actual < (val as any))) return false;
          if (op === '$lte' && !(actual <= (val as any))) return false;
          if (op === '$in') {
            const arr = val as any[];
            if (Array.isArray(actual)) {
              if (!actual.some((a) => arr.includes(a))) return false;
            } else if (!arr.includes(actual)) {
              return false;
            }
          }
          if (op === '$nin' && (val as any[]).includes(actual)) return false;
          if (op === '$exists') {
            const exists = actual !== undefined;
            if (exists !== val) return false;
          }
          if (op === '$regex') {
            const re = val instanceof RegExp ? val : new RegExp(String(val), 'i');
            if (typeof actual !== 'string' || !re.test(actual)) return false;
          }
        }
      } else {
        if (actual !== expected) return false;
      }
    }
    return true;
  }

  public async insertOne(doc: T): Promise<T> {
    const cloned = JSON.parse(JSON.stringify(doc));
    this.documents.push(cloned);
    this.persist();
    return cloned;
  }

  public async insertMany(docs: T[]): Promise<T[]> {
    const cloned = JSON.parse(JSON.stringify(docs));
    this.documents.push(...cloned);
    this.persist();
    return cloned;
  }

  public async find(filter: FilterQuery<T> = {}): Promise<T[]> {
    return this.documents.filter((doc) => this.matchesFilter(doc, filter)).map((d) => JSON.parse(JSON.stringify(d)));
  }

  public async findOne(filter: FilterQuery<T>): Promise<T | null> {
    const found = this.documents.find((doc) => this.matchesFilter(doc, filter));
    return found ? JSON.parse(JSON.stringify(found)) : null;
  }

  public async updateOne(
    filter: FilterQuery<T>,
    update: UpdateQuery<T>,
    options: { upsert?: boolean } = {}
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    const idx = this.documents.findIndex((doc) => this.matchesFilter(doc, filter));
    if (idx === -1) {
      if (options.upsert) {
        const newDoc = { ...(filter as any), ...(update.$set || {}) };
        await this.insertOne(newDoc);
        return { matchedCount: 0, modifiedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }

    const doc = this.documents[idx]!;
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) {
        if (k.includes('.')) {
          const parts = k.split('.');
          let cur: any = doc;
          for (let i = 0; i < parts.length - 1; i++) {
            cur[parts[i]!] = cur[parts[i]!] || {};
            cur = cur[parts[i]!];
          }
          cur[parts[parts.length - 1]!] = v;
        } else {
          (doc as any)[k] = v;
        }
      }
    }
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) {
        (doc as any)[k] = ((doc as any)[k] || 0) + v;
      }
    }
    this.persist();
    return { matchedCount: 1, modifiedCount: 1 };
  }

  public async deleteOne(filter: FilterQuery<T>): Promise<{ deletedCount: number }> {
    const idx = this.documents.findIndex((doc) => this.matchesFilter(doc, filter));
    if (idx !== -1) {
      this.documents.splice(idx, 1);
      this.persist();
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  }

  public async deleteMany(filter: FilterQuery<T>): Promise<{ deletedCount: number }> {
    const initial = this.documents.length;
    this.documents = this.documents.filter((doc) => !this.matchesFilter(doc, filter));
    const deletedCount = initial - this.documents.length;
    if (deletedCount > 0) this.persist();
    return { deletedCount };
  }

  public async countDocuments(filter: FilterQuery<T> = {}): Promise<number> {
    return (await this.find(filter)).length;
  }
}

export class DatabaseClient {
  public readonly tenants = new MongoCollection<TenantDocument>('tenants');
  public readonly apiKeys = new MongoCollection<ApiKeyDocument>('api_keys');
  public readonly connectors = new MongoCollection<ConnectorConfigDocument>('connectors');
  public readonly catalogs = new MongoCollection<CatalogDocument>('catalogs');
  public readonly sessions = new MongoCollection<SessionDocument>('sessions');
  public readonly carts = new MongoCollection<CartDocument>('carts');
  public readonly orders = new MongoCollection<OrderDocument>('orders');
  public readonly preferences = new MongoCollection<CustomerPreferenceDocument>('customer_preferences');
  public readonly auditLogs = new MongoCollection<AuditLogDocument>('audit_logs');
  public readonly usageEvents = new MongoCollection<UsageEventDocument>('usage_events');

  public async getStats(): Promise<Record<string, number>> {
    return {
      tenants: await this.tenants.countDocuments(),
      apiKeys: await this.apiKeys.countDocuments(),
      connectors: await this.connectors.countDocuments(),
      catalogs: await this.catalogs.countDocuments(),
      sessions: await this.sessions.countDocuments(),
      carts: await this.carts.countDocuments(),
      orders: await this.orders.countDocuments(),
      customerPreferences: await this.preferences.countDocuments(),
      auditLogs: await this.auditLogs.countDocuments(),
      usageEvents: await this.usageEvents.countDocuments(),
    };
  }

  public async seedDefaults(): Promise<void> {
    const now = new Date().toISOString();
    const existing = await this.tenants.findOne({ tenantId: 'tenant_arpzo' });
    if (!existing) {
      await this.tenants.insertMany([
        {
          tenantId: 'tenant_arpzo',
          name: 'ARPZO Kitchen & Diner',
          slug: 'arpzo',
          domain: 'arpzo.com',
          vertical: 'food',
          status: 'ACTIVE',
          planTier: 'growth',
          createdAt: now,
          updatedAt: now,
        },
        {
          tenantId: 'tenant_freshmart',
          name: 'FreshMart Daily Supermarket',
          slug: 'freshmart',
          domain: 'freshmart.com',
          vertical: 'grocery',
          status: 'ACTIVE',
          planTier: 'enterprise',
          createdAt: now,
          updatedAt: now,
        },
        {
          tenantId: 'tenant_techvault',
          name: 'TechVault Retail Electronics',
          slug: 'techvault',
          domain: 'techvault.store',
          vertical: 'retail',
          status: 'ACTIVE',
          planTier: 'growth',
          createdAt: now,
          updatedAt: now,
        },
        {
          tenantId: 'tenant_healthcare',
          name: 'HealthCare Plus Medicos',
          slug: 'healthcare',
          domain: 'healthcareplus.in',
          vertical: 'pharmacy',
          status: 'ACTIVE',
          planTier: 'starter',
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }
  }
}

export const db = new DatabaseClient();
