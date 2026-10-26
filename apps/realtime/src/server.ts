import http from 'node:http';
import type net from 'node:net';
import { WebSocketConnection } from './ws/ws-connection.ts';
import { SessionTokenService } from '../../../packages/platform/src/auth/session-token.ts';
import { ConnectorClient } from '../../../packages/connector-sdk/src/client.ts';
import { ProposalManager } from '../../../packages/policy-engine/src/proposal-manager.ts';
import { TurnOrchestrator } from '../../../packages/orchestrator/src/state-machine/machine.ts';
import { MockLLMProvider } from '../../../packages/llm/src/adapters/mock-adapter.ts';
import { createLLMProvider } from '../../../packages/llm/src/factory.ts';
import type { LLMProvider } from '../../../packages/llm/src/interfaces/llm-provider.ts';
import {
  MockSTTProvider,
  MockTTSProvider,
  SentenceChunker,
  type SpeechToTextProvider,
  type TextToSpeechProvider,
} from '../../../packages/speech/src/index.ts';
import { LatencyTracker } from './metrics/latency-tracker.ts';

export interface RealtimeServerOptions {
  readonly connectorUrl: string;
  readonly connectorSecret: string;
  readonly jwtSecret?: string;
  readonly sttProvider?: SpeechToTextProvider;
  readonly ttsProvider?: TextToSpeechProvider;
  readonly llm?: LLMProvider;
}

export class RealtimeServer {
  private readonly server: http.Server;
  private readonly sessionTokenService: SessionTokenService;
  private readonly connector: ConnectorClient;
  private readonly proposalManager: ProposalManager;
  private readonly orchestrator: TurnOrchestrator;
  private readonly stt: SpeechToTextProvider;
  private readonly tts: TextToSpeechProvider;

  private readonly sockets = new Set<net.Socket>();

  constructor(options: RealtimeServerOptions) {
    this.sessionTokenService = new SessionTokenService(
      options.jwtSecret || 'vca_api_jwt_secret_32_characters_long_min',
    );
    this.connector = new ConnectorClient({
      baseUrl: options.connectorUrl,
      signingSecret: options.connectorSecret,
      allowLocalhostForTesting: true,
    });
    this.proposalManager = new ProposalManager();

    let llm = options.llm;
    if (!llm) {
      try {
        llm = createLLMProvider();
      } catch {
        llm = new MockLLMProvider();
      }
    }

    this.orchestrator = new TurnOrchestrator({
      connector: this.connector,
      proposalManager: this.proposalManager,
      llm,
    });
    this.stt = options.sttProvider || new MockSTTProvider();
    this.tts = options.ttsProvider || new MockTTSProvider();

    this.server = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', service: 'realtime' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    this.server.on('connection', (sock) => {
      this.sockets.add(sock);
      sock.on('close', () => this.sockets.delete(sock));
    });

    this.server.on('upgrade', (req, socket, head) => {
      this.sockets.add(socket as net.Socket);
      socket.on('close', () => this.sockets.delete(socket as net.Socket));
      this.handleUpgrade(req, socket, head);
    });
  }

  public async start(port = 8081): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(port, () => {
        const addr = this.server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : port;
        resolve(actualPort);
      });
    });
  }

  public async stop(): Promise<void> {
    for (const sock of this.sockets) {
      try {
        sock.destroy();
      } catch {}
    }
    this.sockets.clear();
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private handleUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer): void {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const token = parsedUrl.searchParams.get('token');

    // Authenticate WebSocket connection
    let sessionClaims: any;
    try {
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      sessionClaims = this.sessionTokenService.verify(token);
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const ws = new WebSocketConnection(socket, req, head, true);
    this.setupVoicePipeline(ws, sessionClaims);
  }

  private setupVoicePipeline(ws: WebSocketConnection, claims: any): void {
    let currentTurnAbortController: AbortController | null = null;
    let audioFrames: Buffer[] = [];
    let isSpeaking = false;
    let latencyTracker: LatencyTracker | null = null;

    ws.on('message', async (data: string | Buffer, isBinary: boolean) => {
      // 1. Binary Audio Frame (16kHz PCM from microphone)
      if (isBinary && Buffer.isBuffer(data)) {
        if (!isSpeaking) {
          isSpeaking = true;
          // Abort any active TTS audio in-flight on new speech (Barge-in / Interruption)
          if (currentTurnAbortController) {
            currentTurnAbortController.abort();
            currentTurnAbortController = null;
          }
        }
        audioFrames.push(data);
        return;
      }

      // 2. Control Messages (JSON)
      if (typeof data === 'string') {
        let msg: any;
        try {
          msg = JSON.parse(data);
        } catch {
          return;
        }

        // PUSH-TO-TALK START
        if (msg.type === 'start_turn') {
          isSpeaking = true;
          audioFrames = [];
          if (currentTurnAbortController) {
            currentTurnAbortController.abort();
            currentTurnAbortController = null;
          }
          ws.sendText(JSON.stringify({ type: 'turn_started' }));
          return;
        }

        // PUSH-TO-TALK STOP / END-OF-SPEECH
        if (msg.type === 'stop_turn') {
          isSpeaking = false;
          const turnId = `turn_${Date.now()}`;
          latencyTracker = new LatencyTracker(turnId);
          latencyTracker.markEndOfSpeech();

          currentTurnAbortController = new AbortController();
          const signal = currentTurnAbortController.signal;

          await this.executeVoiceTurn(
            ws,
            claims,
            audioFrames,
            signal,
            latencyTracker,
          );
          audioFrames = [];
          return;
        }

        // CANCEL / ABORT TURN
        if (msg.type === 'cancel_turn') {
          if (currentTurnAbortController) {
            currentTurnAbortController.abort();
            currentTurnAbortController = null;
          }
          audioFrames = [];
          isSpeaking = false;
          ws.sendText(JSON.stringify({ type: 'turn_cancelled' }));
          return;
        }

        // TYPING FALLBACK / EDITABLE TRANSCRIPT SUBMIT
        if (msg.type === 'text_input') {
          const text = msg.text;
          const turnId = `turn_text_${Date.now()}`;
          latencyTracker = new LatencyTracker(turnId);
          latencyTracker.markEndOfSpeech();

          currentTurnAbortController = new AbortController();
          const signal = currentTurnAbortController.signal;

          await this.executeTextTurn(
            ws,
            claims,
            text,
            signal,
            latencyTracker,
          );
          return;
        }
      }
    });
  }

  private async executeVoiceTurn(
    ws: WebSocketConnection,
    claims: any,
    frames: Buffer[],
    signal: AbortSignal,
    tracker: LatencyTracker,
  ): Promise<void> {
    try {
      // 1. Stream STT
      async function* frameGenerator() {
        for (const frame of frames) {
          yield frame;
        }
      }

      let finalTranscript = '';
      for await (const event of this.stt.transcribeStream(frameGenerator())) {
        if (signal.aborted) return;

        if (event.isFinal) {
          finalTranscript = event.text;
          ws.sendText(
            JSON.stringify({
              type: 'transcript_final',
              text: event.text,
              confidence: event.confidence,
              language: event.detectedLanguage,
            }),
          );
        } else {
          ws.sendText(
            JSON.stringify({
              type: 'transcript_partial',
              text: event.text,
            }),
          );
        }
      }

      tracker.markSttEnd();

      if (!finalTranscript) {
        ws.sendText(
          JSON.stringify({
            type: 'error',
            message: 'No speech recognized. Please try speaking again or type your request.',
          }),
        );
        return;
      }

      // 2. Orchestrator Turn
      await this.executeTextTurn(ws, claims, finalTranscript, signal, tracker);
    } catch (err) {
      if (!signal.aborted) {
        ws.sendText(JSON.stringify({ type: 'error', message: String(err) }));
      }
    }
  }

  private async executeTextTurn(
    ws: WebSocketConnection,
    claims: any,
    text: string,
    signal: AbortSignal,
    tracker: LatencyTracker,
  ): Promise<void> {
    try {
      tracker.markLlmFirstToken();

      const turnResult = await this.orchestrator.processTurn({
        sessionId: claims.sid,
        tenantId: claims.tid,
        userRef: claims.sub,
        branchId: claims.bid,
        utterance: text,
      });

      tracker.markLlmEnd();

      if (signal.aborted) return;

      // Send structured assistant turn response to client (transcript + proposal card + items)
      ws.sendText(
        JSON.stringify({
          type: 'assistant_reply',
          replyText: turnResult.replyText,
          sessionState: turnResult.sessionState,
          proposalId: turnResult.proposalId,
          proposalTotalMinor: turnResult.proposalTotalMinor,
          proposalItems: turnResult.proposalItems,
          proposalCharges: turnResult.proposalCharges,
          currency: turnResult.currency,
          isFastPath: turnResult.isFastPath,
          committedCart: turnResult.committedCart,
        }),
      );

      // 3. Sentence-level TTS Streaming for < 3.0s latency
      const chunker = new SentenceChunker(4);
      const sentences = chunker.push(turnResult.replyText);
      const remainder = chunker.flush();
      if (remainder) {
        sentences.push(remainder);
      }

      ws.sendText(JSON.stringify({ type: 'audio_stream_start' }));

      for (const sentence of sentences) {
        if (signal.aborted) break;

        for await (const audioChunk of this.tts.synthesizeStream(sentence, { abortSignal: signal })) {
          if (signal.aborted) break;
          tracker.markTtsFirstAudio();
          // Send raw binary 16kHz PCM audio chunk to client for instant playback!
          ws.sendBinary(audioChunk);
        }
      }

      if (!signal.aborted) {
        ws.sendText(JSON.stringify({ type: 'audio_stream_end' }));
        const metrics = tracker.markTurnEnd();
        ws.sendText(JSON.stringify({ type: 'latency_metrics', metrics }));
      }
    } catch (err) {
      if (!signal.aborted) {
        ws.sendText(JSON.stringify({ type: 'error', message: String(err) }));
      }
    }
  }
}
