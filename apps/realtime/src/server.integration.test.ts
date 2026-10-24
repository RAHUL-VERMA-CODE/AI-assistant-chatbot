import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import type net from 'node:net';
import { DemoTenantServer } from '../../../tools/demo-tenant/src/server.ts';
import { RealtimeServer } from './server.ts';
import { SessionTokenService } from '../../../packages/platform/src/auth/session-token.ts';
import { WebSocketConnection } from './ws/ws-connection.ts';
import { asTenantId, asUserRef, asSessionId, asBranchId, asCartId } from '../../../packages/core/src/index.ts';

describe('RealtimeServer Voice Streaming Integration', () => {
  let demoTenant: DemoTenantServer;
  let realtimeServer: RealtimeServer;
  let serverPort: number;
  const connectorSecret = 'sec_rt_tenant_test_key_phase6';
  const jwtSecret = 'super_secret_jwt_key_phase6_longer_than_32_chars';
  let sessionToken: string;

  before(async () => {
    // 1. Start Demo Tenant
    demoTenant = new DemoTenantServer(connectorSecret);
    const tenantPort = await demoTenant.start(0);

    // 2. Start Realtime Voice Gateway
    realtimeServer = new RealtimeServer({
      connectorUrl: `http://localhost:${tenantPort}`,
      connectorSecret,
      jwtSecret,
    });
    serverPort = await realtimeServer.start(0);

    // 3. Generate Valid Session Token
    const tokenService = new SessionTokenService(jwtSecret);
    sessionToken = tokenService.sign({
      sessionId: asSessionId('ses_rt_voice_01'),
      tenantId: asTenantId('tenant_arpzo'),
      userRef: asUserRef('usr_cust_01'),
      branchId: asBranchId('branch_koramangala'),
      cartId: asCartId('cart_usr_cust_01'),
    });
  });

  after(async () => {
    await realtimeServer.stop();
    await demoTenant.stop();
  });

  function connectClient(token?: string): Promise<WebSocketConnection> {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      const path = token ? `/?token=${encodeURIComponent(token)}` : '/';

      const req = http.request({
        port: serverPort,
        host: 'localhost',
        path,
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': key,
          'Sec-WebSocket-Version': '13',
        },
      });

      let settled = false;

      req.on('response', (res) => {
        if (!settled) {
          settled = true;
          reject(new Error(`Server returned HTTP ${res.statusCode} instead of upgrading`));
        }
      });

      req.on('upgrade', (res, socket, head) => {
        if (!settled) {
          settled = true;
          socket.removeAllListeners('close');
          const clientWs = new WebSocketConnection(socket as net.Socket, undefined, head, false);
          resolve(clientWs);
        }
      });

      req.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      req.end();
    });
  }

  it('rejects WebSocket connection without valid token with 401', async () => {
    await assert.rejects(async () => {
      await connectClient(); // no token
    });
  });

  it('streams full push-to-talk voice turn with audio playback in < 3s', async () => {
    const ws = await connectClient(sessionToken);

    const receivedMessages: any[] = [];
    let receivedAudioBytes = 0;

    ws.on('message', (data: string | Buffer, isBinary: boolean) => {
      if (isBinary && Buffer.isBuffer(data)) {
        receivedAudioBytes += data.length;
      } else if (typeof data === 'string') {
        receivedMessages.push(JSON.parse(data));
      }
    });

    // 1. Send start_turn
    ws.sendText(JSON.stringify({ type: 'start_turn' }));

    // 2. Stream 3 binary audio frames (16kHz PCM chunks)
    ws.sendBinary(Buffer.alloc(640));
    ws.sendBinary(Buffer.alloc(640));
    ws.sendBinary(Buffer.alloc(640));

    // 3. Send stop_turn (Push-to-talk released / end of speech)
    ws.sendText(JSON.stringify({ type: 'stop_turn' }));

    // Wait for pipeline completion
    await new Promise((resolve) => setTimeout(resolve, 800));

    ws.close();

    // Verify transcript events
    const partials = receivedMessages.filter((m) => m.type === 'transcript_partial');
    const finals = receivedMessages.filter((m) => m.type === 'transcript_final');
    const replies = receivedMessages.filter((m) => m.type === 'assistant_reply');
    const metricsMsg = receivedMessages.find((m) => m.type === 'latency_metrics');

    assert.ok(partials.length >= 1, 'Expected at least 1 partial transcript event');
    assert.equal(finals.length, 1, 'Expected 1 final transcript event');
    assert.equal(replies.length, 1, 'Expected assistant reply event');
    assert.ok(receivedAudioBytes > 0, 'Expected binary audio frames streamed for playback');

    // Verify Latency budget <= 3.0s (Req FAST)
    assert.ok(metricsMsg, 'Expected latency metrics message');
    assert.ok(
      metricsMsg.metrics.endOfSpeechToFirstAudioMs <= 3000,
      `Voice turn latency exceeded 3s budget: ${metricsMsg.metrics.endOfSpeechToFirstAudioMs}ms`,
    );
  });

  it('supports typing fallback over WebSocket (Req A01)', async () => {
    const ws = await connectClient(sessionToken);
    const receivedMessages: any[] = [];

    ws.on('message', (data: string | Buffer, isBinary: boolean) => {
      if (!isBinary && typeof data === 'string') {
        receivedMessages.push(JSON.parse(data));
      }
    });

    ws.sendText(JSON.stringify({ type: 'text_input', text: 'Ek Jain Paneer Tikka add karo' }));

    await new Promise((resolve) => setTimeout(resolve, 800));
    ws.close();

    const reply = receivedMessages.find((m) => m.type === 'assistant_reply');
    assert.ok(reply);
    assert.match(reply.replyText, /Jain Paneer Tikka/);
  });
});
