import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectorSigner } from './signer.ts';

describe('ConnectorSigner (HMAC-SHA256)', () => {
  const secret = 'test_secret_connector_signing_key_12345';
  const signer = new ConnectorSigner(secret);

  it('signs and successfully verifies request signature', () => {
    const method = 'POST';
    const path = '/connector/v1/cart/commit';
    const body = { proposalId: 'cp_9', items: [{ itemId: 'pizza_12' }] };

    const headers = signer.sign(method, path, body);
    assert.ok(headers['X-Connector-Signature']);
    assert.ok(headers['X-Connector-Timestamp']);
    assert.ok(headers['X-Connector-Nonce']);

    const valid = signer.verify(
      headers['X-Connector-Signature'],
      headers['X-Connector-Timestamp'],
      headers['X-Connector-Nonce'],
      method,
      path,
      body,
    );
    assert.equal(valid, true);
  });

  it('fails verification if request body is altered', () => {
    const method = 'POST';
    const path = '/connector/v1/cart/commit';
    const originalBody = { amount: 100 };
    const tamperedBody = { amount: 200 };

    const headers = signer.sign(method, path, originalBody);

    const valid = signer.verify(
      headers['X-Connector-Signature'],
      headers['X-Connector-Timestamp'],
      headers['X-Connector-Nonce'],
      method,
      path,
      tamperedBody,
    );
    assert.equal(valid, false);
  });

  it('fails verification if timestamp is older than maxClockSkewSeconds', () => {
    const method = 'GET';
    const path = '/branches/b1/catalog';
    const headers = signer.sign(method, path);

    // Pretend timestamp is 10 minutes old
    const expiredTimestamp = (parseInt(headers['X-Connector-Timestamp'], 10) - 600).toString();

    const valid = signer.verify(
      headers['X-Connector-Signature'],
      expiredTimestamp,
      headers['X-Connector-Nonce'],
      method,
      path,
      undefined,
      300, // max 5 mins
    );
    assert.equal(valid, false);
  });
});
