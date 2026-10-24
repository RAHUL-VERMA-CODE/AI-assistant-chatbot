import crypto from 'node:crypto';
import type { KmsAdapter, EncryptedPayload } from './kms-adapter.ts';

export class LocalDevKmsAdapter implements KmsAdapter {
  private readonly masterKey: Buffer;

  constructor(masterKeyHex: string) {
    if (!masterKeyHex || masterKeyHex.length < 64) {
      throw new Error('DEV_MASTER_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).');
    }
    this.masterKey = Buffer.from(masterKeyHex.slice(0, 64), 'hex');
  }

  public async encrypt(plaintext: string): Promise<EncryptedPayload> {
    // 1. Generate ephemeral 256-bit Data Encryption Key (DEK)
    const dek = crypto.randomBytes(32);

    // 2. Encrypt plaintext with DEK using AES-256-GCM
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    // 3. Encrypt the DEK with Master Key using AES-256-GCM
    const dekIv = crypto.randomBytes(12);
    const dekCipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, dekIv);
    const encryptedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()]);
    const dekTag = dekCipher.getAuthTag();

    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      encryptedDek: encryptedDek.toString('base64'),
      dekIv: dekIv.toString('base64'),
      dekTag: dekTag.toString('base64'),
      algorithm: 'aes-256-gcm',
    };
  }

  public async decrypt(payload: EncryptedPayload): Promise<string> {
    if (payload.algorithm !== 'aes-256-gcm') {
      throw new Error(`Unsupported encryption algorithm: ${payload.algorithm}`);
    }

    // 1. Decrypt DEK using Master Key
    const dekIv = Buffer.from(payload.dekIv, 'base64');
    const encryptedDek = Buffer.from(payload.encryptedDek, 'base64');
    const dekTag = Buffer.from(payload.dekTag, 'base64');

    const dekDecipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, dekIv);
    dekDecipher.setAuthTag(dekTag);
    const dek = Buffer.concat([dekDecipher.update(encryptedDek), dekDecipher.final()]);

    // 2. Decrypt ciphertext using decrypted DEK
    const iv = Buffer.from(payload.iv, 'base64');
    const ciphertext = Buffer.from(payload.ciphertext, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', dek, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return plaintext.toString('utf8');
  }
}
