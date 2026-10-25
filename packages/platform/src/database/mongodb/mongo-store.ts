import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BaseMongoDocument } from './models.ts';

export type MongoFilter<T> = {
  [K in keyof T]?: any;
} & {
  $and?: MongoFilter<T>[];
  $or?: MongoFilter<T>[];
  $nor?: MongoFilter<T>[];
  [key: string]: any;
};

export type MongoUpdate<T> = {
  $set?: Partial<T> & Record<string, any>;
  $unset?: Record<string, true | 1>;
  $inc?: Record<string, number>;
  $push?: Record<string, any>;
  $pull?: Record<string, any>;
  [key: string]: any;
};

export interface FindOptions {
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
}

export class MongoCollection<T extends BaseMongoDocument> {
  public readonly name: string;
  private documents: T[] = [];
  private readonly storageFilePath?: string;

  constructor(name: string, storageDir?: string) {
    this.name = name;
    if (storageDir) {
      this.storageFilePath = path.join(storageDir, `${name}.json`);
      this.loadFromDisk();
    }
  }

  public async insertOne(doc: T): Promise<{ insertedId: string; acknowledged: boolean }> {
    const insertedId = doc._id || `id_${randomUUID().replace(/-/g, '')}`;
    const now = new Date().toISOString();
    const newDoc = {
      ...doc,
      _id: insertedId,
      createdAt: doc.createdAt || now,
      updatedAt: now,
    };
    this.documents.push(newDoc as T);
    this.saveToDisk();
    return { insertedId, acknowledged: true };
  }

  public async insertMany(docs: T[]): Promise<{ insertedCount: number; insertedIds: string[] }> {
    const insertedIds: string[] = [];
    for (const doc of docs) {
      const res = await this.insertOne(doc);
      insertedIds.push(res.insertedId);
    }
    return { insertedCount: docs.length, insertedIds };
  }

  public async findOne(filter: MongoFilter<T> = {}): Promise<T | null> {
    const match = this.documents.find((doc) => this.matchesFilter(doc, filter));
    return match ? JSON.parse(JSON.stringify(match)) : null;
  }

  public async find(filter: MongoFilter<T> = {}, options?: FindOptions): Promise<T[]> {
    let results = this.documents.filter((doc) => this.matchesFilter(doc, filter));

    if (options?.sort) {
      const sortKeys = Object.keys(options.sort);
      results = results.sort((a, b) => {
        for (const key of sortKeys) {
          const dir = options.sort![key] || 1;
          const aVal = (a as any)[key];
          const bVal = (b as any)[key];
          if (aVal < bVal) return -1 * dir;
          if (aVal > bVal) return 1 * dir;
        }
        return 0;
      });
    }

    if (options?.skip) {
      results = results.slice(options.skip);
    }
    if (options?.limit) {
      results = results.slice(0, options.limit);
    }

    return JSON.parse(JSON.stringify(results));
  }

  public async updateOne(
    filter: MongoFilter<T>,
    update: MongoUpdate<T>,
    options?: { upsert?: boolean },
  ): Promise<{ matchedCount: number; modifiedCount: number; upsertedId?: string }> {
    const index = this.documents.findIndex((doc) => this.matchesFilter(doc, filter));

    if (index === -1) {
      if (options?.upsert) {
        const newDoc = { ...(update.$set || {}) } as T;
        const res = await this.insertOne(newDoc);
        return { matchedCount: 0, modifiedCount: 1, upsertedId: res.insertedId };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }

    const current = this.documents[index]!;
    this.applyUpdate(current, update);
    current.updatedAt = new Date().toISOString();
    this.saveToDisk();

    return { matchedCount: 1, modifiedCount: 1 };
  }

  public async updateMany(
    filter: MongoFilter<T>,
    update: MongoUpdate<T>,
  ): Promise<{ matchedCount: number; modifiedCount: number }> {
    let modifiedCount = 0;
    const now = new Date().toISOString();

    for (const doc of this.documents) {
      if (this.matchesFilter(doc, filter)) {
        this.applyUpdate(doc, update);
        doc.updatedAt = now;
        modifiedCount += 1;
      }
    }

    if (modifiedCount > 0) {
      this.saveToDisk();
    }
    return { matchedCount: modifiedCount, modifiedCount };
  }

  public async deleteOne(filter: MongoFilter<T>): Promise<{ deletedCount: number }> {
    const index = this.documents.findIndex((doc) => this.matchesFilter(doc, filter));
    if (index !== -1) {
      this.documents.splice(index, 1);
      this.saveToDisk();
      return { deletedCount: 1 };
    }
    return { deletedCount: 0 };
  }

  public async deleteMany(filter: MongoFilter<T>): Promise<{ deletedCount: number }> {
    const initialCount = this.documents.length;
    this.documents = this.documents.filter((doc) => !this.matchesFilter(doc, filter));
    const deletedCount = initialCount - this.documents.length;
    if (deletedCount > 0) {
      this.saveToDisk();
    }
    return { deletedCount };
  }

  public async countDocuments(filter: MongoFilter<T> = {}): Promise<number> {
    return this.documents.filter((doc) => this.matchesFilter(doc, filter)).length;
  }

  private matchesFilter(doc: any, filter: MongoFilter<T>): boolean {
    for (const key of Object.keys(filter)) {
      if (key === '$and') {
        const andList = filter.$and!;
        if (!andList.every((sub) => this.matchesFilter(doc, sub))) return false;
        continue;
      }
      if (key === '$or') {
        const orList = filter.$or!;
        if (!orList.some((sub) => this.matchesFilter(doc, sub))) return false;
        continue;
      }
      if (key === '$nor') {
        const norList = filter.$nor!;
        if (norList.some((sub) => this.matchesFilter(doc, sub))) return false;
        continue;
      }

      const expected = filter[key];
      const actual = doc[key];

      if (typeof expected === 'object' && expected !== null && !(expected instanceof RegExp)) {
        // Query operators: $eq, $ne, $in, $nin, $gt, $gte, $lt, $lte, $regex, $exists
        for (const op of Object.keys(expected)) {
          const val = expected[op];
          switch (op) {
            case '$eq':
              if (actual !== val) return false;
              break;
            case '$ne':
              if (actual === val) return false;
              break;
            case '$in':
              if (!Array.isArray(val)) return false;
              if (Array.isArray(actual)) {
                if (!actual.some((a) => val.includes(a))) return false;
              } else {
                if (!val.includes(actual)) return false;
              }
              break;
            case '$nin':
              if (!Array.isArray(val)) return false;
              if (Array.isArray(actual)) {
                if (actual.some((a) => val.includes(a))) return false;
              } else {
                if (val.includes(actual)) return false;
              }
              break;
            case '$gt':
              if (!(actual > val)) return false;
              break;
            case '$gte':
              if (!(actual >= val)) return false;
              break;
            case '$lt':
              if (!(actual < val)) return false;
              break;
            case '$lte':
              if (!(actual <= val)) return false;
              break;
            case '$exists':
              if ((actual !== undefined) !== val) return false;
              break;
            case '$regex': {
              const flags = expected.$options || '';
              const re = new RegExp(val, flags);
              if (!re.test(String(actual || ''))) return false;
              break;
            }
          }
        }
      } else if (expected instanceof RegExp) {
        if (!expected.test(String(actual || ''))) return false;
      } else {
        if (actual !== expected) return false;
      }
    }

    return true;
  }

  private applyUpdate(doc: any, update: MongoUpdate<T>): void {
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) {
        doc[k] = v;
      }
    }
    if (update.$unset) {
      for (const k of Object.keys(update.$unset)) {
        delete doc[k];
      }
    }
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) {
        doc[k] = (doc[k] || 0) + (v as number);
      }
    }
    if (update.$push) {
      for (const [k, v] of Object.entries(update.$push)) {
        if (!Array.isArray(doc[k])) doc[k] = [];
        doc[k].push(v);
      }
    }
    if (update.$pull) {
      for (const [k, v] of Object.entries(update.$pull)) {
        if (Array.isArray(doc[k])) {
          doc[k] = doc[k].filter((item: any) => item !== v);
        }
      }
    }
  }

  private loadFromDisk(): void {
    if (!this.storageFilePath || !fs.existsSync(this.storageFilePath)) return;
    try {
      const data = fs.readFileSync(this.storageFilePath, 'utf8');
      this.documents = JSON.parse(data);
    } catch {
      this.documents = [];
    }
  }

  private saveToDisk(): void {
    if (!this.storageFilePath) return;
    try {
      const dir = path.dirname(this.storageFilePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.storageFilePath, JSON.stringify(this.documents, null, 2), 'utf8');
    } catch {
      // Ignore disk write errors in ephemeral environments
    }
  }
}

export class MongoDatabase {
  public readonly databaseName: string;
  private readonly storageDir?: string;
  private readonly collections = new Map<string, MongoCollection<any>>();

  constructor(databaseName = 'voice_commerce', storageDir?: string) {
    this.databaseName = databaseName;
    this.storageDir = storageDir;
  }

  public collection<T extends BaseMongoDocument>(name: string): MongoCollection<T> {
    let col = this.collections.get(name);
    if (!col) {
      col = new MongoCollection<T>(name, this.storageDir);
      this.collections.set(name, col);
    }
    return col as MongoCollection<T>;
  }

  public async dropDatabase(): Promise<void> {
    for (const col of this.collections.values()) {
      await col.deleteMany({});
    }
    this.collections.clear();
  }
}
