/**
 * @vca/api
 * REST Gateway for Sessions, Turns, Proposals, Cart Confirmation, Order Tracking, and Customer Preferences.
 */

import { ApiServer } from './server.ts';

export * from './server.ts';

export const API_VERSION = '1.0.0';

// Auto-start when executed directly from CLI
const entry = process.argv[1] || '';
if (entry.includes('apps') && entry.includes('api')) {
  const port = parseInt(process.env.PORT || '8080', 10);
  const server = new ApiServer({
    connectorUrl: process.env.CONNECTOR_URL || 'http://localhost:4000',
    connectorSecret: process.env.CONNECTOR_SECRET || 'arpzo_connector_signing_secret_hmac_256',
    adminKey: process.env.ADMIN_KEY || 'vca_master_admin_secret',
  });
  server.start(port).then((p) => {
    console.log(`[REST API Gateway] Server listening on http://localhost:${p}`);
  }).catch((err) => {
    console.error('Failed to start API server:', err);
    process.exit(1);
  });
}
