/**
 * @vca/platform
 * Infrastructure primitives: logging, config validation, crypto KMS, concurrency, idempotency, auth, metering.
 */

export * from './config/env.ts';
export * from './logging/pii-scrubber.ts';
export * from './logging/logger.ts';
export * from './crypto/kms-adapter.ts';
export * from './crypto/local-dev-kms.ts';
export * from './concurrency/rate-limiter.ts';
export * from './concurrency/single-flight.ts';
export * from './concurrency/circuit-breaker.ts';
export * from './idempotency/idempotency-store.ts';
export * from './auth/session-token.ts';
export * from './billing/billing-adapter.ts';
export * from './metering/usage-meter.ts';
export * from './metering/outbox-publisher.ts';
export * from './metering/spend-guard.ts';

export const PLATFORM_VERSION = '1.0.0';
