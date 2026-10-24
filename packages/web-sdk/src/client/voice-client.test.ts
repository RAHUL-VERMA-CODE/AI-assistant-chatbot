import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceClient } from './voice-client.ts';

class MockBrowserWebSocket {
  public url: string;
  public readyState: number = 0; // CONNECTING
  public binaryType: string = 'blob';
  public sentMessages: any[] = [];
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: any }) => void) | null = null;
  public onerror: ((err: any) => void) | null = null;
  public onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    // Simulate auto-open on next tick
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen();
    }, 5);
  }

  public send(data: any): void {
    this.sentMessages.push(data);
  }

  public close(): void {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose();
  }

  // Helper to simulate server sending messages
  public simulateServerMessage(data: any): void {
    if (this.onmessage) {
      this.onmessage({ data });
    }
  }
}

describe('VoiceClient Web SDK', () => {
  let originalWebSocket: any;

  beforeEach(() => {
    originalWebSocket = (globalThis as any).WebSocket;
    (globalThis as any).WebSocket = MockBrowserWebSocket;
  });

  afterEach(() => {
    (globalThis as any).WebSocket = originalWebSocket;
  });

  it('connects to gateway and transitions from DISCONNECTED -> CONNECTING -> IDLE', async () => {
    const states: string[] = [];
    const client = new VoiceClient({
      gatewayUrl: 'ws://localhost:8081',
      sessionToken: 'test_token_xyz',
    });

    client.on('stateChange', (s) => states.push(s));
    assert.equal(client.getState(), 'DISCONNECTED');

    await client.connect();
    assert.equal(client.getState(), 'IDLE');
    assert.deepEqual(states, ['CONNECTING', 'IDLE']);
  });

  it('handles push-to-talk flow and sends proper command frames', async () => {
    const client = new VoiceClient({
      gatewayUrl: 'ws://localhost:8081',
      sessionToken: 'test_token_xyz',
    });
    await client.connect();

    client.startTurn();
    assert.equal(client.getState(), 'LISTENING');

    const pcmData = new Int16Array([100, 200, 300]).buffer;
    client.sendAudioChunk(pcmData);

    client.stopTurn();
    assert.equal(client.getState(), 'PROCESSING');

    const ws = (client as any).ws as MockBrowserWebSocket;
    assert.equal(ws.sentMessages.length, 3);
    assert.equal(JSON.parse(ws.sentMessages[0]).type, 'start_turn');
    assert.equal(ws.sentMessages[1], pcmData);
    assert.equal(JSON.parse(ws.sentMessages[2]).type, 'stop_turn');
  });

  it('processes incoming transcript, assistant reply, and proposal events', async () => {
    const client = new VoiceClient({
      gatewayUrl: 'ws://localhost:8081',
      sessionToken: 'test_token_xyz',
    });
    await client.connect();

    let partial = '';
    let final = '';
    let reply = '';
    let proposal: any = null;

    client.on('transcriptPartial', (t) => { partial = t; });
    client.on('transcriptFinal', (t) => { final = t; });
    client.on('assistantReply', (r) => { reply = r; });
    client.on('proposal', (p) => { proposal = p; });

    const ws = (client as any).ws as MockBrowserWebSocket;

    ws.simulateServerMessage(JSON.stringify({
      type: 'transcript_partial',
      text: 'Ek cheese',
    }));
    assert.equal(partial, 'Ek cheese');

    ws.simulateServerMessage(JSON.stringify({
      type: 'transcript_final',
      text: 'Ek cheese burst pizza add kar do',
    }));
    assert.equal(final, 'Ek cheese burst pizza add kar do');

    ws.simulateServerMessage(JSON.stringify({
      type: 'assistant_reply',
      replyText: 'One Medium Cheese Burst Pizza has been prepared. Total INR 399.00.',
      proposalId: 'prop_9988',
      proposalTotalMinor: 39900,
      currency: 'INR',
    }));
    assert.equal(reply, 'One Medium Cheese Burst Pizza has been prepared. Total INR 399.00.');
    assert.ok(proposal);
    assert.equal(proposal.proposalId, 'prop_9988');
    assert.equal(proposal.totalMinor, 39900);
    assert.equal(proposal.currency, 'INR');
  });

  it('handles audio stream start/end transitions and binary audio chunks', async () => {
    const client = new VoiceClient({
      gatewayUrl: 'ws://localhost:8081',
      sessionToken: 'test_token_xyz',
    });
    await client.connect();

    let receivedChunk: any = null;
    client.on('audioChunk', (c) => { receivedChunk = c; });

    const ws = (client as any).ws as MockBrowserWebSocket;

    ws.simulateServerMessage(JSON.stringify({ type: 'audio_stream_start' }));
    assert.equal(client.getState(), 'SPEAKING');

    const fakeAudio = new Uint8Array([1, 2, 3, 4]).buffer;
    ws.simulateServerMessage(fakeAudio);
    assert.equal(receivedChunk, fakeAudio);

    ws.simulateServerMessage(JSON.stringify({ type: 'audio_stream_end' }));
    assert.equal(client.getState(), 'IDLE');
  });

  it('handles typing fallback and turn cancellation', async () => {
    const client = new VoiceClient({
      gatewayUrl: 'ws://localhost:8081',
      sessionToken: 'test_token_xyz',
    });
    await client.connect();

    client.sendTextInput('Where is my order?');
    assert.equal(client.getState(), 'PROCESSING');

    client.cancelTurn();
    assert.equal(client.getState(), 'IDLE');

    const ws = (client as any).ws as MockBrowserWebSocket;
    assert.equal(JSON.parse(ws.sentMessages[0]).type, 'text_input');
    assert.equal(JSON.parse(ws.sentMessages[0]).text, 'Where is my order?');
    assert.equal(JSON.parse(ws.sentMessages[1]).type, 'cancel_turn');

    client.disconnect();
    assert.equal(client.getState(), 'DISCONNECTED');
  });
});
