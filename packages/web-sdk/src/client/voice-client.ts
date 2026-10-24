import { EventEmitter } from 'node:events';

export type VoiceClientState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'IDLE'
  | 'LISTENING'
  | 'PROCESSING'
  | 'SPEAKING'
  | 'ERROR';

export interface ProposalPayload {
  readonly proposalId: string;
  readonly totalMinor: number;
  readonly currency: string;
  readonly summaryText: string;
}

export interface VoiceClientEvents {
  stateChange: (state: VoiceClientState) => void;
  transcriptPartial: (text: string) => void;
  transcriptFinal: (text: string) => void;
  assistantReply: (replyText: string) => void;
  proposal: (proposal: ProposalPayload) => void;
  audioChunk: (pcmBuffer: Buffer | ArrayBuffer) => void;
  error: (err: Error) => void;
}

export class VoiceClient extends EventEmitter {
  private state: VoiceClientState = 'DISCONNECTED';
  private ws: any = null;
  private readonly gatewayUrl: string;
  private readonly sessionToken: string;

  constructor(options: { gatewayUrl: string; sessionToken: string }) {
    super();
    this.gatewayUrl = options.gatewayUrl;
    this.sessionToken = options.sessionToken;
  }

  public getState(): VoiceClientState {
    return this.state;
  }

  private setState(newState: VoiceClientState): void {
    this.state = newState;
    this.emit('stateChange', newState);
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setState('CONNECTING');
      const wsUrl = `${this.gatewayUrl}?token=${encodeURIComponent(this.sessionToken)}`;

      // Support browser WebSocket and Node WebSocket
      const WebSocketCtor =
        typeof (globalThis as any).WebSocket !== 'undefined'
          ? (globalThis as any).WebSocket
          : null;

      if (!WebSocketCtor) {
        // Fallback for headless environments
        this.setState('IDLE');
        resolve();
        return;
      }

      try {
        this.ws = new WebSocketCtor(wsUrl);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
          this.setState('IDLE');
          resolve();
        };

        this.ws.onmessage = (event: any) => {
          if (typeof event.data === 'string') {
            const msg = JSON.parse(event.data);
            this.handleServerMessage(msg);
          } else {
            // Binary audio chunk from TTS
            this.emit('audioChunk', event.data);
          }
        };

        this.ws.onerror = (err: any) => {
          this.setState('ERROR');
          this.emit('error', new Error('WebSocket connection error'));
          reject(err);
        };

        this.ws.onclose = () => {
          this.setState('DISCONNECTED');
        };
      } catch (err) {
        this.setState('ERROR');
        reject(err);
      }
    });
  }

  public sendAudioChunk(pcmChunk: Buffer | ArrayBuffer): void {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(pcmChunk);
    }
  }

  public startTurn(): void {
    this.setState('LISTENING');
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'start_turn' }));
    }
  }

  public stopTurn(): void {
    this.setState('PROCESSING');
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'stop_turn' }));
    }
  }

  public cancelTurn(): void {
    this.setState('IDLE');
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'cancel_turn' }));
    }
  }

  public sendTextInput(text: string): void {
    this.setState('PROCESSING');
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'text_input', text }));
    }
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState('DISCONNECTED');
  }

  private handleServerMessage(msg: any): void {
    switch (msg.type) {
      case 'transcript_partial':
        this.emit('transcriptPartial', msg.text);
        break;

      case 'transcript_final':
        this.emit('transcriptFinal', msg.text);
        break;

      case 'assistant_reply':
        this.emit('assistantReply', msg.replyText);
        if (msg.proposalId) {
          this.emit('proposal', {
            proposalId: msg.proposalId,
            totalMinor: msg.proposalTotalMinor,
            currency: msg.currency,
            summaryText: msg.replyText,
          });
        }
        break;

      case 'audio_stream_start':
        this.setState('SPEAKING');
        break;

      case 'audio_stream_end':
        this.setState('IDLE');
        break;

      case 'error':
        this.emit('error', new Error(msg.message));
        this.setState('IDLE');
        break;
    }
  }
}
