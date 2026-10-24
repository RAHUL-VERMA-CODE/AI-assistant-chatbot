import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SsrfGuard } from './ssrf-guard.ts';

describe('SsrfGuard', () => {
  it('blocks private, loopback, and cloud metadata IPv4 addresses', () => {
    assert.equal(SsrfGuard.isIpBlocked('127.0.0.1'), true);
    assert.equal(SsrfGuard.isIpBlocked('169.254.169.254'), true); // AWS/GCP metadata
    assert.equal(SsrfGuard.isIpBlocked('10.0.0.1'), true); // RFC 1918
    assert.equal(SsrfGuard.isIpBlocked('192.168.1.1'), true); // RFC 1918
    assert.equal(SsrfGuard.isIpBlocked('172.16.0.1'), true); // RFC 1918
    assert.equal(SsrfGuard.isIpBlocked('0.0.0.0'), true);
  });

  it('blocks private and loopback IPv6 addresses', () => {
    assert.equal(SsrfGuard.isIpBlocked('::1'), true);
    assert.equal(SsrfGuard.isIpBlocked('fe80::1'), true);
    assert.equal(SsrfGuard.isIpBlocked('fc00::1'), true);
  });

  it('allows public Internet IP addresses', () => {
    assert.equal(SsrfGuard.isIpBlocked('8.8.8.8'), false);
    assert.equal(SsrfGuard.isIpBlocked('1.1.1.1'), false);
    assert.equal(SsrfGuard.isIpBlocked('142.250.190.46'), false);
  });

  it('rejects unencrypted HTTP URLs in production mode', async () => {
    await assert.rejects(
      async () => SsrfGuard.validateAndResolveUrl('http://api.tenant.com/connector'),
      /Insecure protocol 'http:'/,
    );
  });
});
