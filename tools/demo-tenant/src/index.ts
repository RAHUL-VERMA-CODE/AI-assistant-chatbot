/**
 * tools/demo-tenant
 * "ARPZO" Demo Tenant: Reference connector server with seeded branch menus, unknown facts, and mock checkout.
 */

import { DemoTenantServer } from './server.ts';

export * from './seeds/arpzo-menu.ts';
export * from './database.ts';
export * from './server.ts';

export const DEMO_TENANT_NAME = 'arpzo';

// Auto-start when executed directly from CLI
const entry = process.argv[1] || '';
if (entry.includes('demo-tenant')) {
  const port = parseInt(process.env.DEMO_PORT || '4000', 10);
  const server = new DemoTenantServer(
    process.env.CONNECTOR_SECRET || 'arpzo_connector_signing_secret_hmac_256',
  );
  server.start(port).then((p) => {
    console.log(`[ARPZO Demo Tenant] Server listening on http://localhost:${p}`);
  }).catch((err) => {
    console.error('Failed to start Demo Tenant server:', err);
    process.exit(1);
  });
}
