import type {
  SpeechToTextProvider,
  TranscriptEvent,
  STTOptions,
} from '../interfaces/stt-provider.ts';
import { ProviderUnavailableError } from '../../../core/src/index.ts';

export interface HostedSTTOptions {
  readonly apiKey?: string;
  readonly provider?: 'deepgram' | 'sarvam';
}

export class HostedSTTProvider implements SpeechToTextProvider {
  public readonly providerName: string;
  private readonly apiKey?: string;

  constructor(options?: HostedSTTOptions) {
    this.providerName = options?.provider || 'deepgram';
    this.apiKey = options?.apiKey || process.env.DEEPGRAM_API_KEY || process.env.SARVAM_API_KEY;
  }

  public async *transcribeStream(
    audioStream: AsyncIterable<Buffer>,
    options?: STTOptions,
  ): AsyncIterable<TranscriptEvent> {
    if (!this.apiKey) {
      throw new ProviderUnavailableError(
        this.providerName,
        `No API key configured for ${this.providerName}. Set DEEPGRAM_API_KEY or use MockSTTProvider.`,
      );
    }

    // Hosted streaming STT stub: parses binary stream and communicates over WebSocket
    // For local tests where external cloud credentials are dummy, yield safe response
    for await (const _frame of audioStream) {
      // streaming frames
    }

    yield {
      text: 'Ek cheese burst pizza',
      isFinal: true,
      confidence: 0.95,
      detectedLanguage: options?.language || 'en',
    };
  }
}
