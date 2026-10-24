import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DemoTenantServer } from '../../../tools/demo-tenant/src/server.ts';
import { ConnectorClient } from './client.ts';

describe('ConnectorClient Integration against ARPZO Demo Tenant', () => {
  let server: DemoTenantServer;
  let client: ConnectorClient;
  let serverPort: number;

  before(async () => {
    server = new DemoTenantServer('arpzo_test_secret_hmac_256');
    serverPort = await server.start(0); // Random free port
    client = new ConnectorClient({
      baseUrl: `http://localhost:${serverPort}`,
      signingSecret: 'arpzo_test_secret_hmac_256',
      allowLocalhostForTesting: true,
    });
  });

  after(async () => {
    await server.stop();
  });

  it('fetches authoritative branch catalog with verified tri-state facts', async () => {
    const catalog = await client.getCatalog('branch_koramangala');
    assert.equal(catalog.branchId, 'branch_koramangala');
    assert.equal(catalog.currency, 'INR');
    assert.equal(catalog.menuVersion, 42);
    assert.ok(catalog.items.length >= 5);

    const cheesePizza = catalog.items.find((i) => i.id === 'pizza_cheese_burst');
    assert.ok(cheesePizza);
    assert.equal(cheesePizza.recipe.isJain, 'FALSE');

    const jainTikka = catalog.items.find((i) => i.id === 'paneer_tikka_jain');
    assert.ok(jainTikka);
    assert.equal(jainTikka.recipe.isJain, 'TRUE');
    assert.equal(jainTikka.recipe.containsRootVegetables, 'FALSE');

    // Unknown cross contact risk test (Req A04)
    const salad = catalog.items.find((i) => i.id === 'quinoa_avocado_salad');
    assert.ok(salad);
    assert.equal(salad.recipe.crossContactRisk, 'UNKNOWN');
  });

  it('validates proposed line items and computes authoritative charges', async () => {
    const val = await client.validateCart({
      branchId: 'branch_koramangala',
      userRef: 'usr_cust_01',
      items: [
        {
          itemId: 'pizza_cheese_burst',
          variantId: 'medium',
          optionIds: ['extra_cheese'],
          quantity: 1,
        },
      ],
    });

    assert.equal(val.valid, true);
    assert.equal(val.currency, 'INR');
    // Unit price = 39900 (medium) + 5000 (extra cheese) = 44900
    assert.equal(val.subtotalMinor, 44900);
    // Taxes (5%) = 2245, Packaging = 2500, Delivery = 4000
    // Total = 44900 + 2245 + 2500 + 4000 = 53645
    assert.equal(val.totalMinor, 53645);
    assert.equal(val.lineItems[0]!.variantName, 'Medium');
    assert.deepEqual(val.lineItems[0]!.optionNames, ['Extra Cheese']);
  });

  it('commits cart atomically and updates cart version', async () => {
    const commit = await client.commitCart({
      branchId: 'branch_koramangala',
      userRef: 'usr_cust_01',
      proposalId: 'prop_test_99',
      expectedCartVersion: 1,
      items: [{ itemId: 'paneer_tikka_jain', quantity: 1, optionIds: [] }],
      idempotencyKey: 'ik_cart_commit_01',
    });

    assert.equal(commit.success, true);
    assert.equal(commit.newCartVersion, 2);
    assert.ok(commit.totalMinor > 0);
  });

  it('rejects stale cart version commits with 409 Conflict', async () => {
    // Current cart version is now 2. Expected 1 must trigger 409!
    await assert.rejects(
      async () =>
        client.commitCart({
          branchId: 'branch_koramangala',
          userRef: 'usr_cust_01',
          proposalId: 'prop_test_stale',
          expectedCartVersion: 1,
          items: [{ itemId: 'paneer_tikka_jain', quantity: 1, optionIds: [] }],
          idempotencyKey: 'ik_cart_stale_99',
        }),
      /Stale cart version/,
    );
  });

  it('loads past completed order for re-ordering', async () => {
    const pastOrder = await client.getLatestOrder('usr_cust_01', 'branch_koramangala');
    assert.ok(pastOrder);
    assert.equal(pastOrder.orderId, 'ord_arpzo_completed_88');
    assert.equal(pastOrder.items.length, 2);
    assert.equal(pastOrder.items[0]!.itemId, 'pizza_cheese_burst');
  });

  it('fetches live order tracking status and enforces ownership check', async () => {
    // Valid owner
    const status = await client.getOrderStatus('ord_live_77', 'usr_cust_01');
    assert.equal(status.orderId, 'ord_live_77');
    assert.equal(status.status, 'OUT_FOR_DELIVERY');
    assert.equal(status.etaMinutes, 10);
    assert.equal(status.eligibleContactActions[0]!.type, 'CHAT_SUPPORT');

    // Forbidden owner (Req A14)
    await assert.rejects(
      async () => client.getOrderStatus('ord_live_77', 'usr_attacker_99'),
      /order belongs to another customer/,
    );
  });
});
