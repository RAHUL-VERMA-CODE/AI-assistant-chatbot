import crypto from 'node:crypto';
import { ConflictError } from '../../../core/src/index.ts';

export type IdempotencyStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface IdempotencyRecord {
  readonly status: IdempotencyStatus;
  readonly requestHash: string;
  readonly responseStatusCode?: number;
  readonly responseBody?: unknown;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export class IdempotencyStore {
  private readonly defaultTtlSeconds: number;
  private readonly store = new Map<string, IdempotencyRecord>();

  constructor(defaultTtlSeconds = 86400) {
    this.defaultTtlSeconds = defaultTtlSeconds;
  }

  public static hashPayload(payload: unknown): string {
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  public async acquire(key: string, requestPayload: unknown): Promise<{ isFirstAttempt: boolean; cachedResponse?: unknown }> {
    const hash = IdempotencyStore.hashPayload(requestPayload);
    const now = Date.now();
    const existing = this.store.get(key);

    if (existing) {
      if (existing.expiresAt <= now) {
        this.store.delete(key);
      } else {
        if (existing.requestHash !== hash) {
          throw new ConflictError(`Idempotency key '${key}' was previously used with a different request payload.`);
        }
        if (existing.status === 'PROCESSING') {
          throw new ConflictError(`Request with idempotency key '${key}' is currently being processed.`);
        }
        return { isFirstAttempt: false, cachedResponse: existing.responseBody };
      }
    }

    // Set lock
    const record: IdempotencyRecord = {
      status: 'PROCESSING',
      requestHash: hash,
      createdAt: now,
      expiresAt: now + this.defaultTtlSeconds * 1000,
    };
    this.store.set(key, record);
    return { isFirstAttempt: true };
  }

  public async complete(key: string, statusCode: number, responseBody: unknown): Promise<void> {
    const existing = this.store.get(key);
    if (!existing) {
      return;
    }

    const updated: IdempotencyRecord = {
      ...existing,
      status: 'COMPLETED',
      responseStatusCode: statusCode,
      responseBody,
    };
    this.store.set(key, updated);
  }

  public async fail(key: string): Promise<void> {
    this.store.delete(key);
  }
}
