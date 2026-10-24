/**
 * @vca/realtime
 * Standalone WebSocket Streaming Voice Gateway: Binary PCM frames, push-to-talk, turn cancellation.
 */

import { RealtimeServer } from './server.ts';

export * from './metrics/latency-tracker.ts';
export * from './ws/ws-connection.ts';
export * from './server.ts';

export const REALTIME_VERSION = '1.0.0';

// Auto-start when executed directly from CLI
const entry = process.argv[1] || '';
if (entry.includes('realtime')) {
  const port = parseInt(process.env.REALTIME_PORT || '8081', 10);
  const server = new RealtimeServer({
    connectorUrl: process.env.CONNECTOR_URL || 'http://localhost:4000',
    connectorSecret: process.env.CONNECTOR_SECRET || 'arpzo_connector_signing_secret_hmac_256',
  });
  server.start(port).then((p) => {
    console.log(`[Realtime Voice Server] WebSocket gateway listening on ws://localhost:${p}`);
  }).catch((err) => {
    console.error('Failed to start Realtime server:', err);
    process.exit(1);
  });
}
