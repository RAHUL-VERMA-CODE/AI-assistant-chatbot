/**
 * @vca/realtime
 * Standalone WebSocket Streaming Voice Gateway: Binary PCM frames, push-to-talk, turn cancellation.
 */

export * from './metrics/latency-tracker.ts';
export * from './ws/ws-connection.ts';
export * from './server.ts';

export const REALTIME_VERSION = '1.0.0';
