import http from 'k6/http';
import { check, sleep } from 'k6';
import ws from 'k6/ws';

export const options = {
  scenarios: {
    voice_streaming_load: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '30s', target: 50 },  // baseline 50 VUs
        { duration: '1m', target: 200 },  // scale up
        { duration: '2m', target: 500 },  // peak 500 concurrent voice streams
        { duration: '30s', target: 0 },   // ramp down
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    'voice_turn_latency_ms': ['p(95)<3000'], // Voice turn p95 latency must be <= 3.0s
    'ws_connecting_duration': ['p(95)<200'],  // Fast WS connection handshake
  },
};

const BASE_HTTP_URL = __ENV.API_BASE_URL || 'http://localhost:8080';
const WS_GATEWAY_URL = __ENV.WS_GATEWAY_URL || 'ws://localhost:8081';

export default function () {
  // 1. Establish session via HTTP REST
  const sessionRes = http.post(
    `${BASE_HTTP_URL}/v1/assistant/sessions`,
    JSON.stringify({
      tenantId: 'tenant_arpzo',
      userRef: `usr_load_${__VU}_${__ITER}`,
      branchId: 'branch_koramangala',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(sessionRes, {
    'session created 200': (r) => r.status === 200,
    'token received': (r) => JSON.parse(r.body).token !== undefined,
  });

  const sessionToken = JSON.parse(sessionRes.body).token;
  const url = `${WS_GATEWAY_URL}/?token=${encodeURIComponent(sessionToken)}`;

  // 2. Open WebSocket stream
  ws.connect(url, {}, function (socket) {
    let turnStartTime = 0;

    socket.on('open', () => {
      turnStartTime = Date.now();
      // Start push-to-talk turn
      socket.send(JSON.stringify({ type: 'start_turn' }));

      // Stream 200ms of simulated 16kHz linear PCM audio frames
      const pcmChunk = new ArrayBuffer(640);
      socket.send(pcmChunk);

      // Stop speech turn
      socket.send(JSON.stringify({ type: 'stop_turn' }));
    });

    socket.on('message', (data) => {
      if (typeof data === 'string') {
        const msg = JSON.parse(data);
        if (msg.type === 'assistant_reply' || msg.type === 'audio_stream_start') {
          const latencyMs = Date.now() - turnStartTime;
          check(latencyMs, {
            'voice turn latency under 3.0s': (l) => l <= 3000,
          });
          socket.close();
        }
      }
    });

    socket.on('error', (err) => {
      console.error('WebSocket load test error: ', err);
    });
  });

  sleep(1);
}
