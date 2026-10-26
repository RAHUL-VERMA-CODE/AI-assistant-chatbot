import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARPZO_KORAMANGALA_CATALOG } from '../tools/demo-tenant/src/seeds/arpzo-menu.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');

export class MongoCollection {
  constructor(collectionName) {
    this.name = collectionName;
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    this.filePath = path.join(DATA_DIR, `${collectionName}.json`);
    this.documents = [];
    this.saveTimeout = null;
    this.loadFromDisk();
  }

  loadFromDisk() {
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

  persist() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      try {
        fs.writeFileSync(this.filePath, JSON.stringify(this.documents, null, 2), 'utf8');
      } catch (err) {
        console.error(`[MongoCollection:${this.name}] Write error:`, err);
      }
    }, 50);
  }

  matchesFilter(doc, filter) {
    for (const [key, expected] of Object.entries(filter)) {
      if (key.startsWith('$')) continue;

      let actual;
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
          if (op === '$gt' && !(actual > val)) return false;
          if (op === '$gte' && !(actual >= val)) return false;
          if (op === '$lt' && !(actual < val)) return false;
          if (op === '$lte' && !(actual <= val)) return false;
          if (op === '$in') {
            if (Array.isArray(actual)) {
              if (!actual.some((a) => val.includes(a))) return false;
            } else if (!val.includes(actual)) {
              return false;
            }
          }
          if (op === '$nin' && val.includes(actual)) return false;
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

  async insertOne(doc) {
    const cloned = JSON.parse(JSON.stringify(doc));
    this.documents.push(cloned);
    this.persist();
    return cloned;
  }

  async insertMany(docs) {
    const cloned = JSON.parse(JSON.stringify(docs));
    this.documents.push(...cloned);
    this.persist();
    return cloned;
  }

  async find(filter = {}) {
    return this.documents.filter((doc) => this.matchesFilter(doc, filter)).map((d) => JSON.parse(JSON.stringify(d)));
  }

  async findOne(filter) {
    const found = this.documents.find((doc) => this.matchesFilter(doc, filter));
    return found ? JSON.parse(JSON.stringify(found)) : null;
  }

  async updateOne(filter, update, options = {}) {
    const idx = this.documents.findIndex((doc) => this.matchesFilter(doc, filter));
    if (idx === -1) {
      if (options.upsert) {
        const newDoc = { ...filter, ...(update.$set || {}) };
        await this.insertOne(newDoc);
        return { matchedCount: 0, modifiedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }

    const doc = this.documents[idx];
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) {
        if (k.includes('.')) {
          const parts = k.split('.');
          let cur = doc;
          for (let i = 0; i < parts.length - 1; i++) {
            cur[parts[i]] = cur[parts[i]] || {};
            cur = cur[parts[i]];
          }
          cur[parts[parts.length - 1]] = v;
        } else {
          doc[k] = v;
        }
      }
    }
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) {
        doc[k] = (doc[k] || 0) + v;
      }
    }
    this.persist();
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async deleteOne(filter) {
    const idx = this.documents.findIndex((doc) => this.matchesFilter(doc, filter));
    if (idx !== -1) {
      this.documents.splice(idx, 1);
      this.persist();
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  }

  async deleteMany(filter) {
    const initial = this.documents.length;
    this.documents = this.documents.filter((doc) => !this.matchesFilter(doc, filter));
    const deletedCount = initial - this.documents.length;
    if (deletedCount > 0) this.persist();
    return { deletedCount };
  }

  async countDocuments(filter = {}) {
    return (await this.find(filter)).length;
  }
}

export class DatabaseClient {
  constructor() {
    this.tenants = new MongoCollection('tenants');
    this.apiKeys = new MongoCollection('api_keys');
    this.connectors = new MongoCollection('connectors');
    this.catalogs = new MongoCollection('catalogs');
    this.sessions = new MongoCollection('sessions');
    this.carts = new MongoCollection('carts');
    this.orders = new MongoCollection('orders');
    this.preferences = new MongoCollection('customer_preferences');
    this.auditLogs = new MongoCollection('audit_logs');
    this.usageEvents = new MongoCollection('usage_events');
  }

  async getStats() {
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

  async seedDefaults() {
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

    const catExisting = await this.catalogs.findOne({ branchId: 'branch_koramangala' });
    if (!catExisting) {
      await this.catalogs.insertOne({
        tenantId: ARPZO_KORAMANGALA_CATALOG.tenantId,
        branchId: ARPZO_KORAMANGALA_CATALOG.branchId,
        branchName: ARPZO_KORAMANGALA_CATALOG.branchName,
        version: ARPZO_KORAMANGALA_CATALOG.menuVersion,
        currency: ARPZO_KORAMANGALA_CATALOG.currency,
        items: ARPZO_KORAMANGALA_CATALOG.items,
        updatedAt: now,
      });
    }
  }
}

export const db = new DatabaseClient();
