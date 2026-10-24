import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SessionTokenService } from './session-token.ts';
import { asTenantId, asUserRef, asSessionId, asBranchId, asCartId } from '../../../core/src/index.ts';

describe('SessionTokenService', () => {
  const secret = 'super_secret_session_token_key_1234567890_abcdef';
  const service = new SessionTokenService(secret, 60);

  it('signs and verifies a valid client session token', () => {
    const token = service.sign({
      tenantId: asTenantId('tenant_arpzo'),
      userRef: asUserRef('usr_cust_99'),
      sessionId: asSessionId('as_77'),
      branchId: asBranchId('branch_koramangala'),
      cartId: asCartId('cart_44'),
    });

    assert.ok(token);
    assert.equal(token.split('.').length, 3);

    const verified = service.verify(token);
    assert.equal(verified.tid, 'tenant_arpzo');
    assert.equal(verified.sub, 'usr_cust_99');
    assert.equal(verified.sid, 'as_77');
    assert.equal(verified.bid, 'branch_koramangala');
    assert.equal(verified.cid, 'cart_44');
    assert.equal(verified.aud, 'vca:assistant');
    assert.equal(verified.iss, 'vca:platform');
  });

  it('rejects tampered tokens', () => {
    const token = service.sign({
      tenantId: asTenantId('tenant_arpzo'),
      userRef: asUserRef('usr_cust_99'),
      sessionId: asSessionId('as_77'),
      branchId: asBranchId('branch_koramangala'),
      cartId: asCartId('cart_44'),
    });

    const tampered = token.slice(0, -4) + 'abcd';
    assert.throws(() => service.verify(tampered), /Invalid session token signature/);
  });

  it('rejects expired tokens', async () => {
    const shortLivedService = new SessionTokenService(secret, -1); // Already expired
    const expiredToken = shortLivedService.sign({
      tenantId: asTenantId('tenant_arpzo'),
      userRef: asUserRef('usr_cust_99'),
      sessionId: asSessionId('as_77'),
      branchId: asBranchId('branch_koramangala'),
      cartId: asCartId('cart_44'),
    });

    assert.throws(() => shortLivedService.verify(expiredToken), /Session token has expired/);
  });
});
