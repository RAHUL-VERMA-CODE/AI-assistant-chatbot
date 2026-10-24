import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    text_traffic_spike: {
      executor: 'ramping-vus',
      startVUs: 100,
      stages: [
        { duration: '30s', target: 1000 },
        { duration: '1m', target: 5000 }, // Peak 5,000 concurrent text sessions
        { duration: '2m', target: 5000 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    'http_req_duration{type:text_turn}': ['p(95)<1500'], // Text turn first token / response <= 1.5s
    'http_req_duration{type:fast_path}': ['p(95)<100'],   // Fast-path confirm <= 100ms
    'http_req_failed': ['rate<0.001'],                   // Error rate < 0.1%
  },
};

const BASE_HTTP_URL = __ENV.API_BASE_URL || 'http://localhost:8080';

export default function () {
  // 1. Create session
  const sessionRes = http.post(
    `${BASE_HTTP_URL}/v1/assistant/sessions`,
    JSON.stringify({
      tenantId: 'tenant_arpzo',
      userRef: `usr_text_load_${__VU}_${__ITER}`,
      branchId: 'branch_koramangala',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  const sessionToken = JSON.parse(sessionRes.body).token;
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${sessionToken}`,
  };

  // 2. Submit natural language text search turn
  const turnRes = http.post(
    `${BASE_HTTP_URL}/v1/assistant/turns`,
    JSON.stringify({
      utterance: 'Ek cheese burst pizza add kar do',
    }),
    {
      headers: authHeaders,
      tags: { type: 'text_turn' },
    }
  );

  check(turnRes, {
    'turn status 200': (r) => r.status === 200,
    'has assistant reply': (r) => JSON.parse(r.body).replyText !== undefined,
  });

  const proposalId = JSON.parse(turnRes.body).proposalId;

  // 3. Confirm cart proposal (fast-path LLM bypass)
  if (proposalId) {
    const confirmRes = http.post(
      `${BASE_HTTP_URL}/v1/cart/confirm`,
      JSON.stringify({ proposalId }),
      {
        headers: authHeaders,
        tags: { type: 'fast_path' },
      }
    );

    check(confirmRes, {
      'confirm status 200': (r) => r.status === 200,
      'cart committed': (r) => JSON.parse(r.body).success === true,
    });
  }

  sleep(0.5);
}
