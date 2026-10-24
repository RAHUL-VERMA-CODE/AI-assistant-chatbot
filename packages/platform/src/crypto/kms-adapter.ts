/**
 * KMS Adapter Interface for Envelope Encryption
 */

export interface EncryptedPayload {
  readonly ciphertext: string; // Base64
  readonly iv: string; // Base64 (12 bytes)
  readonly tag: string; // Base64 (16 bytes)
  readonly encryptedDek: string; // Base64 (32-byte DEK encrypted by master key)
  readonly dekIv: string; // Base64
  readonly dekTag: string; // Base64
  readonly algorithm: 'aes-256-gcm';
}

export interface KmsAdapter {
  encrypt(plaintext: string): Promise<EncryptedPayload>;
  decrypt(payload: EncryptedPayload): Promise<string>;
}
