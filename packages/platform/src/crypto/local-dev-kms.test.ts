import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LocalDevKmsAdapter } from './local-dev-kms.ts';

describe('LocalDevKmsAdapter (Envelope Encryption)', () => {
  const masterKeyHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const kms = new LocalDevKmsAdapter(masterKeyHex);

  it('encrypts and successfully decrypts arbitrary sensitive text', async () => {
    const sensitive = 'Customer dietary preferences: pure Jain, strictly no onion/garlic/root veg';
    const encrypted = await kms.encrypt(sensitive);

    assert.notEqual(encrypted.ciphertext, sensitive);
    assert.equal(encrypted.algorithm, 'aes-256-gcm');
    assert.ok(encrypted.encryptedDek);
    assert.ok(encrypted.iv);
    assert.ok(encrypted.tag);

    const decrypted = await kms.decrypt(encrypted);
    assert.equal(decrypted, sensitive);
  });

  it('generates unique ciphertexts and DEKs for identical plaintext', async () => {
    const text = 'Same plaintext value';
    const enc1 = await kms.encrypt(text);
    const enc2 = await kms.encrypt(text);

    assert.notEqual(enc1.ciphertext, enc2.ciphertext);
    assert.notEqual(enc1.encryptedDek, enc2.encryptedDek);
    assert.notEqual(enc1.iv, enc2.iv);

    assert.equal(await kms.decrypt(enc1), text);
    assert.equal(await kms.decrypt(enc2), text);
  });

  it('fails decryption if auth tag is tampered with', async () => {
    const text = 'Sensitive payload';
    const encrypted = await kms.encrypt(text);

    // Tamper with tag
    const tamperedTag = Buffer.from(encrypted.tag, 'base64');
    tamperedTag[0] = (tamperedTag[0] ?? 0) ^ 0xff;

    const tamperedPayload = {
      ...encrypted,
      tag: tamperedTag.toString('base64'),
    };

    await assert.rejects(async () => kms.decrypt(tamperedPayload));
  });
});
