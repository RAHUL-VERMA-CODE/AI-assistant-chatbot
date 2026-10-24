import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TenantContext } from './tenant-context.ts';
import { asTenantId, asUserRef } from '../types/id.ts';

describe('TenantContext', () => {
  it('propagates tenant identity through async execution', async () => {
    assert.equal(TenantContext.get(), undefined);

    await TenantContext.run(
      {
        tenantId: asTenantId('tenant_arpzo'),
        userRef: asUserRef('usr_123'),
        requestId: 'req_test_01',
        startTimeMs: Date.now(),
      },
      async () => {
        assert.equal(TenantContext.getTenantId(), 'tenant_arpzo');
        assert.equal(TenantContext.getRequestId(), 'req_test_01');

        await new Promise((resolve) => setTimeout(resolve, 10));

        assert.equal(TenantContext.getTenantId(), 'tenant_arpzo');
      },
    );

    assert.equal(TenantContext.get(), undefined);
  });

  it('throws when getRequired is called without context', () => {
    assert.throws(() => TenantContext.getRequired(), /TenantContext is not set/);
  });
});
