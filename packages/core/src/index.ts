/**
 * @vca/core
 * Pure domain types, branded identifiers, result monads, and tenancy context.
 */

export * from './types/id.ts';
export * from './types/currency.ts';
export * from './result/result.ts';
export * from './errors/app-error.ts';
export * from './context/tenant-context.ts';

export const CORE_VERSION = '1.0.0';
