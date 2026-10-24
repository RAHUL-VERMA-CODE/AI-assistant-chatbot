import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ApiServer } from '../server.ts';
import { AdminService } from './admin-service.ts';
import { DemoTenantServer } from '../../../../tools/demo-tenant/src/server.ts';

describe('Phase 9: Tenant Administration & Self-Service', () => {
  let demoServer: DemoTenantServer;
  let demoPort: number;
  let apiServer: ApiServer;
  let apiPort: number;
  const adminKey = 'test_master_admin_secret_123';

  before(async () => {
    demoServer = new DemoTenantServer('demo_tenant_shared_secret_32_bytes_long');
    demoPort = await demoServer.start(0);

    apiServer = new ApiServer({
      connectorUrl: `http://localhost:${demoPort}`,
      connectorSecret: 'demo_tenant_shared_secret_32_bytes_long',
      adminKey,
    });
    apiPort = await apiServer.start(0);
  });

  after(async () => {
    await apiServer.stop();
    await demoServer.stop();
  });

  it('rejects unauthenticated admin requests with 401 Unauthorized', async () => {
    const res = await fetch(`http://localhost:${apiPort}/v1/admin/tenants`, {
      method: 'GET',
    });
    assert.equal(res.status, 401);
  });

  it('creates and lists tenants with custom plan tiers and audit logging', async () => {
    // 1. Create a new tenant
    const createRes = await fetch(`http://localhost:${apiPort}/v1/admin/tenants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': adminKey,
      },
      body: JSON.stringify({
        name: 'Curry Express',
        slug: 'curry-express',
        domain: 'curryexpress.in',
        planTier: 'growth',
      }),
    });

    assert.equal(createRes.status, 201);
    const createdTenant = await createRes.json();
    assert.equal(createdTenant.tenantId, 'tenant_curry-express');
    assert.equal(createdTenant.status, 'ACTIVE');
    assert.equal(createdTenant.planTier, 'growth');

    // 2. List tenants
    const listRes = await fetch(`http://localhost:${apiPort}/v1/admin/tenants`, {
      headers: { 'X-Admin-Key': adminKey },
    });
    assert.equal(listRes.status, 200);
    const tenants = await listRes.json();
    assert.ok(tenants.length >= 2); // Seeded ARPZO + Curry Express

    // 3. Update tenant status to SUSPENDED
    const patchRes = await fetch(
      `http://localhost:${apiPort}/v1/admin/tenants/tenant_curry-express`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': adminKey,
        },
        body: JSON.stringify({ status: 'SUSPENDED' }),
      },
    );
    assert.equal(patchRes.status, 200);
    const updated = await patchRes.json();
    assert.equal(updated.status, 'SUSPENDED');
  });

  it('generates, lists, and revokes API keys without persisting raw secret', async () => {
    // 1. Generate API key
    const createKeyRes = await fetch(
      `http://localhost:${apiPort}/v1/admin/tenants/tenant_arpzo/keys`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': adminKey,
        },
        body: JSON.stringify({
          label: 'Mobile App Gateway Key',
          expiresInDays: 30,
        }),
      },
    );

    assert.equal(createKeyRes.status, 201);
    const keyData = await createKeyRes.json();
    assert.ok(keyData.keyId);
    assert.ok(keyData.rawSecret.startsWith('vca_live_'));
    assert.ok(keyData.keyPrefix.startsWith('vca_live_'));

    // Validate key via AdminService
    const adminService = apiServer.getAdminService();
    const valid = adminService.validateApiKey(keyData.rawSecret);
    assert.ok(valid);
    assert.equal(valid.tenantId, 'tenant_arpzo');

    // 2. List API keys (raw secret MUST NOT be present)
    const listKeysRes = await fetch(
      `http://localhost:${apiPort}/v1/admin/tenants/tenant_arpzo/keys`,
      {
        headers: { 'X-Admin-Key': adminKey },
      },
    );
    assert.equal(listKeysRes.status, 200);
    const keys = await listKeysRes.json();
    assert.ok(keys.length >= 1);
    assert.equal(keys[0].rawSecret, undefined);
    assert.equal(keys[0].keyHash, undefined);

    // 3. Revoke API key
    const revokeRes = await fetch(
      `http://localhost:${apiPort}/v1/admin/tenants/tenant_arpzo/keys/${keyData.keyId}`,
      {
        method: 'DELETE',
        headers: { 'X-Admin-Key': adminKey },
      },
    );
    assert.equal(revokeRes.status, 200);

    // Key is no longer valid
    const validAfterRevocation = adminService.validateApiKey(keyData.rawSecret);
    assert.equal(validAfterRevocation, null);
  });

  it('configures tenant connector and verifies connection via ping test', async () => {
    // 1. Configure connector
    const configRes = await fetch(
      `http://localhost:${apiPort}/v1/admin/tenants/tenant_arpzo/connector`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Key': adminKey,
        },
        body: JSON.stringify({
          baseUrl: `http://localhost:${demoPort}`,
          signingSecret: 'demo_tenant_shared_secret_32_bytes_long',
        }),
      },
    );
    assert.equal(configRes.status, 200);

    // 2. Test ping
    const pingRes = await fetch(
      `http://localhost:${apiPort}/v1/admin/tenants/tenant_arpzo/connector/ping`,
      {
        method: 'POST',
        headers: { 'X-Admin-Key': adminKey },
      },
    );
    assert.equal(pingRes.status, 200);
    const pingData = await pingRes.json();
    assert.equal(pingData.success, true);
    assert.ok(typeof pingData.latencyMs === 'number');

    // 3. Inspect audit trail
    const auditRes = await fetch(
      `http://localhost:${apiPort}/v1/admin/tenants/tenant_arpzo/audit-log`,
      {
        headers: { 'X-Admin-Key': adminKey },
      },
    );
    assert.equal(auditRes.status, 200);
    const auditLog = await auditRes.json();
    assert.ok(auditLog.length >= 3);
    assert.ok(auditLog.some((e: any) => e.action === 'CONNECTOR_PING_SUCCESS'));
  });
});
