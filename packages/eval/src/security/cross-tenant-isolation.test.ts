import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TenantContext } from '../../../core/src/context/tenant-context.ts';
import { asTenantId } from '../../../core/src/index.ts';

describe('Security Acceptance: Strict Cross-Tenant Isolation', () => {
  it('enforces isolated execution boundaries across concurrent tenant calls', async () => {
    let capturedTenantA: string | undefined;
    let capturedTenantB: string | undefined;

    const taskA = TenantContext.run(
      { tenantId: asTenantId('tenant_arpzo') },
      async () => {
        await new Promise((r) => setTimeout(r, 10));
        capturedTenantA = TenantContext.getRequired().tenantId;
      },
    );

    const taskB = TenantContext.run(
      { tenantId: asTenantId('tenant_curry_express') },
      async () => {
        await new Promise((r) => setTimeout(r, 5));
        capturedTenantB = TenantContext.getRequired().tenantId;
      },
    );

    await Promise.all([taskA, taskB]);

    assert.equal(capturedTenantA, 'tenant_arpzo');
    assert.equal(capturedTenantB, 'tenant_curry_express');
  });

  it('strictly blocks tenant queries outside active context boundary', () => {
    assert.throws(
      () => TenantContext.getRequired(),
      /TenantContext is not set for the current asynchronous call stack/,
    );
  });
});
