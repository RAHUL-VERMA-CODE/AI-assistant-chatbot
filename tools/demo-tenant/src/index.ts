/**
 * tools/demo-tenant
 * "ARPZO" Demo Tenant: Reference connector server with seeded branch menus, unknown facts, and mock checkout.
 */

export * from './seeds/arpzo-menu.ts';
export * from './database.ts';
export * from './server.ts';

export const DEMO_TENANT_NAME = 'arpzo';
