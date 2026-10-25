import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MongoDatabase } from './mongo-store.ts';
import { MongoRepositories } from './repositories.ts';

describe('MongoDB Storage & Generic Repository Layer', () => {
  it('supports MongoDB queries with operators ($eq, $in, $regex) and updates ($set, $inc)', async () => {
    const db = new MongoDatabase('test_db');
    const items = db.collection<any>('products');

    await items.insertOne({
      id: 'prod_1',
      name: 'Wireless Bluetooth Headphones',
      price: 2999,
      tags: ['electronics', 'audio'],
      inStock: true,
    });

    await items.insertOne({
      id: 'prod_2',
      name: 'Organic Basmati Rice 5kg',
      price: 650,
      tags: ['grocery', 'organic'],
      inStock: true,
    });

    // 1. Exact match
    const p1 = await items.findOne({ id: 'prod_1' });
    assert.ok(p1);
    assert.equal(p1.name, 'Wireless Bluetooth Headphones');

    // 2. $in operator
    const multi = await items.find({ tags: { $in: ['electronics'] } });
    assert.equal(multi.length, 1);
    assert.equal(multi[0].id, 'prod_1');

    // 3. $regex operator (case-insensitive search)
    const regexMatch = await items.find({ name: { $regex: 'basmati', $options: 'i' } });
    assert.equal(regexMatch.length, 1);
    assert.equal(regexMatch[0].id, 'prod_2');

    // 4. Update with $set and $inc
    await items.updateOne({ id: 'prod_1' }, { $set: { price: 3499 }, $inc: { views: 1 } });
    const updated = await items.findOne({ id: 'prod_1' });
    assert.equal(updated.price, 3499);
    assert.equal(updated.views, 1);

    // 5. Delete
    const delRes = await items.deleteOne({ id: 'prod_2' });
    assert.equal(delRes.deletedCount, 1);
    assert.equal(await items.countDocuments(), 1);
  });

  it('manages multi-tenant onboarding, preferences, and orders via MongoRepositories', async () => {
    const repos = new MongoRepositories();

    // 1. Tenant creation
    await repos.tenants.insertOne({
      tenantId: 'tenant_freshmart',
      name: 'FreshMart Grocery',
      slug: 'freshmart',
      vertical: 'grocery',
      status: 'ACTIVE',
      planTier: 'growth',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const tenant = await repos.tenants.findOne({ slug: 'freshmart' });
    assert.ok(tenant);
    assert.equal(tenant.name, 'FreshMart Grocery');
    assert.equal(tenant.vertical, 'grocery');

    // 2. Customer Preferences (Right to Erasure)
    await repos.preferences.insertOne({
      tenantId: 'tenant_freshmart',
      userRef: 'usr_rahul',
      isVeg: true,
      consented: true,
      updatedAt: new Date().toISOString(),
    });

    const pref = await repos.preferences.findOne({ tenantId: 'tenant_freshmart', userRef: 'usr_rahul' });
    assert.ok(pref);
    assert.equal(pref.isVeg, true);

    await repos.preferences.deleteOne({ tenantId: 'tenant_freshmart', userRef: 'usr_rahul' });
    const erased = await repos.preferences.findOne({ tenantId: 'tenant_freshmart', userRef: 'usr_rahul' });
    assert.equal(erased, null);
  });
});
