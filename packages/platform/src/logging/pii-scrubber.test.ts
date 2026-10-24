import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PiiScrubber } from './pii-scrubber.ts';

describe('PiiScrubber', () => {
  it('redacts Indian phone numbers with various formats', () => {
    const raw = 'Call me on 9876543210 or +91 9123456789 or 8888888888';
    const scrubbed = PiiScrubber.scrub(raw);
    assert.equal(scrubbed.includes('9876543210'), false);
    assert.equal(scrubbed.includes('9123456789'), false);
    assert.equal(scrubbed.includes('[REDACTED_PHONE]'), true);
  });

  it('redacts email addresses', () => {
    const raw = 'Send receipt to customer.food@example.com please';
    const scrubbed = PiiScrubber.scrub(raw);
    assert.equal(scrubbed, 'Send receipt to [REDACTED_EMAIL] please');
  });

  it('redacts credit card numbers', () => {
    const raw = 'Card number 4111 2222 3333 4444 used';
    const scrubbed = PiiScrubber.scrub(raw);
    assert.equal(scrubbed.includes('4111'), false);
    assert.equal(scrubbed.includes('[REDACTED_PAYMENT]'), true);
  });

  it('recursively scrubs sensitive keys in objects', () => {
    const obj = {
      username: 'john_doe',
      apiKey: 'secret_1234567890abcdef',
      phone: '9876543210',
      nested: {
        token: 'bearer_eyJhbGciOi...',
        message: 'Deliver to 9999999999',
      },
    };
    const sanitized = PiiScrubber.scrubObject(obj);
    assert.equal(sanitized.apiKey, '[REDACTED_SECRET]');
    assert.equal(sanitized.phone, '[REDACTED_PHONE]');
    assert.equal(sanitized.nested.token, '[REDACTED_SECRET]');
    assert.equal(sanitized.nested.message, 'Deliver to [REDACTED_PHONE]');
  });
});
