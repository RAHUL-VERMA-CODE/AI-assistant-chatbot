import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DemoTenantServer } from '../../../tools/demo-tenant/src/server.ts';
import { ApiServer } from './server.ts';

describe('ApiServer REST Endpoints Integration', () => {
  let demoTenant: DemoTenantServer;
  let apiServer: ApiServer;
  let apiBaseUrl: string;
  const connectorSecret = 'sec_api_tenant_test_key_phase5';
  let sessionToken: string;

  before(async () => {
    // Start Demo Tenant
    demoTenant = new DemoTenantServer(connectorSecret);
    const tenantPort = await demoTenant.start(0);

    // Start API Gateway
    apiServer = new ApiServer({
      connectorUrl: `http://localhost:${tenantPort}`,
      connectorSecret,
      jwtSecret: 'super_secret_jwt_key_phase5_longer_than_32_chars',
    });
    const apiPort = await apiServer.start(0);
    apiBaseUrl = `http://localhost:${apiPort}`;
  });

  after(async () => {
    await apiServer.stop();
    await demoTenant.stop();
  });

  it('GET /health returns 200 OK', async () => {
    const res = await fetch(`${apiBaseUrl}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.status, 'ok');
  });

  it('GET /v1/db/status returns connected MongoDB status and collections', async () => {
    const res = await fetch(`${apiBaseUrl}/v1/db/status`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.status, 'connected');
    assert.equal(body.engine, 'MongoDB');
    assert.equal(body.database, 'voice_commerce');
    assert.ok(typeof body.collections.tenants === 'number');
    assert.ok(typeof body.collections.sessions === 'number');
  });

  it('POST /v1/assistant/sessions creates session token', async () => {
    const res = await fetch(`${apiBaseUrl}/v1/assistant/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId: 'tenant_arpzo',
        userRef: 'usr_cust_01',
        branchId: 'branch_koramangala',
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.ok(body.sessionId);
    assert.ok(body.token);
    sessionToken = body.token;
  });

  it('POST /v1/assistant/turns processes voice utterance and returns proposal', async () => {
    const res = await fetch(`${apiBaseUrl}/v1/assistant/turns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        utterance: 'Ek Jain Paneer Tikka add kar do',
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.sessionState, 'PROPOSAL_PREVIEW');
    assert.ok(body.proposalId);
    assert.match(body.replyText, /Jain Paneer Tikka/);
  });

  it('PATCH, GET, DELETE /v1/me/preferences manages customer dietary preferences (Req A06)', async () => {
    // 1. Opt-in and set preference
    const patchRes = await fetch(`${apiBaseUrl}/v1/me/preferences`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        isJain: true,
        isVeg: true,
        excludedAllergens: ['peanut'],
      }),
    });
    assert.equal(patchRes.status, 200);
    const patchBody = (await patchRes.json()) as any;
    assert.equal(patchBody.isJain, true);
    assert.equal(patchBody.consented, true);

    // 2. Read preference
    const getRes = await fetch(`${apiBaseUrl}/v1/me/preferences`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    assert.equal(getRes.status, 200);
    const getBody = (await getRes.json()) as any;
    assert.equal(getBody.isJain, true);

    // 3. Delete preference (Right to erasure)
    const delRes = await fetch(`${apiBaseUrl}/v1/me/preferences`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    assert.equal(delRes.status, 200);
  });

  it('GET /v1/orders/:id/status fetches verified live order status (Req A08)', async () => {
    const res = await fetch(`${apiBaseUrl}/v1/orders/ord_live_77/status`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.orderId, 'ord_live_77');
    assert.equal(body.status, 'OUT_FOR_DELIVERY');
    assert.equal(body.etaMinutes, 10);
    assert.match(body.formattedSummary, /out for delivery/);
  });

  it('POST /v1/cart/confirm updates database and returns line items and charges', async () => {
    // 1. Create a proposal
    const turnRes = await fetch(`${apiBaseUrl}/v1/assistant/turns`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        utterance: 'Ek Jain Paneer Tikka add karo',
      }),
    });
    const turnBody = (await turnRes.json()) as any;
    assert.ok(turnBody.proposalId);

    // 2. Confirm proposal
    const confirmRes = await fetch(`${apiBaseUrl}/v1/cart/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ proposalId: turnBody.proposalId }),
    });
    assert.equal(confirmRes.status, 200);
    const confirmBody = (await confirmRes.json()) as any;
    assert.equal(confirmBody.success, true);
    assert.ok(confirmBody.items && confirmBody.items.length > 0);
    assert.match(confirmBody.items[0].itemName, /Jain Paneer Tikka/);
    assert.ok(confirmBody.charges);

    // 3. GET /v1/cart returns updated active cart
    const cartRes = await fetch(`${apiBaseUrl}/v1/cart`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    assert.equal(cartRes.status, 200);
    const cartBody = (await cartRes.json()) as any;
    assert.ok(cartBody.items && cartBody.items.length > 0);

    // 4. GET /v1/me/orders returns confirmed order
    const ordersRes = await fetch(`${apiBaseUrl}/v1/me/orders`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    assert.equal(ordersRes.status, 200);
    const ordersBody = (await ordersRes.json()) as any;
    assert.ok(ordersBody.length > 0);
    assert.equal(ordersBody[ordersBody.length - 1].status, 'CONFIRMED');
  });

  it('handles restaurant AI chat, cart, orders, and admin live status updates via /api/*', async () => {
    // 1. GET /api/menu
    const menuRes = await fetch(`${apiBaseUrl}/api/menu`);
    assert.equal(menuRes.status, 200);
    const menuData = (await menuRes.json()) as any;
    assert.ok(menuData.count >= 20);
    assert.ok(menuData.dishes.length > 0);

    // 2. POST /api/chat (Bhook lagi hai query)
    const chatRes = await fetch(`${apiBaseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'int_test_ses_01', message: 'Bhook lagi hai kya milega?' }),
    });
    assert.equal(chatRes.status, 200);
    const chatData = (await chatRes.json()) as any;
    assert.ok(chatData.text);
    assert.ok(chatData.quickReplies.length > 0);

    // 3. POST /api/cart/add
    const addRes = await fetch(`${apiBaseUrl}/api/cart/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'int_test_ses_01', dishId: 'main_01', quantity: 2 }),
    });
    assert.equal(addRes.status, 200);
    const cartData = (await addRes.json()) as any;
    assert.equal(cartData.cart.items.length, 1);
    assert.equal(cartData.cart.items[0].dishId, 'main_01');

    // 4. POST /api/orders (Place order)
    const orderRes = await fetch(`${apiBaseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'int_test_ses_01',
        customerName: 'Karan Mehra',
        phone: '9988776655',
        orderType: 'delivery',
        deliveryAddress: 'Indiranagar 12th Main',
        paymentMethod: 'UPI',
      }),
    });
    assert.equal(orderRes.status, 201);
    const orderData = (await orderRes.json()) as any;
    assert.ok(orderData.order.id.startsWith('ORD-'));
    assert.equal(orderData.order.status, 'Placed');

    // 5. PATCH /api/orders/:id/status (Admin updates status to Preparing)
    const updateRes = await fetch(`${apiBaseUrl}/api/orders/${orderData.order.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Preparing', note: 'Chef fired tandoor' }),
    });
    assert.equal(updateRes.status, 200);
    const updateData = (await updateRes.json()) as any;
    assert.equal(updateData.order.status, 'Preparing');

    // 6. GET /api/admin/analytics
    const statsRes = await fetch(`${apiBaseUrl}/api/admin/analytics`);
    assert.equal(statsRes.status, 200);
    const statsData = (await statsRes.json()) as any;
    assert.ok(statsData.totalOrders > 0);
  });
});
